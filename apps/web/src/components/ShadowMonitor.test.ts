import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupObservationsByCase } from "./shadow-monitor-grouping";

describe("shadow integration monitor", () => {
  it("loads full protected observations without an approval workflow", () => {
    const source = readFileSync(new URL("./ShadowMonitor.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../styles/shadow-monitor.css", import.meta.url), "utf8");

    expect(source).toContain('"/checkdrop/v1/operator/observations"');
    expect(source).toMatch(/fetch\(`\$\{endpoint\}\?\$\{params\.toString\(\)\}`/);
    expect(source).toContain('page_size: "25"');
    expect(source).toContain('params.set("operation"');
    expect(source).toContain('params.set("assist_outcome"');
    expect(source).toContain('params.set("client_name"');
    expect(source).toContain('"/checkdrop/v1/operator/integrations"');
    expect(source).toContain('label={t("Web", "Website")}');
    expect(source).toContain('["all", t("Všechny weby", "All websites")]');
    expect(source).toContain("Zákazník · web · formulář");
    expect(source).toContain("checkout_session_ref");
    expect(source).toContain("groupObservationsByCase(payload.data)");
    expect(source).toContain("/checkdrop/v1/operator/observations/search");
    expect(source).toContain("JSON.stringify({ query: query.search })");
    expect(source).toContain("Jméno, firma, e-mail, telefon, IČO nebo ID případu");
    expect(source).toContain("customerCaseIdentity(customerCase)");
    expect(source).toContain("Zákazník bez jména");
    expect(source).toContain("ponecháno");
    expect(source).toContain("Nic jsme nenašli");
    expect(source).toMatch(/className=\{`monitor-case-card\$\{expanded \? " expanded" : ""\}`\}/);
    expect(source).not.toMatch(/monitor-case-card \$\{overview\.tone\}/);
    expect(styles).not.toMatch(/\.monitor-case-card[^}]*border-left:/s);
    expect(styles).not.toContain(".monitor-case-card.changed");
    expect(styles).not.toContain(".monitor-case-card.review");
    expect(styles).not.toContain(".monitor-case-card.invalid");
    expect(source).toContain('className="case-detail-table"');
    expect(source).toContain("Konkrétní zákaznické hodnoty");
    expect(source).toContain("Propojené s rozhodnutím, šifrované a mazané");
    expect(source).toContain("observation.input_value");
    expect(source).toContain("observation.proposed_value");
    expect(source).toContain("starší maskovaný záznam");
    expect(source).toContain("Přijatá hodnota");
    expect(source).toContain("Návrh Checkdrop");
    expect(source).toContain("Reakce zákazníka");
    expect(source).toContain("Zpracované kontroly");
    expect(source).toContain("Zobrazené opravy");
    expect(source).toContain("Použité opravy");
    expect(source).toContain("Automaticky upraveno");
    expect(source).toContain("Ponecháno");
    expect(source).toContain("Vráceno");
    expect(source).toContain("observation.assist_outcome");
    expect(source).toContain("server_latency_ms");
    expect(source).toContain("Automatická obnova po 30 s");
    expect(source).toContain('label: t("Adresa", "Address")');
    expect(source).toContain('label: "IČO"');
    expect(source).toContain('ruian: "RÚIAN"');
    expect(source).toContain('ares: "ARES"');
    expect(source).toContain('"address.country_mismatch"');
    expect(source).toContain('"person.first_name_missing"');
    expect(source).toContain('"person.title_normalized"');
    expect(source).toContain('"person.capitalization_normalized"');
    expect(source).toContain('"person.capitalization_ambiguous"');
    expect(source).toContain('"person.invalid_characters"');
    expect(source).toContain('country: t("Země objednávky", "Order country")');
    expect(source).toContain('className="monitor-status invalid">{t("Neplatné", "Invalid")}');
    expect(source).toContain('aria-label={t("Stránkování monitoru", "Monitor pagination")}');
    expect(source).toContain("...localeHeader");
    expect(source).not.toContain('"cs-CZ"');
    expect(source).not.toContain("Přijmout změnu");
    expect(source).not.toContain('role="switch"');
  });

  it("keeps compact case summaries and changes expanded details to readable mobile cards", () => {
    const styles = readFileSync(new URL("../styles/shadow-monitor.css", import.meta.url), "utf8");

    expect(styles).toMatch(
      /\.monitor-metric-icon\s*{[^}]*display:\s*grid;[^}]*place-items:\s*center;/s,
    );
    expect(styles).toMatch(/\.monitor-case-summary\s*{[^}]*min-height:\s*62px;/s);
    expect(styles).toMatch(/\.case-detail-table\s*{[^}]*table-layout:\s*fixed;/s);
    expect(styles).toContain("content: attr(data-label)");
    expect(styles).toMatch(
      /\.case-detail-table tbody td\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*100px minmax\(0, 1fr\)/s,
    );
    expect(styles).not.toContain("min-width: 1000px");
  });

  it("groups only observations with the same irreversible checkout reference", () => {
    type Observation = Parameters<typeof groupObservationsByCase>[0][number];
    const observation = (id: string, session: string | null): Observation => ({
      id,
      client_name: "shop-checkout",
      form_id: "checkout",
      form_name: "Objednávka",
      checkout_session_ref: session,
      observed_at: "2026-08-29T10:00:00.000Z",
    });
    const shared = "a".repeat(64);

    const cases = groupObservationsByCase([
      observation("one", shared),
      observation("two", shared),
      observation("legacy-one", null),
      observation("legacy-two", null),
    ]);

    expect(cases).toHaveLength(3);
    expect(cases[0]?.observations).toHaveLength(2);
    expect(cases[1]?.key).toBe("observation:legacy-one");
    expect(cases[2]?.key).toBe("observation:legacy-two");
  });
});
