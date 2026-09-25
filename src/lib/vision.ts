/**
 * Shaved-head pre-screen. SPEC.md §6.
 *
 * The model is a filter, not a judge — a human confirms every acceptance, and
 * the human override always wins (§12). Anything ambiguous is a rejection: the
 * countdown continuing is recoverable, a false halt is not.
 */

import Anthropic from "@anthropic-ai/sdk";
import { env_ } from "./config";
import type { VisionVerdict } from "./types";

const SYSTEM = [
  "You are verifying a photo. Respond with ONLY a JSON object, no markdown fences,",
  "no preamble: {\"shaved\": boolean, \"confidence\": number between 0 and 1,",
  "\"reason\": string under 20 words, \"is_person\": boolean}",
].join(" ");

const QUESTION =
  "Does this photo show a real person whose head has been shaved (bald or buzzed to the scalp)?";

export const VISION_SCHEMA = {
  type: "object",
  properties: {
    shaved: { type: "boolean" },
    // No `minimum`/`maximum` here: structured outputs reject range keywords on a
    // number ("For 'number' type, properties maximum, minimum are not supported"),
    // which 400s the whole request. parseVerdict clamps to [0,1] anyway.
    confidence: { type: "number" },
    reason: { type: "string" },
    is_person: { type: "boolean" },
  },
  required: ["shaved", "confidence", "reason", "is_person"],
  additionalProperties: false,
} as const;

interface RawVerdict {
  shaved?: unknown;
  confidence?: unknown;
  reason?: unknown;
  is_person?: unknown;
}

/**
 * Defensive parse (§6): strips fences, tolerates surrounding prose, and treats
 * any failure as a rejection rather than throwing it up the stack.
 */
export function parseVerdict(text: string): VisionVerdict {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;

  let raw: RawVerdict;
  try {
    const parsed: unknown = JSON.parse(candidate);
    // `null` and `[]` are valid JSON but not verdicts. Check the shape, not
    // just that the parse returned without throwing.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        shaved: false,
        confidence: 0,
        reason: "model output was not a JSON object",
        isPerson: false,
      };
    }
    raw = parsed as RawVerdict;
  } catch {
    return { shaved: false, confidence: 0, reason: "model output was not JSON", isPerson: false };
  }

  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.min(1, Math.max(0, raw.confidence))
      : 0;

  return {
    shaved: raw.shaved === true,
    confidence,
    reason:
      typeof raw.reason === "string" && raw.reason.trim()
        ? raw.reason.trim().slice(0, 200)
        : "no reason given",
    isPerson: raw.is_person === true,
  };
}

/** §6: is_person && shaved && confidence >= threshold. */
export function accepts(v: VisionVerdict, minConfidence = env_.visionMinConfidence()): boolean {
  return v.isPerson && v.shaved && v.confidence >= minConfidence;
}

/**
 * Development seam, mirroring MockSource (§4). Set VISION_STUB to a JSON
 * verdict to exercise the upload pipeline without an API key. Ignored in
 * production so it can never wave a real submission through.
 */
function stubVerdict(): VisionVerdict | null {
  if (process.env.NODE_ENV === "production") return null;
  const raw = process.env.VISION_STUB;
  if (!raw) return null;
  return parseVerdict(raw);
}

export async function prescreen(jpeg: Buffer): Promise<VisionVerdict> {
  const stub = stubVerdict();
  if (stub) return stub;

  const key = env_.anthropicKey();
  if (!key) {
    // Without a key the pre-screen cannot run. Reject rather than wave it
    // through — a human can still confirm from /admin.
    return {
      shaved: false,
      confidence: 0,
      reason: "vision pre-screen is not configured",
      isPerson: false,
    };
  }

  const client = new Anthropic({ apiKey: key });
  try {
    const res = await client.messages.create({
      model: env_.visionModel(),
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: VISION_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
            },
            { type: "text", text: QUESTION },
          ],
        },
      ],
    });

    if (res.stop_reason === "refusal") {
      return { shaved: false, confidence: 0, reason: "model declined to answer", isPerson: false };
    }

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseVerdict(text);
  } catch (err) {
    return {
      shaved: false,
      confidence: 0,
      reason: `pre-screen failed: ${err instanceof Error ? err.message : String(err)}`,
      isPerson: false,
    };
  }
}
