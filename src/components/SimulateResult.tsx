import { KeyValue } from "./KeyValue";
import { fmtLocal } from "@/lib/time";
import type { SimulateResult as Result } from "@/lib/store";

const RECIPIENT_LABEL: Record<string, string> = {
  alice: "Alice",
  jacob: "Jacob",
  barber: "the barber",
};

/**
 * Says in plain words what the last check concluded. SPEC.md §9.
 *
 * Before this, running a check from /admin changed a status field and nothing
 * else — you had to infer "it decided I hadn't posted, and it has just emailed
 * Alice" from a streak counter and a timestamp. For the one screen used while
 * deciding whether to arm a system that mails another person, that is not good
 * enough.
 */
export function SimulateResultPanel({ r }: { r: Result }) {
  const fired = r.statusBefore !== "FAILURE" && r.statusAfter === "FAILURE";
  const days = r.ageHours !== null ? (r.ageHours / 24).toFixed(1) : null;

  const verdict = r.inconclusive
    ? "COULDN'T TELL"
    : r.posted
      ? "POSTED"
      : "DIDN'T POST";

  const tone = r.inconclusive ? "var(--fg-dim)" : r.posted ? "var(--safe)" : "var(--failure)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      <p
        style={{
          margin: 0,
          color: tone,
          fontSize: "clamp(1.4rem, 7vw, 2.2rem)",
          fontWeight: 700,
          letterSpacing: "0.02em",
        }}
      >
        {verdict}
      </p>

      <div>
        {r.inconclusive ? (
          <KeyValue k="Why" v={r.sourceError ?? "the check could not reach Instagram"} wrap />
        ) : (
          <>
            <KeyValue
              k="Last video"
              v={days !== null ? `${days} days ago` : "none found"}
              wrap
            />
            <KeyValue k="Allowed gap" v={`${(r.thresholdHours / 24).toFixed(0)} days`} />
          </>
        )}
        <KeyValue
          k="Stale checks"
          v={`${r.staleStreak} of ${r.requiredStaleChecks} needed to declare failure`}
          wrap
        />
        <KeyValue k="Status" v={`${r.statusBefore} → ${r.statusAfter}`} />
        {r.deadlineAt ? <KeyValue k="Deadline" v={fmtLocal(r.deadlineAt)} wrap /> : null}
        {r.simulated ? <KeyValue k="Simulated post date" v={r.simulated} wrap /> : null}
      </div>

      {fired ? (
        <p className="statusblock" style={{ margin: 0, color: "var(--failure)" }}>
          HEAD SHAVE PROTOCOL COMMENCED
        </p>
      ) : null}

      {r.mail.length > 0 ? (
        <div>
          {r.mail.map((m, i) => (
            <p
              key={`${m.template}-${i}`}
              className="statusblock"
              style={{ margin: "0 0 0.35rem", color: m.ok ? "var(--fg)" : "var(--failure)" }}
            >
              {m.ok ? "→ SENDING" : "→ FAILED TO SEND"}{" "}
              {m.template === "alice"
                ? "MESSAGE TO ALICE"
                : m.template === "jacob-barber-draft"
                  ? "BARBER DRAFT TO JACOB"
                  : `${m.template.toUpperCase()} TO ${(RECIPIENT_LABEL[m.to] ?? m.to).toUpperCase()}`}
              {" — "}
              {m.dryRun ? `DRY RUN, REDIRECTED TO ${m.resolvedTo}` : m.resolvedTo}
              {m.error ? ` (${m.error})` : ""}
            </p>
          ))}
        </div>
      ) : (
        <p className="statusblock" style={{ margin: 0 }}>
          NO MESSAGES SENT
        </p>
      )}

      <p className="statusblock" style={{ margin: 0, opacity: 0.7 }}>
        CHECKED {fmtLocal(r.at)}
      </p>
    </div>
  );
}
