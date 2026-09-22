#!/usr/bin/env node
/**
 * Dev-only: drive the running app into a given state and print the URLs.
 *
 *   npm run demo            # FAILURE, countdown running (the interesting one)
 *   npm run demo safe
 *   npm run demo pending    # photo submitted, countdown frozen, awaiting review
 *   npm run demo resolved
 *
 * Talks to the app over HTTP exactly as the cron and the browser do — it never
 * writes state directly, so what you see is the real state machine, not a
 * fixture.
 */

import { readFileSync, existsSync, rmSync } from "node:fs";
import { createHmac } from "node:crypto";
import sharp from "sharp";

const WANT = (process.argv[2] ?? "failure").toLowerCase();
const VALID = ["safe", "failure", "pending", "resolved"];
if (!VALID.includes(WANT)) {
  console.error(`unknown state "${WANT}". one of: ${VALID.join(", ")}`);
  process.exit(1);
}

// --- config from .env.local ------------------------------------------------
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const PORT = process.env.PORT ?? "3007";
const BASE = `http://localhost:${PORT}`;
const CRON = env.CRON_SECRET;
const ADMIN = env.ADMIN_TOKEN;

const sign = (v) =>
  `${Buffer.from(v).toString("base64url")}.${createHmac("sha256", ADMIN).update(v).digest("base64url")}`;

async function check(simulateLastPostAt) {
  const res = await fetch(`${BASE}/api/check`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON}`, "content-type": "application/json" },
    body: JSON.stringify(simulateLastPostAt ? { simulateLastPostAt } : {}),
  });
  if (!res.ok) throw new Error(`/api/check returned ${res.status}`);
  return res.json();
}

async function state() {
  return (await fetch(`${BASE}/api/state`, { cache: "no-store" })).json();
}

async function fullState() {
  const raw = JSON.parse(readFileSync(new URL("../.ohs-local-state.json", import.meta.url), "utf8"));
  return raw.kv["ohs:state"].v;
}

// --- go --------------------------------------------------------------------
try {
  await fetch(`${BASE}/api/state`);
} catch {
  console.error(`nothing is listening on ${BASE}. start it with: npm run dev -- --port ${PORT}`);
  process.exit(1);
}

// Wipe and rebuild from zero so every run is reproducible.
const localState = new URL("../.ohs-local-state.json", import.meta.url);
if (existsSync(localState)) rmSync(localState);

const NINE_DAYS_AGO = new Date(Date.now() - 9 * 86_400_000).toISOString();
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString();

if (WANT === "safe") {
  await check(YESTERDAY);
} else {
  // Two consecutive stale checks. The first only arms it — that is the point.
  await check(NINE_DAYS_AGO);
  await check(NINE_DAYS_AGO);
}

if (WANT === "pending" || WANT === "resolved") {
  const s = await fullState();
  const jpeg = await sharp({
    create: { width: 900, height: 1200, channels: 3, background: { r: 176, g: 148, b: 130 } },
  })
    .jpeg()
    .toBuffer();

  const form = new FormData();
  form.set("token", s.protocolToken);
  form.set("photo", new Blob([jpeg], { type: "image/jpeg" }), "proof.jpg");
  const up = await fetch(`${BASE}/api/upload`, {
    method: "POST",
    body: form,
    headers: { accept: "application/json" },
  });
  const upJson = await up.json();
  if (!upJson.ok) {
    console.error(`upload was rejected: ${upJson.code} — ${upJson.message}`);
    console.error("set VISION_STUB in .env.local to an accepting verdict and retry.");
    process.exit(1);
  }
  if (WANT === "resolved") {
    const s2 = await fullState();
    await fetch(`${BASE}/api/review/confirm?t=${sign(`confirm:${s2.episode}`)}`);
  }
}

const s = await fullState();
const pub = await state();

const pad = (l) => l.padEnd(20, ".");
console.log(`
${pad("STATUS ")} ${s.status}${s.paused ? ` (paused: ${s.pauseReason})` : ""}
${pad("DEADLINE ")} ${s.deadlineAt ?? (s.remainingMs !== null ? `frozen at ${(s.remainingMs / 3_600_000).toFixed(2)}h` : "—")}
${pad("NEXT CHECK ")} ${pub.nextCheckAt}

  public ......... ${BASE}/
  protocol ....... ${s.protocolToken ? `${BASE}/p/${s.protocolToken}` : "(no live episode)"}
  admin .......... ${BASE}/admin        sign in with: ${ADMIN}
  barber approve . ${s.barberApproveToken ? `${BASE}/api/barber/send?token=${s.barberApproveToken}` : "—"}
  og image ....... ${BASE}/opengraph-image
  raw state ...... ${BASE}/api/state

  outbox ......... .ohs-outbox/   (every email that would have been sent)
`);
