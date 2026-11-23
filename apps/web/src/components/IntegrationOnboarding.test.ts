import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import componentSource from "./IntegrationOnboarding.tsx?raw";
import modelSource from "./integrations/model.ts?raw";

const source =
  componentSource +
  modelSource +
  ["Forms.tsx", "MappingRow.tsx", "Setup.tsx", "useIntegrationEditor.ts", "api.ts"]
    .map((name) => readFileSync(new URL(`./integrations/${name}`, import.meta.url), "utf8"))
    .join("\n") +
  readFileSync(
    new URL("../../../../packages/core/src/operator-contracts.ts", import.meta.url),
    "utf8",
  );

const styles = readFileSync(
  new URL("../styles/integration-onboarding.css", import.meta.url),
  "utf8",
);

describe("integration onboarding", () => {
  it("covers the self-service URL, mapping, one-line install, and shadow flow", () => {
    expect(source).toContain("URL formuláře");
    expect(source).toContain("Mapování polí");
    expect(source).toContain("Vložte jeden řádek do e-shopu");
    expect(source).toContain("Žádný balíček, GitHub ani serverový API klíč není potřeba");
    expect(source).toContain("embed_script");
    expect(source).toContain("navigator.clipboard.writeText(value)");
    expect(source).not.toContain("document.execCommand");
    expect(source).toContain("Zapnout kontrolu");
    expect(source).toContain("/scan");
    expect(source).toContain("/fields");
    expect(source).toContain("/versions");
    expect(source).toContain("/rollback");
    expect(source).not.toContain("Vytvořit klíč");
  });

  it("supports one full-name field, ignored fields, and manual selector fallback", () => {
    expect(source).toContain('value: "full_name"');
    expect(source).toContain('value: "off",\n    label: t("Nevalidovat", "Do not validate")');
    expect(source).toContain("Přidat pole ručně");
    expect(source).toContain("CSS selektor");
    expect(source).toContain("Kontrolovat i prázdnou hodnotu");
    expect(source).toContain("Vyžadovat jméno i příjmení před odesláním");
    expect(source).toContain("customer_type=private");
    expect(source).toContain("customer_type=company");
  });

  it("reports evidence and separates each non-blocking assistance mode", () => {
    expect(source).toContain("observation_count_24h");
    expect(source).toContain("Data skutečně přijímáme");
    expect(source).toContain("čekáme na první kontrolu");
    expect(source).toContain('value: "suggest"');
    expect(source).toContain('label: t("Nabídnout opravu", "Suggest a fix")');
    expect(source).toContain('label: t("Automaticky formátovat", "Format automatically")');
    expect(source).toContain('label: t("Upozornit a nabídnout opravu", "Warn and suggest a fix")');
    expect(source).toContain('? t("Nabízet adresy", "Suggest addresses")');
    expect(source).toContain(': t("Doplňovat z ARES", "Fill in from ARES")');
    expect(source).toContain('["full_name", "first_name", "last_name"]');
    expect(source).toContain('field.canonical_field === "email"');
    expect(source).toContain('field.canonical_field === "phone"');
    expect(source).toContain('field.canonical_field === "street_line"');
    expect(source).toContain('["company_name", "company_id"]');
    expect(source).toContain('? "input"');
    expect(source).toContain("Asistence je aktivní");
    expect(source).toContain("Neúplné jméno vysvětlíme bez blokace objednávky");
    expect(source).toContain("Bez celého jména objednávku nedokončíme.");
    expect(source).toContain("Bez platného telefonu objednávku nedokončíme.");
    expect(source).toContain("Zahraniční adresu ukážeme a první dokončení jednou zastavíme.");
    expect(source).toContain("Jiné kontroly objednávku neblokují");
    expect(source).toContain("Vyžadovat platný telefon před odesláním");
    expect(source).toContain("assistedFieldCount + guardCount > 0");
    expect(source).toContain("Český telefon se bezpečně a tiše zformátuje");
    expect(source).toContain("Výběr z RÚIAN doplní ulici, město a PSČ");
    expect(source).toContain("Výběr firmy doplní firemní a fakturační údaje z ARES");
    expect(source).not.toContain('value: "normalize"');
    expect(source).not.toContain("Shadow běží");
  });

  it("uses compact responsive mapping cards without a wide hidden table", () => {
    expect(source).toContain("mapping-card");
    expect(source).toContain("Pokročilé nastavení");
    expect(source).not.toContain("mapping-table");
    expect(styles).toContain(".mapping-card-main");
    expect(styles).not.toContain("min-width: 920px");
  });

  it("starts a new integration blank and generates the technical identifier", () => {
    expect(source).toContain('const [name, setName] = useState("")');
    expect(source).toContain('const [url, setUrl] = useState("")');
    expect(source).toContain("clientIdentifier(name, url)");
    expect(source).not.toContain("Example shop – objednávka");
    expect(source).not.toContain("<span>Identifikátor</span>");
  });
});
