# Decisions

| ID | Decision | Status |
| --- | --- | --- |
| ADR-0001 | Pilot is a Node.js modular monolith on one PostgreSQL database | Accepted |
| ADR-0002 | Cloudflare provides DNS/TLS/CDN/WAF, not pilot application compute | Accepted |
| ADR-0003 | Kysely plus explicit SQL is the only database access approach | Accepted |
| ADR-0004 | PostgreSQL `pg_trgm` must be benchmarked before adding search infrastructure | Accepted |
| ADR-0005 | Validation and shadow evidence precede signup, dashboard, batch, and Stripe | Accepted |
| ADR-0006 | Czech rules are a normal versioned package, not a plugin marketplace | Accepted |
| ADR-0007 | One Astro web will contain site, docs, playground, and dashboard | Accepted |
| ADR-0008 | Self-hosted remains a later deployment profile of the same product | Superseded by ADR-0011 |
| ADR-0009 | RÚIAN versions stage in PostgreSQL and an active view switches in one transaction | Accepted |
| ADR-0010 | Keep PostgreSQL address search; local full-scale p95 is 141.34 ms, below the 150 ms escalation gate | Accepted with pilot recheck |
| ADR-0011 | Open source without open-core: one application for every installation, AGPL server, MIT core, packs, checkout script and plugins, automatic updates ([details](docs/adr/0011-open-source-one-application.md)) | Accepted 2026-11-17 |

Current clarification (2026-09-17): operational PostgreSQL backups already use Cloudflare R2;
customer object storage and job queues remain deferred. The operator dashboard is deployed;
customer account/auth primitives are prepared, not an active public login/signup product.

Deferred until measured need: customer R2/S3 files, pg-boss, Redis, PostGIS, OpenSearch, main
application compute on Cloudflare Workers, multi-region operation, public signup and billing.
