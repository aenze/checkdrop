import { describe, expect, it } from "vitest";
import { czEmbedTexts, czEmbedTextsEn } from "../src/index.js";

// Placeholders the hosted script fills in; any other name would reach customers as "{name}".
const filledPlaceholders: Readonly<Record<string, readonly string[]>> = {
  "address.postal_code_mismatch": ["postal_code"],
  "correction.title": ["field", "value"],
  "correction.apply_label": ["field", "value"],
  "correction.keep_label": ["field"],
};

describe("Czech hosted-script texts", () => {
  it.each(Object.entries(czEmbedTexts.messages))(
    "%s uses only filled placeholders",
    (key, text) => {
      const used = [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
      expect(used).toEqual(filledPlaceholders[key] ?? []);
      expect(text.trim()).not.toBe("");
    },
  );

  it("prefills the Czech dialling code", () => {
    expect(czEmbedTexts.phonePrefill).toBe("+420 ");
    expect(czEmbedTexts.phonePlaceholder.startsWith(czEmbedTexts.phonePrefill)).toBe(true);
  });

  it("has an English text for every Czech one, with the same placeholders", () => {
    expect(Object.keys(czEmbedTextsEn.messages).sort()).toEqual(
      Object.keys(czEmbedTexts.messages).sort(),
    );
    for (const [key, text] of Object.entries(czEmbedTextsEn.messages)) {
      const used = [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
      expect(used).toEqual(filledPlaceholders[key] ?? []);
      expect(text).not.toMatch(/[ěščřžýáíéůúťďň]/);
    }
  });
});
