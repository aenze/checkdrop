import { readFileSync } from "node:fs";
import { normalizeCzechAddressSearch } from "@checkdrop/pack-cz";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { searchCzechAddresses } from "../src/address-search.js";

const connection = process.env.CHECKDROP_ADDRESS_ADVICE_TEST_DATABASE_URL;
describe.skipIf(!connection)("address advice on isolated PostgreSQL", () => {
  let pool: Pool;
  beforeAll(async () => {
    if (!connection) throw new Error("Test database URL required");
    const url = new URL(connection);
    if (url.pathname !== "/checkdrop_address_advice_qa" || url.hostname !== "127.0.0.1") {
      throw new Error("Only a local, disposable checkdrop_address_advice_qa database is allowed");
    }
    pool = new Pool({ connectionString: connection });
    // Intentionally fails if the schema already exists. Never clean or overwrite a database.
    await pool.query("CREATE SCHEMA reference_cz");
    for (const migration of [
      "0001_reference_foundation.sql",
      "0002_ruian_staging.sql",
      "0003_address_city_exact.sql",
      "0009_ruian_snapshot_rotation.sql",
    ]) {
      await pool.query(
        readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"),
      );
    }
    await pool.query(`
      INSERT INTO reference_cz.dataset_versions (id, source, version, effective_at, row_count, checksum, state)
      VALUES ('dataset-a', 'ruian-st-uads', '2026-08-03', '2026-08-03', 7, 'a', 'active')`);
    const rows: [string, string, string | null, string, string | null, string][] = [
      ["1", "Obec A", "Testovací", "12", "4a", "12345"],
      ["2", "Obec A", "Testovací", "12", "4b", "12345"],
      ["3", "Obec B", "Testovací", "12", "4a", "67890"],
      ["4", "Obec C", "Dvojitá", "7", null, "11111"],
      ["5", "Obec C", "Dvojitá", "7", null, "11112"],
      ["6", "Ves", null, "134", null, "22222"],
      ["7", "Obec A", "Dlouhá", "12345", null, "12345"],
    ];
    for (const [id, municipality, street, houseNumber, orientation, postalCode] of rows) {
      const compound = orientation ? `${houseNumber}/${orientation}` : houseNumber;
      const structured = [street, compound, municipality, postalCode].filter(Boolean).join(" ");
      await pool.query(
        `INSERT INTO reference_cz.addresses (
           id, dataset_version_id, municipality, municipality_part, street, house_number_type,
           house_number, orientation_number, postal_code, address_line,
           search_full, search_city, search_street, search_postal_code
         ) VALUES ($1, 'dataset-a', $2, NULL, $3, '', $4, $5, $6, $7, $8, $9, $10, $6)`,
        [
          id,
          municipality,
          street,
          houseNumber,
          orientation,
          postalCode,
          `${[street, compound].filter(Boolean).join(" ")}, ${postalCode} ${municipality}`,
          normalizeCzechAddressSearch(structured),
          normalizeCzechAddressSearch(municipality),
          normalizeCzechAddressSearch(`${street ?? municipality} ${compound}`),
        ],
      );
    }
  });
  afterAll(async () => {
    await pool?.end();
  });

  const search = (street_line: string, city: string, postal_code: string) =>
    searchCzechAddresses(pool, [street_line, city, postal_code].filter(Boolean).join(" "), {
      components: { street_line, city, postal_code },
    });

  it("proposes the only matching address when just the PSČ differs", async () => {
    const result = await search("Testovací 12/4a", "Obec A", "54321");
    expect(result.advice).toEqual({ code: "address.postal_code_mismatch", postal_code: "12345" });
    expect(result.suggestions.map((s) => s.id)).toEqual(["1"]);
  });

  it("gives no advice when the PSČ is already right", async () => {
    const result = await search("Testovací 12/4a", "Obec A", "123 45");
    expect(result.advice).toBeUndefined();
    expect(result.suggestions[0]?.id).toBe("1");
  });

  it("never claims a PSČ for another orientation letter or another municipality", async () => {
    expect((await search("Testovací 12/4c", "Obec A", "54321")).advice?.code).not.toBe(
      "address.postal_code_mismatch",
    );
    expect((await search("Testovací 12/4a", "Obec Z", "54321")).advice?.code).not.toBe(
      "address.postal_code_mismatch",
    );
  });

  it("does not claim a PSČ when two address points match", async () => {
    const result = await search("Dvojitá 7", "Obec C", "99999");
    expect(result.advice?.code).not.toBe("address.postal_code_mismatch");
  });

  it("proposes the PSČ for a village without streets", async () => {
    const result = await search("134", "Ves", "33333");
    expect(result.advice).toEqual({ code: "address.postal_code_mismatch", postal_code: "22222" });
    expect(result.suggestions.map((s) => s.id)).toEqual(["6"]);
  });

  it("never reads a five-digit house number as a PSČ", async () => {
    const result = await search("Dlouhá 12345", "Obec A", "");
    expect(result.suggestions.map((s) => s.id)).toContain("7");
    expect(result.advice).toBeUndefined();
  });

  it("reports a missing house number for a known street in the municipality", async () => {
    const result = await search("Testovací", "Obec A", "");
    expect(result.advice).toEqual({ code: "address.house_number_missing" });
  });

  it("reports no match only after a completed search", async () => {
    const result = await search("Neexistující 9", "Obec Z", "99999");
    expect(result.suggestions).toEqual([]);
    expect(result.advice).toEqual({ code: "address.no_match" });
  });

  it("keeps the legacy query path without advice", async () => {
    const result = await searchCzechAddresses(pool, "Testovací 12/4a Obec A 54321");
    expect(result.advice).toBeUndefined();
  });
});
