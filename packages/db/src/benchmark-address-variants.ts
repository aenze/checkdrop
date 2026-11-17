// Compares address candidate strategies on the active full RÚIAN dataset (plan C3).
//
// The corpus is sampled deterministically from real address points; the expected answer is always
// the sampled address itself, never the output of a strategy under test. Typing prefixes have no
// single correct answer and are measured for latency and for returning any street that matches.
//
// Usage: CHECKDROP_DATABASE_URL=... node dist/benchmark-address-variants.js [out.json]
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { normalizeCzechAddressSearch } from "@checkdrop/pack-cz";
import { Pool } from "pg";
import { type AddressSearchOptions, searchCzechAddresses } from "./address-search.js";

type Strategy = NonNullable<AddressSearchOptions["strategy"]>;
const strategies: readonly Strategy[] = ["trigram", "street-prefix-first"];

interface SampleRow {
  id: string;
  street: string | null;
  house_number: string;
  orientation_number: string | null;
  municipality: string;
  postal_code: string;
}
interface Case {
  category: string;
  input: string;
  expectedId: string | null;
  /** Active addresses sharing the street (or municipality) and number of the expected one. */
  sameNumberMatches: number | null;
  prefix?: string;
}

const connectionString = process.env.CHECKDROP_DATABASE_URL;
if (!connectionString) throw new Error("CHECKDROP_DATABASE_URL is required.");
const outPath = process.argv[2];
const iterations = Number(process.env.CHECKDROP_BENCHMARK_ITERATIONS ?? 3);
const pool = new Pool({ connectionString, max: 2 });

const compound = (row: SampleRow) =>
  row.orientation_number ? `${row.house_number}/${row.orientation_number}` : row.house_number;
const stripDiacritics = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "");
function dropCharacter(value: string) {
  const index = Math.floor(value.length / 2);
  return `${value.slice(0, index)}${value.slice(index + 1)}`;
}

async function sample(where: string, seed: number, limit: number) {
  const result = await pool.query<SampleRow>(
    `SELECT id, street, house_number, orientation_number, municipality, postal_code
       FROM reference_cz.addresses TABLESAMPLE SYSTEM (0.5) REPEATABLE (${seed})
      WHERE dataset_version_id = $1 AND ${where}
      ORDER BY id
      LIMIT ${limit}`,
    [datasetId],
  );
  if (result.rows.length < limit) throw new Error(`Sample ${seed} returned ${result.rows.length}.`);
  return result.rows;
}

async function sameNumberMatches(row: SampleRow, useMunicipality: boolean) {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM reference_cz.addresses
      WHERE dataset_version_id = $1
        AND ${useMunicipality ? "municipality = $2" : "street = $2"}
        AND (house_number = $3 OR orientation_number = $3)`,
    [datasetId, useMunicipality ? row.municipality : row.street, row.house_number],
  );
  return Number(result.rows[0]?.count ?? 0);
}

const dataset = (
  await pool.query<{ id: string; version: string; row_count: number }>(
    `SELECT id, version, row_count FROM reference_cz.dataset_versions
      WHERE source = 'ruian-st-uads' AND state = 'active'`,
  )
).rows[0];
if (!dataset || dataset.row_count < 1_000_000) throw new Error("A full active RÚIAN is required.");
const datasetId = dataset.id;

const streets = await sample("street IS NOT NULL", 11, 200);
const oriented = await sample("street IS NOT NULL AND orientation_number IS NOT NULL", 12, 20);
const villages = await sample("street IS NULL", 13, 20);
const cases: Case[] = [];
const take = (from: number, count: number) => streets.slice(from, from + count);

for (const row of take(0, 30))
  cases.push({
    category: "exact",
    input: `${row.street} ${compound(row)}, ${row.municipality} ${row.postal_code}`,
    expectedId: row.id,
    sameNumberMatches: null,
  });
for (const row of take(30, 30))
  cases.push({
    category: "no-diacritics",
    input: stripDiacritics(`${row.street} ${compound(row)} ${row.municipality}`),
    expectedId: row.id,
    sameNumberMatches: null,
  });
for (const row of take(60, 40))
  cases.push({
    category: "street-number-no-city",
    input: `${row.street} ${compound(row)}`,
    expectedId: row.id,
    sameNumberMatches: await sameNumberMatches(row, false),
  });
for (const row of oriented)
  cases.push({
    category: "orientation-only-no-city",
    input: `${row.street} ${row.orientation_number}`,
    expectedId: row.id,
    sameNumberMatches: null,
  });
for (const row of take(100, 30))
  cases.push({
    category: "street-number-city",
    input: `${row.street} ${row.house_number} ${row.municipality}`,
    expectedId: row.id,
    sameNumberMatches: null,
  });
for (const row of take(130, 25))
  cases.push({
    category: "typo-with-city",
    input: `${dropCharacter(row.street ?? "")} ${compound(row)} ${row.municipality}`,
    expectedId: row.id,
    sameNumberMatches: null,
  });
for (const row of take(155, 25))
  cases.push({
    category: "typo-no-city",
    input: `${dropCharacter(row.street ?? "")} ${compound(row)}`,
    expectedId: row.id,
    sameNumberMatches: await sameNumberMatches(row, false),
  });
for (const row of villages)
  cases.push({
    category: "village-number",
    input: `${row.municipality} ${row.house_number}`,
    expectedId: row.id,
    sameNumberMatches: await sameNumberMatches(row, true),
  });
for (const row of take(180, 20)) {
  const wrong = String(((Number(row.postal_code) + 1_000) % 90_000) + 10_000).padStart(5, "0");
  cases.push({
    category: "wrong-postal-code",
    input: `${row.street} ${compound(row)} ${row.municipality} ${wrong}`,
    expectedId: row.id,
    sameNumberMatches: null,
  });
}
for (const row of take(0, 40)) {
  const street = normalizeCzechAddressSearch(row.street ?? "");
  if (street.length >= 5 && cases.filter((c) => c.category === "typing-street-prefix").length < 20)
    cases.push({
      category: "typing-street-prefix",
      input: (row.street ?? "").slice(0, 5),
      expectedId: null,
      sameNumberMatches: null,
      prefix: street.slice(0, 5),
    });
}
for (const row of take(40, 20))
  cases.push({
    category: "typing-partial-number",
    input: `${row.street} ${row.house_number.slice(0, Math.max(1, row.house_number.length - 2))}`,
    expectedId: null,
    sameNumberMatches: null,
    prefix: normalizeCzechAddressSearch(row.street ?? ""),
  });

type Measurement = { strategy: Strategy; case: Case; ms: number; ids: string[]; streets: string[] };
const measurements: Measurement[] = [];
for (let iteration = 0; iteration <= iterations; iteration += 1) {
  for (const testCase of cases) {
    // Alternate the order so neither strategy profits from the other's warmed buffers.
    const order = iteration % 2 === 0 ? strategies : [...strategies].reverse();
    for (const strategy of order) {
      const started = performance.now();
      const result = await searchCzechAddresses(pool, testCase.input, { strategy });
      const ms = performance.now() - started;
      if (iteration === 0) continue; // warm-up pass
      measurements.push({
        strategy,
        case: testCase,
        ms,
        ids: result.suggestions.map((suggestion) => suggestion.id),
        streets: result.suggestions.map((suggestion) =>
          normalizeCzechAddressSearch(suggestion.street ?? suggestion.municipality),
        ),
      });
    }
  }
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(p * sorted.length) - 1] ?? 0;
};
const summary: Record<string, Record<string, unknown>> = {};
for (const category of [...new Set(cases.map((c) => c.category))]) {
  summary[category] = {};
  for (const strategy of strategies) {
    const rows = measurements.filter(
      (m) => m.strategy === strategy && m.case.category === category,
    );
    const first = rows.filter((_, index) => index < rows.length / iterations);
    const withExpected = first.filter((m) => m.case.expectedId);
    const unambiguous = withExpected.filter((m) => (m.case.sameNumberMatches ?? 1) <= 5);
    (summary[category] as Record<string, unknown>)[strategy] = {
      cases: first.length,
      p50: Math.round(
        percentile(
          rows.map((m) => m.ms),
          0.5,
        ),
      ),
      p95: Math.round(
        percentile(
          rows.map((m) => m.ms),
          0.95,
        ),
      ),
      max: Math.round(Math.max(...rows.map((m) => m.ms))),
      over2s: rows.filter((m) => m.ms > 2_000).length,
      empty: first.filter((m) => m.ids.length === 0).length,
      ...(withExpected.length > 0
        ? {
            top1: withExpected.filter((m) => m.ids[0] === m.case.expectedId).length,
            top5: withExpected.filter((m) => m.ids.includes(m.case.expectedId ?? "")).length,
            unambiguousCases: unambiguous.length,
            unambiguousTop5: unambiguous.filter((m) => m.ids.includes(m.case.expectedId ?? ""))
              .length,
          }
        : {
            anyMatchingStreet: first.filter((m) =>
              m.streets.some((street) => street.startsWith(m.case.prefix ?? "\u0000")),
            ).length,
          }),
    };
  }
}

const output = {
  benchmark: "cz.address.search.strategies",
  dataset: dataset.version,
  datasetRows: dataset.row_count,
  iterations,
  cases: cases.length,
  note: "Local full RÚIAN, no statement timeout, sequential queries; latency is local, not production.",
  summary,
  regressions: cases
    .filter((testCase) => testCase.expectedId)
    .map((testCase) => {
      const found = (strategy: Strategy) =>
        measurements
          .find((m) => m.strategy === strategy && m.case === testCase)
          ?.ids.includes(testCase.expectedId ?? "") ?? false;
      return { testCase, trigram: found("trigram"), prefix: found("street-prefix-first") };
    })
    .filter((row) => row.trigram && !row.prefix)
    .map((row) => ({
      category: row.testCase.category,
      input: row.testCase.input,
      sameNumberMatches: row.testCase.sameNumberMatches,
    })),
};
if (outPath) await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify(output.summary, null, 1)}\nregressions: ${JSON.stringify(output.regressions)}\n`,
);
await pool.end();
