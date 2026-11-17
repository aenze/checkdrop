import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { searchCzechAddresses } from "./address-search.js";

interface BenchmarkCase {
  input: string;
  expectedId: string;
}

const connectionString = process.env.CHECKDROP_DATABASE_URL;
if (!connectionString) {
  throw new Error("CHECKDROP_DATABASE_URL is required for the address benchmark.");
}

const root = process.env.INIT_CWD ?? process.cwd();
const fixturePath = resolve(root, "fixtures/address-search-cases.json");
const fixtureCases = JSON.parse(await readFile(fixturePath, "utf8")) as BenchmarkCase[];
const pool = new Pool({ connectionString });

try {
  const datasetResult = await pool.query<{
    id: string;
    version: string;
    row_count: number;
  }>(
    "SELECT id, version, row_count FROM reference_cz.dataset_versions WHERE source = 'ruian-st-uads' AND state = 'active'",
  );
  const dataset = datasetResult.rows[0];
  if (!dataset) {
    throw new Error("An active RÚIAN dataset is required for the address benchmark.");
  }

  const fullScale = dataset.row_count >= 1_000_000;
  const cases = fullScale ? await createFullScaleCases(pool, dataset.id) : fixtureCases;
  const warmupIterations = fullScale ? 1 : 10;
  const measuredIterations = Number(
    process.env.CHECKDROP_BENCHMARK_ITERATIONS ?? (fullScale ? 3 : 100),
  );

  for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
    for (const benchmarkCase of cases) {
      await searchCzechAddresses(pool, benchmarkCase.input);
    }
  }

  const durations: number[] = [];
  const failedExamples: Array<{ input: string; expectedId: string; actualId: string | null }> = [];
  let correctTopResults = 0;
  let measuredQueries = 0;

  for (let iteration = 0; iteration < measuredIterations; iteration += 1) {
    for (const benchmarkCase of cases) {
      const startedAt = performance.now();
      const result = await searchCzechAddresses(pool, benchmarkCase.input);
      durations.push(performance.now() - startedAt);
      measuredQueries += 1;
      if (result.suggestions[0]?.id === benchmarkCase.expectedId) {
        correctTopResults += 1;
      } else if (failedExamples.length < 10 && iteration === 0) {
        failedExamples.push({
          input: benchmarkCase.input,
          expectedId: benchmarkCase.expectedId,
          actualId: result.suggestions[0]?.id ?? null,
        });
      }
    }
  }

  durations.sort((left, right) => left - right);
  process.stdout.write(
    `${JSON.stringify(
      {
        benchmark: "cz.address.search.pg_trgm",
        dataset: dataset.version,
        datasetRows: dataset.row_count,
        fullScale,
        queryCorpus: fullScale
          ? "100 deterministic RÚIAN samples with exact and perturbed normalized queries"
          : "five curated synthetic fixture queries",
        latencyScaleRepresentative: fullScale,
        accuracyRepresentative: false,
        warning: fullScale
          ? "Full-scale local measurement with a limited synthetic query corpus; validate on pilot traffic before release claims."
          : "This verifies the query path only; it is not evidence for full RÚIAN latency or accuracy.",
        cases: cases.length,
        measuredQueries,
        top1Accuracy: correctTopResults / measuredQueries,
        failedExamples,
        latencyMs: {
          p50: percentile(durations, 0.5),
          p95: percentile(durations, 0.95),
          p99: percentile(durations, 0.99),
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await pool.end();
}

async function createFullScaleCases(
  pool: Pool,
  datasetVersionId: string,
): Promise<BenchmarkCase[]> {
  const result = await pool.query<{ id: string; search_full: string }>(
    `SELECT id, search_full
     FROM reference_cz.addresses TABLESAMPLE SYSTEM (0.2) REPEATABLE (42)
     WHERE dataset_version_id = $1 AND street IS NOT NULL
     LIMIT 100`,
    [datasetVersionId],
  );
  if (result.rows.length < 50) {
    throw new Error(`Full-scale benchmark sample is too small: ${result.rows.length} rows.`);
  }

  return result.rows.map((row, index) => {
    const input = index % 2 === 0 ? perturbAddress(row.search_full) : row.search_full;
    return {
      input: index % 4 === 0 ? input.replace(/\s\d{5}$/, "") : input,
      expectedId: row.id,
    };
  });
}

function perturbAddress(input: string): string {
  const tokens = input.split(" ");
  const tokenIndex = tokens.findIndex((token) => /^[a-z]{6,}$/.test(token));
  const token = tokenIndex >= 0 ? tokens[tokenIndex] : undefined;
  if (tokenIndex < 0 || !token) {
    return input;
  }

  const removalIndex = Math.floor(token.length / 2);
  tokens[tokenIndex] = `${token.slice(0, removalIndex)}${token.slice(removalIndex + 1)}`;
  return tokens.join(" ");
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) {
    return 0;
  }
  const index = Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1);
  return values[index] ?? 0;
}
