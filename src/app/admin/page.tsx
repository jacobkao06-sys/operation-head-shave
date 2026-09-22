/**
 * /admin. SPEC.md §9. Same terminal palette, no framework, no client JS:
 * everything here is a plain form posting to a server action.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { isAdmin } from "@/lib/auth";
import { barberAutoArmed, env_ } from "@/lib/config";
import { TEMPLATE_NAMES, loadTemplate } from "@/lib/notify/templates";
import { loadIg, loadOverrides, loadState, recentEvents } from "@/lib/store";
import { ago, fmtIso, fmtLocal } from "@/lib/time";
import {
  doCheck,
  doConfirm,
  doPause,
  doReject,
  doResetTemplate,
  doResetToSafe,
  doSaveOverrides,
  doSaveTemplate,
  doUnpause,
  signIn,
  signOut,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "ADMIN",
  robots: { index: false, follow: false },
};

const sectionStyle: React.CSSProperties = {
  border: "1px solid var(--fg-dim)",
  padding: "1.1rem 1.2rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.8rem",
};

function H({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ margin: 0, fontSize: "0.9rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>
      {children}
    </h2>
  );
}

export default async function AdminPage() {
  if (!(await isAdmin())) {
    return (
      <main data-status="SAFE" style={{ padding: "3rem 1.5rem", maxWidth: "34rem" }}>
        <h1 className="heading" style={{ fontSize: "clamp(1.8rem, 7vw, 3rem)" }}>
          ADMIN
          <span className="cursor" aria-hidden="true" />
        </h1>
        <form action={signIn} style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "2rem" }}>
          <label htmlFor="token" className="statusblock" style={{ margin: 0 }}>
            ADMIN_TOKEN
          </label>
          <input id="token" className="field" type="password" name="token" autoComplete="off" required />
          <button className="btn" type="submit">
            SIGN IN
          </button>
        </form>
      </main>
    );
  }

  const [state, events, overrides, ig] = await Promise.all([
    loadState(),
    recentEvents(60),
    loadOverrides(),
    loadIg(),
  ]);
  const templates = await Promise.all(
    TEMPLATE_NAMES.map(async (name) => ({ name, source: await loadTemplate(name) })),
  );
  const now = new Date();
  const effectiveDryRun = overrides.dryRun ?? env_.dryRun();
  const effectiveMode = overrides.barberMode ?? env_.barberMode();
  const armed =
    effectiveMode === "auto" &&
    (overrides.barberConfirmPhrase !== undefined
      ? overrides.barberConfirmPhrase === "SEND WITHOUT ASKING"
      : barberAutoArmed());
  const barberPlaceholder = (templates.find((t) => t.name === "barber")?.source ?? "").includes(
    "PLACEHOLDER",
  );

  return (
    <main
      data-status={state.status}
      style={{
        padding: "clamp(1.25rem, 4vw, 2.5rem)",
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        maxWidth: "72rem",
        margin: "0 auto",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
        <h1 className="heading" style={{ fontSize: "clamp(1.6rem, 6vw, 2.6rem)" }}>
          ADMIN / {state.status}
        </h1>
        <form action={signOut}>
          <button className="btn" type="submit" style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}>
            SIGN OUT
          </button>
        </form>
      </header>

      {effectiveDryRun ? (
        <p className="statusblock" style={{ margin: 0, border: "1px dashed var(--fg)", padding: "0.7rem 0.9rem" }}>
          DRY RUN IS ON — every email goes to {env_.jacobEmail() ?? "(JACOB_EMAIL unset)"} with a banner
          naming the intended recipient. Nothing leaves the building.
        </p>
      ) : (
        <p className="statusblock" style={{ margin: 0, border: "1px solid var(--failure)", padding: "0.7rem 0.9rem", color: "var(--failure)" }}>
          DRY RUN IS OFF — MAIL IS LIVE.
        </p>
      )}

      <section style={sectionStyle}>
        <H>State</H>
        <pre className="statusblock" style={{ margin: 0 }}>
{`STATUS ............ ${state.status}${state.paused ? `  (PAUSED: ${state.pauseReason})` : ""}
EPISODE ........... ${state.episode}
LAST POST ......... ${fmtIso(state.lastPostAt)}  ${state.lastPostAt ? ago(state.lastPostAt, now) : ""}
LAST CHECK ........ ${fmtIso(state.lastCheckedAt)} [${state.lastCheckOk ? "OK" : "FAIL"}]
STALE STREAK ...... ${state.consecutiveStaleChecks} / 2
FAILED STREAK ..... ${state.consecutiveFailedChecks}
DEADLINE .......... ${fmtLocal(state.deadlineAt)}
FROZEN REMAINDER .. ${state.remainingMs !== null ? `${(state.remainingMs / 3_600_000).toFixed(2)}h` : "—"}
ANDREA NOTIFIED ... ${fmtIso(state.notifiedAndreaAt)}
BARBER DRAFT ...... ${fmtIso(state.barberDraftSentAt)}
BARBER SENT ....... ${fmtIso(state.barberSentAt)}
IG TOKEN EXPIRES .. ${fmtIso(state.tokenExpiresAt ?? ig?.expiresAt ?? null)}${
  (state.tokenExpiresAt ?? ig?.expiresAt)
    ? `  (${ago(state.tokenExpiresAt ?? ig!.expiresAt, now)})`
    : "  — no token minted yet"
}
VERSION ........... ${state.version}`}
        </pre>
        <p className="statusblock" style={{ margin: 0 }}>
          <a href="/api/auth/instagram/start">RE-RUN THE INSTAGRAM OAUTH FLOW →</a>
          {"   "}
          <Link href="/">PUBLIC PAGE →</Link>
        </p>
      </section>

      <section style={sectionStyle}>
        <H>Simulate a check</H>
        <p className="statusblock" style={{ margin: 0 }}>
          Forces lastPostAt to an arbitrary date and runs a full check, so the whole failure chain is
          exercisable without waiting 7 days. Two consecutive stale checks are still required.
        </p>
        <form action={doCheck} style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <input
            className="field"
            style={{ flex: "1 1 22rem" }}
            type="text"
            name="simulateLastPostAt"
            placeholder="2026-09-01T12:00:00Z  (blank = a real check)"
          />
          <button className="btn" type="submit">
            RUN CHECK
          </button>
        </form>
      </section>

      {state.status === "PENDING_REVIEW" && state.submission ? (
        <section style={sectionStyle}>
          <H>Pending submission</H>
          <pre className="statusblock" style={{ margin: 0 }}>
{`SUBMITTED ......... ${fmtLocal(state.submission.submittedAt)}
VISION ............ shaved=${state.submission.vision.shaved} confidence=${state.submission.vision.confidence.toFixed(2)}
REASON ............ ${state.submission.vision.reason}`}
          </pre>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/photo/${state.submission.blobKey}`}
            alt="submitted proof"
            style={{ maxWidth: "min(100%, 26rem)", border: "1px solid var(--fg-dim)" }}
          />
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            <form action={doConfirm}>
              <button className="btn" type="submit">
                CONFIRM — PROTOCOL COMPLETE
              </button>
            </form>
            <form action={doReject} style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
              <input className="field" style={{ width: "18rem" }} name="reason" placeholder="reason" />
              <button className="btn" type="submit">
                REJECT — RESUME COUNTDOWN
              </button>
            </form>
          </div>
          <p className="statusblock" style={{ margin: 0 }}>
            The human override always wins. If the model was wrong, confirm anyway.
          </p>
        </section>
      ) : null}

      <section style={sectionStyle}>
        <H>Overrides</H>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          {state.paused ? (
            <form action={doUnpause}>
              <button className="btn" type="submit">
                UNPAUSE
              </button>
            </form>
          ) : (
            <form action={doPause} style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
              <input className="field" style={{ width: "18rem" }} name="reason" placeholder="reason for the pause" required />
              <button className="btn" type="submit">
                PAUSE
              </button>
            </form>
          )}
        </div>
        <form action={doResetToSafe} style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <input
            className="field"
            style={{ flex: "1 1 22rem" }}
            name="reason"
            placeholder="reason — e.g. cross-posted to TikTok only"
            required
          />
          <button className="btn" type="submit">
            RESET TO SAFE
          </button>
        </form>
        <p className="statusblock" style={{ margin: 0 }}>
          Both are logged with an actor and a reason. If a reset for a cross-post slip happens twice,
          that is the signal to build TikTokSource (§4).
        </p>
      </section>

      <section style={sectionStyle}>
        <H>Mail rails</H>
        <form action={doSaveOverrides} style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
          <label className="statusblock" style={{ margin: 0 }}>
            <input type="checkbox" name="dryRun" defaultChecked={effectiveDryRun} /> DRY RUN — redirect
            all mail to Jacob
          </label>
          <label className="statusblock" style={{ margin: 0 }}>
            BARBER MODE{" "}
            <select className="field" name="barberMode" defaultValue={effectiveMode} style={{ width: "10rem", display: "inline-block" }}>
              <option value="draft">draft</option>
              <option value="auto">auto</option>
              <option value="off">off</option>
            </select>
          </label>
          <label className="statusblock" style={{ margin: 0 }}>
            CONFIRM PHRASE — auto-send stays disarmed unless this is exactly{" "}
            <code>SEND WITHOUT ASKING</code>
            <input
              className="field"
              name="barberConfirmPhrase"
              defaultValue={overrides.barberConfirmPhrase ?? ""}
              autoComplete="off"
            />
          </label>
          <button className="btn" type="submit" style={{ alignSelf: "flex-start" }}>
            SAVE
          </button>
        </form>
        <pre className="statusblock" style={{ margin: 0 }}>
{`EFFECTIVE MODE .... ${effectiveMode}
AUTO ARMED ........ ${armed ? "YES" : "no"}
BARBER TEMPLATE ... ${barberPlaceholder ? "still says PLACEHOLDER — sends are refused in every mode" : "real copy"}
BARBER ADDRESS .... ${env_.barberEmail() ?? "(BARBER_EMAIL unset)"}`}
        </pre>
      </section>

      <section style={sectionStyle}>
        <H>Templates</H>
        <p className="statusblock" style={{ margin: 0 }}>
          Stored in KV, seeded from /templates. Edits take effect immediately, no redeploy. Variables:{" "}
          <code>
            {"{{deadline_local}} {{deadline_iso}} {{hours_remaining}} {{protocol_url}} {{last_post_date}} {{days_since_post}} {{public_url}}"}
          </code>
        </p>
        {templates.map((t) => (
          <details key={t.name}>
            <summary className="statusblock" style={{ cursor: "pointer" }}>
              {t.name}
              {t.source.includes("PLACEHOLDER") ? "  [PLACEHOLDER]" : ""}
            </summary>
            <form action={doSaveTemplate} style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginTop: "0.6rem" }}>
              <input type="hidden" name="name" value={t.name} />
              <textarea className="field" name="source" rows={12} defaultValue={t.source} spellCheck={false} />
              <div style={{ display: "flex", gap: "0.6rem" }}>
                <button className="btn" type="submit">
                  SAVE
                </button>
              </div>
            </form>
            <form action={doResetTemplate} style={{ marginTop: "0.5rem" }}>
              <input type="hidden" name="name" value={t.name} />
              <button className="btn" type="submit" style={{ padding: "0.4rem 0.8rem", fontSize: "0.78rem" }}>
                REVERT TO THE FILE
              </button>
            </form>
          </details>
        ))}
      </section>

      <section style={sectionStyle}>
        <H>Recent events</H>
        <pre className="statusblock" style={{ margin: 0, maxHeight: "28rem", overflow: "auto" }}>
{events.length === 0
  ? "(nothing yet)"
  : events
      .map(
        (e) =>
          `${fmtIso(e.at)}  ${e.event.padEnd(28)} ${e.actor ? `[${e.actor}] ` : ""}${
            e.detail ? JSON.stringify(e.detail) : ""
          }`,
      )
      .join("\n")}
        </pre>
      </section>
    </main>
  );
}
