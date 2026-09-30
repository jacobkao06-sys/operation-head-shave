import { KeyValue } from "./KeyValue";
import { ago, fmtIso, nextCheckAt } from "@/lib/time";
import type { State } from "@/lib/types";

/** The dim status block under both modes. SPEC.md §5. */
export function StatusBlock({ state, now }: { state: State; now: Date }) {
  return (
    <div>
      <KeyValue
        k="Last post"
        v={`${fmtIso(state.lastPostAt)}${state.lastPostAt ? `  (${ago(state.lastPostAt, now)})` : ""}`}
        wrap
      />
      <KeyValue
        k="Last check"
        v={`${fmtIso(state.lastCheckedAt)} [${state.lastCheckOk ? "OK" : "FAIL"}]`}
        wrap
      />
      <KeyValue k="Next check" v={fmtIso(nextCheckAt(now))} wrap />
      {state.paused ? <KeyValue k="Paused" v={state.pauseReason ?? "no reason given"} wrap /> : null}
    </div>
  );
}
