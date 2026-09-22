import { describe, expect, it } from "vitest";
import { accepts, parseVerdict } from "./vision";

describe("parseVerdict — defensive parsing, §6", () => {
  it("parses a clean JSON object", () => {
    const v = parseVerdict('{"shaved":true,"confidence":0.93,"reason":"bald scalp","is_person":true}');
    expect(v).toEqual({ shaved: true, confidence: 0.93, reason: "bald scalp", isPerson: true });
  });

  it("strips markdown fences", () => {
    const v = parseVerdict('```json\n{"shaved":true,"confidence":0.8,"reason":"buzzed","is_person":true}\n```');
    expect(v.shaved).toBe(true);
    expect(v.confidence).toBe(0.8);
  });

  it("survives surrounding prose", () => {
    const v = parseVerdict('Sure! {"shaved":false,"confidence":0.2,"reason":"a dog","is_person":false} Hope that helps.');
    expect(v.isPerson).toBe(false);
    expect(v.reason).toBe("a dog");
  });

  it("treats unparseable output as a rejection, never a throw", () => {
    for (const bad of ["", "not json at all", "{", "null", "[]", "{{{"]) {
      const v = parseVerdict(bad);
      expect(v.shaved).toBe(false);
      expect(v.isPerson).toBe(false);
      expect(v.confidence).toBe(0);
    }
  });

  it("refuses truthy non-booleans — only a literal true counts", () => {
    const v = parseVerdict('{"shaved":"yes","confidence":1,"reason":"x","is_person":1}');
    expect(v.shaved).toBe(false);
    expect(v.isPerson).toBe(false);
  });

  it("clamps confidence into [0,1] and defaults a missing one to zero", () => {
    expect(parseVerdict('{"shaved":true,"confidence":9,"reason":"x","is_person":true}').confidence).toBe(1);
    expect(parseVerdict('{"shaved":true,"confidence":-4,"reason":"x","is_person":true}').confidence).toBe(0);
    expect(parseVerdict('{"shaved":true,"reason":"x","is_person":true}').confidence).toBe(0);
    expect(parseVerdict('{"shaved":true,"confidence":"high","reason":"x","is_person":true}').confidence).toBe(0);
  });
});

describe("accepts — §6 acceptance rule", () => {
  const v = (over: Partial<ReturnType<typeof parseVerdict>>) => ({
    shaved: true,
    confidence: 0.9,
    reason: "r",
    isPerson: true,
    ...over,
  });

  it("accepts a confident shaved person", () => {
    expect(accepts(v({}), 0.7)).toBe(true);
  });

  it("requires all three conditions", () => {
    expect(accepts(v({ isPerson: false }), 0.7)).toBe(false);
    expect(accepts(v({ shaved: false }), 0.7)).toBe(false);
    expect(accepts(v({ confidence: 0.69 }), 0.7)).toBe(false);
  });

  it("accepts exactly at the threshold", () => {
    expect(accepts(v({ confidence: 0.7 }), 0.7)).toBe(true);
  });
});
