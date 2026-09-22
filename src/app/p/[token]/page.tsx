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
import { UploadForm } from "@/components/UploadForm";
import { loadState } from "@/lib/store";
import { hhmmss } from "@/lib/time";
import { safeEqual } from "@/lib/tokens";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "PROTOCOL",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ProtocolPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { token } = await params;
  const { r } = await searchParams;
  const state = await loadState();

  // A closed episode looks exactly like a made-up token.
  if (!state.protocolToken || !safeEqual(token, state.protocolToken)) notFound();
  if (state.status !== "FAILURE" && state.status !== "PENDING_REVIEW") notFound();

  const frozen = state.status === "PENDING_REVIEW";
  const noscriptRemaining = state.deadlineAt
    ? Math.max(0, Date.parse(state.deadlineAt) - Date.now())
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
          <Countdown deadlineAt={state.deadlineAt} frozenMs={state.remainingMs} />
          <noscript>
            <div className="countdown">{hhmmss(noscriptRemaining)}</div>
            <p className="statusblock">STATIC — RELOAD FOR THE CURRENT VALUE.</p>
          </noscript>
        </div>

        {frozen ? (
          <p className="caption">
            Proof has been submitted and the countdown is frozen. Nothing more is needed here
            unless it is rejected, in which case the clock resumes from where it stopped.
          </p>
        ) : (
          <UploadForm token={token} initialResult={r} />
        )}
      </div>
    </main>
  );
}
