/**
 * Proof upload. SPEC.md §6.
 *
 * Nothing the client says is believed: not the filename, not the declared
 * content type, not the status, not the clock. The token must match the live
 * episode, the bytes must sniff as an image, and the verdict comes from the
 * server-side pre-screen.
 */

import { NextResponse } from "next/server";
import { env_ } from "@/lib/config";
import { dispatch } from "@/lib/notify/dispatch";
import { barberTemplateIsPlaceholder } from "@/lib/notify/templates";
import { MAX_BYTES, UploadError, normalize, storePhoto } from "@/lib/photo";
import { acceptSubmission } from "@/lib/state";
import { appendEvent, loadState, rateLimit, saveState } from "@/lib/store";
import { safeEqual } from "@/lib/tokens";
import { verifyCaptureToken } from "@/lib/auth";
import { accepts, prescreen } from "@/lib/vision";
import type { Submission } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function reply(req: Request, token: string, status: number, code: string, message: string) {
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");
  if (wantsJson) return NextResponse.json({ ok: status < 400, code, message }, { status });
  const url = new URL(`/p/${token}`, env_.protocolUrl());
  url.searchParams.set("r", code);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: Request) {
  const state = await loadState();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, code: "BAD_FORM", message: "Malformed upload." }, { status: 400 });
  }

  const token = String(form.get("token") ?? "");

  // Generic failure for a bad token: no information leak about whether an
  // episode is running. §6.
  if (!state.protocolToken || !safeEqual(token, state.protocolToken)) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND", message: "Not found." }, { status: 404 });
  }

  if (state.status !== "FAILURE") {
    return reply(req, token, 409, "NOT_ACTIVE", `The protocol is ${state.status}. Nothing to halt.`);
  }

  // The capture must come from a protocol page loaded in the last 15 minutes.
  // This is the server-side half of "live camera only" (§6, amended
  // 2026-09-25): without it the camera-only UI is decoration, because this
  // endpoint would still take any bytes anyone posted at it.
  if (!verifyCaptureToken(token, String(form.get("captureToken") ?? ""))) {
    return reply(
      req,
      token,
      403,
      "STALE_CAPTURE",
      "This page went stale, or the photo did not come from it. Reload and take the photo again.",
    );
  }

  // §6 rate limits. Per-token first so a global flood cannot lock out the one
  // person who is actually trying to stop the countdown.
  if (!(await rateLimit(`upload:${token}`, 5, 3600))) {
    return reply(req, token, 429, "RATE_LIMITED", "SLOW DOWN. 5 UPLOADS PER HOUR. TRY AGAIN LATER.");
  }
  if (!(await rateLimit("upload:global", 20, 86_400))) {
    return reply(req, token, 429, "RATE_LIMITED", "GLOBAL LIMIT REACHED. TRY AGAIN TOMORROW.");
  }

  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return reply(req, token, 400, "NO_FILE", "No photo was attached.");
  }
  if (file.size > MAX_BYTES) {
    return reply(req, token, 413, "TOO_LARGE", "That photo is over 10 MB.");
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return reply(req, token, 413, "TOO_LARGE", "That photo is over 10 MB.");
  }

  const now = new Date();
  let jpeg;
  try {
    jpeg = await normalize(buf);
  } catch (err) {
    const code = err instanceof UploadError ? err.code : "BAD_IMAGE";
    const message = err instanceof Error ? err.message : "That file could not be read as an image.";
    await appendEvent({ at: now.toISOString(), event: "upload.rejected", status: state.status, detail: { code } });
    return reply(req, token, 400, code, message);
  }

  const verdict = await prescreen(jpeg.data);

  if (!accepts(verdict)) {
    // The countdown keeps running. Log the attempt. §6.
    await appendEvent({
      at: now.toISOString(),
      event: "upload.prescreen_rejected",
      status: state.status,
      detail: { ...verdict },
    });
    return reply(
      req,
      token,
      422,
      "PRESCREEN_REJECTED",
      `REJECTED: ${verdict.reason}. The countdown is still running.`,
    );
  }

  const stored = await storePhoto(jpeg);
  const submission: Submission = {
    blobKey: stored.key,
    blobUrl: stored.url,
    submittedAt: now.toISOString(),
    vision: verdict,
    confirmedBy: null,
    confirmedAt: null,
  };

  const { state: next, effects } = acceptSubmission(state, now, submission);
  if (!(await saveState(next))) {
    return reply(req, token, 409, "CONFLICT", "Something else changed the state. Try once more.");
  }

  const placeholder = await barberTemplateIsPlaceholder();
  for (const e of effects) {
    if (e.type === "log") {
      await appendEvent({ at: now.toISOString(), event: e.event, status: next.status, detail: e.detail });
    } else {
      const r = await dispatch(e, { state: next, now }, { barberIsPlaceholder: placeholder });
      await appendEvent({
        at: now.toISOString(),
        event: r.ok ? "email.sent" : "email.failed",
        status: next.status,
        detail: { ...r },
      });
    }
  }

  return reply(
    req,
    token,
    200,
    "ACCEPTED",
    "ACCEPTED. COUNTDOWN FROZEN PENDING VERIFICATION.",
  );
}
