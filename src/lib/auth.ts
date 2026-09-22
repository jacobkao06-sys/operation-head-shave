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
