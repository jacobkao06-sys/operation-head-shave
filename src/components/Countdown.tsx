"use client";

/**
 * Progressive enhancement only. SPEC.md §3 hard rule 3:
 * the server owns the clock. This component renders `deadlineAt - now` and
 * re-syncs from /api/state every 30s. It NEVER computes a deadline from page
 * load time, and it never invents one when the server did not supply it.
 */

import { useEffect, useState } from "react";
import { hhmmss } from "@/lib/time";

export function Countdown({
  deadlineAt,
  frozenMs,
  className,
}: {
  deadlineAt: string | null;
  /** PENDING_REVIEW: the countdown is frozen at this remainder. */
  frozenMs: number | null;
  className?: string;
}) {
  const [deadline, setDeadline] = useState(deadlineAt);
  const [remaining, setRemaining] = useState<number | null>(
    deadlineAt ? Math.max(0, Date.parse(deadlineAt) - Date.now()) : frozenMs,
  );

  useEffect(() => {
    setDeadline(deadlineAt);
  }, [deadlineAt]);

  // Tick.
  useEffect(() => {
    if (!deadline) return;
    const tick = () => setRemaining(Math.max(0, Date.parse(deadline) - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  // Re-sync with the server every 30s so a sleeping laptop or a drifting clock
  // cannot leave a stale number on screen.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          deadlineAt: string | null;
          remainingMs: number | null;
          status: string;
        };
        if (cancelled) return;
        setDeadline(data.deadlineAt);
        if (!data.deadlineAt) setRemaining(data.remainingMs);
      } catch {
        // Offline is not an error worth showing. The last server value stands.
      }
    };
    const id = setInterval(sync, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const frozen = !deadline && remaining !== null;
  const display = remaining === null ? "--:--:--" : hhmmss(remaining);

  return (
    <div className={className}>
      <div className="countdown" aria-live="off" suppressHydrationWarning>
        {display}
      </div>
      {frozen ? (
        <p className="statusblock" style={{ marginTop: "0.5rem" }}>
          COUNTDOWN FROZEN — AWAITING VERIFICATION
        </p>
      ) : null}
    </div>
  );
}
