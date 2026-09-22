/**
 * The state machine. SPEC.md §3.
 *
 * This module is PURE: no I/O, no clock, no randomness. Every entry point takes
 * `now` and (where needed) a token minter, and returns `{ state, effects }`.
 * The caller persists the state and performs the effects. Keep it that way —
 * it is the only reason the whole failure chain is testable in milliseconds.
 */

import type { Config, Effect, Post, State, Submission } from "./types";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface CheckInput {
  now: Date;
  /** False when the fetch threw, timed out, or returned non-200. SPEC.md §3 rule 1. */
  fetchOk: boolean;
  /** Most recent qualifying post across all enabled sources, or null. */
  latestPost: Post | null;
  /** Long-lived token expiry, if known, for the §4 alarm. */
  tokenExpiresAt?: string | null;
}

export interface Outcome {
  state: State;
  effects: Effect[];
}

export type TokenMinter = () => string;

export const DEFAULT_CONFIG: Config = {
  failureThresholdHours: 168,
  countdownHours: 72,
  requiredStaleChecks: 2,
  barberMode: "draft",
  barberAutoArmed: false,
  barberTemplateIsPlaceholder: true,
  tokenExpiryAlarmDays: 10,
};

function log(event: string, detail?: Record<string, unknown>): Effect {
  return { type: "log", event, detail };
}

/**
 * A scheduled check. The only transition that can *start* a failure episode.
 */
export function evaluateCheck(
  prev: State,
  input: CheckInput,
  cfg: Config,
  mintToken: TokenMinter,
): Outcome {
  const now = input.now.getTime();
  const nowIso = input.now.toISOString();
  const effects: Effect[] = [];
  const next: State = { ...prev, lastCheckedAt: nowIso, version: prev.version + 1 };

  if (input.tokenExpiresAt !== undefined) next.tokenExpiresAt = input.tokenExpiresAt;

  // --- Hard rule 1: fail safe. -------------------------------------------
  // A thrown fetch, a timeout, a non-200, or an EMPTY media list (SPEC.md §13:
  // never transition on an empty response; §12: an empty /me/media means the
  // account reverted to personal or the tester role was removed) is an
  // inconclusive check. It never advances the stale counter and never
  // transitions. It does raise an alarm, because it means the rig is blind.
  const inconclusive = !input.fetchOk || input.latestPost === null;
  if (inconclusive) {
    next.lastCheckOk = false;
    next.consecutiveFailedChecks = prev.consecutiveFailedChecks + 1;
    effects.push(
      log("check.inconclusive", {
        fetchOk: input.fetchOk,
        hadPost: input.latestPost !== null,
        streak: next.consecutiveFailedChecks,
      }),
    );
    // Alert on the second consecutive failure, then once a day (every 4th check)
    // for as long as it persists.
    const streak = next.consecutiveFailedChecks;
    if (streak >= 2 && (streak - 2) % 4 === 0) {
      effects.push({
        type: "email",
        template: "jacob-check-failure",
        to: "jacob",
        reason: `${streak} consecutive inconclusive checks`,
      });
      next.notifiedCheckFailureAt = nowIso;
    }
    pushTokenExpiryAlarm(prev, next, now, nowIso, cfg, effects);
    return { state: next, effects };
  }

  next.lastCheckOk = true;
  next.consecutiveFailedChecks = 0;

  const post = input.latestPost as Post;
  const isNewer = !prev.lastPostAt || Date.parse(post.timestamp) > Date.parse(prev.lastPostAt);
  if (isNewer) {
    next.lastPostAt = post.timestamp;
    next.lastPostPermalink = post.permalink;
    next.lastPostId = post.id;
    effects.push(log("post.observed", { id: post.id, timestamp: post.timestamp }));
  }

  // --- Staleness. Hard rule 4: 168 hours from the post timestamp. --------
  const ageMs = next.lastPostAt ? now - Date.parse(next.lastPostAt) : Infinity;
  const stale = ageMs > cfg.failureThresholdHours * HOUR_MS;
  next.consecutiveStaleChecks = stale ? prev.consecutiveStaleChecks + 1 : 0;

  switch (prev.status) {
    case "SAFE": {
      if (!stale) break;
      if (next.consecutiveStaleChecks < cfg.requiredStaleChecks) {
        effects.push(
          log("failure.armed", { consecutiveStaleChecks: next.consecutiveStaleChecks }),
        );
        break;
      }
      if (prev.paused) {
        effects.push(log("failure.suppressed.paused", { reason: prev.pauseReason }));
        break;
      }
      declareFailure(next, now, nowIso, cfg, mintToken, effects);
      break;
    }

    case "FAILURE":
    case "PENDING_REVIEW":
      // D5: posting during the countdown does NOT cancel it. Only a verified
      // photo stops it. We still record the post above for the audit trail.
      break;

    case "RESOLVED": {
      const declaredAt = prev.failureDeclaredAt ? Date.parse(prev.failureDeclaredAt) : null;
      const postAt = next.lastPostAt ? Date.parse(next.lastPostAt) : null;
      if (declaredAt !== null && postAt !== null && postAt > declaredAt) {
        resetToSafeFields(next);
        effects.push(log("resolved.to_safe", { lastPostAt: next.lastPostAt }));
      }
      break;
    }
  }

  pushTokenExpiryAlarm(prev, next, now, nowIso, cfg, effects);
  return { state: next, effects };
}

function pushTokenExpiryAlarm(
  prev: State,
  next: State,
  now: number,
  nowIso: string,
  cfg: Config,
  effects: Effect[],
): void {
  if (!next.tokenExpiresAt) return;
  const remaining = Date.parse(next.tokenExpiresAt) - now;
  if (remaining >= cfg.tokenExpiryAlarmDays * DAY_MS) return;
  // "every run" per §4, de-duplicated to at most one per 5h so that a burst of
  // manual /api/check calls cannot mail-bomb.
  const last = prev.notifiedTokenExpiryAt ? Date.parse(prev.notifiedTokenExpiryAt) : null;
  if (last !== null && now - last < 5 * HOUR_MS) return;
  effects.push({
    type: "email",
    template: "token-expiry",
    to: "jacob",
    reason: `token expires in ${Math.floor(remaining / DAY_MS)}d`,
  });
  next.notifiedTokenExpiryAt = nowIso;
}

/**
 * SAFE -> FAILURE. Sets the deadline, mints the episode tokens, and queues the
 * dispatch emails. Hard rule 2: every notification is guarded by its own *At
 * timestamp, and those timestamps are written in the SAME object as the status
 * change so there is no window in which the status moved but the guard did not.
 */
function declareFailure(
  next: State,
  now: number,
  nowIso: string,
  cfg: Config,
  mintToken: TokenMinter,
  effects: Effect[],
): void {
  next.status = "FAILURE";
  next.episode += 1;
  next.failureDeclaredAt = nowIso;
  next.deadlineAt = new Date(now + cfg.countdownHours * HOUR_MS).toISOString();
  next.remainingMs = null;
  next.submission = null;
  next.protocolToken = mintToken();
  next.barberApproveToken = mintToken();
  next.notifiedAndreaAt = null;
  next.notifiedJacobFailureAt = null;
  next.barberDraftSentAt = null;
  next.barberSentAt = null;

  effects.push(log("failure.declared", { deadlineAt: next.deadlineAt, episode: next.episode }));

  // Andrea: exactly one dispatch email per failure episode.
  effects.push({ type: "email", template: "andrea", to: "andrea", reason: "failure declared" });
  next.notifiedAndreaAt = nowIso;

  // NO alert to Jacob on declaration. SPEC.md §4 wanted one as the mitigation
  // for the cross-post gap — a video posted to TikTok only would declare a
  // false failure, and the alert was the 72-hour window to catch it. Jacob
  // decided on 2026-09-22 that the dispatch should reach Andrea alone, and
  // accepted that a false firing now runs unopposed unless he checks the site.
  // The `jacob-alert` template is still used for operational faults below.

  queueBarberStep(next, nowIso, cfg, effects);
}

/**
 * The barber step. SPEC.md §7 and §13. Read those before touching this.
 *
 * Invariants enforced here:
 *   - nothing reaches the barber while the template contains "PLACEHOLDER", in any mode
 *   - nothing reaches the barber in `auto` unless the confirm phrase matched exactly
 *   - at most one barber email per episode, guarded by barberSentAt
 */
function queueBarberStep(next: State, nowIso: string, cfg: Config, effects: Effect[]): void {
  if (cfg.barberMode === "off") {
    effects.push(log("barber.skipped", { mode: "off" }));
    return;
  }

  if (cfg.barberMode === "auto" && !cfg.barberAutoArmed) {
    // A stray env edit or a copied .env.example must never mail a real business.
    effects.push(log("barber.auto_not_armed"));
    effects.push({
      type: "email",
      template: "jacob-barber-draft",
      to: "jacob",
      reason: "auto-send requested but BARBER_CONFIRM_PHRASE did not match — fell back to draft",
    });
    next.barberDraftSentAt = nowIso;
    return;
  }

  if (cfg.barberMode === "auto" && cfg.barberTemplateIsPlaceholder) {
    effects.push(log("barber.refused_placeholder"));
    effects.push({
      type: "email",
      template: "jacob-alert",
      to: "jacob",
      reason: "auto-send armed but the barber template still says PLACEHOLDER — refused to send",
    });
    return;
  }

  if (cfg.barberMode === "auto") {
    effects.push({ type: "email", template: "barber", to: "barber", reason: "auto-send armed" });
    next.barberSentAt = nowIso;
    return;
  }

  // draft: the rendered template goes to Jacob with a one-click approve link.
  effects.push({
    type: "email",
    template: "jacob-barber-draft",
    to: "jacob",
    reason: "draft mode — awaiting human click",
  });
  next.barberDraftSentAt = nowIso;
}

/** Clears every failure-episode field. Used by RESOLVED->SAFE and admin reset. */
function resetToSafeFields(next: State): void {
  next.status = "SAFE";
  next.failureDeclaredAt = null;
  next.deadlineAt = null;
  next.remainingMs = null;
  next.notifiedAndreaAt = null;
  next.notifiedJacobFailureAt = null;
  next.barberDraftSentAt = null;
  next.barberSentAt = null;
  next.protocolToken = null;
  next.barberApproveToken = null;
  next.submission = null;
  next.consecutiveStaleChecks = 0;
}

// ---------------------------------------------------------------------------
// Submission transitions. SPEC.md §6.
// ---------------------------------------------------------------------------

/**
 * FAILURE -> PENDING_REVIEW. Freeze semantics: store the remaining time and
 * clear deadlineAt, so time stops rather than resetting.
 */
export function acceptSubmission(prev: State, now: Date, submission: Submission): Outcome {
  if (prev.status !== "FAILURE") {
    return { state: prev, effects: [log("submission.rejected.wrong_status", { status: prev.status })] };
  }
  const remainingMs = prev.deadlineAt
    ? Math.max(0, Date.parse(prev.deadlineAt) - now.getTime())
    : 0;
  const next: State = {
    ...prev,
    status: "PENDING_REVIEW",
    submission,
    deadlineAt: null,
    remainingMs,
    version: prev.version + 1,
  };
  return {
    state: next,
    effects: [
      log("submission.accepted", { remainingMs, confidence: submission.vision.confidence }),
      { type: "email", template: "jacob-review", to: "jacob", reason: "photo awaiting review" },
    ],
  };
}

/** PENDING_REVIEW -> FAILURE. The countdown resumes from where it froze. */
export function rejectSubmission(prev: State, now: Date, actor: string, reason: string): Outcome {
  if (prev.status !== "PENDING_REVIEW") {
    return { state: prev, effects: [log("reject.noop", { status: prev.status })] };
  }
  const remainingMs = prev.remainingMs ?? 0;
  const next: State = {
    ...prev,
    status: "FAILURE",
    deadlineAt: new Date(now.getTime() + remainingMs).toISOString(),
    remainingMs: null,
    submission: null,
    version: prev.version + 1,
  };
  return {
    state: next,
    effects: [log("submission.rejected", { actor, reason, resumedMs: remainingMs })],
  };
}

/** PENDING_REVIEW -> RESOLVED. */
export function confirmSubmission(prev: State, now: Date, actor: string): Outcome {
  if (prev.status !== "PENDING_REVIEW") {
    return { state: prev, effects: [log("confirm.noop", { status: prev.status })] };
  }
  const nowIso = now.toISOString();
  const next: State = {
    ...prev,
    status: "RESOLVED",
    deadlineAt: null,
    remainingMs: null,
    submission: prev.submission
      ? { ...prev.submission, confirmedBy: actor, confirmedAt: nowIso }
      : null,
    version: prev.version + 1,
  };
  return {
    state: next,
    effects: [
      log("submission.confirmed", { actor }),
      { type: "email", template: "jacob-resolved", to: "jacob", reason: "protocol complete" },
      { type: "email", template: "andrea-resolved", to: "andrea", reason: "protocol complete" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Admin overrides. SPEC.md §9. Every one is logged with actor and reason.
// ---------------------------------------------------------------------------

export function pause(prev: State, now: Date, actor: string, reason: string): Outcome {
  const next: State = { ...prev, paused: true, pauseReason: reason, version: prev.version + 1 };
  return { state: next, effects: [log("admin.pause", { actor, reason, at: now.toISOString() })] };
}

export function unpause(prev: State, now: Date, actor: string): Outcome {
  const next: State = { ...prev, paused: false, pauseReason: null, version: prev.version + 1 };
  return { state: next, effects: [log("admin.unpause", { actor, at: now.toISOString() })] };
}

export function adminResetToSafe(prev: State, now: Date, actor: string, reason: string): Outcome {
  const next: State = { ...prev, version: prev.version + 1 };
  resetToSafeFields(next);
  next.consecutiveFailedChecks = 0;
  return {
    state: next,
    effects: [log("admin.reset_to_safe", { actor, reason, at: now.toISOString(), from: prev.status })],
  };
}
