import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("validation playground", () => {
  it("uses the bounded same-origin API for Czech address autocomplete and e-mail validation", () => {
    const source = readFileSync(new URL("./ValidationPlayground.tsx", import.meta.url), "utf8");

    expect(source).toContain('"/v1/addresses/autocomplete"');
    expect(source).toContain('"/v1/emails/validate"');
    expect(source).toContain(["fetch(`", "/checkdrop", "$", "{path}`"].join(""));
    expect(source).toContain("AbortSignal.timeout(2_500)");
    expect(source).toContain("RÚIAN · DNS/MX");
    expect(source).toContain('aria-label={t("Checkdrop – domů", "Checkdrop – home")}');
    expect(source).toContain("...localeHeader");
    expect(source).not.toContain("přejít na importy");
    expect(source).toContain('code === "email.domain_typo"');
    expect(source).toContain("Doména pravděpodobně obsahuje překlep.");
    expect(source).toContain("Měli jste na mysli?");
    expect(source).toContain("Použít opravu");
    expect(source).not.toContain("X-Checkdrop-Key");
  });
});
