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

describe("blob credentials — token or OIDC store id", () => {
  const blobKeys = ["BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID"];
  afterEach(() => blobKeys.forEach((k) => delete process.env[k]));

  it("is configured by a static read-write token", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_x";
    const { blobConfigured } = await import("./config");
    expect(blobConfigured()).toBe(true);
  });

  it("is configured by an OIDC store id alone", async () => {
    process.env.BLOB_STORE_ID = "store_abc";
    const { blobConfigured } = await import("./config");
    expect(blobConfigured()).toBe(true);
  });

  it("is not configured when neither is present", async () => {
    const { blobConfigured } = await import("./config");
    expect(blobConfigured()).toBe(false);
  });
});

describe("placeholder dispatch address guard", () => {
  const addr = ["ANDREA_EMAIL", "JACOB_EMAIL"];
  afterEach(() => addr.forEach((k) => delete process.env[k]));

  it("flags an identical pair, ignoring case", async () => {
    process.env.JACOB_EMAIL = "me@example.invalid";
    process.env.ANDREA_EMAIL = "ME@Example.Invalid";
    const { dispatchAddressIsPlaceholder } = await import("./config");
    expect(dispatchAddressIsPlaceholder()).toBe(true);
  });

  it("does not flag two different addresses", async () => {
    process.env.JACOB_EMAIL = "me@example.invalid";
    process.env.ANDREA_EMAIL = "her@example.invalid";
    const { dispatchAddressIsPlaceholder } = await import("./config");
    expect(dispatchAddressIsPlaceholder()).toBe(false);
  });

  it("does not flag when either is unset", async () => {
    process.env.JACOB_EMAIL = "me@example.invalid";
    const { dispatchAddressIsPlaceholder } = await import("./config");
    expect(dispatchAddressIsPlaceholder()).toBe(false);
  });
});
