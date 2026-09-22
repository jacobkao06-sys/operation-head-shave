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
