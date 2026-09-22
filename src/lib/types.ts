/**
 * Core domain types. See SPEC.md §3.
 *
 * Fields marked EXTENSION are not in the SPEC.md §3 listing but are required to
 * satisfy rules stated elsewhere in the spec (fail-safe alerting, §6 tokens,
 * §7 barber approve links). They are additive; nothing in §3 was removed.
 */

export type Status = "SAFE" | "FAILURE" | "PENDING_REVIEW" | "RESOLVED";

export interface VisionVerdict {
  shaved: boolean;
  confidence: number;
  reason: string;
  isPerson: boolean;
}

export interface Submission {
  blobKey: string;
  blobUrl: string;
  submittedAt: string;
  vision: VisionVerdict;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface State {
  status: Status;
  lastPostAt: string | null;
  lastPostPermalink: string | null;
  lastPostId: string | null;
  lastCheckedAt: string | null;
  lastCheckOk: boolean;
  consecutiveStaleChecks: number;
  failureDeclaredAt: string | null;
  deadlineAt: string | null;
  notifiedAndreaAt: string | null;
  barberDraftSentAt: string | null;
  barberSentAt: string | null;
  submission: Submission | null;
  paused: boolean;
  pauseReason: string | null;
  tokenExpiresAt: string | null;
  version: number;

  /** EXTENSION — fail-safe alerting, SPEC.md §3 hard rule 1. */
  consecutiveFailedChecks: number;
  /** EXTENSION — one alert per failed-check streak, re-armed every 4 checks. */
  notifiedCheckFailureAt: string | null;
  /** EXTENSION — one alert per token-expiry run; spec asks for every run. */
  notifiedJacobFailureAt: string | null;
  /** EXTENSION — §6: 32-char URL-safe token minted at failure time. */
  protocolToken: string | null;
  /** EXTENSION — §7: single-use barber approve token, dies with the episode. */
  barberApproveToken: string | null;
  /** EXTENSION — §6 freeze semantics: time stops, it does not reset. */
  remainingMs: number | null;
  /** EXTENSION — increments once per failure episode; scopes idempotency. */
  episode: number;
  /** EXTENSION — last time a token-expiry alarm went out. */
  notifiedTokenExpiryAt: string | null;
}

export interface Post {
  id: string;
  timestamp: string;
  permalink: string;
  mediaType?: string;
}

export interface PostSource {
  name: string;
  getLatestPost(): Promise<Post | null>;
}

/** Declarative side effects. The state machine returns them; the caller performs them. */
export type Effect =
  | { type: "email"; template: EmailTemplateName; to: Recipient; reason: string }
  | { type: "log"; event: string; detail?: Record<string, unknown> };

export type Recipient = "jacob" | "andrea" | "barber";

export type EmailTemplateName =
  | "andrea"
  | "barber"
  | "jacob-alert"
  | "jacob-review"
  | "jacob-check-failure"
  | "jacob-barber-draft"
  | "jacob-resolved"
  | "andrea-resolved"
  | "token-expiry";

export interface Config {
  failureThresholdHours: number;
  countdownHours: number;
  requiredStaleChecks: number;
  barberMode: "draft" | "auto" | "off";
  /** True only when BARBER_MODE=auto AND the confirm phrase matches exactly. */
  barberAutoArmed: boolean;
  /** True when the barber template still contains the string PLACEHOLDER. */
  barberTemplateIsPlaceholder: boolean;
  tokenExpiryAlarmDays: number;
}

export const INITIAL_STATE: State = {
  status: "SAFE",
  lastPostAt: null,
  lastPostPermalink: null,
  lastPostId: null,
  lastCheckedAt: null,
  lastCheckOk: true,
  consecutiveStaleChecks: 0,
  failureDeclaredAt: null,
  deadlineAt: null,
  notifiedAndreaAt: null,
  barberDraftSentAt: null,
  barberSentAt: null,
  submission: null,
  paused: false,
  pauseReason: null,
  tokenExpiresAt: null,
  version: 0,
  consecutiveFailedChecks: 0,
  notifiedCheckFailureAt: null,
  notifiedJacobFailureAt: null,
  protocolToken: null,
  barberApproveToken: null,
  remainingMs: null,
  episode: 0,
  notifiedTokenExpiryAt: null,
};
