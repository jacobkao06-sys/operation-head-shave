import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  acceptSubmission,
  adminResetToSafe,
  confirmSubmission,
  evaluateCheck,
  pause,
  rejectSubmission,
} from "./state";
import { INITIAL_STATE, type Config, type Effect, type Post, type State, type Submission } from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const T0 = new Date("2026-09-01T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

let tokenSeq = 0;
const mint = () => `tok${++tokenSeq}`;

const post = (timestamp: Date, id = "p1"): Post => ({
  id,
  timestamp: timestamp.toISOString(),
  permalink: `https://instagram.com/p/${id}`,
});

const cfg = (over: Partial<Config> = {}): Config => ({ ...DEFAULT_CONFIG, ...over });

const emails = (effects: Effect[]) =>
  effects.filter((e) => e.type === "email").map((e) => `${e.template}->${e.to}`);

/** A SAFE state whose last post is `ageMs` old as of `now`. */
function safeWith(ageMs: number, now: Date, over: Partial<State> = {}): State {
  return {
    ...INITIAL_STATE,
    lastPostAt: new Date(now.getTime() - ageMs).toISOString(),
    lastPostId: "p1",
    lastPostPermalink: "https://instagram.com/p/p1",
    ...over,
  };
}

/** Runs checks until FAILURE is declared, returning the final outcome. */
function driveToFailure(start: State, config = cfg()) {
  let s = start;
  let last = evaluateCheck(s, { now: at(0), fetchOk: true, latestPost: post(at(-8 * DAY)) }, config, mint);
  s = last.state;
  last = evaluateCheck(s, { now: at(6 * HOUR), fetchOk: true, latestPost: post(at(-8 * DAY)) }, config, mint);
  return last;
}

describe("SAFE -> FAILURE", () => {
  it("does not fire on the first stale check (requires two)", () => {
    const s = safeWith(8 * DAY, T0);
    const { state, effects } = evaluateCheck(
      s,
      { now: T0, fetchOk: true, latestPost: post(at(-8 * DAY)) },
      cfg(),
      mint,
    );
    expect(state.status).toBe("SAFE");
    expect(state.consecutiveStaleChecks).toBe(1);
    expect(emails(effects)).toEqual([]);
  });

  it("fires on the second consecutive stale check", () => {
    const { state, effects } = driveToFailure(safeWith(8 * DAY, T0));
    expect(state.status).toBe("FAILURE");
    expect(state.consecutiveStaleChecks).toBe(2);
    expect(emails(effects)).toContain("andrea->andrea");
    // Jacob is deliberately NOT warned on declaration — see declareFailure().
    expect(emails(effects)).not.toContain("jacob-alert->jacob");
  });

  it("sets deadlineAt to exactly 72h after the declaration, not after the post", () => {
    const { state } = driveToFailure(safeWith(8 * DAY, T0));
    const declared = Date.parse(state.failureDeclaredAt!);
    expect(Date.parse(state.deadlineAt!) - declared).toBe(72 * HOUR);
    expect(state.failureDeclaredAt).toBe(at(6 * HOUR).toISOString());
  });

  it("treats the threshold as 168 hours from the post timestamp, not calendar days", () => {
    // 167h59m old: not stale. One minute later: stale.
    const almost = safeWith(168 * HOUR - 60_000, T0);
    const a = evaluateCheck(
      almost,
      { now: T0, fetchOk: true, latestPost: post(at(-(168 * HOUR - 60_000))) },
      cfg(),
      mint,
    );
    expect(a.state.consecutiveStaleChecks).toBe(0);

    const just = safeWith(168 * HOUR + 60_000, T0);
    const b = evaluateCheck(
      just,
      { now: T0, fetchOk: true, latestPost: post(at(-(168 * HOUR + 60_000))) },
      cfg(),
      mint,
    );
    expect(b.state.consecutiveStaleChecks).toBe(1);
  });

  it("mints a 2-token episode and bumps the episode counter", () => {
    const { state } = driveToFailure(safeWith(8 * DAY, T0));
    expect(state.protocolToken).toBeTruthy();
    expect(state.barberApproveToken).toBeTruthy();
    expect(state.protocolToken).not.toBe(state.barberApproveToken);
    expect(state.episode).toBe(1);
  });

  it("does not fire while paused", () => {
    const { state, effects } = driveToFailure(
      safeWith(8 * DAY, T0, { paused: true, pauseReason: "travelling" }),
    );
    expect(state.status).toBe("SAFE");
    expect(emails(effects)).toEqual([]);
  });

  it("resets the stale counter when a fresh post appears", () => {
    const s = safeWith(8 * DAY, T0);
    const first = evaluateCheck(s, { now: T0, fetchOk: true, latestPost: post(at(-8 * DAY)) }, cfg(), mint);
    expect(first.state.consecutiveStaleChecks).toBe(1);
    const second = evaluateCheck(
      first.state,
      { now: at(HOUR), fetchOk: true, latestPost: post(at(-HOUR), "p2") },
      cfg(),
      mint,
    );
    expect(second.state.consecutiveStaleChecks).toBe(0);
    expect(second.state.status).toBe("SAFE");
    expect(second.state.lastPostId).toBe("p2");
  });
});

describe("hard rule 1 — fail safe", () => {
  it("never transitions on a fetch error, and never advances the stale counter", () => {
    const s = safeWith(30 * DAY, T0, { consecutiveStaleChecks: 1 });
    const { state, effects } = evaluateCheck(
      s,
      { now: T0, fetchOk: false, latestPost: null },
      cfg(),
      mint,
    );
    expect(state.status).toBe("SAFE");
    expect(state.consecutiveStaleChecks).toBe(1);
    expect(state.lastCheckOk).toBe(false);
    expect(emails(effects)).toEqual([]);
  });

  it("never transitions on an empty media list", () => {
    const s = safeWith(30 * DAY, T0, { consecutiveStaleChecks: 1 });
    const { state } = evaluateCheck(s, { now: T0, fetchOk: true, latestPost: null }, cfg(), mint);
    expect(state.status).toBe("SAFE");
    expect(state.consecutiveStaleChecks).toBe(1);
    expect(state.lastCheckOk).toBe(false);
  });

  it("emails Jacob on the second consecutive failed check, not the first", () => {
    const s = safeWith(2 * DAY, T0);
    const a = evaluateCheck(s, { now: T0, fetchOk: false, latestPost: null }, cfg(), mint);
    expect(emails(a.effects)).toEqual([]);
    const b = evaluateCheck(a.state, { now: at(6 * HOUR), fetchOk: false, latestPost: null }, cfg(), mint);
    expect(emails(b.effects)).toEqual(["jacob-check-failure->jacob"]);
    // third and fourth are quiet; it re-alerts a day later
    const c = evaluateCheck(b.state, { now: at(12 * HOUR), fetchOk: false, latestPost: null }, cfg(), mint);
    expect(emails(c.effects)).toEqual([]);
    const d = evaluateCheck(c.state, { now: at(18 * HOUR), fetchOk: false, latestPost: null }, cfg(), mint);
    expect(emails(d.effects)).toEqual([]);
    const e = evaluateCheck(d.state, { now: at(24 * HOUR), fetchOk: false, latestPost: null }, cfg(), mint);
    expect(emails(e.effects)).toEqual([]);
    const f = evaluateCheck(e.state, { now: at(30 * HOUR), fetchOk: false, latestPost: null }, cfg(), mint);
    expect(emails(f.effects)).toEqual(["jacob-check-failure->jacob"]);
  });

  it("clears the failed-check streak once a check succeeds", () => {
    const s = safeWith(2 * DAY, T0, { consecutiveFailedChecks: 3, lastCheckOk: false });
    const { state } = evaluateCheck(
      s,
      { now: T0, fetchOk: true, latestPost: post(at(-2 * DAY)) },
      cfg(),
      mint,
    );
    expect(state.consecutiveFailedChecks).toBe(0);
    expect(state.lastCheckOk).toBe(true);
  });
});

describe("hard rule 2 — idempotent side effects", () => {
  it("emails Andrea exactly once per failure episode across repeated checks", () => {
    let { state } = driveToFailure(safeWith(8 * DAY, T0));
    expect(state.notifiedAndreaAt).toBeTruthy();

    for (const h of [12, 18, 24, 30]) {
      const r = evaluateCheck(
        state,
        { now: at(h * HOUR), fetchOk: true, latestPost: post(at(-8 * DAY)) },
        cfg(),
        mint,
      );
      state = r.state;
      expect(emails(r.effects)).toEqual([]);
    }
  });

  it("sets notifiedAndreaAt in the same object as the status change", () => {
    const { state } = driveToFailure(safeWith(8 * DAY, T0));
    expect(state.status).toBe("FAILURE");
    expect(state.notifiedAndreaAt).toBe(state.failureDeclaredAt);
  });
});

describe("who is told when the protocol fires", () => {
  it("dispatches Andrea and nobody else is warned about the deadline", () => {
    const { effects } = driveToFailure(safeWith(8 * DAY, T0), cfg({ barberMode: "off" }));
    expect(emails(effects)).toEqual(["andrea->andrea"]);
  });

  it("still sends Jacob the barber draft, because approving it needs his click", () => {
    const { effects } = driveToFailure(safeWith(8 * DAY, T0), cfg({ barberMode: "draft" }));
    expect(emails(effects).sort()).toEqual(["andrea->andrea", "jacob-barber-draft->jacob"]);
  });
});

describe("D5 — posting during the countdown does not cancel it", () => {
  it("stays in FAILURE and keeps the same deadline when a new post lands", () => {
    const { state: failed } = driveToFailure(safeWith(8 * DAY, T0));
    const r = evaluateCheck(
      failed,
      { now: at(12 * HOUR), fetchOk: true, latestPost: post(at(11 * HOUR), "fresh") },
      cfg(),
      mint,
    );
    expect(r.state.status).toBe("FAILURE");
    expect(r.state.deadlineAt).toBe(failed.deadlineAt);
    expect(r.state.lastPostId).toBe("fresh");
    expect(emails(r.effects)).toEqual([]);
  });
});

describe("the barber step — §7 and §13", () => {
  const failFrom = (config: Config) => driveToFailure(safeWith(8 * DAY, T0), config);

  it("draft mode emails Jacob, never the barber", () => {
    const { state, effects } = failFrom(cfg({ barberMode: "draft" }));
    expect(emails(effects)).toContain("jacob-barber-draft->jacob");
    expect(emails(effects).some((e) => e.endsWith("->barber"))).toBe(false);
    expect(state.barberDraftSentAt).toBeTruthy();
    expect(state.barberSentAt).toBeNull();
  });

  it("off mode does nothing at all", () => {
    const { state, effects } = failFrom(cfg({ barberMode: "off" }));
    expect(emails(effects).some((e) => e.includes("barber"))).toBe(false);
    expect(state.barberDraftSentAt).toBeNull();
    expect(state.barberSentAt).toBeNull();
  });

  it("auto WITHOUT the confirm phrase falls back to draft and warns", () => {
    const { state, effects } = failFrom(cfg({ barberMode: "auto", barberAutoArmed: false }));
    expect(emails(effects).some((e) => e.endsWith("->barber"))).toBe(false);
    expect(emails(effects)).toContain("jacob-barber-draft->jacob");
    expect(state.barberSentAt).toBeNull();
  });

  it("auto WITH the phrase but a PLACEHOLDER template refuses and alerts", () => {
    const { state, effects } = failFrom(
      cfg({ barberMode: "auto", barberAutoArmed: true, barberTemplateIsPlaceholder: true }),
    );
    expect(emails(effects).some((e) => e.endsWith("->barber"))).toBe(false);
    expect(state.barberSentAt).toBeNull();
    expect(effects.some((e) => e.type === "log" && e.event === "barber.refused_placeholder")).toBe(true);
  });

  it("auto, armed, real copy: sends exactly once", () => {
    const { state, effects } = failFrom(
      cfg({ barberMode: "auto", barberAutoArmed: true, barberTemplateIsPlaceholder: false }),
    );
    expect(emails(effects)).toContain("barber->barber");
    expect(state.barberSentAt).toBeTruthy();
  });
});

describe("FAILURE <-> PENDING_REVIEW — §6 freeze semantics", () => {
  const submission = (): Submission => ({
    blobKey: "k",
    blobUrl: "https://blob/k",
    submittedAt: at(20 * HOUR).toISOString(),
    vision: { shaved: true, confidence: 0.94, reason: "bald head", isPerson: true },
    confirmedBy: null,
    confirmedAt: null,
  });

  it("freezes the countdown: stores remaining time and clears the deadline", () => {
    const { state: failed } = driveToFailure(safeWith(8 * DAY, T0));
    // failure declared at T0+6h, deadline T0+78h. Upload at T0+30h -> 48h left.
    const r = acceptSubmission(failed, at(30 * HOUR), submission());
    expect(r.state.status).toBe("PENDING_REVIEW");
    expect(r.state.deadlineAt).toBeNull();
    expect(r.state.remainingMs).toBe(48 * HOUR);
    expect(emails(r.effects)).toEqual(["jacob-review->jacob"]);
  });

  it("rejection resumes from the frozen remainder — time stops, it does not reset", () => {
    const { state: failed } = driveToFailure(safeWith(8 * DAY, T0));
    const frozen = acceptSubmission(failed, at(30 * HOUR), submission()).state;
    // Jacob sits on it for 10 hours, then rejects.
    const r = rejectSubmission(frozen, at(40 * HOUR), "jacob", "that is a hat");
    expect(r.state.status).toBe("FAILURE");
    expect(Date.parse(r.state.deadlineAt!) - at(40 * HOUR).getTime()).toBe(48 * HOUR);
    expect(r.state.remainingMs).toBeNull();
    expect(r.state.submission).toBeNull();
  });

  it("confirmation resolves and notifies both parties", () => {
    const { state: failed } = driveToFailure(safeWith(8 * DAY, T0));
    const frozen = acceptSubmission(failed, at(30 * HOUR), submission()).state;
    const r = confirmSubmission(frozen, at(31 * HOUR), "jacob");
    expect(r.state.status).toBe("RESOLVED");
    expect(r.state.submission!.confirmedBy).toBe("jacob");
    expect(r.state.deadlineAt).toBeNull();
    expect(emails(r.effects).sort()).toEqual(["andrea-resolved->andrea", "jacob-resolved->jacob"]);
  });

  it("an upload is ignored when the status is not FAILURE", () => {
    const r = acceptSubmission(safeWith(DAY, T0), T0, submission());
    expect(r.state.status).toBe("SAFE");
    expect(emails(r.effects)).toEqual([]);
  });
});

describe("RESOLVED -> SAFE", () => {
  it("returns to SAFE only on a post newer than the failure declaration", () => {
    const { state: failed } = driveToFailure(safeWith(8 * DAY, T0));
    const frozen = acceptSubmission(failed, at(30 * HOUR), {
      blobKey: "k",
      blobUrl: "u",
      submittedAt: at(30 * HOUR).toISOString(),
      vision: { shaved: true, confidence: 0.9, reason: "bald", isPerson: true },
      confirmedBy: null,
      confirmedAt: null,
    }).state;
    const resolved = confirmSubmission(frozen, at(31 * HOUR), "jacob").state;

    // An older post does not resurrect SAFE.
    const stale = evaluateCheck(
      resolved,
      { now: at(40 * HOUR), fetchOk: true, latestPost: post(at(-8 * DAY)) },
      cfg(),
      mint,
    );
    expect(stale.state.status).toBe("RESOLVED");

    const fresh = evaluateCheck(
      resolved,
      { now: at(50 * HOUR), fetchOk: true, latestPost: post(at(49 * HOUR), "new") },
      cfg(),
      mint,
    );
    expect(fresh.state.status).toBe("SAFE");
    expect(fresh.state.failureDeclaredAt).toBeNull();
    expect(fresh.state.deadlineAt).toBeNull();
    expect(fresh.state.protocolToken).toBeNull();
    expect(fresh.state.consecutiveStaleChecks).toBe(0);
  });
});

describe("token expiry alarm — §4", () => {
  it("is quiet at 30 days out and loud inside 10", () => {
    const base = safeWith(DAY, T0);
    const quiet = evaluateCheck(
      base,
      {
        now: T0,
        fetchOk: true,
        latestPost: post(at(-DAY)),
        tokenExpiresAt: at(30 * DAY).toISOString(),
      },
      cfg(),
      mint,
    );
    expect(emails(quiet.effects)).toEqual([]);

    const loud = evaluateCheck(
      base,
      {
        now: T0,
        fetchOk: true,
        latestPost: post(at(-DAY)),
        tokenExpiresAt: at(9 * DAY).toISOString(),
      },
      cfg(),
      mint,
    );
    expect(emails(loud.effects)).toEqual(["token-expiry->jacob"]);
  });

  it("fires on an inconclusive check too — a blind rig still needs its token warning", () => {
    const base = safeWith(DAY, T0);
    const r = evaluateCheck(
      base,
      { now: T0, fetchOk: false, latestPost: null, tokenExpiresAt: at(3 * DAY).toISOString() },
      cfg(),
      mint,
    );
    expect(emails(r.effects)).toEqual(["token-expiry->jacob"]);
  });

  it("does not re-alert within 5 hours", () => {
    const base = safeWith(DAY, T0);
    const first = evaluateCheck(
      base,
      { now: T0, fetchOk: true, latestPost: post(at(-DAY)), tokenExpiresAt: at(9 * DAY).toISOString() },
      cfg(),
      mint,
    );
    const second = evaluateCheck(
      first.state,
      {
        now: at(2 * HOUR),
        fetchOk: true,
        latestPost: post(at(-DAY)),
        tokenExpiresAt: at(9 * DAY).toISOString(),
      },
      cfg(),
      mint,
    );
    expect(emails(second.effects)).toEqual([]);
  });
});

describe("admin overrides — §9", () => {
  it("pause records the reason and suppresses the next declaration", () => {
    const paused = pause(safeWith(8 * DAY, T0), T0, "jacob", "flu").state;
    expect(paused.paused).toBe(true);
    expect(paused.pauseReason).toBe("flu");
    const { state } = driveToFailure(paused);
    expect(state.status).toBe("SAFE");
  });

  it("reset to SAFE clears every failure field and is logged with actor and reason", () => {
    const { state: failed } = driveToFailure(safeWith(8 * DAY, T0));
    const r = adminResetToSafe(failed, at(20 * HOUR), "jacob", "cross-post slip, posted to TikTok only");
    expect(r.state.status).toBe("SAFE");
    expect(r.state.deadlineAt).toBeNull();
    expect(r.state.notifiedAndreaAt).toBeNull();
    expect(r.state.protocolToken).toBeNull();
    const logged = r.effects.find((e) => e.type === "log" && e.event === "admin.reset_to_safe");
    expect(logged).toBeTruthy();
    expect((logged as { detail: Record<string, unknown> }).detail.reason).toContain("TikTok");
  });
});

describe("optimistic concurrency", () => {
  it("bumps version on every write", () => {
    const s = safeWith(DAY, T0);
    const r = evaluateCheck(s, { now: T0, fetchOk: true, latestPost: post(at(-DAY)) }, cfg(), mint);
    expect(r.state.version).toBe(s.version + 1);
  });
});
