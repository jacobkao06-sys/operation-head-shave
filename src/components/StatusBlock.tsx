import { ago, fmtIso, nextCheckAt } from "@/lib/time";
import type { State } from "@/lib/types";

/** The dim status block under both modes. SPEC.md §5. */
export function StatusBlock({ state, now }: { state: State; now: Date }) {
  const pad = (label: string) => label.padEnd(18, ".");
  const lines = [
    `${pad("LAST POST ")} ${fmtIso(state.lastPostAt)}${state.lastPostAt ? ` (${ago(state.lastPostAt, now)})` : ""}`,
    `${pad("LAST CHECK ")} ${fmtIso(state.lastCheckedAt)} [${state.lastCheckOk ? "OK" : "FAIL"}]`,
    `${pad("NEXT CHECK ")} ${fmtIso(nextCheckAt(now))}`,
  ];
  if (state.paused) lines.push(`${pad("PAUSED ")} ${state.pauseReason ?? "no reason given"}`);

  return (
    <pre className="statusblock" style={{ margin: 0 }}>
      {lines.join("\n")}
    </pre>
  );
}
