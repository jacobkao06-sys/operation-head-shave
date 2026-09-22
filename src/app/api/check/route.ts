/**
 * The scheduled check. SPEC.md §1, §8.
 *
 * POST with `Authorization: Bearer $CRON_SECRET`, from GitHub Actions every 6h.
 * The response body is what the workflow commits to log/, so it is the audit
 * record: keep it complete and keep it free of secrets.
 */

import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { runCheck } from "@/lib/check";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await isCronAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Admin "simulate" (§9): force lastPostAt to an arbitrary date and run a
  // check, so the whole failure chain is exercisable without waiting 7 days.
  let simulateLastPostAt: string | undefined;
  try {
    const body = (await req.clone().json()) as { simulateLastPostAt?: string };
    if (body?.simulateLastPostAt && !Number.isNaN(Date.parse(body.simulateLastPostAt))) {
      simulateLastPostAt = body.simulateLastPostAt;
    }
  } catch {
    // No body, or not JSON. That is the normal cron case.
  }

  try {
    const report = await runCheck({ simulateLastPostAt });
    return NextResponse.json(
      {
        ok: true,
        checkedAt: new Date().toISOString(),
        status: report.state.status,
        state: report.state,
        sources: report.sources,
        fetchOk: report.fetchOk,
        sourceError: report.sourceError ?? null,
        conflict: report.conflict ?? false,
        simulated: simulateLastPostAt ?? null,
        events: report.events,
        dispatched: report.dispatched.map((d) => ({
          template: d.template,
          to: d.to,
          ok: d.ok,
          dryRun: d.dryRun,
          error: d.error ?? null,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    // A throw here means the rig itself is broken, not that Jacob failed.
    // Never transition on it. SPEC.md §13.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** Convenience for `workflow_dispatch` debugging and for /admin. */
export async function GET(req: Request) {
  return POST(req);
}
