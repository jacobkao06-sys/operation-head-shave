/**
 * OAuth callback. Exchanges the code for a long-lived (60d) token and stores it
 * in KV — env vars cannot be rewritten at runtime. SPEC.md §4.
 */

import { NextResponse } from "next/server";
import { env_ } from "@/lib/config";
import { exchangeCode } from "@/lib/sources/instagram";
import { appendEvent, loadState, saveIg, saveState } from "@/lib/store";
import { verifyPayload } from "@/lib/tokens";
import { redirectUri } from "../start/route";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (error) {
    return NextResponse.json({ error: `Instagram refused: ${error}` }, { status: 400 });
  }

  const adminToken = env_.adminToken();
  const nonce = verifyPayload(url.searchParams.get("state") ?? undefined, adminToken ?? "");
  if (!adminToken || !nonce?.startsWith("ig:")) {
    return NextResponse.json({ error: "bad or missing state parameter" }, { status: 400 });
  }

  const code = url.searchParams.get("code");
  if (!code) return NextResponse.json({ error: "no code in callback" }, { status: 400 });

  try {
    const creds = await exchangeCode(code, redirectUri());
    await saveIg(creds);

    // Mirror the expiry into the state so /admin and the §4 alarm can see it
    // without a round trip to Meta.
    const state = await loadState();
    await saveState({ ...state, tokenExpiresAt: creds.expiresAt, version: state.version + 1 });
    await appendEvent({
      at: new Date().toISOString(),
      event: "instagram.token_minted",
      status: state.status,
      detail: { expiresAt: creds.expiresAt, userId: creds.userId },
    });

    return NextResponse.json({
      ok: true,
      expiresAt: creds.expiresAt,
      userId: creds.userId ?? null,
      next: "Token stored in KV. Confirm it on /admin, then run a check.",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
