# Changelog

Every release lists what changed for people running Checkdrop and whether it contains database
migrations. Installations update automatically; migrations run before the new server starts.

## 0.1.3 — 2026-11-18

- **ARES always answers.** When the company fields already match the register, the form shows
  “Údaje firmy odpovídají ARES” instead of nothing.
- **No stale company list.** A slower answer for a shorter IČO no longer covers the result for the
  finished one.
- Migrations: none.

## 0.1.2 — 2026-11-18

- **Company names from ARES** come with single spaces; ARES keeps the registry's double spaces, such
  as `ECOZZ  s.r.o.`, which were copied into forms.
- **Name reminder** no longer mentions delivery (“Doplňte jméno i příjmení.”), so it fits any form,
  not only a checkout.
- Migrations: none.

## 0.1.1 — 2026-11-17

- **Separate API address.** `CHECKDROP_PUBLIC_API_URL` and `CHECKDROP_PUBLIC_ADMIN_URL` in `.env`
  give the API that shops embed and the administration different public addresses, for an
  installation behind its own proxy. Without them nothing changes: both use `CHECKDROP_PUBLIC_URL`.
- **First sign-in** says where the one-time setup code comes from (`./checkdrop setup-code`).
- Migrations: none.

## 0.1.0 — 2026-11-17

First open source release.

- **Run it yourself.** `install.sh` and `./checkdrop` install one installation on a server with
  Docker: secrets generated, HTTPS certificate, database, server, administration and jobs.
- **Automatic updates.** Daily check of the newest release, backup, update, health check and
  rollback; the administration shows the version and the result.
- **Administrator accounts.** Sign-in with e-mail and password, first account created with a
  one-time setup code, password reset on the server.
- **Czech and English.** The administration in both languages; the checkout script follows the
  shop page's language.
- **Same application everywhere.** Public addresses come from configuration; the administration and
  the marketing website are built separately.
- **Jobs inside the installation.** Czech addresses download right after installation and update
  monthly; old observations and sessions are cleaned up daily.
- **Foreign address warning** for shops that deliver only within Czechia.
- Migrations: `0030`–`0033` (domestic address flag, admin accounts, instance jobs).


## 2026-09-08 — světlá a kompaktní administrace

Nasazeno jako webová verze `8584990`. [Poznámky k vydání](docs/releases/2026-09-08-admin.md).

- Nový dashboard se souhrny za vybrané období, napojenými weby a přechodem do odpovídajícího monitoru nebo nastavení.
- Kompaktnější navigace, odlišené sekce a řádky monitoru 46 px místo 62 px. Ve srovnávacím náhledu při 1440 × 900 je vidět 12 celých záznamů místo 8.
- Boční detail případu s evidencí oprav a časovou osou košíku; Escape vrací fokus na záznam.
- Sbalitelné editory polí napojení a prázdné vstupy pro vlastní ověření e-mailu, telefonu a adresy. Telefon nabízí normalizovaný formát pod polem, zachovává zadaný text.
- Mobilní spodní navigace, sbalitelné filtry, přizpůsobený detail a celé popisky metrik i u velkých čísel.

Všechny čtyři agendy ověřeny na produkci na desktopu a mobilu. CI prošla; lokálně 276 úspěšných testů a 8 přeskočených databázových testů. Backend, databázové schéma a nastavení integrací beze změny. Zákaznické přihlášení a WordPress integrace do tohoto vydání nepatří.

## 2026-08-15 — pre-pilot security and provider readiness

- Bounded direct API JSON before parsing and added application/proxy request ceilings.
- Made request correlation server-generated and proxy telemetry attribution trusted configuration.
- Replaced global idempotency SHA-256 with key-scoped request-bound HMAC material.
- Added DNS deadlines, bounded provider response bodies, remote HTTPS enforcement, database
  metadata constraints, and Docker build-context secret exclusions.
- Recorded current Czech provider evidence and the controlled M2 staging/rollback runbook.

At this stage, the project had not made a public release. The entries below preserve the original pre-pilot development notes.

## Unreleased

### Added

- Replaced the early Worker/D1 split with a validation-first Node.js/PostgreSQL modular monolith.
- Added country-independent policy/email primitives and a versioned Czech pack for email, phone,
  IČO, and address normalization.
- Added a Node CLI/server foundation, PostgreSQL `pg_trgm` migration, OpenAPI contract, and local
  Compose infrastructure.
- Added an Astro/React Czech review-flow prototype with source-aware evidence, interactive
  corrections, and browser-backed visual QA against the selected design.
- Added operator-managed hashed pilot keys, authenticated e-mail and phone endpoints, OpenAPI
  examples, and an idempotent redacted PostgreSQL usage ledger for the M1 Internal API.
- Added the `@checkdrop/sdk` JavaScript/TypeScript client, non-mutating shadow form observer,
  client/server timing, and bounded shadow measurement dimensions.
- Added the responsive `/shadow-pilot` integration demo and documented the same-origin proxy trust
  boundary that keeps pilot keys out of browser code.
- Added a server-only Fetch-compatible same-origin proxy handler with an exact route/header
  allow-list, bounded request bodies, trusted key injection, timeouts, and redacted failure output.

### Changed

- Refined the review canvas with button-based acceptance, aligned icon containers, equal-height
  desktop evidence cards and field rows, equal-height mobile field cards, compact reason controls,
  and responsive mobile states.
- Increased the contrast of small secondary metadata while preserving the approved dark visual
  direction.
