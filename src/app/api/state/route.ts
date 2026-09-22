/**
 * Public, read-only projection of the state. The countdown re-syncs against it
 * every 30s. It exposes nothing sensitive: no tokens, no addresses, no blob keys.
 */

import { NextResponse } from "next/server";
import { loadState } from "@/lib/store";
import { nextCheckAt } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await loadState();
  return NextResponse.json(
    {
      status: s.status,
      deadlineAt: s.deadlineAt,
      remainingMs: s.remainingMs,
      serverNow: new Date().toISOString(),
      lastPostAt: s.lastPostAt,
      lastPostPermalink: s.lastPostPermalink,
      lastCheckedAt: s.lastCheckedAt,
      lastCheckOk: s.lastCheckOk,
      nextCheckAt: nextCheckAt(),
      paused: s.paused,
      pauseReason: s.pauseReason,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
