# Roadmap

Current release: 0.1.x, open source, with one-command self-hosting on a server with Docker. See
[CHANGELOG.md](CHANGELOG.md) for what each release changed.

## Done

- Czech validation core: e-mail typos and domains, Czech phones, names, IČO and ARES, RÚIAN import,
  address validation and autocomplete, with deterministic fixtures and latency benchmarks.
- HTTP API with hashed keys, a redacted usage ledger, an OpenAPI contract, rate limits, timeouts
  and fail-open behaviour when a source is unavailable.
- One script tag that loads the field mapping of a site, observes first and offers suggestions
  field by field; optional blocking of submits whose details make delivery impossible.
- Administration with a monitor of encrypted observations (90-day retention), site setup and
  checkout measurement, in Czech and English.
- One application for every installation: `install.sh`, the `./checkdrop` manager, administrator
  accounts, jobs inside each installation, daily automatic updates with backup and rollback.
- WordPress plugin.

## Later

Nothing here is scheduled; each item waits for a real need.

- Foreign address coverage and live VIES checks.
- More country packs.
- Object storage and job queues for batch file processing.

## Not planned

- A separate npm SDK, unless a real custom-client requirement appears.
- Plugin marketplaces or country-pack registries.
