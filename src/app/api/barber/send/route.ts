/**
 * The one-click barber approve link. SPEC.md §7 and §13.
 *
 * This is the only code path in the system that can put mail in front of a real
 * business, so every rail is checked here again rather than trusted from
 * upstream:
 *
 *   1. the token must match the CURRENT episode's barberApproveToken
 *   2. the template must not contain the string PLACEHOLDER
 *   3. barberSentAt must be unset — one barber email per episode, no retries
 *   4. a failed send alerts Jacob; it is never re-attempted
 */

import { NextResponse } from "next/server";
import { env_ } from "@/lib/config";
import { dispatch } from "@/lib/notify/dispatch";
import { barberTemplateIsPlaceholder } from "@/lib/notify/templates";
import { appendEvent, loadState, saveState } from "@/lib/store";
import { safeEqual } from "@/lib/tokens";

export const dynamic = "force-dynamic";

function page(title: string, detail: string, status: number) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${title}</title>
<style>body{background:#000;color:#00ff41;font-family:ui-monospace,Menlo,monospace;
padding:3rem 1.5rem;line-height:1.7}h1{font-size:1.4rem;letter-spacing:.06em}
p{max-width:60ch;color:#00803a}</style></head>
<body><h1>${title}</h1><p>${detail}</p></body></html>`;
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow" },
  });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const state = await loadState();
  const now = new Date();

  if (!state.barberApproveToken || !safeEqual(token, state.barberApproveToken)) {
    return page("LINK DEAD", "This approve link is invalid or belongs to a closed episode.", 404);
  }

  if (state.barberSentAt) {
    return page(
      "ALREADY SENT",
      `One barber email per episode. This one went out at ${state.barberSentAt}.`,
      409,
    );
  }

  if (state.status !== "FAILURE") {
    return page("NOT ACTIVE", `The protocol is ${state.status}. Nothing to send.`, 409);
  }

  if (await barberTemplateIsPlaceholder()) {
    return page(
      "REFUSED",
      "templates/barber.md still contains the string PLACEHOLDER. Write the real copy in " +
        "/admin first — this system will not mail a real business a placeholder.",
      409,
    );
  }

  // Burn the token in the same write that records the send, so a double-click
  // cannot produce a second email even if the send itself is slow.
  const next = {
    ...state,
    barberSentAt: now.toISOString(),
    barberApproveToken: null,
    version: state.version + 1,
  };
  if (!(await saveState(next))) {
    return page("CONFLICT", "Something else wrote the state. Reload and try once more.", 409);
  }

  const result = await dispatch(
    { type: "email", template: "barber", to: "barber", reason: "approved by human click" },
    { state: next, now },
    { barberIsPlaceholder: false },
  );

  await appendEvent({
    at: now.toISOString(),
    event: result.ok ? "barber.sent" : "barber.send_failed",
    status: next.status,
    actor: "jacob (approve link)",
    detail: { ...result },
  });

  if (!result.ok) {
    // No retry. §7: a bounced send alerts Jacob rather than re-attempting.
    await dispatch(
      {
        type: "email",
        template: "jacob-alert",
        to: "jacob",
        reason: `The barber send FAILED and was not retried: ${result.error}`,
      },
      { state: next, now },
      { barberIsPlaceholder: true },
    );
    return page("SEND FAILED", `${result.error}. Not retried. You have been emailed.`, 502);
  }

  return page(
    result.dryRun ? "SENT (DRY RUN)" : "SENT",
    result.dryRun
      ? `DRY_RUN is on, so this went to you, not to ${env_.barberEmail()}.`
      : `Delivered to ${result.resolvedTo}. This link is now dead.`,
    200,
  );
}
