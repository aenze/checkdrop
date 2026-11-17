import { performance } from "node:perf_hooks";
import { normalizeCzechAddressSearch } from "@checkdrop/pack-cz";
import cases from "../fixtures/address-normalization.json" with { type: "json" };

const durations: number[] = [];
const iterations = 25_000;

for (let index = 0; index < iterations; index += 1) {
  const fixture = cases[index % cases.length];
  if (!fixture) throw new Error("Address benchmark requires at least one fixture.");
  const started = performance.now();
  normalizeCzechAddressSearch(fixture.input);
  durations.push(performance.now() - started);
}

durations.sort((left, right) => left - right);
const percentile = (value: number) => durations[Math.floor((durations.length - 1) * value)] ?? 0;
const output = {
  benchmark: "cz.address.normalization",
  iterations,
  p50_ms: percentile(0.5),
  p95_ms: percentile(0.95),
  p99_ms: percentile(0.99),
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (output.p95_ms > 1) process.exitCode = 1;
