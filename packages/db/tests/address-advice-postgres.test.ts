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
      VALUES ('dataset-a', 'ruian-st-uads', '2026-08-03', '2026-08-03', 22, 'a', 'active')`);
    // [id, municipality, street, house number, orientation, PSČ, part of municipality, number type]
    type Row = [string, string, string | null, string, string | null, string, string?, string?];
    const rows: Row[] = [
      ["1", "Obec A", "Testovací", "12", "4a", "12345"],
      ["2", "Obec A", "Testovací", "12", "4b", "12345"],
      ["3", "Obec B", "Testovací", "12", "4a", "67890"],
      ["4", "Obec C", "Dvojitá", "7", null, "11111"],
      ["5", "Obec C", "Dvojitá", "7", null, "11112"],
      ["6", "Ves", null, "134", null, "22222"],
      ["7", "Obec A", "Dlouhá", "12345", null, "12345"],
      // Municipalities without streets, as RÚIAN records them (Sudoměřice, okres Hodonín).
      ["8", "Sudoměřice", null, "242", null, "69666", "Sudoměřice", "1"],
      ["9", "Sudoměřice", null, "241", null, "69666", "Sudoměřice", "1"],
      ["10", "Adršpach", null, "13", null, "54952", "Dolní Adršpach", "1"],
      ["11", "Adršpach", null, "14", null, "54957", "Horní Adršpach", "1"],
      // The same number in two parts with one PSČ, and in two parts with different PSČ.
      ["12", "Dvojice", null, "5", null, "33301", "Horní Dvojice", "1"],
      ["13", "Dvojice", null, "5", null, "33301", "Dolní Dvojice", "1"],
      ["14", "Rozdíl", null, "7", null, "44401", "Rozdíl", "1"],
      ["15", "Rozdíl", null, "7", null, "44402", "Malý Rozdíl", "1"],
      // A town with streets in one part and a village part without them.
      ["16", "Smíšená", "Hlavní", "3", null, "55501", "Smíšená", "1"],
      ["17", "Smíšená", null, "3", null, "55501", "Lhota", "1"],
      ["18", "Smíšená", "Hlavní", "4", null, "55501", "Smíšená", "1"],
      // A recreation area: the same number as č. p. and as č. ev.
      ["19", "Chatová", null, "8", null, "66601", "Chatová", "1"],
      ["20", "Chatová", null, "8", null, "66601", "Chatová", "2"],
      ["21", "Chatová", null, "9", null, "66601", "Chatová", "2"],
      ["22", "Smíšená", "Hlavní", "4", "2", "55501", "Smíšená", "1"],
    ];
    for (const [
      id,
      municipality,
      street,
      houseNumber,
      orientation,
      postalCode,
      part = null,
      numberType = "",
    ] of rows) {
      const compound = orientation ? `${houseNumber}/${orientation}` : houseNumber;
      const printedNumber = numberType === "2" ? `č. ev. ${compound}` : compound;
      const structured = [
        street,
        compound,
        part !== municipality ? part : null,
        municipality,
        postalCode,
      ]
        .filter(Boolean)
        .join(" ");
      await pool.query(
        `INSERT INTO reference_cz.addresses (
           id, dataset_version_id, municipality, municipality_part, street, house_number_type,
           house_number, orientation_number, postal_code, address_line,
           search_full, search_city, search_street, search_postal_code
         ) VALUES ($1, 'dataset-a', $2, $11, $3, $12, $4, $5, $6, $7, $8, $9, $10, $6)`,
        [
          id,
          municipality,
          street,
          houseNumber,
          orientation,
          postalCode,
          `${[street ?? part, printedNumber].filter(Boolean).join(" ")}, ${postalCode} ${municipality}`,
          normalizeCzechAddressSearch(structured),
          normalizeCzechAddressSearch(municipality),
          normalizeCzechAddressSearch(`${street ?? part ?? municipality} ${compound}`),
          part,
          numberType,
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

  describe("municipality without streets", () => {
    const village = (street_line: string, city: string, postal_code: string) =>
      search(street_line, city, postal_code).then((result) => ({
        advice: result.advice,
        ids: result.suggestions.map((s) => s.id),
      }));

    it("completes a bare number to the part of the municipality and the number", async () => {
      expect(await village("242", "Sudoměřice", "696 66")).toEqual({
        advice: { code: "address.village_street", street_line: "Sudoměřice 242" },
        ids: ["8"],
      });
      expect(await village("242", "Sudoměřice", "")).toEqual({
        advice: { code: "address.village_street", street_line: "Sudoměřice 242" },
        ids: ["8"],
      });
    });

    it("drops a typed č. p. and keeps what followed the number", async () => {
      expect((await village("č.p. 242", "Sudoměřice", "69666")).advice).toEqual({
        code: "address.village_street",
        street_line: "Sudoměřice 242",
      });
      expect((await village("242/3", "Sudoměřice", "69666")).advice).toEqual({
        code: "address.village_street",
        street_line: "Sudoměřice 242/3",
      });
      expect((await village("242a", "sudomerice", "69666")).advice).toEqual({
        code: "address.village_street",
        street_line: "Sudoměřice 242a",
      });
    });

    it("uses the part of the municipality, not the municipality", async () => {
      expect((await village("13", "Adršpach", "54952")).advice).toEqual({
        code: "address.village_street",
        street_line: "Dolní Adršpach 13",
      });
    });

    it("writes an evidence number with č. ev. and tells č. p. from č. ev.", async () => {
      expect((await village("9", "Chatová", "66601")).advice).toEqual({
        code: "address.village_street",
        street_line: "Chatová č. ev. 9",
      });
      expect((await village("8", "Chatová", "66601")).advice?.code).not.toBe(
        "address.village_street",
      );
      expect((await village("č.p. 8", "Chatová", "66601")).advice).toEqual({
        code: "address.village_street",
        street_line: "Chatová 8",
      });
      expect((await village("č. ev. 8", "Chatová", "66601")).advice).toEqual({
        code: "address.village_street",
        street_line: "Chatová č. ev. 8",
      });
    });

    it("does nothing when the number is in two parts with the same PSČ", async () => {
      const result = await village("5", "Dvojice", "33301");
      expect(result.advice?.code).not.toBe("address.village_street");
      expect(result.advice?.code).not.toBe("address.postal_code_mismatch");
    });

    it("lets a typed PSČ pick the part when the parts differ in PSČ", async () => {
      expect((await village("7", "Rozdíl", "44402")).advice).toEqual({
        code: "address.village_street",
        street_line: "Malý Rozdíl 7",
      });
      expect((await village("7", "Rozdíl", "")).advice?.code).not.toBe("address.village_street");
    });

    it("does nothing in a municipality where the number belongs to a street", async () => {
      expect((await village("12", "Obec A", "12345")).advice?.code).not.toBe(
        "address.village_street",
      );
      expect((await village("4", "Smíšená", "55501")).advice?.code).not.toBe(
        "address.village_street",
      );
      // Hlavní 3 and Lhota 3 share the number, so a bare "3" is ambiguous.
      expect((await village("3", "Smíšená", "55501")).advice?.code).not.toBe(
        "address.village_street",
      );
    });

    it("reports a wrong PSČ instead of changing the street", async () => {
      expect(await village("242", "Sudoměřice", "69667")).toEqual({
        advice: { code: "address.postal_code_mismatch", postal_code: "69666" },
        ids: ["8"],
      });
    });

    it("accepts the official form as typed, without any advice", async () => {
      const result = await village("Sudoměřice 242", "Sudoměřice", "69666");
      expect(result.advice).toBeUndefined();
      expect(result.ids[0]).toBe("8");
    });
  });

  it("keeps the legacy query path without advice", async () => {
    const result = await searchCzechAddresses(pool, "Testovací 12/4a Obec A 54321");
    expect(result.advice).toBeUndefined();
  });
});
