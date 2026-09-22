import { afterEach, describe, expect, it } from "vitest";
import { env_ } from "./config";

const keys = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"];
afterEach(() => keys.forEach((k) => delete process.env[k]));

describe("storage credentials — either naming", () => {
  it("reads the UPSTASH_* names", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://a";
    process.env.UPSTASH_REDIS_REST_TOKEN = "ta";
    expect(env_.upstashUrl()).toBe("https://a");
    expect(env_.upstashToken()).toBe("ta");
  });

  it("falls back to the KV_* names Vercel's Marketplace integration sets", () => {
    process.env.KV_REST_API_URL = "https://b";
    process.env.KV_REST_API_TOKEN = "tb";
    expect(env_.upstashUrl()).toBe("https://b");
    expect(env_.upstashToken()).toBe("tb");
  });

  it("prefers UPSTASH_* when both are present", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://a";
    process.env.KV_REST_API_URL = "https://b";
    expect(env_.upstashUrl()).toBe("https://a");
  });

  it("is undefined when neither is set", () => {
    expect(env_.upstashUrl()).toBeUndefined();
    expect(env_.upstashToken()).toBeUndefined();
  });
});
