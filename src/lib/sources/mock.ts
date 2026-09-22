/**
 * Env-driven mock. SPEC.md §4 and phase 1.
 *
 *   USE_MOCK_SOURCE=true
 *   MOCK_LAST_POST_AT=2026-09-01T12:00:00Z   # or a relative "-8d" / "-3h"
 *   MOCK_FAIL=true                            # simulate a fetch failure
 *   MOCK_EMPTY=true                           # simulate an empty media list
 */

import { SourceError, type Post, type PostSource } from "./types";

function parseWhen(raw: string, now = new Date()): Date {
  const rel = /^-(\d+)([dhm])$/.exec(raw.trim());
  if (rel) {
    const n = Number(rel[1]);
    const ms = rel[2] === "d" ? 86_400_000 : rel[2] === "h" ? 3_600_000 : 60_000;
    return new Date(now.getTime() - n * ms);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new SourceError(`MOCK_LAST_POST_AT is not a date: ${raw}`);
  return d;
}

export class MockSource implements PostSource {
  name = "mock";

  constructor(private readonly raw?: string) {}

  async getLatestPost(): Promise<Post | null> {
    if (process.env.MOCK_FAIL === "true") throw new SourceError("MOCK_FAIL is set");
    if (process.env.MOCK_EMPTY === "true") return null;
    const raw = this.raw ?? process.env.MOCK_LAST_POST_AT;
    if (!raw) return null;
    const when = parseWhen(raw);
    return {
      id: `mock-${when.getTime()}`,
      timestamp: when.toISOString(),
      permalink: "https://www.instagram.com/p/mock/",
      mediaType: "VIDEO",
    };
  }
}
