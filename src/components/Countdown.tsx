"use client";

/**
 * Progressive enhancement only. SPEC.md §3 hard rule 3: the server owns the
 * clock. This renders `deadlineAt - now` and re-syncs from /api/state every
 * 30s. It never computes a deadline from page-load time, and it never invents
 * one the server did not supply.
 *
 * The first paint deliberately shows the server-rendered figure and only starts
 * ticking after mount — computing a remainder during render would use the
 * viewer's clock and produce a hydration mismatch against the server's.
 */

import { useEffect, useState } from "react";
import { hhmmss } from "@/lib/time";

interface Synced {
  deadlineAt: string | null;
  remainingMs: number | null;
}

export function Countdown({
  deadlineAt,
  frozenMs,
  serverRemainingMs,
  className,
}: {
  deadlineAt: string | null;
  /** PENDING_REVIEW: the countdown is frozen at this remainder. */
  frozenMs: number | null;
  /** Computed on the server, used for the first paint so SSR and hydration agree. */
  serverRemainingMs: number;
  className?: string;
}) {
  // Anything the server has told us since load wins over the initial props.
  const [synced, setSynced] = useState<Synced | null>(null);
  const [tick, setTick] = useState<number | null>(null);

  const deadline = synced ? synced.deadlineAt : deadlineAt;
  const frozen = synced ? synced.remainingMs : frozenMs;

  useEffect(() => {
    // No deadline means the countdown is frozen; `tick` is simply unused then.
    if (!deadline) return;
    const update = () => setTick(Math.max(0, Date.parse(deadline) - Date.now()));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  // Re-sync with the server so a sleeping laptop or a drifting clock cannot
  // leave a stale number on screen.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Synced;
        if (!cancelled) setSynced({ deadlineAt: data.deadlineAt, remainingMs: data.remainingMs });
      } catch {
        // Offline is not worth showing. The last server value stands.
      }
    };
    const id = setInterval(sync, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const remaining = deadline ? (tick ?? serverRemainingMs) : (frozen ?? 0);
  const isFrozen = !deadline;

  return (
    <div className={className}>
      <div className="countdown" aria-live="off">
        {hhmmss(remaining)}
      </div>
      {isFrozen ? (
        <p className="statusblock" style={{ marginTop: "0.5rem" }}>
          COUNTDOWN FROZEN — AWAITING VERIFICATION
        </p>
      ) : null}
    </div>
  );
}
