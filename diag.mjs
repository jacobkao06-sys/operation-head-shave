import { chromium } from "playwright";
const BASE = "http://localhost:3007";
const peek = async (tag) => {
  const r = await fetch(`${BASE}/api/state`).then(r => r.json());
  console.log(`   ${tag}: status=${r.status}`);
};
const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 360, height: 640 } }).then(c => c.newPage());
await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.fill('input[name="token"]', "dev-admin-token");
await page.click('button[type="submit"]');
await page.waitForSelector('input[name="simulateLastPostAt"]');
await page.waitForTimeout(1200);
await peek("before any check");

const stale = new Date(Date.now() - 20 * 86400000).toISOString();
for (const pass of [1, 2]) {
  await page.fill('input[name="simulateLastPostAt"]', stale);
  await page.click('form:has(input[name="simulateLastPostAt"]) button[type="submit"]');
  await page.waitForTimeout(2500);
  await peek(`after admin pass ${pass}`);
}
await browser.close();
