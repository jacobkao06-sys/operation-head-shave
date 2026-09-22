/**
 * SPEC.md §6 and §13: the protocol page and everything that can reveal a photo
 * must never be indexed. The meta tag is on the page; this is the header rail,
 * which also covers the API routes that have no HTML head.
 */

import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const p = req.nextUrl.pathname;
  if (p.startsWith("/p/") || p.startsWith("/admin") || p.startsWith("/api/")) {
    res.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  }
  return res;
}

export const config = {
  matcher: ["/p/:path*", "/admin/:path*", "/api/:path*"],
};
