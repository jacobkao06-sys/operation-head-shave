import { chromium } from "playwright";

const BASE = "http://localhost:3007";
const ADMIN = "dev-admin-token";
const OUT = "/private/tmp/claude-501/-Users-jacobkao/21126b87-622d-4870-b05b-1b4aa1a76d59/scratchpad/rec";

// A phone viewport in CSS pixels, captured at 3x so the output is 1080x1920.
// Recording at a 1080px-wide viewport would render the DESKTOP layout at phone
// dimensions, which is the opposite of what a mobile recording should show.
const VIEWPORT = { width: 360, height: 640 };
const SIZE = { width: 1080, height: 1920 };
const beat = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 3,
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
await verdict.scrollIntoViewIfNeeded();
await page.waitForSelector("text=SENDING MESSAGE TO ALICE", { timeout: 15000 });
panel = await page.locator("main").innerText();
must(/SAFE → FAILURE/.test(panel), "second check should declare failure");
await beat(7000);

// 5. Public page: now red, counting down.
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
must((await page.locator("h1").innerText()).includes("FAILURE"), "public page should have flipped to FAILURE");
await beat(4500);

await ctx.close();
await browser.close();
console.log("recorded, all assertions passed");
