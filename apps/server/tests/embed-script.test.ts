import { describe, expect, it } from "vitest";
import { CHECKDROP_EMBED_SCRIPT } from "../src/embed-script.js";

describe("hosted checkout script", () => {
  it("is executable browser JavaScript with the complete shadow route set", () => {
    expect(() => new Function(CHECKDROP_EMBED_SCRIPT)).not.toThrow();
    expect(CHECKDROP_EMBED_SCRIPT).toContain("/v1/integration/config?site=");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("&path=");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("&form=");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("&session=");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("window.sessionStorage");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("createCheckoutSessionId");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("crypto.getRandomValues");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("completedRequests.get(key) === requestFingerprint");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("completedRequests.delete");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("location.pathname");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("/v1/names/validate");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("/v1/emails/validate");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("/v1/phones/validate");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("/v1/assist/interactions");
    // Simple CORS requests: JSON travels as text/plain, so no check waits for a preflight.
    expect(CHECKDROP_EMBED_SCRIPT).toContain('"Content-Type": "text/plain;charset=UTF-8"');
    expect(CHECKDROP_EMBED_SCRIPT).not.toContain("application/json");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("/v1/addresses/validate");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("/v1/addresses/autocomplete");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("/v1/company-ids/validate");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("/v1/companies/autocomplete");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("config.forms");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("root_selector");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("control.selectedOptions");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("control.labels");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("na firmu");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("ceska republika");
  });

  it("assists names, e-mails, phones and Czech addresses without blocking checkout", () => {
    expect(CHECKDROP_EMBED_SCRIPT).toContain('document.addEventListener("input"');
    expect(CHECKDROP_EMBED_SCRIPT).toContain('document.addEventListener("focusout"');
    expect(CHECKDROP_EMBED_SCRIPT).toContain('document.addEventListener("focusin"');
    expect(CHECKDROP_EMBED_SCRIPT).toContain(
      "setControlValueSilently(control, texts.phonePrefill)",
    );
    expect(CHECKDROP_EMBED_SCRIPT).toContain('"phonePrefill":"+420 "');
    expect(CHECKDROP_EMBED_SCRIPT).toContain("isCzechPhonePrefixOnly");
    expect(CHECKDROP_EMBED_SCRIPT).toContain('document.addEventListener("submit"');
    expect(CHECKDROP_EMBED_SCRIPT).toContain('document.removeEventListener("submit"');
    expect(CHECKDROP_EMBED_SCRIPT).toMatch(
      /\[\s*"city",\s*"postal_code",\s*"country"\s*\]\.includes/,
    );
    expect(CHECKDROP_EMBED_SCRIPT).toContain(
      "cityField && !city || postalCodeField && !postalCode",
    );
    expect(CHECKDROP_EMBED_SCRIPT).toContain('credentials: "omit"');
    expect(CHECKDROP_EMBED_SCRIPT).not.toContain("X-Checkdrop-Key");
    // Autocomplete consumes navigation keys, but native submit remains fail-open.
    expect(CHECKDROP_EMBED_SCRIPT).toContain("event.isComposing");
    expect(CHECKDROP_EMBED_SCRIPT).not.toContain("innerHTML");
    expect(CHECKDROP_EMBED_SCRIPT).toContain('validation_mode === "suggest"');
    expect(CHECKDROP_EMBED_SCRIPT).toContain("email.domain_typo");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("phone.normalized");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("safePhoneSuggestion");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("formatCzechPhoneControl");
    expect(CHECKDROP_EMBED_SCRIPT).toContain('control.setAttribute("inputmode", "tel")');
    expect(CHECKDROP_EMBED_SCRIPT).toContain(
      'control.setAttribute("placeholder", texts.phonePlaceholder)',
    );
    expect(CHECKDROP_EMBED_SCRIPT).toContain('"phonePlaceholder":"+420 777 762 456"');
    expect(CHECKDROP_EMBED_SCRIPT).toContain("safeEmailWarning");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("applyPhoneNormalization");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("safePhoneWarning");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("/^\\+420\\d{9}$/");
    expect(CHECKDROP_EMBED_SCRIPT).toContain('"$1 $2 $3 $4"');
    expect(CHECKDROP_EMBED_SCRIPT).toContain("phone.number_impossible");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("phone.country_not_cz");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("email.syntax_invalid");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("email.domain_no_dns");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("Zkontrolujte formát e-mailu");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("Doména e-mailu pravděpodobně neexistuje");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("Telefon musí mít 9 číslic");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("Pro ČR použijte české číslo");
    expect(CHECKDROP_EMBED_SCRIPT).toContain('warning.setAttribute("role", "alert")');
    expect(CHECKDROP_EMBED_SCRIPT).toContain("checkdrop-field-assist-icon");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("#fff7f6");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("safeNameSuggestion");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("safeNameWarning");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("Jméno je v pořádku");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("first_name");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("last_name");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("Doplňte jméno i příjmení, ať se doručení nezpozdí.");
    expect(CHECKDROP_EMBED_SCRIPT).toContain('"correction.title":"Opravit {field} na {value}?"');
    expect(CHECKDROP_EMBED_SCRIPT).toContain('apply.textContent = message("correction.apply")');
    expect(CHECKDROP_EMBED_SCRIPT).toContain("checkdrop-field-assist-actions");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("flex-wrap:nowrap");
    expect(CHECKDROP_EMBED_SCRIPT).not.toContain("Telefon upraven na ");
    expect(CHECKDROP_EMBED_SCRIPT).not.toContain('undo.textContent = "Vrátit původní"');
    expect(CHECKDROP_EMBED_SCRIPT).not.toContain("skipPhoneFormatting");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("showAddressSuggestions");
    expect(CHECKDROP_EMBED_SCRIPT).toContain(
      "Doplňte adresu podle nápovědy, ať se doručení nezpozdí.",
    );
    expect(CHECKDROP_EMBED_SCRIPT).toContain("suggestion.streetLine");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("suggestion.city");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("suggestion.postalCode");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("Adresa doplněna.");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("addressMutationControls");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("Firemní údaje doplněny z ARES");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("applyCompanyData");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("findExactField");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("alternate_shipping_enabled=true");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("profile_details_enabled=true");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("!splitNameReady(field, fields)");
    expect(CHECKDROP_EMBED_SCRIPT).toContain("clearRelatedNamePrompts(field, fields)");
    expect(CHECKDROP_EMBED_SCRIPT).toContain('apply.addEventListener("click"');
    expect(CHECKDROP_EMBED_SCRIPT).toContain('undo.addEventListener("click"');
    expect(CHECKDROP_EMBED_SCRIPT).toContain('trackAssistInteraction(formId, requestId, "shown")');
    expect(CHECKDROP_EMBED_SCRIPT).toContain('track("applied")');
    expect(CHECKDROP_EMBED_SCRIPT).toContain('track("kept")');
    expect(CHECKDROP_EMBED_SCRIPT).toContain('trackAssistInteraction(formId, requestId, "undone")');
    expect(CHECKDROP_EMBED_SCRIPT).toContain("control.value === original");
    expect(CHECKDROP_EMBED_SCRIPT).toContain('new Event("input", { bubbles: true })');
    expect(
      CHECKDROP_EMBED_SCRIPT.match(
        /void validate\(formId, key, field, fields, control, value, startedAt\);/g,
      ),
    ).toHaveLength(1);
  });

  it("normalizes a valid Czech phone silently", () => {
    const phoneNormalization = CHECKDROP_EMBED_SCRIPT.match(
      /function applyPhoneNormalization[\s\S]*?function trackAssistInteraction/,
    )?.[0];

    expect(phoneNormalization).toBeTruthy();
    expect(phoneNormalization).toContain("setNativeControlValue(control, normalized)");
    expect(phoneNormalization).not.toContain("insertAdjacentElement");
    expect(phoneNormalization).not.toContain("trackAssistInteraction(formId");
    expect(phoneNormalization).not.toContain("Telefon upraven");
    expect(phoneNormalization).not.toContain("Vrátit původní");
  });
});
