/** Auth helpers. SPEC.md §9: one bearer token, no user accounts. */

import { cookies } from "next/headers";
import { env_ } from "./config";
import { safeEqual, signPayload, verifyPayload } from "./tokens";

export const ADMIN_COOKIE = "ohs_admin";

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/** The GitHub Actions cron. An admin session is also accepted for manual runs. */
export async function isCronAuthorized(req: Request): Promise<boolean> {
  const secret = env_.cronSecret();
  if (secret && safeEqual(bearer(req), secret)) return true;
  return isAdmin();
}

export async function isAdmin(): Promise<boolean> {
  const token = env_.adminToken();
  if (!token) return false;
  const jar = await cookies();
  return verifyPayload(jar.get(ADMIN_COOKIE)?.value, token) === "admin";
}

export function adminCookieValue(): string {
  return signPayload("admin", env_.adminToken() ?? "");
}

/**
 * Signed one-click links for the review emails. Scoped to the failure episode so
 * a link from a previous episode is dead. SPEC.md §6.
 */
export function reviewLink(action: "confirm" | "reject", episode: number): string {
  const token = env_.adminToken();
  if (!token) return "";
  const payload = `${action}:${episode}`;
  return `${env_.publicUrl()}/api/review/${action}?t=${signPayload(payload, token)}`;
}

export function verifyReviewLink(action: "confirm" | "reject", episode: number, t: string | null): boolean {
  const token = env_.adminToken();
  if (!token || !t) return false;
  return verifyPayload(t, token) === `${action}:${episode}`;
}

/**
 * Freshness token for a proof capture. SPEC.md §6, amended 2026-09-25.
 *
 * The protocol page mints one when it renders; /api/upload refuses a submission
 * without a valid, recent one. This is the server-side half of "live camera
 * only": without it the endpoint would still accept any bytes anyone posted at
 * it, and the camera-only UI would be decoration.
 *
 * What it actually guarantees: the upload came from a protocol page loaded in
 * the last CAPTURE_WINDOW_MS, for THIS failure episode. What it does not
 * guarantee: that the pixels came from a lens. Nothing on the web can.
 */
export const CAPTURE_WINDOW_MS = 15 * 60 * 1000;

export function mintCaptureToken(protocolToken: string, now = Date.now()): string {
  const secret = env_.adminToken();
  if (!secret) return "";
  return signPayload(`cap:${protocolToken}:${now}`, secret);
}

export function verifyCaptureToken(
  protocolToken: string,
  supplied: string | null | undefined,
  now = Date.now(),
  windowMs = CAPTURE_WINDOW_MS,
): boolean {
  const secret = env_.adminToken();
  if (!secret || !supplied) return false;
  const payload = verifyPayload(supplied, secret);
  if (!payload) return false;
  const prefix = `cap:${protocolToken}:`;
  if (!payload.startsWith(prefix)) return false;
  const issued = Number(payload.slice(prefix.length));
  if (!Number.isFinite(issued)) return false;
  const age = now - issued;
  // Reject a clock-skewed future token as well as a stale one.
  return age >= -60_000 && age <= windowMs;
}
