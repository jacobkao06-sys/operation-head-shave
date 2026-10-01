import { beforeEach, describe, expect, it } from "vitest";
import { __setBackend, loadState, saveState } from "./store";
import { INITIAL_STATE, type State } from "./types";

function memoryBackend() {
  const kv = new Map<string, unknown>();
  return {
    async get<T>(k: string) {
      return (kv.get(k) as T) ?? null;
    },
    async set<T>(k: string, v: T) {
      kv.set(k, v);
    },
    async del(k: string) {
      kv.delete(k);
    },
    async casSet(k: string, v: State, expected: number) {
      const cur = kv.get(k) as State | undefined;
      if (cur && cur.version !== expected) return false;
      kv.set(k, v);
      return true;
    },
    async pushEvent() {},
    async listEvents() {
      return [];
    },
    async incr() {
      return 1;
    },
    async keys() {
      return [];
    },
  };
}

beforeEach(() => __setBackend(memoryBackend()));

describe("optimistic concurrency — SPEC.md §3 `version`", () => {
  it("accepts the first writer and rejects the second from the same base", async () => {
    const base = await loadState();
    expect(base.version).toBe(0);

    const a: State = { ...base, status: "FAILURE", version: base.version + 1 };
    const b: State = { ...base, paused: true, version: base.version + 1 };

    expect(await saveState(a)).toBe(true);
    // b was computed from version 0, which is no longer current.
    expect(await saveState(b)).toBe(false);
    expect((await loadState()).status).toBe("FAILURE");
  });

  it("lets a writer that re-read the state proceed", async () => {
    const first: State = { ...INITIAL_STATE, status: "FAILURE", version: 1 };
    await saveState(first);
    const fresh = await loadState();
    expect(await saveState({ ...fresh, paused: true, version: fresh.version + 1 })).toBe(true);
  });
});

describe("forward compatibility", () => {
  it("fills in fields a state written by an older deploy is missing", async () => {
    const backend = memoryBackend();
    __setBackend(backend);
    // A v1 state, before the extension fields existed.
    await backend.set("ohs:state", { status: "SAFE", version: 3 } as unknown as State);
    const s = await loadState();
    expect(s.version).toBe(3);
    expect(s.episode).toBe(0);
    expect(s.consecutiveFailedChecks).toBe(0);
    expect(s.protocolToken).toBeNull();
  });
});

describe("the local file store under concurrent writes", () => {
  // Regression: unserialised read-modify-write produced malformed JSON, which
  // the reader then treated as "no state yet". State appeared to save and then
  // silently vanish — it cost several wasted runs before it was spotted.
  it("does not lose writes when many land at once", async () => {
    const { __setBackend: reset, getBackend } = await import("./store");
    reset(null);
    const dir = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmp = await dir.mkdtemp(path.join(os.tmpdir(), "ohs-store-"));
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      const backend = getBackend();

      await Promise.all([
        backend.set("a", 1),
        backend.set("b", 2),
        backend.set("c", 3),
        backend.pushEvent({ at: "t", event: "one", status: "SAFE" }, 100),
        backend.pushEvent({ at: "t", event: "two", status: "SAFE" }, 100),
        backend.set("d", 4),
      ]);

      expect(await backend.get("a")).toBe(1);
      expect(await backend.get("b")).toBe(2);
      expect(await backend.get("c")).toBe(3);
      expect(await backend.get("d")).toBe(4);
      expect((await backend.listEvents(10)).length).toBe(2);

      // And the file on disk must still be valid JSON.
      const raw = await dir.readFile(path.join(tmp, ".ohs-local-state.json"), "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
    } finally {
      process.chdir(cwd);
      reset(null);
    }
  });
});
