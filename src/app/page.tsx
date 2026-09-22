/**
 * shave.jacobkao.com. SPEC.md §5.
 *
 * Server-rendered: the status is readable with JavaScript disabled. The
 * countdown is the only client-side piece, and it is progressive enhancement
 * over a server-supplied deadline.
 */

import { Countdown } from "@/components/Countdown";
import { StatusBlock } from "@/components/StatusBlock";
import { loadState } from "@/lib/store";
import { hhmmss } from "@/lib/time";
import type { State } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function headingFor(status: State["status"]): string {
  switch (status) {
    case "SAFE":
      return "SAFE";
    case "FAILURE":
    case "PENDING_REVIEW":
      return "FAILURE";
    case "RESOLVED":
      return "RESOLVED";
  }
}

export default async function Page() {
  const state = await loadState();
  const now = new Date();
  const heading = headingFor(state.status);
  const showCountdown = state.status === "FAILURE" || state.status === "PENDING_REVIEW";
  const remaining = state.deadlineAt
    ? Math.max(0, Date.parse(state.deadlineAt) - now.getTime())
    : (state.remainingMs ?? 0);

  return (
    <main
      data-status={state.status}
      style={{
        minHeight: "100svh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: "2rem",
        padding: "clamp(1.5rem, 5vw, 4rem)",
      }}
    >
      <div className="boot" style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
        <h1 className="heading">
          {heading}
          <span className="cursor" aria-hidden="true" />
        </h1>

        {state.status === "SAFE" ? (
          <p className="caption">
            Jacob <strong>has</strong> posted a video in the past week, so his hair is safe.
          </p>
        ) : null}

        {state.status === "FAILURE" || state.status === "PENDING_REVIEW" ? (
          <p className="caption">
            Jacob has failed to post a video in the past 7 days. Head shave protocol has commenced
            and operation Jacob goes bald is imminent.
          </p>
        ) : null}

        {state.status === "PENDING_REVIEW" ? (
          <p className="caption">
            Proof has been submitted. The countdown is frozen pending verification.
          </p>
        ) : null}

        {state.status === "RESOLVED" ? (
          <p className="caption">
            The protocol ran its course. The head has been shaved and the photograph verified. The
            status returns to <strong>SAFE</strong> on the next video.
          </p>
        ) : null}

        {showCountdown ? (
          <div>
            <Countdown
              deadlineAt={state.deadlineAt}
              frozenMs={state.remainingMs}
              serverRemainingMs={remaining}
            />
            <noscript>
              <div className="countdown">{hhmmss(remaining)}</div>
              <p className="statusblock">
                STATIC — RELOAD FOR THE CURRENT VALUE. DEADLINE {state.deadlineAt ?? "FROZEN"}
              </p>
            </noscript>
          </div>
        ) : null}

        <StatusBlock state={state} now={now} />
      </div>
    </main>
  );
}
