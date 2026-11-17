import { describe, expect, it } from "vitest";
import { detectFormFields, type FormScanError, scanFormUrl } from "../src/form-scanner.js";

const checkoutHtml = `<!doctype html>
<html><head><title>Objednávka</title></head><body>
  <form id="checkout">
    <fieldset><legend>Nakupuji</legend>
      <label><input type="radio" name="customer_type" value="private"> soukromě</label>
      <label><input type="radio" name="customer_type" value="company"> na firmu</label>
    </fieldset>
    <label for="billing-name">Jméno a příjmení</label><input id="billing-name" name="billing_name" required>
    <label>Email <input type="email" name="email" required></label>
    <label>Tel. číslo <input type="tel" name="phone"></label>
    <label>Ulice a č. p. <input name="street" autocomplete="street-address"></label>
    <label>Město <input name="city" autocomplete="address-level2"></label>
    <label>PSČ <input name="zip" autocomplete="postal-code"></label>
    <label>Země <select name="country" autocomplete="country-name"></select></label>
    <section><h2>Doručovací adresa</h2>
      <label>Jméno a příjmení <input name="shipping_name"></label>
      <label>Ulice a č. p. <input name="shipping_street"></label>
    </section>
    <input type="password" name="password"><input type="hidden" name="csrf" value="secret">
  </form>
</body></html>`;

describe("form scanner", () => {
  it("detects structural checkout fields without reading field values", () => {
    const result = detectFormFields(checkoutHtml, new URL("https://shop.example/checkout?token=x"));
    expect(result.sanitizedUrl).toBe("https://shop.example/checkout");
    expect(result.pageTitle).toBe("Objednávka");
    expect(result.formCount).toBe(1);
    expect(result.fields.map((field) => field.canonicalField)).toEqual([
      "customer_type",
      "full_name",
      "email",
      "phone",
      "street_line",
      "city",
      "postal_code",
      "country",
      "full_name",
      "street_line",
    ]);
    expect(result.fields.filter((field) => field.context === "shipping")).toHaveLength(2);
    expect(new Set(result.fields.map((field) => field.rootSelector))).toEqual(
      new Set(["#checkout"]),
    );
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("groups registration controls and detects split names, company and conditional sections", () => {
    const html = `<!doctype html><html><body>
      <form id="registration">
        <label>E-mail <input type="email" name="email"></label>
        <label><input type="checkbox" name="profile_details"> Chci vyplnit všechny údaje</label>
        <label>Jméno <input name="first_name" autocomplete="given-name"></label>
        <label>Příjmení <input name="last_name" autocomplete="family-name"></label>
        <label>Název firmy <input name="company_name"></label>
        <label>IČO <input name="ico"></label>
        <label>DIČ <input name="dic"></label>
        <label><input type="checkbox" name="different_shipping"> Doručit na jinou adresu</label>
      </form>
      <form id="checkout"><label>Telefon <input type="tel" name="phone"></label></form>
    </body></html>`;
    const result = detectFormFields(html, new URL("https://shop.example/account"));
    const registration = result.fields.filter((field) => field.rootSelector === "#registration");
    expect(registration.map((field) => field.canonicalField)).toEqual([
      "email",
      "profile_details_enabled",
      "first_name",
      "last_name",
      "company_name",
      "company_id",
      "vat_id",
      "alternate_shipping_enabled",
    ]);
    expect(
      result.fields.find((field) => field.canonicalField === "company_id")?.validationTrigger,
    ).toBe("input");
  });

  it("rejects private targets before fetching", async () => {
    let calls = 0;
    await expect(
      scanFormUrl("https://shop.example/checkout", {
        resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }],
        fetch: async () => {
          calls += 1;
          return new Response(checkoutHtml, { headers: { "Content-Type": "text/html" } });
        },
      }),
    ).rejects.toMatchObject({ code: "private_target" } satisfies Partial<FormScanError>);
    expect(calls).toBe(0);
  });

  it("scans public HTML with a bounded injected fetch", async () => {
    const result = await scanFormUrl("https://shop.example/checkout?session=secret", {
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      fetch: async () =>
        new Response(checkoutHtml, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    });
    expect(result.fields.some((field) => field.canonicalField === "email")).toBe(true);
    expect(result.sanitizedUrl).toBe("https://shop.example/checkout");
  });
});
