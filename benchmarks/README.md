# Benchmarks

`address-normalization.ts` is a CPU microbenchmark. It does not query PostgreSQL and is not evidence
for RÚIAN search latency.

`pnpm benchmark:address` uses the active PostgreSQL RÚIAN version. With at least one million rows it
selects 100 deterministic real records, removes one character from half of the normalized queries,
removes PSČ from one quarter, warms each case once, and measures three iterations. The resulting
accuracy is useful for regression detection but remains synthetic; pilot traffic is the release
corpus.

Committed result files must include dataset version, row count, environment, latency percentiles,
accuracy limitations, and the exact command. Never silently replace an older result.

`pnpm benchmark:validation` replays the versioned 40-case M0 corpus without network access. It
covers documented success, correction, risk, invalid-input, DNS-unavailable, and normalization
categories for email, phone, IČO, DIČ, and address normalization. The committed local result is
`results/2026-08-15-m0-validation-local.json`.

An accuracy of 1.0 here means the implementation matches its regression fixtures. The corpus is
balanced by engineering category and is not representative of real traffic frequency, customer
outcomes, live ARES behavior, or end-to-end latency. Shadow-pilot outcomes remain the release
evidence for false-positive and false-negative rates.
