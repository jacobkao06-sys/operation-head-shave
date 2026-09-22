/**
 * Kicks off the Instagram OAuth flow. SPEC.md §4.
 *
 * Admin-only: minting a token is a privileged act, and the callback writes to
 * KV. The `state` parameter is signed so a stray callback cannot inject a code.
 */

import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { env_ } from "@/lib/config";
import { authorizeUrl } from "@/lib/sources/instagram";
import { signPayload } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export function redirectUri(): string {
  return `${env_.publicUrl()}/api/auth/instagram/callback`;
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized — sign in at /admin first" }, { status: 401 });
  }
  const adminToken = env_.adminToken();
  if (!adminToken) return NextResponse.json({ error: "ADMIN_TOKEN is not set" }, { status: 500 });

  try {
    const nonce = `ig:${Date.now()}`;
    return NextResponse.redirect(authorizeUrl(redirectUri(), signPayload(nonce, adminToken)));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
