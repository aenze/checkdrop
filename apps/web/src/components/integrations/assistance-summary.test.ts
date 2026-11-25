import { describe, expect, it } from "vitest";
import { assistanceSummary, type IntegrationField } from "./model";

const field = (patch: Partial<IntegrationField>): IntegrationField => ({
  selector: "#field",
  label: "Pole",
  name: null,
  canonical_field: "email",
  context: "shared",
  condition_key: null,
  required: true,
  validation_mode: "suggest",
  validation_trigger: "blur",
  confidence: 100,
  detected: true,
  ...patch,
});

// A checkout like the ones running today: required full names, a domestic-only PSČ, an e-mail with
// fixes and an automatically formatted phone.
const checkout = [
  field({ selector: "#name", canonical_field: "full_name", require_complete_name: true }),
  field({ selector: "#email", canonical_field: "email" }),
  field({ selector: "#phone", canonical_field: "phone" }),
  field({
    selector: "#zip",
    canonical_field: "postal_code",
    validation_mode: "shadow",
    require_domestic_address: true,
  }),
];

describe("saved configuration behaviour", () => {
  it("says the full-name guard stops the order instead of claiming nothing blocks", () => {
    const summary = assistanceSummary(checkout);
    expect(summary.description).toContain("Bez celého jména objednávku nedokončíme.");
    expect(summary.description).toContain("Zahraniční adresu ukážeme");
    expect(summary.description).not.toContain("Neúplné jméno vysvětlíme bez blokace");
    expect(summary.description).not.toContain("Objednávka se neblokuje.");
    expect(summary.description).not.toContain("telefonu");
  });

  it("names the phone guard once it is turned on", () => {
    const fields = checkout.map((item) =>
      item.canonical_field === "phone" ? { ...item, require_valid_phone: true } : item,
    );
    expect(assistanceSummary(fields).description).toContain(
      "Bez platného telefonu objednávku nedokončíme.",
    );
  });

  it("describes the village street completion only where it is on", () => {
    const street = field({
      selector: "#street",
      canonical_field: "street_line",
      validation_trigger: "input",
    });
    const village = "V obci bez ulic doplníme k číslu domu název obce";
    expect(assistanceSummary([street]).description).not.toContain(village);
    expect(assistanceSummary([{ ...street, fill_village_street: true }]).description).toContain(
      village,
    );
    expect(
      assistanceSummary([{ ...street, validation_mode: "shadow", fill_village_street: true }])
        .description,
    ).not.toContain(village);
  });

  it("ignores guards on switched-off fields and still describes a measuring-only guard", () => {
    const phone = field({ selector: "#phone", canonical_field: "phone" });
    const off = assistanceSummary([
      { ...phone, validation_mode: "off", require_valid_phone: true },
    ]);
    expect(off.guardCount).toBe(0);
    expect(off.description).toBe("Objednávka se neblokuje.");
    const measuring = assistanceSummary([
      { ...phone, validation_mode: "shadow", require_valid_phone: true },
    ]);
    expect(measuring).toMatchObject({ assistedFieldCount: 0, guardCount: 1 });
    expect(measuring.description).toContain("Bez platného telefonu objednávku nedokončíme.");
  });
});
