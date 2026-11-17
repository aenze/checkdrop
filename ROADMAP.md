# Roadmap

Current checkpoint: the Czech validation core, hosted shadow integration, onboarding, operator
dashboard/monitor, configurable assistance and public noindex website/live demo are deployed.
Read-only runtime rechecked 2026-09-17; see STATUS.md. Wider assistance still needs representative
evidence; self-service customer access is not active.

## M0 — Czech validation core

Status: implemented.

E-mail format and typo hints, Czech phone format, full-name checks, IČO and ARES, RÚIAN import,
address validation/autocomplete, source evidence, deterministic fixtures, and latency benchmarks.

## M1 — Internal API

Status: implemented.

Bounded Hono endpoints, manually provisioned pilot keys, redacted usage ledger, OpenAPI contract,
rate ceilings, timeouts, and fail-open provider behavior.

## M2 — Hosted shadow pilot

Status: deployed pilot; representative labeled customer outcomes remain a quality gate.

One origin-bound script tag loads versioned field mapping and measures configured checkout fields.
In shadow mode it never changes a value or blocks submit. The protected monitor decrypts full
values when encryption is configured, with masked fallbacks and a maximum 90-day retention.
Expired rows are excluded immediately; the daily cleanup removes them in bounded batches.

## M3 — Assist mode

Status: configurable runtime implemented; wider activation remains gated on representative evidence.

Configured fields support non-blocking name/e-mail guidance, customer-selected RÚIAN addresses and
ARES assistance. Valid Czech phones normalize silently without suggestion or acceptance events.
Other proposals retain explicit interaction outcomes. Deploying code does not activate these modes
or change existing field mappings.

## M4 — Product web

Status: public website and operator application deployed.

One shared Astro application contains the public website, login entry, onboarding, monitor, and
playground. The public page remains `noindex,nofollow`; model examples are distinct from opt-in
live validation. Public signup/customer login is not enabled.

## Open source 0.1.0 — run it yourself

Status: prepared, released with the public repository.

The same application for everyone: one-command installation on a server with Docker, administrator
accounts, automatic daily updates with backup and rollback, jobs inside each installation, Czech and
English administration, AGPL-3.0 server and administration, MIT core, country packs, checkout script and plugins. The hosted service runs
the same release images.

## M5 — Multi-tenant SaaS

Status: account/role/invitation and magic-link primitives prepared; customer HTTP/session access unfinished.

Signup and authentication, users, organizations, projects, roles, customer-managed API keys, audit
trails, retention controls, and transactional account e-mail. Add tenant isolation tests before
opening signup.

## M6 — Object storage and job queues

Status: planned after the SaaS ownership model exists.

Use an S3-compatible adapter such as Cloudflare R2 for files and a real queue abstraction for jobs.
Add streaming CSV processing, retry and idempotency policy, quotas, progress, expiry, and download
lifecycle. Do not restore PostgreSQL blobs or polling tables as the primary file queue.

## M7 — Billing

Status: planned.

Stripe test subscriptions, plans, entitlements, and reconciled usage billing only after organization
ownership and the internal usage ledger are proven. Cloudflare Email Sending can deliver billing and
account messages; inbound support routing remains a separate service.

## Explicitly deferred

- foreign address coverage and live VIES checks;
- a separate npm SDK unless a real custom-client requirement appears;
- plugin marketplaces or country-pack registries.
