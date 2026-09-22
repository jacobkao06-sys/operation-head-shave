/**
 * The confirm / reject links from the review email. SPEC.md §3, §6.
 *
 * Signed with ADMIN_TOKEN and scoped to the failure episode, so a link from a
 * previous episode is dead. An admin session can also drive these from /admin.
 */

import { NextResponse } from "next/server";
import { isAdmin, verifyReviewLink } from "@/lib/auth";
import { dispatch } from "@/lib/notify/dispatch";
import { barberTemplateIsPlaceholder } from "@/lib/notify/templates";
import { confirmSubmission, rejectSubmission } from "@/lib/state";
import { appendEvent, loadState, saveState } from "@/lib/store";

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

export async function GET(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (action !== "confirm" && action !== "reject") return page("NOT FOUND", "", 404);

  const state = await loadState();
  const t = new URL(req.url).searchParams.get("t");
  const authorized = verifyReviewLink(action, state.episode, t) || (await isAdmin());
  if (!authorized) return page("LINK DEAD", "This link is invalid or belongs to a closed episode.", 403);

  if (state.status !== "PENDING_REVIEW") {
    return page("NOTHING TO REVIEW", `The protocol is ${state.status}.`, 409);
  }

  const now = new Date();
  const outcome =
    action === "confirm"
      ? confirmSubmission(state, now, "jacob (email link)")
      : rejectSubmission(state, now, "jacob (email link)", "rejected from the review email");

  if (!(await saveState(outcome.state))) {
    return page("CONFLICT", "Something else changed the state. Reload and try again.", 409);
  }

  const placeholder = await barberTemplateIsPlaceholder();
  for (const e of outcome.effects) {
    if (e.type === "log") {
      await appendEvent({
        at: now.toISOString(),
        event: e.event,
        status: outcome.state.status,
        actor: "jacob (email link)",
        detail: e.detail,
      });
    } else {
      const r = await dispatch(e, { state: outcome.state, now }, { barberIsPlaceholder: placeholder });
      await appendEvent({
        at: now.toISOString(),
        event: r.ok ? "email.sent" : "email.failed",
        status: outcome.state.status,
        detail: { ...r },
      });
    }
  }

  return action === "confirm"
    ? page("CONFIRMED", "Protocol complete. The status is RESOLVED and everyone has been told.", 200)
    : page(
        "REJECTED",
        `The countdown has resumed and now ends at ${outcome.state.deadlineAt}.`,
        200,
      );
}
