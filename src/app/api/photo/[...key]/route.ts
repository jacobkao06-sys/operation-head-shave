/** Serves an uploaded proof photo. Admin session only; never public. SPEC.md §6. */

import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { readPhoto } from "@/lib/photo";
import { loadState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { key } = await ctx.params;
  const requested = key.join("/");

  // Only ever serve the key the current state points at. Even an admin cannot
  // enumerate the blob store through this route.
  const state = await loadState();
  if (!state.submission || state.submission.blobKey !== requested) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const data = await readPhoto(requested);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
