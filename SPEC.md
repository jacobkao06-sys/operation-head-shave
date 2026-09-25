# OPERATION HEAD SHAVE — Build Spec

A public accountability system. If Jacob doesn't post a video for 7 days, a 72-hour
countdown starts and a designated person is dispatched to shave his head.

Hand this whole file to Claude Code as the project brief. Save it in the repo as
`SPEC.md` and keep a short `CLAUDE.md` pointing at it.

---

## 0. Decisions to lock before coding

Fill these in. Claude Code should stop and ask if any are blank.

| # | Decision | Status |
|---|---|---|
| D1 | Public hostname | `shave.jacobkao.com` |
| D2 | Protocol (Alice) hostname | `protocol.jacobkao.com` |
| D3 | Host platform | Vercel (see §2 for the Cloudflare alternative) |
| D4 | What counts as "a video"? | **CONFIRMED.** Any IG feed post or Reel. Stories do **not** count. |
| D5 | Does posting *during* the countdown cancel it? | **No.** Once failure is declared, only a verified photo stops it. |
| D6 | Who can confirm the shaved-head photo? | Jacob, via a signed admin link. Vision model pre-screens. |
| D7 | Alice's participation | **CONFIRMED — Alice agreed on 2026-09-25**, replacing Andrea, whose consent did not transfer. Her address goes in `ALICE_EMAIL`, env var only, never in the repo. Still open: that she has seen the actual email and has a way to opt out. |
| D8 | Barber send mode | **CONFIRMED.** Launch in `draft` (Jacob approves each send). Switchable to `auto` later on Jacob's explicit say-so — see §7. |
| D9 | Timezone for all display + boundary math | `America/New_York` |
| D10 | Platforms tracked | **Instagram only.** Jacob cross-posts every video to both IG and TikTok, so IG is a complete signal. No TikTok integration is needed — see §4. |

---

## 1. System overview

```
                 ┌────────────────────────────────────┐
  GitHub Actions │ cron: every 6h                     │
  (the scheduler)│  → POST /api/check  (CRON_SECRET)  │
                 │  → commits log/ back to repo       │
                 └───────────────┬────────────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │  /api/check              │
                    │  1. refresh IG token?    │
                    │  2. fetch /me/media      │
                    │  3. evaluate state       │
                    │  4. fire side effects    │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
      ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
      │ KV (state)   │   │ Resend       │   │ log/*.json   │
      │              │   │ → Alice     │   │ (git audit)  │
      │              │   │ → Jacob      │   │              │
      └──────┬───────┘   └──────────────┘   └──────────────┘
             │
   ┌─────────┴─────────┬──────────────────────┐
   ▼                   ▼                      ▼
shave.jacobkao.com  protocol.jacobkao.com  /admin
(SAFE / FAILURE)    (countdown + upload)   (overrides, templates)
```

---

## 2. Stack

**Default: Vercel.** One Next.js (App Router) deployment serving both hostnames.
Chosen because jacobkao.com is already an Astro site that likely deploys there, and
adding a subdomain is one CNAME.

- Runtime: Next.js 15, TypeScript, App Router, Tailwind
- State: Upstash Redis (Vercel Marketplace, free tier) — a single JSON blob under one key
- Image storage: Vercel Blob (free tier)
- Email: Resend (free tier: 3,000/mo, 100/day, verified domain required)
- Scheduler: **GitHub Actions cron**, not Vercel Cron
  - Vercel Hobby caps cron at once per day; Actions gives any cadence and a free
    tamper-evident audit trail via commits
  - Caveat: Actions disables scheduled workflows after 60 days of repo inactivity.
    The workflow must commit its log every run, which keeps the repo active.
- Vision check: Anthropic API (`claude-sonnet-4-6`) for shaved-head pre-screening

**Alternative: Cloudflare.** Workers + KV + R2 + native Cron Triggers, all one platform
with more generous free cron. Requires jacobkao.com's DNS zone to live on Cloudflare.
Only pick this if moving DNS is painless. Keep all platform calls behind the adapters
in §4 so this is a swap, not a rewrite.

---

## 3. State machine

Single source of truth, stored in KV under `ohs:state`, mirrored to `log/state.json`.

```ts
type Status = "SAFE" | "FAILURE" | "PENDING_REVIEW" | "RESOLVED";

interface State {
  status: Status;
  lastPostAt: string | null;        // ISO8601, from IG
  lastPostPermalink: string | null;
  lastPostId: string | null;
  lastCheckedAt: string | null;
  lastCheckOk: boolean;
  consecutiveStaleChecks: number;   // must reach 2 before FAILURE
  failureDeclaredAt: string | null;
  deadlineAt: string | null;        // failureDeclaredAt + 72h
  notifiedAliceAt: string | null;
  barberDraftSentAt: string | null;
  barberSentAt: string | null;
  submission: {
    blobKey: string;
    submittedAt: string;
    vision: { shaved: boolean; confidence: number; reason: string };
    confirmedBy: string | null;
    confirmedAt: string | null;
  } | null;
  paused: boolean;                  // manual freeze (travel, illness, etc.)
  pauseReason: string | null;
  tokenExpiresAt: string | null;
  version: number;                  // optimistic concurrency
}
```

### Transitions

| From | Trigger | To | Side effects |
|---|---|---|---|
| SAFE | `now - lastPostAt > 7d` AND `consecutiveStaleChecks >= 2` AND `!paused` | FAILURE | set `deadlineAt = now + 72h`; email Alice; email barber **draft** to Jacob; email Jacob an alert |
| FAILURE | image uploaded and accepted | PENDING_REVIEW | countdown display freezes; email Jacob with photo + confirm link |
| PENDING_REVIEW | Jacob rejects | FAILURE | countdown resumes from remaining time (see §6) |
| PENDING_REVIEW | Jacob confirms | RESOLVED | email all parties "protocol complete" |
| RESOLVED | new post detected with `timestamp > failureDeclaredAt` | SAFE | reset failure fields |
| any | admin override | any | logged with actor + reason |

### Hard rules

1. **Fail safe.** If the IG fetch throws, times out, or returns a non-200: set
   `lastCheckOk = false`, do **not** increment `consecutiveStaleChecks`, do **not**
   transition. Email Jacob if two consecutive checks fail.
2. **Idempotent side effects.** Every notification is guarded by its own `*At`
   timestamp. Alice gets exactly one dispatch email per failure episode.
3. **Server owns the clock.** `deadlineAt` is authoritative and stored server-side.
   The browser renders `deadlineAt - now` and re-syncs from `/api/state` every 30s.
   Never compute the deadline from page-load time.
4. **7 days means 168 hours** from the post's `timestamp`, not "7 calendar days."
5. Every transition appends a line to `log/events.ndjson`.

---

## 4. Instagram integration

### One-time manual setup (Jacob does this, not Claude Code)

1. ~~Convert Instagram to a Professional account.~~ **DONE — account is now Business.**
   Either Professional type (Business or Creator) works with this API; personal
   accounts have had no API access since the Basic Display shutdown in Dec 2024.
   Note for later: if the account ever reverts to personal, every check breaks —
   see the runbook in §12.
2. developers.facebook.com → Create App → use case **"Instagram"** → app type
   **Business**. Skip connecting a business portfolio. A Business account with no
   linked Facebook Page is fine on the Business Login for Instagram path — that is
   precisely what it exists for.
3. Leave the app in **Development mode**. Own-account access is Standard Access and
   needs no App Review or business verification.
4. Instagram product → **API setup with Instagram business login**. Add Jacob's IG
   account under Instagram Tester / roles and accept the invite from
   Instagram → Settings → Apps and Websites.
5. Set the OAuth redirect URI to `https://shave.jacobkao.com/api/auth/instagram/callback`.
6. Run the app's `/api/auth/instagram/start` flow once to mint the token.

### Token lifecycle (Claude Code implements)

```
auth code (1h)
  → POST https://api.instagram.com/oauth/access_token          → short-lived (1h)
  → GET  https://graph.instagram.com/access_token
         ?grant_type=ig_exchange_token                          → long-lived (60d)
  → GET  https://graph.instagram.com/refresh_access_token
         ?grant_type=ig_refresh_token                           → +60d
```

- Scope: `instagram_business_basic`
- Refresh whenever `tokenExpiresAt - now < 30 days`. Token must be ≥24h old to refresh.
- Store the refreshed token back into KV (env vars can't be rewritten at runtime) and
  write `tokenExpiresAt`.
- **Alarm:** if `tokenExpiresAt - now < 10 days`, email Jacob every run. An expired
  token cannot be refreshed — it requires re-running the OAuth flow by hand.

### The check

```
GET https://graph.instagram.com/v23.0/me/media
    ?fields=id,timestamp,permalink,media_type
    &limit=10
    &access_token=<token>
```

- Pin the API version in an env var (`IG_API_VERSION`) so a Meta deprecation is a
  one-line fix.
- Take the max `timestamp` across returned items whose `media_type` is in the
  configured allowlist (default: `IMAGE`, `VIDEO`, `CAROUSEL_ALBUM`, `REELS`).
- **Stories are excluded, confirmed.** They do not appear on the `/me/media` edge at
  all — they live on a separate `/me/stories` edge, which this app must never query.
  This means the exclusion is enforced by the API surface itself, not just by the
  allowlist, so there is no way for a Story to accidentally count.
- Rate limit is generous (200 calls/hour/app). Checking every 6h is nowhere near it.

### Abstraction

```ts
interface PostSource {
  name: string;
  getLatestPost(): Promise<{ id: string; timestamp: string; permalink: string } | null>;
}
```

Implementations: `InstagramSource` and `MockSource` (env-driven, for testing). The
checker takes the most recent post across all enabled sources — a list of one today.

**Why there is no TikTok integration.** Jacob cross-posts every video to both
platforms, so Instagram is a complete signal for "did a video go out." Building the
TikTok Display API path would require developer-account registration plus human
review and approval of both Login Kit and the Display API product, with
`user.info.basic` and `video.list` scopes granted — weeks of latency for zero
additional coverage. Keep the `PostSource` interface anyway; it costs nothing and
means adding TikTok later is one file.

**The one gap this leaves:** if Jacob ever posts a video to TikTok *only* and skips
Instagram, the system will declare failure on a week he actually posted. This is a
known, accepted tradeoff. Two mitigations, both cheap:
- The failure email to Jacob fires at the same moment as Alice's, so he gets
  72 hours of warning and can override from `/admin` if the miss was a cross-post
  slip rather than a real lapse.
- Log the override reason. If it happens more than once, that's the signal to
  actually build `TikTokSource`.

### Fallbacks if Instagram access is unavailable

- **Sanctioned:** `MANUAL_HEARTBEAT` mode. Jacob POSTs a permalink to
  `/api/heartbeat` with a shared secret; the server fetches the URL and confirms it
  returns a valid Instagram OG page before accepting the timestamp. Self-reported but
  not trivially faked, and every heartbeat is logged publicly.
- **Not recommended:** third-party scrapers (Apify and similar) and RSS bridges.
  They violate Instagram's terms, break without warning, and will eventually declare
  failure on a week you did post. If used at all, only as a *secondary* signal that
  can prove SAFE but can never trigger FAILURE on its own.

---

## 5. Public site — `shave.jacobkao.com`

Server-rendered, no client JS required to read the status. Countdown is progressive
enhancement.

### Content

**SAFE mode** — heading `SAFE` in phosphor green.

> Jacob **has** posted a video in the past week, so his hair is safe.

(Note: the original brief read "so he his hair is safe." Typo corrected.)

**FAILURE mode** — heading `FAILURE` in alert red.

> Jacob has failed to post a video in the past 7 days. Head shave protocol has
> commenced and operation Jacob goes bald is imminent.

Plus the live 72-hour countdown, large and monospaced: `71:58:04`.

Both modes render a small status block underneath in dim green:

```
LAST POST ......... 2026-09-14T18:22:00Z (7d 2h ago)
LAST CHECK ........ 2026-09-21T06:00:12Z [OK]
NEXT CHECK ........ 2026-09-21T12:00:00Z
```

### Visual direction

- Background `#000000`. Safe text `#00FF41`. Failure text `#FF2D2D`. Dim UI `#00803A`.
- Monospace stack: `ui-monospace, "JetBrains Mono", "IBM Plex Mono", Menlo, monospace`.
- Heading: `clamp(4rem, 18vw, 14rem)`, uppercase, tight tracking, `text-shadow` glow.
- Captions ~1rem, max-width ~60ch, generous line-height.
- Effects: CRT scanline overlay (repeating-linear-gradient), faint vignette, blinking
  block cursor after the heading, a short boot-sequence typewriter reveal on load.
- Respect `prefers-reduced-motion: reduce` — drop flicker, typewriter, and scanlines.
- Contrast must stay legible. Glow is decoration, never the only signal.
- FAILURE mode may pulse slowly (2s ease) but must not strobe.

Open Graph image should render the current status so link previews are part of the joke.

---

## 6. Protocol site — `protocol.jacobkao.com`

Unlisted, not secret-grade. Reached at `/p/<token>` where `<token>` is a 32-char
URL-safe random string generated at failure time and included in Alice's link.

- `noindex, nofollow` meta + `X-Robots-Tag` header + `robots.txt` disallow
- Invalid/expired token → generic 404, no information leak
- Works well on a phone; assume Alice opens it on mobile

### Contents

1. Countdown, same styling as the main site, synced to server `deadlineAt`.
2. One line of instruction: `UPLOAD PROOF OF SHAVED HEAD TO HALT COUNTDOWN`.
3. File input (camera capture enabled on mobile: `accept="image/*" capture="environment"`).
4. Result state after upload.

### Upload handling

- Accept `image/jpeg|png|webp|heic`, max 10 MB. Validate by magic bytes, not extension.
- Strip EXIF (including GPS) before storing.
- Store in Blob with a random key. Private; served only through a signed admin route.
- Rate limit: 5 uploads/hour per token, 20/day globally. Return 429 with a plain
  hacker-styled message.
- Run the vision pre-screen:

```
model: claude-sonnet-4-6
system: You are verifying a photo. Respond with ONLY a JSON object, no markdown
        fences, no preamble: {"shaved": boolean, "confidence": number between 0
        and 1, "reason": string under 20 words, "is_person": boolean}
user:   [image] Does this photo show a real person whose head has been shaved
        (bald or buzzed to the scalp)?
```

- Parse defensively (strip fences, try/catch, treat any parse failure as rejection).
- `is_person && shaved && confidence >= 0.7` → accept → `PENDING_REVIEW`, countdown
  freezes, Jacob emailed with the photo and Confirm / Reject links.
- Otherwise → reject with a reason, countdown keeps running, log the attempt.

**Freeze semantics.** On entering PENDING_REVIEW, store `remainingMs = deadlineAt - now`
and clear `deadlineAt`. On rejection, set `deadlineAt = now + remainingMs`. This is
what "pause" means — time stops, it doesn't reset.

---

## 7. Notifications

### Provider

Resend. Verify a **subdomain** (`mail.jacobkao.com`) rather than the root domain so a
mishap here can't hurt deliverability for your normal mail. Add the SPF/DKIM/DMARC
records Resend gives you. Free tier is 3,000/month with a 100/day cap — far beyond
what this needs.

**SMS:** skip at launch. US long-code SMS via Twilio requires A2P 10DLC brand and
campaign registration (fees, days-to-weeks of review). If a push-style ping is
wanted, add a Telegram bot (`sendMessage` via bot token) — free, instant, five lines
of code. Build `Notifier` as an interface with `EmailNotifier` and a stubbed
`TelegramNotifier`.

```ts
interface Notifier {
  send(to: string, subject: string, body: string): Promise<{ id: string }>;
}
```

### Templates — must be editable without a redeploy

Store templates in KV under `ohs:templates:<name>`, seeded on first boot from files in
`/templates`. Editable from `/admin`. Simple `{{variable}}` interpolation.

Available variables: `{{deadline_local}}`, `{{deadline_iso}}`, `{{hours_remaining}}`,
`{{protocol_url}}`, `{{last_post_date}}`, `{{days_since_post}}`, `{{public_url}}`.

**`templates/alice.md`** (v1 content, per brief — keep it changeable):

```
Subject: OPERATION HEAD SHAVE — PROTOCOL ACTIVE

Go shave Jacob's head.

Countdown and instructions: {{protocol_url}}
Deadline: {{deadline_local}}
```

**`templates/barber.md`** — PLACEHOLDER, do not finalize:

```
Subject: [PLACEHOLDER — Mobile barber inquiry]

[PLACEHOLDER. Copy TBD. Recipient: <set BARBER_EMAIL in the host env — never here, see §13>
 Source: https://www.bookmobilebarber.com/contact
 Must include: service requested, location, date window, contact info.]
```

**`templates/jacob-alert.md`**, **`templates/jacob-review.md`**,
**`templates/token-expiry.md`** — also files, also editable.

### The barber step — safety rails

`BARBER_MODE` env var. **Launch value: `draft`** (confirmed).

- `draft` — render the template and email it **to Jacob** with a one-click
  `/api/barber/send?token=...` approve link. Nothing reaches the barber without a
  human click. The approve link is single-use and expires with the failure episode.
- `auto` — send directly to the barber the moment failure is declared.
- `off` — skip the barber step entirely.

**Switching to `auto` later.** Jacob has said he wants this reachable on his word, so
build it as a deliberate two-key action rather than a one-character edit:

1. Set `BARBER_MODE=auto` in the host's env.
2. Set `BARBER_CONFIRM_PHRASE` to the exact string `SEND WITHOUT ASKING`.

If `BARBER_MODE=auto` and the phrase doesn't match exactly, the app falls back to
`draft` and emails Jacob a warning that auto-send was requested but not armed. This
keeps a stray env edit or a copied `.env.example` from mailing a real business. Both
values should also be togglable from `/admin` for the same session, so Jacob can arm
it from his phone without a redeploy.

Under all modes: hard cap of one barber email per failure episode, enforced by
`barberSentAt`, and no retries on failure — a bounced send alerts Jacob rather than
re-attempting. Never CC or BCC the barber on anything else. The template stays
`PLACEHOLDER` until Jacob writes the real copy; if `BARBER_MODE=auto` while the
template still contains the string `PLACEHOLDER`, refuse to send and alert.

---

## 8. Cron and audit log

`.github/workflows/check.yml`:

```yaml
on:
  schedule:
    - cron: "0 */6 * * *"   # every 6 hours UTC
  workflow_dispatch:         # manual trigger for testing
```

Each run:
1. `curl -X POST $APP_URL/api/check -H "Authorization: Bearer $CRON_SECRET"`
2. Write the returned state to `log/state.json` and append to `log/events.ndjson`
3. Commit with message `chore(log): check <timestamp> <status>` if anything changed

This gives a public, timestamped, tamper-evident record in git history — and keeps the
repo active so GitHub doesn't disable the schedule after 60 days.

Note: GitHub cron is best-effort and can run several minutes late. Irrelevant at a
7-day resolution, but don't build anything minute-precise on it.

---

## 9. Admin — `/admin`

Auth: single long bearer token in `ADMIN_TOKEN`, exchanged for an HttpOnly signed
cookie. No user accounts.

Capabilities:
- View full state and recent events
- **Simulate**: force `lastPostAt` to an arbitrary date and run a check — lets you
  exercise the entire failure chain without waiting 7 days
- **Dry run**: global flag that redirects every outbound email to Jacob with a
  `[DRY RUN → intended recipient]` banner
- Pause / unpause with a reason
- Edit templates
- Confirm / reject a pending submission, view the uploaded photo
- Manually reset to SAFE
- Re-run the Instagram OAuth flow
- Every admin action appends to the event log with actor and reason

---

## 10. Environment variables

```
# App
PUBLIC_URL=https://shave.jacobkao.com
PROTOCOL_URL=https://protocol.jacobkao.com
TZ_DISPLAY=America/New_York
FAILURE_THRESHOLD_HOURS=168
COUNTDOWN_HOURS=72
DRY_RUN=true                      # flip to false only after a full simulated run

# Instagram
IG_APP_ID=
IG_APP_SECRET=
IG_API_VERSION=v23.0
IG_MEDIA_TYPES=IMAGE,VIDEO,CAROUSEL_ALBUM,REELS
# access token + expiry live in KV, not here

# Storage
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
BLOB_READ_WRITE_TOKEN=

# Email
RESEND_API_KEY=
MAIL_FROM=protocol@mail.jacobkao.com
JACOB_EMAIL=
ALICE_EMAIL=
BARBER_EMAIL=<set BARBER_EMAIL in the host env — never here, see §13>
BARBER_MODE=draft                 # draft | auto | off — launch as draft
BARBER_CONFIRM_PHRASE=            # must equal "SEND WITHOUT ASKING" to arm auto

# Vision
ANTHROPIC_API_KEY=

# Auth
CRON_SECRET=
ADMIN_TOKEN=
```

Nothing here is ever exposed to the client. Verify the production bundle contains no
secret before launch.

---

## 11. Build phases

Claude Code should complete and verify each phase before moving on.

**Phase 1 — Shell (no integrations).**
Next.js app, both routes, full hacker styling, `MockSource` driven by an env var.
State machine fully implemented against mock data with unit tests for every transition
in §3. Acceptance: flipping the mock date flips the site between SAFE and FAILURE, and
the countdown renders and ticks correctly.

**Phase 2 — Persistence.** Upstash wired in, optimistic concurrency via `version`,
`/api/state` endpoint. Acceptance: state survives redeploy.

**Phase 3 — Instagram.** OAuth start/callback routes, token exchange, refresh logic,
`InstagramSource`, expiry alarm. Acceptance: `/api/check` returns the real last post
date; a forced token refresh succeeds and persists.

**Phase 4 — Notifications.** Resend, template engine, KV-backed templates, dry-run
mode, idempotency guards. Acceptance: simulated failure sends exactly one Alice email
and one Jacob draft, and re-running the check sends nothing further.

**Phase 5 — Protocol page.** Token generation, upload, validation, EXIF strip, vision
pre-screen, PENDING_REVIEW freeze, confirm/reject links. Acceptance: a shaved-head
photo halts the countdown; a photo of a dog does not.

**Phase 6 — Cron + audit log.** GitHub Actions workflow, log commits, `workflow_dispatch`.

**Phase 7 — Admin.** Simulate, pause, template editor, manual overrides.

**Phase 8 — Polish.** OG image, `prefers-reduced-motion`, 404s, Lighthouse pass,
README with the runbook from §12.

---

## 12. Runbook

| Symptom | Cause | Fix |
|---|---|---|
| Site stuck on an old date | Token expired | Re-run `/api/auth/instagram/start`. Expired tokens cannot be refreshed. |
| `OAuthException code 190` | Token invalid/revoked | Same as above. Check the IG account is still Professional. |
| Empty `/me/media` | Account reverted to personal, or tester role removed | Re-convert to Creator; re-accept the app invite in IG settings. |
| Declared failure but Jacob did post | Post was a Story (never counts), or the video went to TikTok only and wasn't cross-posted | Reset via admin with a logged reason. Repeat occurrences justify building `TikTokSource`. |
| Declared failure, post exists on IG | Media type not in allowlist | Check `IG_MEDIA_TYPES` against the post's `media_type`. |
| Countdown jumps or resets on refresh | Client-side clock math | Countdown must derive from server `deadlineAt` only. |
| Alice got five emails | Idempotency guard missing | `notifiedAliceAt` must be set in the same write as the status change. |
| Emails land in spam | Domain not verified | Complete Resend DNS records; keep DMARC at `p=none` initially. |
| Cron silently stopped | 60 days of repo inactivity | Workflow must commit each run. Re-enable in the Actions tab. |
| Vision check rejects a valid photo | Bad lighting, hat, low confidence | Admin can confirm manually — the human override always wins. |

---

## 13. Explicit non-goals and prohibitions

- **Never** email `<set BARBER_EMAIL in the host env — never here, see §13>` without a human click while
  `BARBER_MODE=draft`. Do not add retry logic to barber sends. Do not send at all
  while the template contains the string `PLACEHOLDER`, in any mode.
- **Never** scrape Instagram HTML or use logged-in session cookies.
- **Never** store Alice's or the barber's contact details in the repository.
- **Never** trust the client clock, client-reported status, or client-side validation
  of uploads.
- **Never** transition to FAILURE on an API error, timeout, or empty response.
- Do not commit uploaded photos to git.
- Do not index the protocol page.

---

## 14. Pre-launch checklist

- [x] Instagram converted to a Professional (Business) account
- [ ] Meta app created, long-lived token minted
- [ ] `tokenExpiresAt` visible in `/admin` and ~60 days out
- [ ] `DRY_RUN=true`, full simulated failure run completed, all emails reviewed
- [x] Alice has consented — agreed 2026-09-25, replacing Andrea
- [ ] Alice knows what the email will look like and has a way to opt out
- [ ] `ALICE_EMAIL` set in host env (not in repo, not in `.env.example`)
- [ ] Barber template still says PLACEHOLDER, `BARBER_MODE=draft`, `BARBER_CONFIRM_PHRASE` empty
- [ ] DNS: both subdomains resolve, TLS valid
- [ ] Resend domain verified, test email delivered to inbox not spam
- [ ] GitHub Actions run succeeds manually via `workflow_dispatch`
- [ ] Production bundle audited — no secrets client-side
- [ ] Calendar reminder set for day 50 to verify token refresh happened
- [ ] `DRY_RUN=false`
