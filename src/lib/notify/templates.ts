/**
 * Template engine. SPEC.md §7 — templates must be editable without a redeploy.
 *
 * The .md files under /templates are the seed. On first read a template is
 * copied into KV under ohs:templates:<name>; from then on KV wins and /admin
 * edits it. Deleting the KV copy restores the file.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getBackend, KEYS } from "../store";
import type { EmailTemplateName } from "../types";

export interface RenderedTemplate {
  subject: string;
  body: string;
}

const TEMPLATE_DIR = path.join(process.cwd(), "templates");

export const TEMPLATE_NAMES: EmailTemplateName[] = [
  "alice",
  "barber",
  "jacob-alert",
  "jacob-barber-draft",
  "jacob-review",
  "jacob-resolved",
  "alice-resolved",
  "jacob-check-failure",
  "token-expiry",
];

async function readSeed(name: EmailTemplateName): Promise<string> {
  try {
    return await fs.readFile(path.join(TEMPLATE_DIR, `${name}.md`), "utf8");
  } catch {
    return `Subject: OPERATION HEAD SHAVE — ${name}\n\n(template ${name} is missing from /templates)\n`;
  }
}

/** Raw source of a template: KV if edited, else the seeded file. */
export async function loadTemplate(name: EmailTemplateName): Promise<string> {
  const stored = await getBackend().get<string>(KEYS.template(name));
  if (typeof stored === "string" && stored.length > 0) return stored;
  const seed = await readSeed(name);
  await getBackend().set(KEYS.template(name), seed);
  return seed;
}

export async function saveTemplate(name: EmailTemplateName, source: string): Promise<void> {
  await getBackend().set(KEYS.template(name), source);
}

export async function resetTemplate(name: EmailTemplateName): Promise<void> {
  await getBackend().del(KEYS.template(name));
}

/** SPEC.md §13: no barber send, in any mode, while this is true. */
export async function barberTemplateIsPlaceholder(): Promise<boolean> {
  return (await loadTemplate("barber")).includes("PLACEHOLDER");
}

export function interpolate(source: string, vars: Record<string, string>): string {
  return source.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) => vars[key] ?? "");
}

/** First line is `Subject: ...`; everything after the blank line is the body. */
export function split(source: string): RenderedTemplate {
  const lines = source.split(/\r?\n/);
  let subject = "OPERATION HEAD SHAVE";
  let start = 0;
  const m = /^Subject:\s*(.*)$/i.exec(lines[0] ?? "");
  if (m) {
    subject = m[1].trim();
    start = 1;
    while (lines[start] !== undefined && lines[start].trim() === "") start += 1;
  }
  return { subject, body: lines.slice(start).join("\n").trimEnd() };
}

export async function render(
  name: EmailTemplateName,
  vars: Record<string, string>,
): Promise<RenderedTemplate> {
  const source = await loadTemplate(name);
  const { subject, body } = split(source);
  return { subject: interpolate(subject, vars), body: interpolate(body, vars) };
}
