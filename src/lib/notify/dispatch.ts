/**
 * Turns the state machine's declarative effects into real mail. SPEC.md §7, §9.
 *
 * Two rails live here and nowhere else:
 *   - DRY_RUN redirects every message to Jacob with a banner naming the
 *     intended recipient. Nothing leaves the building.
 *   - The barber recipient is refused outright if the template still contains
 *     the string PLACEHOLDER, in any mode. §13.
 */

import { env_ } from "../config";
import { fmtIso, fmtLocal } from "../time";
import { loadOverrides } from "../store";
import type { Effect, EmailTemplateName, Recipient, State } from "../types";
import { EmailNotifier, type Notifier } from "./index";
import { render } from "./templates";

const HOUR_MS = 3_600_000;

export interface DispatchResult {
  template: EmailTemplateName;
  to: Recipient;
  resolvedTo: string;
  ok: boolean;
  dryRun: boolean;
  error?: string;
}

export async function resolveRecipient(to: Recipient): Promise<string | null> {
  switch (to) {
    case "jacob":
      return env_.jacobEmail() ?? null;
    case "andrea":
      return env_.andreaEmail() ?? null;
    case "barber":
      return env_.barberEmail() ?? null;
  }
}

export interface VarContext {
  state: State;
  now: Date;
  reason?: string;
  extra?: Record<string, string>;
}

/** The `{{variable}}` bag. SPEC.md §7 lists the required names; the rest are additive. */
export function buildVars(ctx: VarContext): Record<string, string> {
  const { state, now } = ctx;
  const publicUrl = env_.publicUrl();
  const protocolBase = env_.protocolUrl();
  const remainingMs = state.deadlineAt
    ? Math.max(0, Date.parse(state.deadlineAt) - now.getTime())
    : (state.remainingMs ?? 0);
  const daysSincePost = state.lastPostAt
    ? Math.floor((now.getTime() - Date.parse(state.lastPostAt)) / 86_400_000)
    : 0;

  return {
    // §7 required
    deadline_local: fmtLocal(state.deadlineAt),
    deadline_iso: fmtIso(state.deadlineAt),
    hours_remaining: String(Math.floor(remainingMs / HOUR_MS)),
    protocol_url: state.protocolToken ? `${protocolBase}/p/${state.protocolToken}` : protocolBase,
    last_post_date: fmtLocal(state.lastPostAt),
    days_since_post: String(daysSincePost),
    public_url: publicUrl,
    // additive
    admin_url: `${publicUrl}/admin`,
    status: state.status,
    reason: ctx.reason ?? "",
    barber_email: env_.barberEmail() ?? "(BARBER_EMAIL unset)",
    barber_approve_url: state.barberApproveToken
      ? `${publicUrl}/api/barber/send?token=${state.barberApproveToken}`
      : "(no approve token)",
    failure_declared_local: fmtLocal(state.failureDeclaredAt),
    last_check_local: fmtLocal(state.lastCheckedAt),
    token_expires_local: fmtLocal(state.tokenExpiresAt),
    days_until_token_expiry: state.tokenExpiresAt
      ? String(Math.floor((Date.parse(state.tokenExpiresAt) - now.getTime()) / 86_400_000))
      : "—",
    vision_shaved: state.submission ? String(state.submission.vision.shaved) : "—",
    vision_confidence: state.submission ? state.submission.vision.confidence.toFixed(2) : "—",
    vision_reason: state.submission?.vision.reason ?? "—",
    submitted_local: fmtLocal(state.submission?.submittedAt ?? null),
    photo_url: state.submission ? `${publicUrl}/api/photo/${state.submission.blobKey}` : "—",
    confirm_url: "",
    reject_url: "",
    ...ctx.extra,
  };
}

export async function isDryRun(): Promise<boolean> {
  const o = await loadOverrides();
  return o.dryRun ?? env_.dryRun();
}

/**
 * Performs one email effect. Never throws — a delivery failure is reported, not
 * retried (§7: a bounced barber send alerts Jacob rather than re-attempting).
 */
export async function dispatch(
  effect: Extract<Effect, { type: "email" }>,
  ctx: VarContext,
  opts: { notifier?: Notifier; barberIsPlaceholder: boolean },
): Promise<DispatchResult> {
  const base: Omit<DispatchResult, "ok" | "resolvedTo"> = {
    template: effect.template,
    to: effect.to,
    dryRun: false,
  };

  // §13 backstop. The state machine already refuses, but a template edit or an
  // admin action could route here by another path. One rail is not enough.
  if (effect.to === "barber" && opts.barberIsPlaceholder) {
    return {
      ...base,
      resolvedTo: "(refused)",
      ok: false,
      error: "Refused: the barber template still contains PLACEHOLDER",
    };
  }

  const dryRun = await isDryRun();
  const intended = await resolveRecipient(effect.to);
  if (!intended) {
    return {
      ...base,
      resolvedTo: "(unset)",
      ok: false,
      error: `No address configured for recipient "${effect.to}"`,
    };
  }

  const jacob = env_.jacobEmail();
  if (dryRun && !jacob) {
    return { ...base, resolvedTo: "(unset)", ok: false, dryRun: true, error: "DRY_RUN needs JACOB_EMAIL" };
  }

  const vars = buildVars({ ...ctx, reason: effect.reason });
  const { subject, body } = await render(effect.template, vars);

  const to = dryRun ? (jacob as string) : intended;
  const finalSubject = dryRun ? `[DRY RUN → ${intended}] ${subject}` : subject;
  const finalBody = dryRun
    ? `*** DRY RUN — this message was NOT sent to ${intended}. ***\n` +
      `*** Flip DRY_RUN=false (or clear it in /admin) to go live. ***\n\n${body}`
    : body;

  try {
    const notifier = opts.notifier ?? new EmailNotifier();
    await notifier.send(to, finalSubject, finalBody);
    return { ...base, resolvedTo: to, ok: true, dryRun };
  } catch (err) {
    return {
      ...base,
      resolvedTo: to,
      ok: false,
      dryRun,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
