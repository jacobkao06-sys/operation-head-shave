import { beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "./dispatch";
import { CapturingNotifier } from "./index";
import { __setBackend } from "../store";
import { INITIAL_STATE, type State } from "../types";

/** Minimal in-memory backend so these tests never touch Redis or the disk. */
function memoryBackend() {
  const kv = new Map<string, unknown>();
  const events: unknown[] = [];
  return {
    kv,
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
    async pushEvent(line: unknown) {
      events.unshift(line);
    },
    async listEvents(n: number) {
      return events.slice(0, n) as never[];
    },
    async incr(k: string) {
      const n = ((kv.get(k) as number) ?? 0) + 1;
      kv.set(k, n);
      return n;
    },
    async keys(prefix: string) {
      return [...kv.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

const failed: State = {
  ...INITIAL_STATE,
  status: "FAILURE",
  episode: 1,
  failureDeclaredAt: "2026-09-01T12:00:00.000Z",
  deadlineAt: "2026-09-04T12:00:00.000Z",
  lastPostAt: "2026-08-24T12:00:00.000Z",
  protocolToken: "ptok",
  barberApproveToken: "btok",
};

const NOW = new Date("2026-09-01T12:00:00.000Z");

beforeEach(() => {
  __setBackend(memoryBackend());
  process.env.JACOB_EMAIL = "jacob@example.invalid";
  process.env.ANDREA_EMAIL = "andrea@example.invalid";
  process.env.BARBER_EMAIL = "barber@example.invalid";
  process.env.PUBLIC_URL = "https://shave.example.invalid";
  process.env.PROTOCOL_URL = "https://protocol.example.invalid";
  process.env.ADMIN_TOKEN = "admintok";
  process.env.DRY_RUN = "true";
});

describe("§13 — the barber can never be mailed a placeholder", () => {
  it("refuses a barber send when the template contains PLACEHOLDER", async () => {
    const n = new CapturingNotifier();
    const r = await dispatch(
      { type: "email", template: "barber", to: "barber", reason: "x" },
      { state: failed, now: NOW },
      { notifier: n, barberIsPlaceholder: true },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PLACEHOLDER/);
    expect(n.sent).toHaveLength(0);
  });

  it("still refuses when DRY_RUN would have redirected it to Jacob anyway", async () => {
    process.env.DRY_RUN = "true";
    const n = new CapturingNotifier();
    const r = await dispatch(
      { type: "email", template: "barber", to: "barber", reason: "x" },
      { state: failed, now: NOW },
      { notifier: n, barberIsPlaceholder: true },
    );
    expect(r.ok).toBe(false);
    expect(n.sent).toHaveLength(0);
  });
});

describe("DRY_RUN", () => {
  it("redirects to Jacob and names the intended recipient in the subject", async () => {
    const n = new CapturingNotifier();
    const r = await dispatch(
      { type: "email", template: "andrea", to: "andrea", reason: "failure declared" },
      { state: failed, now: NOW },
      { notifier: n, barberIsPlaceholder: true },
    );
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(n.sent[0].to).toBe("jacob@example.invalid");
    expect(n.sent[0].subject).toContain("[DRY RUN → andrea@example.invalid]");
    expect(n.sent[0].body).toContain("was NOT sent to andrea@example.invalid");
  });

  it("goes to the real recipient once DRY_RUN is off", async () => {
    process.env.DRY_RUN = "false";
    const n = new CapturingNotifier();
    const r = await dispatch(
      { type: "email", template: "andrea", to: "andrea", reason: "failure declared" },
      { state: failed, now: NOW },
      { notifier: n, barberIsPlaceholder: true },
    );
    expect(r.dryRun).toBe(false);
    expect(n.sent[0].to).toBe("andrea@example.invalid");
    expect(n.sent[0].subject).not.toContain("DRY RUN");
  });
});

describe("template rendering", () => {
  it("interpolates the protocol link and the deadline into Andrea's email", async () => {
    process.env.DRY_RUN = "false";
    const n = new CapturingNotifier();
    await dispatch(
      { type: "email", template: "andrea", to: "andrea", reason: "" },
      { state: failed, now: NOW },
      { notifier: n, barberIsPlaceholder: true },
    );
    expect(n.sent[0].subject).toBe("OPERATION HEAD SHAVE — PROTOCOL ACTIVE");
    expect(n.sent[0].body).toContain("https://protocol.example.invalid/p/ptok");
    expect(n.sent[0].body).not.toContain("{{");
  });

  it("quotes the barber template verbatim inside the draft to Jacob", async () => {
    process.env.DRY_RUN = "false";
    const n = new CapturingNotifier();
    await dispatch(
      { type: "email", template: "jacob-barber-draft", to: "jacob", reason: "draft mode" },
      { state: failed, now: NOW },
      { notifier: n, barberIsPlaceholder: true },
    );
    expect(n.sent[0].to).toBe("jacob@example.invalid");
    expect(n.sent[0].body).toContain("PLACEHOLDER");
    expect(n.sent[0].body).toContain("/api/barber/send?token=btok");
  });

  it("reports a missing recipient rather than sending to nobody", async () => {
    delete process.env.ANDREA_EMAIL;
    process.env.DRY_RUN = "false";
    const n = new CapturingNotifier();
    const r = await dispatch(
      { type: "email", template: "andrea", to: "andrea", reason: "" },
      { state: failed, now: NOW },
      { notifier: n, barberIsPlaceholder: true },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No address configured/);
    expect(n.sent).toHaveLength(0);
  });
});

describe("audit accuracy", () => {
  it("reports the real dry-run state even when the recipient is unset", async () => {
    delete process.env.ANDREA_EMAIL;
    process.env.DRY_RUN = "true";
    const n = new CapturingNotifier();
    const r = await dispatch(
      { type: "email", template: "andrea", to: "andrea", reason: "" },
      { state: failed, now: NOW },
      { notifier: n, barberIsPlaceholder: true },
    );
    expect(r.ok).toBe(false);
    // The log must not claim mail was live when DRY_RUN was on.
    expect(r.dryRun).toBe(true);
  });
});
