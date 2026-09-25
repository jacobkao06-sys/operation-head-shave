import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAPTURE_WINDOW_MS, mintCaptureToken, verifyCaptureToken } from "./auth";

const PROTOCOL = "ptok-abc";
const T0 = 1_790_000_000_000;

beforeEach(() => {
  process.env.ADMIN_TOKEN = "admin-secret";
});
afterEach(() => {
  delete process.env.ADMIN_TOKEN;
});

describe("capture freshness token — §6 as amended", () => {
  it("accepts a token it just minted", () => {
    expect(verifyCaptureToken(PROTOCOL, mintCaptureToken(PROTOCOL, T0), T0)).toBe(true);
  });

  it("accepts one right at the edge of the window and rejects one past it", () => {
    const t = mintCaptureToken(PROTOCOL, T0);
    expect(verifyCaptureToken(PROTOCOL, t, T0 + CAPTURE_WINDOW_MS)).toBe(true);
    expect(verifyCaptureToken(PROTOCOL, t, T0 + CAPTURE_WINDOW_MS + 1)).toBe(false);
  });

  it("rejects a token minted for a different episode", () => {
    // A link from a closed episode must not be replayable against a new one.
    expect(verifyCaptureToken("ptok-other", mintCaptureToken(PROTOCOL, T0), T0)).toBe(false);
  });

  it("rejects a forged or tampered token", () => {
    const good = mintCaptureToken(PROTOCOL, T0);
    expect(verifyCaptureToken(PROTOCOL, "made.up", T0)).toBe(false);
    expect(verifyCaptureToken(PROTOCOL, good.slice(0, -2) + "xx", T0)).toBe(false);
    expect(verifyCaptureToken(PROTOCOL, "", T0)).toBe(false);
    expect(verifyCaptureToken(PROTOCOL, null, T0)).toBe(false);
  });

  it("rejects one signed with a different admin token", () => {
    const t = mintCaptureToken(PROTOCOL, T0);
    process.env.ADMIN_TOKEN = "rotated-secret";
    expect(verifyCaptureToken(PROTOCOL, t, T0)).toBe(false);
  });

  it("rejects a far-future token rather than trusting a skewed clock", () => {
    const t = mintCaptureToken(PROTOCOL, T0 + 10 * 60_000);
    expect(verifyCaptureToken(PROTOCOL, t, T0)).toBe(false);
  });

  it("tolerates a minute of ordinary clock skew", () => {
    const t = mintCaptureToken(PROTOCOL, T0 + 30_000);
    expect(verifyCaptureToken(PROTOCOL, t, T0)).toBe(true);
  });
});
