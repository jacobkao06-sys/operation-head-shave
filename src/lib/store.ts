/**
 * Persistence. SPEC.md §2 and phase 2.
 *
 * Upstash Redis in any deployed environment. A gitignored JSON file locally so
 * `npm run dev` behaves like production without credentials. Everything the app
 * touches goes through this adapter so swapping to Cloudflare KV (§2) is one
 * file, not a rewrite.
 *
 * Keys
 *   ohs:state             the single JSON blob
 *   ohs:events            capped list of event log lines, newest first
 *   ohs:templates:<name>  editable email templates
 *   ohs:ig                Instagram token + expiry (env vars cannot be rewritten
 *                         at runtime — SPEC.md §4)
 *   ohs:rl:<bucket>       rate-limit counters
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";
import { env_ } from "./config";
import { INITIAL_STATE, type State } from "./types";

export const KEYS = {
  state: "ohs:state",
  events: "ohs:events",
  template: (name: string) => `ohs:templates:${name}`,
  ig: "ohs:ig",
  rl: (bucket: string) => `ohs:rl:${bucket}`,
  overrides: "ohs:overrides",
} as const;

export interface EventLine {
  at: string;
  event: string;
  status: State["status"];
  actor?: string;
  detail?: Record<string, unknown>;
}

interface Backend {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Sets only if the stored version matches `expectedVersion`. Returns false on conflict. */
  casSet(key: string, value: State, expectedVersion: number): Promise<boolean>;
  pushEvent(line: EventLine, cap: number): Promise<void>;
  listEvents(limit: number): Promise<EventLine[]>;
  incr(key: string, ttlSeconds: number): Promise<number>;
  keys(prefix: string): Promise<string[]>;
}

// --- Upstash --------------------------------------------------------------

const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if cur then
  local ok, parsed = pcall(cjson.decode, cur)
  if ok and parsed.version ~= nil and tonumber(parsed.version) ~= tonumber(ARGV[2]) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1])
return 1
`;

class UpstashBackend implements Backend {
  constructor(private redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    return (await this.redis.get<T>(key)) ?? null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) await this.redis.set(key, value, { ex: ttlSeconds });
    else await this.redis.set(key, value);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async casSet(key: string, value: State, expectedVersion: number): Promise<boolean> {
    const res = await this.redis.eval(CAS_SCRIPT, [key], [JSON.stringify(value), String(expectedVersion)]);
    return Number(res) === 1;
  }

  async pushEvent(line: EventLine, cap: number): Promise<void> {
    await this.redis.lpush(KEYS.events, JSON.stringify(line));
    await this.redis.ltrim(KEYS.events, 0, cap - 1);
  }

  async listEvents(limit: number): Promise<EventLine[]> {
    const raw = await this.redis.lrange<string | EventLine>(KEYS.events, 0, limit - 1);
    return raw.map((r) => (typeof r === "string" ? (JSON.parse(r) as EventLine) : r));
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, ttlSeconds);
    return n;
  }

  async keys(prefix: string): Promise<string[]> {
    return await this.redis.keys(`${prefix}*`);
  }
}

// --- Local file (dev only) ------------------------------------------------

interface FileShape {
  kv: Record<string, { v: unknown; exp?: number }>;
  events: EventLine[];
}

class FileBackend implements Backend {
  private file = path.join(process.cwd(), ".ohs-local-state.json");

  private async read(): Promise<FileShape> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as FileShape;
      const now = Date.now();
      for (const [k, entry] of Object.entries(parsed.kv)) {
        if (entry.exp && entry.exp < now) delete parsed.kv[k];
      }
      return parsed;
    } catch {
      return { kv: {}, events: [] };
    }
  }

  private async write(data: FileShape): Promise<void> {
    await fs.writeFile(this.file, JSON.stringify(data, null, 2));
  }

  async get<T>(key: string): Promise<T | null> {
    const d = await this.read();
    return (d.kv[key]?.v as T) ?? null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const d = await this.read();
    d.kv[key] = { v: value, exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined };
    await this.write(d);
  }

  async del(key: string): Promise<void> {
    const d = await this.read();
    delete d.kv[key];
    await this.write(d);
  }

  async casSet(key: string, value: State, expectedVersion: number): Promise<boolean> {
    const d = await this.read();
    const cur = d.kv[key]?.v as State | undefined;
    if (cur && cur.version !== expectedVersion) return false;
    d.kv[key] = { v: value };
    await this.write(d);
    return true;
  }

  async pushEvent(line: EventLine, cap: number): Promise<void> {
    const d = await this.read();
    d.events.unshift(line);
    d.events = d.events.slice(0, cap);
    await this.write(d);
  }

  async listEvents(limit: number): Promise<EventLine[]> {
    const d = await this.read();
    return d.events.slice(0, limit);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const d = await this.read();
    const cur = (d.kv[key]?.v as number) ?? 0;
    const next = cur + 1;
    d.kv[key] = { v: next, exp: d.kv[key]?.exp ?? Date.now() + ttlSeconds * 1000 };
    await this.write(d);
    return next;
  }

  async keys(prefix: string): Promise<string[]> {
    const d = await this.read();
    return Object.keys(d.kv).filter((k) => k.startsWith(prefix));
  }
}

let backend: Backend | null = null;

export function getBackend(): Backend {
  if (backend) return backend;
  const url = env_.upstashUrl();
  const token = env_.upstashToken();
  if (url && token) {
    backend = new UpstashBackend(new Redis({ url, token }));
    return backend;
  }
  if (process.env.NODE_ENV === "production" && process.env.OHS_ALLOW_FILE_STORE !== "true") {
    throw new Error(
      "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set. Refusing to run on the " +
        "local file store in production — state would silently vanish between invocations.",
    );
  }
  backend = new FileBackend();
  return backend;
}

/** Test seam. */
export function __setBackend(b: Backend | null): void {
  backend = b;
}

// --- State ----------------------------------------------------------------

export async function loadState(): Promise<State> {
  const raw = await getBackend().get<State>(KEYS.state);
  if (!raw) return { ...INITIAL_STATE };
  // Forward-compatible: a state written by an older deploy is missing the newer
  // fields, so merge over the initial shape rather than trusting it wholesale.
  return { ...INITIAL_STATE, ...raw };
}

/**
 * Optimistic concurrency, SPEC.md §3 `version`. `next.version` must already be
 * prev.version + 1 (the state machine does this). We compare against
 * next.version - 1 so two concurrent checks cannot both win.
 */
export async function saveState(next: State): Promise<boolean> {
  return getBackend().casSet(KEYS.state, next, next.version - 1);
}

export async function appendEvent(line: EventLine): Promise<void> {
  await getBackend().pushEvent(line, 1000);
}

export async function recentEvents(limit = 100): Promise<EventLine[]> {
  return getBackend().listEvents(limit);
}

// --- Instagram credentials (KV, never env — SPEC.md §4) -------------------

export interface IgCredentials {
  accessToken: string;
  expiresAt: string;
  userId?: string;
  refreshedAt?: string;
}

export async function loadIg(): Promise<IgCredentials | null> {
  return getBackend().get<IgCredentials>(KEYS.ig);
}

export async function saveIg(creds: IgCredentials): Promise<void> {
  await getBackend().set(KEYS.ig, creds);
}

// --- Rate limiting (SPEC.md §6) -------------------------------------------

export async function rateLimit(bucket: string, max: number, windowSeconds: number): Promise<boolean> {
  const n = await getBackend().incr(KEYS.rl(bucket), windowSeconds);
  return n <= max;
}

// --- Runtime overrides settable from /admin without a redeploy (§7, §9) ---

export interface Overrides {
  barberMode?: "draft" | "auto" | "off";
  barberConfirmPhrase?: string;
  dryRun?: boolean;
}

export async function loadOverrides(): Promise<Overrides> {
  return (await getBackend().get<Overrides>(KEYS.overrides)) ?? {};
}

export async function saveOverrides(o: Overrides): Promise<void> {
  await getBackend().set(KEYS.overrides, o);
}
