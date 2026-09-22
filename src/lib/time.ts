/** Display formatting. SPEC.md D9 — America/New_York for all display + boundary math. */

import { env_ } from "./config";

export function fmtLocal(iso: string | null | undefined, tz = env_.tz()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    dateStyle: "full",
    timeStyle: "short",
  }).format(d);
}

export function fmtIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** "7d 2h" — the relative age shown in the status block. */
export function ago(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const parts = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return ms >= 0 ? `${parts} ago` : `in ${parts}`;
}

/** `71:58:04`, clamped at zero. Never negative, never NaN. */
export function hhmmss(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** The next 6-hourly cron boundary, for the NEXT CHECK line. */
export function nextCheckAt(now = new Date()): string {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  const nextHour = (Math.floor(now.getUTCHours() / 6) + 1) * 6;
  d.setUTCHours(nextHour);
  return d.toISOString();
}
