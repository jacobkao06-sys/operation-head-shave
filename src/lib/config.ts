/**
 * Environment access. SPEC.md §10.
 *
 * Nothing here is ever imported into a client component. Every value is read
 * lazily so that a missing var fails at the point of use with a clear message,
 * not at module load in a route that did not need it.
 */

import type { Config } from "./types";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

export function required(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = env(name);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = env(name);
  if (v === undefined) return fallback;
  return v === "true" || v === "1";
}

export const BARBER_CONFIRM_PHRASE = "SEND WITHOUT ASKING";

export const env_ = {
  publicUrl: () => env("PUBLIC_URL") ?? "http://localhost:3000",
  protocolUrl: () => env("PROTOCOL_URL") ?? "http://localhost:3000",
  tz: () => env("TZ_DISPLAY") ?? "America/New_York",
  failureThresholdHours: () => num("FAILURE_THRESHOLD_HOURS", 168),
  countdownHours: () => num("COUNTDOWN_HOURS", 72),
  /** SPEC.md §10: flip to false only after a full simulated run. */
  dryRun: () => bool("DRY_RUN", true),

  igAppId: () => env("IG_APP_ID"),
  igAppSecret: () => env("IG_APP_SECRET"),
  igApiVersion: () => env("IG_API_VERSION") ?? "v23.0",
  igMediaTypes: () =>
    (env("IG_MEDIA_TYPES") ?? "IMAGE,VIDEO,CAROUSEL_ALBUM,REELS")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),

  upstashUrl: () => env("UPSTASH_REDIS_REST_URL"),
  upstashToken: () => env("UPSTASH_REDIS_REST_TOKEN"),
  blobToken: () => env("BLOB_READ_WRITE_TOKEN"),

  resendKey: () => env("RESEND_API_KEY"),
  mailFrom: () => env("MAIL_FROM") ?? "protocol@mail.jacobkao.com",
  jacobEmail: () => env("JACOB_EMAIL"),
  andreaEmail: () => env("ANDREA_EMAIL"),
  barberEmail: () => env("BARBER_EMAIL"),
  barberMode: (): Config["barberMode"] => {
    const v = (env("BARBER_MODE") ?? "draft").toLowerCase();
    return v === "auto" || v === "off" ? v : "draft";
  },
  barberConfirmPhrase: () => env("BARBER_CONFIRM_PHRASE") ?? "",

  anthropicKey: () => env("ANTHROPIC_API_KEY"),
  visionModel: () => env("VISION_MODEL") ?? "claude-sonnet-5",
  visionMinConfidence: () => num("VISION_MIN_CONFIDENCE", 0.7),

  cronSecret: () => env("CRON_SECRET"),
  adminToken: () => env("ADMIN_TOKEN"),

  /** MockSource driver. SPEC.md §11 phase 1. */
  mockLastPostAt: () => env("MOCK_LAST_POST_AT"),
  useMockSource: () => bool("USE_MOCK_SOURCE", false),
  manualHeartbeatSecret: () => env("MANUAL_HEARTBEAT_SECRET"),
};

/**
 * `auto` is armed only when BARBER_MODE=auto AND BARBER_CONFIRM_PHRASE matches
 * the phrase exactly. SPEC.md §7: a stray env edit must not mail a real business.
 */
export function barberAutoArmed(): boolean {
  return env_.barberMode() === "auto" && env_.barberConfirmPhrase() === BARBER_CONFIRM_PHRASE;
}

export function buildConfig(overrides: Partial<Config> = {}): Config {
  return {
    failureThresholdHours: env_.failureThresholdHours(),
    countdownHours: env_.countdownHours(),
    requiredStaleChecks: 2,
    barberMode: env_.barberMode(),
    barberAutoArmed: barberAutoArmed(),
    barberTemplateIsPlaceholder: true, // replaced by the caller once templates are loaded
    tokenExpiryAlarmDays: 10,
    ...overrides,
  };
}
