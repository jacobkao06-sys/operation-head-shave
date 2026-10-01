#!/usr/bin/env node
/**
 * Records a 540x960 walkthrough of a simulated failing check, for upscaling to
 * 1080x1920. Run against the LOCAL dev server with USE_MOCK_SOURCE=true — never
 * production, since it declares a real failure and dispatches real mail.
 *
 *   npm run dev -- --port 3007     # in another terminal
 *   node scripts/record-demo.mjs
 *
 * Then upscale (any full ffmpeg build; the one Playwright bundles is VP8-only):
 *   ffmpeg -i <out>.webm -vf "scale=1080:1920:flags=lanczos,unsharp=5:5:0.6,fps=30" \
 *          -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart out.mp4
 */

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3007";
const ADMIN = process.env.ADMIN_TOKEN ?? "dev-admin-token";
const OUT = process.env.OUT_DIR ?? "./.ohs-recording";

// Playwright draws the page into the video at CSS-pixel scale — it will letterbox
// a small viewport rather than scale it up. So record at 540x960, which is still
// under the 560px mobile breakpoint and therefore gets the phone layout, then
// upscale exactly 2x to 1080x1920 in ffmpeg. Recording at a 1080px-wide viewport
// would instead render the DESKTOP layout at phone dimensions.
const VIEWPORT = { width: 540, height: 960 };
const SIZE = VIEWPORT;
const beat = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  recordVideo: { dir: OUT, size: SIZE },
});
const page = await ctx.newPage();

function must(cond, msg) {
  if (!cond) throw new Error(`recording aborted: ${msg}`);
}

// 1. Public page: safe.
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
must((await page.locator("h1").innerText()).includes("SAFE"), "expected the public page to read SAFE");
await beat(3500);

// 2. Admin, signed in. These are server-action forms: a click before React
// hydrates submits natively and silently does nothing.
await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
await beat(1600);
await page.fill('input[name="token"]', ADMIN);
await beat(700);
await page.click('button[type="submit"]');
await page.waitForSelector('input[name="simulateLastPostAt"]', { timeout: 15000 });
await beat(1800);

const stale = new Date(Date.now() - 20 * 86_400_000).toISOString();
const field = page.locator('input[name="simulateLastPostAt"]');
const run = page.locator('form:has(input[name="simulateLastPostAt"]) button[type="submit"]');
const verdict = page.locator("text=DIDN'T POST").first();

// 3. First check — arms it, does not fire. The two-check rule, made visible.
await field.scrollIntoViewIfNeeded();
await beat(700);
await field.click();
await page.keyboard.type(stale, { delay: 34 });
must((await field.inputValue()) === stale, "the simulate date did not land in the field");
await beat(900);
await run.click();
await verdict.waitFor({ timeout: 15000 });
await verdict.scrollIntoViewIfNeeded();
let panel = await page.locator("main").innerText();
must(/1 of 2 needed/.test(panel), `first check should arm but not fire, got:\n${panel.slice(0, 400)}`);
await beat(5200);

// 4. Second check — declares failure and dispatches to Alice.
await field.scrollIntoViewIfNeeded();
await beat(500);
await field.fill(stale);
await beat(800);
await run.click();
await verdict.waitFor({ timeout: 15000 });
const alice = page.locator("text=SENDING MESSAGE TO ALICE").first();
await alice.waitFor({ timeout: 15000 });
panel = await page.locator("main").innerText();
must(/SAFE → FAILURE/.test(panel), "second check should declare failure");
// Hold on the verdict first, then bring the dispatch line into the middle of
// the frame — it is the whole point of the recording.
await verdict.scrollIntoViewIfNeeded();
await beat(4000);
await alice.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
await beat(5500);

// 5. Public page: now red, counting down.
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
must((await page.locator("h1").innerText()).includes("FAILURE"), "public page should have flipped to FAILURE");
await beat(4500);

await ctx.close();
await browser.close();
console.log("recorded, all assertions passed");
