import { describe, expect, it } from "vitest";
import { detectLocale } from "./i18n";

describe("administration language", () => {
  it("keeps an explicit choice", () => {
    expect(detectLocale("en", ["cs-CZ"])).toBe("en");
    expect(detectLocale("cs", ["en-US"])).toBe("cs");
  });
  it("uses Czech for Czech and Slovak browsers, English otherwise", () => {
    expect(detectLocale(null, ["cs-CZ", "en"])).toBe("cs");
    expect(detectLocale(null, ["sk"])).toBe("cs");
    expect(detectLocale(null, ["de-DE", "en"])).toBe("en");
    expect(detectLocale("fr", ["en-GB"])).toBe("en");
  });
});
