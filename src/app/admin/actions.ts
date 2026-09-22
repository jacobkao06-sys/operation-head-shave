"use server";

/**
 * Admin actions. SPEC.md §9.
 *
 * Every one of these re-checks the session itself — a server action is a public
 * endpoint, not a private function. Every one appends to the event log with an
 * actor and a reason.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ADMIN_COOKIE, adminCookieValue, isAdmin } from "@/lib/auth";
import { env_ } from "@/lib/config";
import { dispatch } from "@/lib/notify/dispatch";
import {
  TEMPLATE_NAMES,
  barberTemplateIsPlaceholder,
  resetTemplate,
  saveTemplate,
} from "@/lib/notify/templates";
import { runCheck } from "@/lib/check";
import { adminResetToSafe, confirmSubmission, pause, rejectSubmission, unpause } from "@/lib/state";
import { appendEvent, loadOverrides, loadState, saveOverrides, saveState } from "@/lib/store";
import { safeEqual } from "@/lib/tokens";
import type { Effect, EmailTemplateName, State } from "@/lib/types";

const ACTOR = "jacob (admin)";

async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new Error("unauthorized");
}

async function log(event: string, detail: Record<string, unknown>): Promise<void> {
  const state = await loadState();
  await appendEvent({
    at: new Date().toISOString(),
    event,
    status: state.status,
    actor: ACTOR,
    detail,
  });
}

/** Applies a state-machine outcome and performs its effects. */
async function apply(outcome: { state: State; effects: Effect[] }) {
  const now = new Date();
  if (!(await saveState(outcome.state))) throw new Error("version conflict — reload and retry");
  const placeholder = await barberTemplateIsPlaceholder();
  for (const e of outcome.effects) {
    if (e.type === "log") {
      await appendEvent({
        at: now.toISOString(),
        event: e.event,
        status: outcome.state.status,
        actor: ACTOR,
        detail: e.detail,
      });
    } else {
      const r = await dispatch(e, { state: outcome.state, now }, { barberIsPlaceholder: placeholder });
      await appendEvent({
        at: now.toISOString(),
        event: r.ok ? "email.sent" : "email.failed",
        status: outcome.state.status,
        actor: ACTOR,
        detail: { ...r },
      });
    }
  }
  revalidatePath("/admin");
}

export async function signIn(formData: FormData): Promise<void> {
  const token = env_.adminToken();
  const supplied = String(formData.get("token") ?? "");
  if (!token || !safeEqual(supplied, token)) {
    await appendEvent({
      at: new Date().toISOString(),
      event: "admin.signin_failed",
      status: (await loadState()).status,
    });
    return;
  }
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, adminCookieValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  await log("admin.signin", {});
  revalidatePath("/admin");
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
  revalidatePath("/admin");
}

export async function doPause(formData: FormData): Promise<void> {
  await requireAdmin();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) throw new Error("a pause needs a reason — it goes in the public log");
  await apply(pause(await loadState(), new Date(), ACTOR, reason));
}

export async function doUnpause(): Promise<void> {
  await requireAdmin();
  await apply(unpause(await loadState(), new Date(), ACTOR));
}

export async function doResetToSafe(formData: FormData): Promise<void> {
  await requireAdmin();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) throw new Error("a reset needs a reason — §4 says repeated resets justify TikTokSource");
  await apply(adminResetToSafe(await loadState(), new Date(), ACTOR, reason));
}

export async function doConfirm(): Promise<void> {
  await requireAdmin();
  await apply(confirmSubmission(await loadState(), new Date(), ACTOR));
}

export async function doReject(formData: FormData): Promise<void> {
  await requireAdmin();
  const reason = String(formData.get("reason") ?? "no reason given").trim();
  await apply(rejectSubmission(await loadState(), new Date(), ACTOR, reason));
}

export async function doCheck(formData: FormData): Promise<void> {
  await requireAdmin();
  const raw = String(formData.get("simulateLastPostAt") ?? "").trim();
  const simulate = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : undefined;
  const report = await runCheck({ simulateLastPostAt: simulate });
  await log("admin.ran_check", {
    simulated: simulate ?? null,
    status: report.state.status,
    mail: report.dispatched.map((d) => `${d.template}->${d.to}:${d.ok ? "ok" : d.error}`),
  });
  revalidatePath("/admin");
}

export async function doSaveTemplate(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "") as EmailTemplateName;
  if (!TEMPLATE_NAMES.includes(name)) throw new Error(`unknown template ${name}`);
  const source = String(formData.get("source") ?? "");
  await saveTemplate(name, source);
  await log("admin.template_saved", {
    name,
    bytes: source.length,
    stillPlaceholder: source.includes("PLACEHOLDER"),
  });
  revalidatePath("/admin");
}

export async function doResetTemplate(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "") as EmailTemplateName;
  if (!TEMPLATE_NAMES.includes(name)) throw new Error(`unknown template ${name}`);
  await resetTemplate(name);
  await log("admin.template_reset", { name });
  revalidatePath("/admin");
}

/**
 * Session overrides for DRY_RUN and the barber mode, so Jacob can arm things
 * from his phone without a redeploy. `auto` still needs the exact confirm
 * phrase — the two-key rule is not relaxed here. SPEC.md §7.
 */
export async function doSaveOverrides(formData: FormData): Promise<void> {
  await requireAdmin();
  const mode = String(formData.get("barberMode") ?? "draft");
  const phrase = String(formData.get("barberConfirmPhrase") ?? "");
  const dryRun = formData.get("dryRun") === "on";

  const next = {
    barberMode: (mode === "auto" || mode === "off" ? mode : "draft") as "draft" | "auto" | "off",
    barberConfirmPhrase: phrase,
    dryRun,
  };
  await saveOverrides(next);
  await log("admin.overrides_saved", {
    barberMode: next.barberMode,
    autoArmed: next.barberMode === "auto" && phrase === "SEND WITHOUT ASKING",
    dryRun,
  });
  revalidatePath("/admin");
}

export async function currentOverrides() {
  return loadOverrides();
}
