# Changelog

Every release lists what changed for people running Checkdrop and whether it contains database
migrations. Installations update automatically; migrations run before the new server starts.

## 0.1.5 — 2026-11-18

- **Licences:** the MIT licences name ECOZZ s.r.o., which operates Checkdrop, as the copyright
  holder. The name and logo stay with Aenze s.r.o.
- Migrations: none.

## 0.1.4 — 2026-11-18

- **Clearer messages.** API errors and the administration no longer mention a pilot; the monitor
  is called “Monitor” everywhere.
- **Updated components:** Caddy 2.11.9 in the web image, current dependencies.
- **Documentation** describes the product as it runs today: security, architecture, API, moving to
  a new server, error codes of the installer.
- Migrations: none.

## 0.1.3 — 2026-11-18

- **ARES always answers.** When the company fields already match the register, the form shows
  “Údaje firmy odpovídají ARES” instead of nothing.
- **No stale company list.** A slower answer for a shorter IČO no longer covers the result for the
  finished one.
- Migrations: none.

## 0.1.2 — 2026-11-18

- **Company names from ARES** come with single spaces; ARES keeps the registry's double spaces, such
  as `Example  s.r.o.`, which were copied into forms.
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

## Before 0.1.0

Checkdrop was developed privately before the first open source release.
