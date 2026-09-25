/**
 * protocol.jacobkao.com/p/<token>. SPEC.md §6.
 *
 * Unlisted, not secret-grade. noindex/nofollow meta here, the X-Robots-Tag
 * header and the robots.txt disallow live in middleware.ts and robots.ts.
 * An invalid or expired token gets a generic 404 with no information leak.
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Countdown } from "@/components/Countdown";
import { CameraCapture } from "@/components/CameraCapture";
import { loadState } from "@/lib/store";
import { mintCaptureToken } from "@/lib/auth";
import { hhmmss } from "@/lib/time";
import { safeEqual } from "@/lib/tokens";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "PROTOCOL",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ProtocolPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await loadState();

  // A closed episode looks exactly like a made-up token.
  if (!state.protocolToken || !safeEqual(token, state.protocolToken)) notFound();
  if (state.status !== "FAILURE" && state.status !== "PENDING_REVIEW") notFound();

  const frozen = state.status === "PENDING_REVIEW";
  const now = new Date();
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
        gap: "2.25rem",
        padding: "clamp(1.5rem, 6vw, 4rem)",
      }}
    >
      <div className="boot" style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        <h1 className="heading" style={{ fontSize: "clamp(2rem, 9vw, 5rem)" }}>
          PROTOCOL
          <span className="cursor" aria-hidden="true" />
        </h1>

        <div>
          <Countdown
            deadlineAt={state.deadlineAt}
            frozenMs={state.remainingMs}
            serverRemainingMs={remaining}
          />
          <noscript>
            <div className="countdown">{hhmmss(remaining)}</div>
            <p className="statusblock">STATIC — RELOAD FOR THE CURRENT VALUE.</p>
          </noscript>
        </div>

        <noscript>
          <p className="caption">
            This page needs JavaScript. Proof must be taken with the camera on this device — there
            is no file upload, deliberately — and that is not possible with scripting disabled.
          </p>
        </noscript>

        {frozen ? (
          <p className="caption">
            Proof has been submitted and the countdown is frozen. Nothing more is needed here
            unless it is rejected, in which case the clock resumes from where it stopped.
          </p>
        ) : (
          <CameraCapture token={token} captureToken={mintCaptureToken(token)} />
        )}
      </div>
    </main>
  );
}
