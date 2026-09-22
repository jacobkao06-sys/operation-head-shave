/**
 * Instagram Graph API. SPEC.md §4.
 *
 * Official API only — never HTML scraping, never session cookies (§13).
 * Stories are excluded by the API surface itself: they live on /me/stories,
 * which this file must never query.
 */

import { env_ } from "../config";
import { loadIg, saveIg, type IgCredentials } from "../store";
import { SourceError, type Post, type PostSource } from "./types";

const GRAPH = "https://graph.instagram.com";
const OAUTH = "https://api.instagram.com";
const AUTHORIZE = "https://www.instagram.com/oauth/authorize";
const SCOPE = "instagram_business_basic";
const DAY_MS = 86_400_000;

interface MediaItem {
  id: string;
  timestamp: string;
  permalink: string;
  media_type: string;
}

async function getJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    const body = await res.text();
    if (!res.ok) throw new SourceError(`Instagram responded ${res.status}`, body.slice(0, 500));
    try {
      return JSON.parse(body);
    } catch {
      throw new SourceError("Instagram returned non-JSON", body.slice(0, 200));
    }
  } finally {
    clearTimeout(timer);
  }
}

// --- OAuth ----------------------------------------------------------------

export function authorizeUrl(redirectUri: string, state: string): string {
  const appId = env_.igAppId();
  if (!appId) throw new SourceError("IG_APP_ID is not set");
  const q = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: SCOPE,
    response_type: "code",
    state,
  });
  return `${AUTHORIZE}?${q}`;
}

/** auth code -> short-lived (1h) -> long-lived (60d). SPEC.md §4. */
export async function exchangeCode(code: string, redirectUri: string): Promise<IgCredentials> {
  const appId = env_.igAppId();
  const secret = env_.igAppSecret();
  if (!appId || !secret) throw new SourceError("IG_APP_ID / IG_APP_SECRET are not set");

  const form = new URLSearchParams({
    client_id: appId,
    client_secret: secret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${OAUTH}/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new SourceError(`Code exchange failed (${res.status})`, text.slice(0, 500));
  const short = JSON.parse(text) as { access_token: string; user_id?: string | number };

  const longUrl = new URL(`${GRAPH}/access_token`);
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  longUrl.searchParams.set("client_secret", secret);
  longUrl.searchParams.set("access_token", short.access_token);
  const long = (await getJson(longUrl.toString())) as { access_token: string; expires_in: number };

  return {
    accessToken: long.access_token,
    expiresAt: new Date(Date.now() + long.expires_in * 1000).toISOString(),
    userId: short.user_id ? String(short.user_id) : undefined,
    refreshedAt: new Date().toISOString(),
  };
}

/**
 * Refresh when there is less than 30 days left. The token must be at least 24h
 * old for Meta to accept the refresh, so a freshly minted one is skipped.
 * An EXPIRED token cannot be refreshed — that needs the OAuth flow by hand (§12).
 */
export async function refreshIfNeeded(creds: IgCredentials, now = new Date()): Promise<IgCredentials> {
  const remaining = Date.parse(creds.expiresAt) - now.getTime();
  if (remaining > 30 * DAY_MS) return creds;
  if (remaining <= 0) throw new SourceError("Instagram token has expired; re-run the OAuth flow");

  const mintedAt = creds.refreshedAt ? Date.parse(creds.refreshedAt) : 0;
  if (now.getTime() - mintedAt < DAY_MS) return creds;

  const url = new URL(`${GRAPH}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", creds.accessToken);
  const out = (await getJson(url.toString())) as { access_token: string; expires_in: number };

  const next: IgCredentials = {
    ...creds,
    accessToken: out.access_token,
    expiresAt: new Date(now.getTime() + out.expires_in * 1000).toISOString(),
    refreshedAt: now.toISOString(),
  };
  await saveIg(next);
  return next;
}

// --- The check ------------------------------------------------------------

export class InstagramSource implements PostSource {
  name = "instagram";

  constructor(private readonly creds: IgCredentials) {}

  static async create(): Promise<InstagramSource> {
    const creds = await loadIg();
    if (!creds) throw new SourceError("No Instagram token in KV — run /api/auth/instagram/start");
    const fresh = await refreshIfNeeded(creds);
    return new InstagramSource(fresh);
  }

  async getLatestPost(): Promise<Post | null> {
    const allow = env_.igMediaTypes();
    const url = new URL(`${GRAPH}/${env_.igApiVersion()}/me/media`);
    url.searchParams.set("fields", "id,timestamp,permalink,media_type");
    url.searchParams.set("limit", "10");
    url.searchParams.set("access_token", this.creds.accessToken);

    const body = (await getJson(url.toString())) as { data?: MediaItem[] };
    const items = body.data ?? [];
    const qualifying = items.filter((i) => allow.includes(String(i.media_type).toUpperCase()));
    if (qualifying.length === 0) return null;

    const latest = qualifying.reduce((a, b) =>
      Date.parse(a.timestamp) >= Date.parse(b.timestamp) ? a : b,
    );
    return {
      id: latest.id,
      timestamp: new Date(latest.timestamp).toISOString(),
      permalink: latest.permalink,
      mediaType: latest.media_type,
    };
  }

  get expiresAt(): string {
    return this.creds.expiresAt;
  }
}
