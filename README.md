# OPERATION HEAD SHAVE

A public accountability system. If Jacob doesn't post a video for 7 days, a 72-hour
countdown starts and a designated person is dispatched to shave his head.

**[SPEC.md](SPEC.md) is the source of truth.** This file covers running it and fixing it.

| | |
|---|---|
| Public | `shave.jacobkao.com` — SAFE / FAILURE, live countdown |
| Protocol | `protocol.jacobkao.com/p/<token>` — countdown + proof upload, unlisted |
| Admin | `shave.jacobkao.com/admin` — simulate, pause, templates, overrides |

---

## Running it locally

```bash
npm install
cp .env.example .env.local   # the defaults already run entirely offline
npm run dev
```

With no credentials at all the app still runs end to end:

| Missing | Fallback |
|---|---|
| Upstash | a gitignored `.ohs-local-state.json` (refuses to engage in production) |
| Resend | `.ohs-outbox/*.txt`, one file per message (hard error in production) |
| Vercel Blob | `.ohs-uploads/` |
| Instagram | `USE_MOCK_SOURCE=true` + `MOCK_LAST_POST_AT=-8d` |
| Anthropic | `VISION_STUB={"shaved":true,...}` (ignored in production) |

### Poking at it

```bash
npm run demo              # FAILURE, countdown running — the interesting one
npm run demo safe
npm run demo pending      # photo submitted, countdown frozen, awaiting review
npm run demo resolved
```

Each run wipes local state and rebuilds it by driving the real HTTP endpoints, so
what you see is the actual state machine rather than a fixture. It prints every
URL including the current protocol token and the barber approve link.

Drive the whole failure chain by hand without waiting seven days:

```bash
curl -s -X POST localhost:3000/api/check -H "Authorization: Bearer $CRON_SECRET" -H 'content-type: application/json' -d '{"simulateLastPostAt":"2026-09-01T00:00:00Z"}'
```

Two consecutive stale checks are required, so run it twice. Or use **Simulate** in `/admin`.

```bash
npm test          # the state machine and the mail rails
npm run build     # typecheck + production build
npm run lint
```

---

## How it fits together

```
GitHub Actions (every 6h)  →  POST /api/check  →  evaluateCheck()  →  KV
        │                                              │
        └── commits log/ back to the repo              └── effects → Resend
```

`src/lib/state.ts` is a pure reducer — `(state, input, config) → { state, effects }`. It
does no I/O and reads no clock, which is why every transition in SPEC.md §3 is covered
by a millisecond-fast unit test. The caller persists the state, *then* performs the
effects: a crash in between loses a notification, which is the safe direction and shows
up in the log. The reverse order would mail Andrea five times.

### The five rails that matter

1. **Fail safe.** A fetch error, a timeout, a non-200, or an empty media list is an
   *inconclusive* check: it never advances the stale counter and never transitions. It
   does alert, because a blind rig is still a broken rig.
2. **One email per episode.** Every notification is guarded by its own `*At` timestamp,
   written in the same object as the status change.
3. **The server owns the clock.** `deadlineAt` is authoritative. The browser renders
   `deadlineAt - now` and re-syncs every 30s.
4. **The barber is unreachable by accident.** Four independent checks, listed below.
5. **Nothing the client says is believed** — not the filename, the content type, the
   status, or the clock.

### The barber rails (SPEC.md §7, §13)

Mail can only reach `BARBER_EMAIL` if *all* of these hold:

- `BARBER_MODE=auto` **and** `BARBER_CONFIRM_PHRASE` is exactly `SEND WITHOUT ASKING`,
  or a human clicked the single-use approve link from the draft email
- `templates/barber.md` no longer contains the string `PLACEHOLDER`
- `barberSentAt` is unset for this episode
- `DRY_RUN` is off

A mismatched confirm phrase silently falls back to `draft` and warns. A failed send is
never retried — it alerts instead.

---

## Deploying

1. Push to GitHub, import into Vercel.
2. Add both domains in Vercel and point `shave` and `protocol` at it with CNAMEs.
3. Add the Upstash Redis and Blob integrations from the Vercel Marketplace.
4. Set every variable from `.env.example` in the Vercel dashboard. Keep `DRY_RUN=true`.
5. Verify a subdomain (`mail.jacobkao.com`) in Resend, not the root domain, and add its
   SPF/DKIM/DMARC records. Start DMARC at `p=none`.
6. Repository secrets for the workflow: `APP_URL` and `CRON_SECRET`.
7. Do the one-time Meta app setup in SPEC.md §4, then visit `/admin` → **re-run the
   Instagram OAuth flow**. Confirm `IG TOKEN EXPIRES` lands ~60 days out.
8. Run the workflow manually via `workflow_dispatch` and check that `log/` gets a commit.
9. Simulate a full failure from `/admin`, read every email in the outbox, then set
   `DRY_RUN=false`.

The pre-launch checklist is SPEC.md §14.

---

## Runbook

| Symptom | Cause | Fix |
|---|---|---|
| Site stuck on an old date | Token expired | Re-run `/api/auth/instagram/start` from `/admin`. Expired tokens **cannot** be refreshed. |
| `OAuthException code 190` | Token invalid or revoked | Same. Check the IG account is still Professional. |
| Empty `/me/media` | Account reverted to personal, or the tester role was removed | Re-convert to Business/Creator; re-accept the app invite in IG → Settings → Apps and Websites. Note this is treated as an *inconclusive* check, so nothing will have transitioned. |
| Declared failure but Jacob did post | The post was a Story (never counts), or the video went to TikTok only | Reset from `/admin` with a logged reason. Twice = build `TikTokSource`. |
| Declared failure, post exists on IG | Media type not in the allowlist | Compare `IG_MEDIA_TYPES` against the post's `media_type`. |
| Countdown jumps or resets on refresh | Client-side clock math | It must derive from the server's `deadlineAt` only. See `src/components/Countdown.tsx`. |
| Andrea got five emails | Idempotency guard missing | `notifiedAndreaAt` must be set in the same write as the status change. `src/lib/state.ts` does this; there is a test for it. |
| Emails land in spam | Domain not verified | Complete the Resend DNS records; keep DMARC at `p=none` initially. |
| Cron silently stopped | 60 days of repo inactivity | The workflow commits every run to prevent this. Re-enable it in the Actions tab. |
| Vision check rejects a valid photo | Bad lighting, a hat, low confidence | Confirm manually from `/admin` — the human override always wins. |
| `/api/check` returns 500 | The rig is broken, not Jacob | Nothing has transitioned. Read the error, check Upstash and the IG token. |
| A check reports `conflict: true` | Two writers raced | Harmless. The next scheduled run re-evaluates. |

### Calendar reminders worth setting

- **Day 50** after minting the token: confirm the automatic refresh happened. The alarm
  emails daily inside 10 days, but a dead inbox is not a monitoring system.
- The workflow disables itself after 60 days of repo inactivity. It commits each run
  specifically to stop that, so an unexplained gap in `log/` is the signal.

---

## What this deliberately does not do

- No Instagram scraping and no session cookies, ever. Official Graph API only.
- No TikTok integration. Jacob cross-posts everything, so Instagram is a complete
  signal; the `PostSource` interface keeps TikTok one file away if that stops being true.
- No SMS at launch — US long-code needs A2P 10DLC registration. `TelegramNotifier` is
  stubbed against the same interface if a push ping is wanted.
- Andrea's and the barber's addresses live only in the host's environment, never here.
- Uploaded photos are never committed to git.
