import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 32-char URL-safe random token. SPEC.md §6. */
export function mintToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url").slice(0, 32);
}

/** Constant-time compare that does not leak length through an early return. */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still burn a comparison so the timing does not distinguish length.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/** `<value>.<sig>` cookie payloads for the admin session. SPEC.md §9. */
export function signPayload(value: string, secret: string): string {
  return `${Buffer.from(value).toString("base64url")}.${sign(value, secret)}`;
}

export function verifyPayload(signed: string | undefined, secret: string): string | null {
  if (!signed) return null;
  const idx = signed.lastIndexOf(".");
  if (idx <= 0) return null;
  const value = Buffer.from(signed.slice(0, idx), "base64url").toString();
  return safeEqual(signed.slice(idx + 1), sign(value, secret)) ? value : null;
}
