# Data-source policy

Each capability adapter exposes source name, retrieval time, effective/version date, freshness
state, timeout state, and the evidence that supports its issue codes.

| Capability | Intended source | Use |
| --- | --- | --- |
| Email | Syntax, IDNA/DNS, disposable/role metadata | Deterministic normalization and risk evidence |
| Phone | libphonenumber plus ČTÚ metadata | Format, country, type, and plausibility |
| Company | ARES | Czech organization identity and status |
| VAT | Local Czech DIČ rules | Format normalization only; no live registration claim |
| Address | RÚIAN in PostgreSQL with `pg_trgm` | Czech address normalization and suggestions |

Source terms, quotas, redistribution rights, and retention are release gates. A successful HTTP
response alone is not proof of current or authoritative data. Stale or unavailable sources produce
explicit evidence and do not silently become `valid`.

## ARES adapter contract

- ARES uses the Ministry of Finance REST endpoints for a single, locally checksum-valid IČO and
  bounded company-name search.
- ARES uses one bounded request with no automatic retry.
- Invalid local input is never sent upstream.
- Timeout, network failure, HTTP 429, 5xx, and malformed payloads are distinct evidence states.
- Provider failure returns `unknown` with `fail_open`; it never becomes a false invalid result.
- Raw provider errors and payloads are not included in returned evidence.
- Company results expose only the normalized name, IČO, optional DIČ, and structured registered
  office needed by mapped company/billing fields.
- ARES does not accept partial IČO search. Numeric prefixes are never sent as company names and may
  match only a recently resolved company in the short server cache.

ARES documents a possible restriction above 500 requests per minute and for duplicate, random, or
highly concurrent traffic. Its data are informative rather than legally authoritative. CI uses an
injected fixture response only; live smoke checks are explicit operator actions.

Official contracts:

- https://data.mf.gov.cz/api/ares.html
- https://mf.gov.cz/cs/ministerstvo/informacni-systemy/ares

## RÚIAN import evidence

The importer targets the official nationwide special VFR address file (`ST_UADS`). It reads
uncompressed XML from a file or stdin with bounded memory. The updater checks the current and
recent monthly archives published by ČÚZK, downloads the first available ZIP, and streams only the
expected XML entry into the importer. The previously active snapshot is retained for at least 24
hours so a failed refresh never replaces verified data.

Local evidence is recorded in `benchmarks/results/2026-08-15-full-ruian-local.json`. It proves the
current import/query path at full row-count scale, not source redistribution rights, production
latency, or pilot accuracy. The address validation and autocomplete API use the active snapshot and
propose a correction only when the result is unambiguous.
