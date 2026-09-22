/**
 * The link preview renders the live status, so sharing the URL is part of the
 * joke. SPEC.md §5.
 */

import { ImageResponse } from "next/og";
import { loadState } from "@/lib/store";
import { hhmmss } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "OPERATION HEAD SHAVE";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  let status = "SAFE";
  let sub = "Jacob has posted a video in the past week.";
  let clock: string | null = null;

  try {
    const state = await loadState();
    status = state.status === "PENDING_REVIEW" ? "FAILURE" : state.status;
    if (state.status === "FAILURE" || state.status === "PENDING_REVIEW") {
      sub = "Head shave protocol has commenced.";
      const ms = state.deadlineAt
        ? Math.max(0, Date.parse(state.deadlineAt) - Date.now())
        : (state.remainingMs ?? 0);
      clock = hhmmss(ms);
    } else if (state.status === "RESOLVED") {
      sub = "The head has been shaved and verified.";
    }
  } catch {
    // A broken store must not break the preview. Fall through to SAFE copy.
  }

  const fg = status === "FAILURE" ? "#FF2D2D" : "#00FF41";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#000000",
          color: fg,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px",
          fontFamily: "monospace",
        }}
      >
        <div style={{ fontSize: 30, letterSpacing: 6, opacity: 0.75, display: "flex" }}>
          OPERATION HEAD SHAVE
        </div>
        <div style={{ fontSize: 168, fontWeight: 700, letterSpacing: -6, marginTop: 8, display: "flex" }}>
          {status}
        </div>
        {clock ? (
          <div style={{ fontSize: 92, fontWeight: 700, marginTop: 4, display: "flex" }}>{clock}</div>
        ) : null}
        <div style={{ fontSize: 34, marginTop: 24, opacity: 0.8, display: "flex" }}>{sub}</div>
      </div>
    ),
    size,
  );
}
