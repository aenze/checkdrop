# Product and reliability metrics

## North-star outcome

Percentage of validation decisions later confirmed useful by customer outcomes, segmented by
capability, issue code, source freshness, and policy. Do not publish this metric until the sample
and confidence interval are meaningful.

## Pilot scorecard

- Successful API request rate and p50/p95/p99 latency.
- `valid`, `correctable`, `risky`, `invalid`, and `unknown` distribution.
- Fail-open and upstream timeout rate.
- Suggestion acceptance/rejection rate.
- Customer-reported false-positive and false-negative rate.
- Idempotent usage-ledger reconciliation difference (target: zero).
- Raw-PII logging scan findings (target: zero).
- Dataset freshness and ingestion lag.

Metrics must use pseudonymous request/project identifiers and bounded dimensions. No dashboard may
display fabricated customer usage; development fixtures must be visibly labeled.

M2 records result distribution and server latency in Checkdrop plus total request latency in the
SDK callback. The optional protected monitor derives only request count, proposed-change count,
average server latency, and p95 server latency from unexpired protected rows. These measurements do not
by themselves prove validation accuracy. An accuracy claim requires a separately labeled,
representative pilot sample or later observed outcomes; neither is fabricated from usage rows or
monitor values.
