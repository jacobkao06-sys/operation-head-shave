/**
 * The orchestrator. SPEC.md §1.
 *
 *   1. build the sources          2. fetch the latest post (fail safe on throw)
 *   3. evaluate                   4. persist (CAS)
 *   5. append the audit events    6. perform the side effects
 *
 * Order matters at step 4/6: the state is written BEFORE any mail goes out, so
 * `notifiedAndreaAt` is durable before Andrea could possibly receive anything.
 * A crash in between loses a notification, which is the safe direction and is
 * visible in the event log. The reverse order would mail Andrea five times.
 */

import { buildConfig, env_ } from "./config";
import { MockSource } from "./sources/mock";
import { InstagramSource } from "./sources/instagram";
import { barberTemplateIsPlaceholder } from "./notify/templates";
import { dispatch, type DispatchResult } from "./notify/dispatch";
import type { Notifier } from "./notify";
import { appendEvent, loadIg, loadOverrides, loadState, saveState } from "./store";
import { evaluateCheck } from "./state";
import { mintToken } from "./tokens";
import type { Post, PostSource, State } from "./types";

export interface CheckReport {
  state: State;
  fetchOk: boolean;
  latestPost: Post | null;
  sources: string[];
  sourceError?: string;
  events: { at: string; event: string; detail?: Record<string, unknown> }[];
  dispatched: DispatchResult[];
  conflict?: boolean;
}

/** Instagram only today. The interface keeps TikTok one file away. SPEC.md §4. */
async function buildSources(): Promise<{ sources: PostSource[]; tokenExpiresAt: string | null }> {
  if (env_.useMockSource()) return { sources: [new MockSource()], tokenExpiresAt: null };
  const creds = await loadIg();
  const source = await InstagramSource.create();
  return { sources: [source], tokenExpiresAt: creds?.expiresAt ?? null };
}

/** Most recent post across all enabled sources. Any throw makes the whole check inconclusive. */
async function latestAcross(sources: PostSource[]): Promise<Post | null> {
  const posts = await Promise.all(sources.map((s) => s.getLatestPost()));
  const found = posts.filter((p): p is Post => p !== null);
  if (found.length === 0) return null;
  return found.reduce((a, b) => (Date.parse(a.timestamp) >= Date.parse(b.timestamp) ? a : b));
}

export interface RunCheckOptions {
  now?: Date;
  notifier?: Notifier;
  /** Admin "simulate": pretend the last post was at this time without touching IG. */
  simulateLastPostAt?: string;
}

export async function runCheck(opts: RunCheckOptions = {}): Promise<CheckReport> {
  const now = opts.now ?? new Date();
  let prev = await loadState();
  const overrides = await loadOverrides();

  // `lastPostAt` is monotonic in normal operation: a later fetch never moves it
  // backwards, so a deleted post cannot un-declare a failure. Simulate is the
  // one sanctioned way to move it back, and it is admin-only. SPEC.md §9.
  if (opts.simulateLastPostAt) {
    prev = { ...prev, lastPostAt: new Date(opts.simulateLastPostAt).toISOString() };
  }

  const placeholder = await barberTemplateIsPlaceholder();
  const cfg = buildConfig({
    barberTemplateIsPlaceholder: placeholder,
    ...(overrides.barberMode ? { barberMode: overrides.barberMode } : {}),
    ...(overrides.barberMode === "auto"
      ? { barberAutoArmed: overrides.barberConfirmPhrase === "SEND WITHOUT ASKING" }
      : {}),
  });

  let fetchOk = true;
  let latestPost: Post | null = null;
  let sourceNames: string[] = [];
  let sourceError: string | undefined;
  let tokenExpiresAt: string | null = null;

  if (opts.simulateLastPostAt) {
    sourceNames = ["simulated"];
    latestPost = {
      id: `sim-${Date.parse(opts.simulateLastPostAt)}`,
      timestamp: new Date(opts.simulateLastPostAt).toISOString(),
      permalink: "https://www.instagram.com/p/simulated/",
      mediaType: "VIDEO",
    };
    tokenExpiresAt = prev.tokenExpiresAt;
  } else {
    try {
      const built = await buildSources();
      sourceNames = built.sources.map((s) => s.name);
      tokenExpiresAt = built.tokenExpiresAt;
      latestPost = await latestAcross(built.sources);
    } catch (err) {
      // Hard rule 1. A throw here never transitions anything.
      fetchOk = false;
      sourceError = err instanceof Error ? err.message : String(err);
    }
  }

  const { state: next, effects } = evaluateCheck(
    prev,
    { now, fetchOk, latestPost, tokenExpiresAt },
    cfg,
    mintToken,
  );

  const saved = await saveState(next);
  if (!saved) {
    // Another writer won. Do nothing further — no state, no mail. The next
    // scheduled run re-evaluates from whatever they wrote.
    return {
      state: prev,
      fetchOk,
      latestPost,
      sources: sourceNames,
      sourceError,
      events: [],
      dispatched: [],
      conflict: true,
    };
  }

  const events: CheckReport["events"] = [];
  const logEffects = effects.filter((e) => e.type === "log");
  if (sourceError) {
    logEffects.unshift({ type: "log", event: "source.error", detail: { message: sourceError } });
  }
  for (const e of logEffects) {
    const line = { at: now.toISOString(), event: e.event, status: next.status, detail: e.detail };
    await appendEvent(line);
    events.push({ at: line.at, event: e.event, detail: e.detail });
  }

  const dispatched: DispatchResult[] = [];
  for (const e of effects) {
    if (e.type !== "email") continue;
    const result = await dispatch(e, { state: next, now }, {
      notifier: opts.notifier,
      barberIsPlaceholder: placeholder,
    });
    dispatched.push(result);
    await appendEvent({
      at: now.toISOString(),
      event: result.ok ? "email.sent" : "email.failed",
      status: next.status,
      detail: { ...result },
    });
  }

  return { state: next, fetchOk, latestPost, sources: sourceNames, sourceError, events, dispatched };
}
