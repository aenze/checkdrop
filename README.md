# Checkdrop

Catch a wrong e-mail, phone, address or company ID right in the form, before it becomes a returned
parcel, an undelivered invoice or a lost lead.

Checkdrop checks a form while people fill it in, whether it is a checkout, an inquiry, an
application or a sign-up: e-mail domain typos (`gmil.com` →
`gmail.com`), Czech phone numbers (`+420 777 123 456`), real Czech addresses from the official
RÚIAN register, company details from ARES by IČO, and addresses that do not belong in a shop that
delivers only within Czechia. The customer confirms each fix with one click. You choose field by field
whether Checkdrop only suggests, or also stops an order whose details would make delivery
impossible. If Checkdrop itself is unavailable, the checkout works exactly as before.

[Česky](README.cs.md) · [Install](INSTALL.md) · [checkdrop.dev](https://checkdrop.dev)

## Run it yourself

You need one Linux server with Docker and a domain name pointing to it.

```bash
curl -fsSL https://raw.githubusercontent.com/aenze/checkdrop/main/install.sh \
  | sudo bash -s -- --domain checks.example.com
```

The installer generates every secret, starts the database, the server, the administration and the
scheduled jobs, gets an HTTPS certificate and prints a one-time setup code. Open
`https://checks.example.com/sign-in`, create the administrator account with the code, add your
website and paste one script tag into the page with the form.

**Give it to your AI agent.** [INSTALL.md](INSTALL.md) is written for AI agents such as Claude Code
or Codex: give the agent that link and access to your server; it installs Checkdrop there, checks the
result and hands you the setup code. Nothing is sent to us.

|             |                                                                                |
| ----------- | ------------------------------------------------------------------------------ |
| Server      | 2 CPU, 4 GB RAM, 20 GB disk, Linux with Docker Engine and Compose v2           |
| First start | about 1 minute, then Czech addresses download in the background (5–15 minutes) |
| Updates     | automatic and daily: backup, update, health check, rollback if anything fails  |
| Languages   | Czech and English administration; the form script follows the page's language  |

Try it on your own computer first: `./checkdrop install --local` in a clone of this repository, then
open <http://localhost:8080> (details in [INSTALL.md](INSTALL.md#trying-it-on-your-own-computer-instead)).

## Or let us do it

We deploy Checkdrop on your server or a European host you choose, connect your forms and set up the
fields; on request we also run it for you. One-off, from CZK 9,900 excl. VAT depending on the
integration. [checkdrop.dev](https://checkdrop.dev/#contact)

## How it works

- **One script tag** on the page loads the field mapping you set in the administration. No npm
  package, no secret key in the browser, no changes to the website's code.
- **Start with monitoring.** New fields only observe; the monitor shows what Checkdrop would have
  caught. Turn on suggestions field by field when you trust them.
- **Your data stays with you.** Each installation runs on your server with its own database and
  sends form data nowhere. Full values in the monitor
  are encrypted and deleted after 90 days.
- **Same application everywhere.** The hosted service at checkdrop.dev runs the same release images
  as every self-hosted installation; only data and connections differ.

| Field           | What Checkdrop checks                                                            | Source                        |
| --------------- | -------------------------------------------------------------------------------- | ----------------------------- |
| E-mail          | domain typos, whether the domain and its mail (MX) exist, disposable mailboxes   | list of common typos, DNS     |
| Phone           | valid Czech number, one format with the country code                             | rules for Czech numbers       |
| Address         | a real address point, postal code and number completion, address outside Czechia | local copy of RÚIAN from ČÚZK |
| IČO and company | the company exists, name, DIČ and registered address filled in                   | ARES                          |
| Name            | first name and surname, capitalization, titles                                   | rules for Czech names         |

## Repository

| Path                                      | What it is                                                    | Licence  |
| ----------------------------------------- | ------------------------------------------------------------- | -------- |
| `apps/server`                             | API, administration API, jobs                                 | AGPL-3.0 |
| `apps/server/src/embed-script.ts`         | Hosted checkout script that runs in the shop page             | MIT      |
| `apps/web`                                | Administration (`app`) and the checkdrop.dev website (`site`) | AGPL-3.0 |
| `packages/core`                           | Validation policy, e-mail and name rules                      | MIT      |
| `packages/db`                             | PostgreSQL, migrations, RÚIAN import and search               | AGPL-3.0 |
| `packages/pack-cz`                        | Czech rules: addresses, phones, IČO, DIČ, texts               | MIT      |
| `packages/contracts`                      | OpenAPI contract and generated types                          | MIT      |
| `integrations/wordpress`                  | WordPress plugin                                              | MIT      |
| `checkdrop`, `compose.yaml`, `install.sh` | Installation, updates, backups                                | AGPL-3.0 |

Development needs Node.js 24 and pnpm 10:

```bash
pnpm install --frozen-lockfile
pnpm run ci
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and
[docs/self-hosting.md](docs/self-hosting.md).

## Data and licences

The server, administration, database layer and installation tools are licensed under the
[GNU Affero General Public License v3.0](LICENSE). The validation core, country packs, the checkout
script that runs in your shop, the API contract and the WordPress plugin are MIT (see the `LICENSE`
file in each). If you offer a
modified Checkdrop to others over a network, the AGPL requires you to publish your changes.

Address data © ČÚZK, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Each installation
downloads it directly from ČÚZK; it is not part of this repository. Company data comes live from
ARES. See [DATA_SOURCES.md](DATA_SOURCES.md).

Checkdrop is an Aenze project. The name “Checkdrop” and its logo belong to Aenze s.r.o.; the licences cover the code, not the name.
