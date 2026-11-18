# Checkdrop HTTP API

Every installation serves the API under `https://<your-installation>/v1/`. The source contract is
`packages/contracts/openapi.yaml`. Most forms do not call the API directly: the embed script
(`/v1/embed.js`) does it for them. Direct calls are for server-to-server integrations.

## Endpoints

| Method | Path                         | Authentication                       | Purpose                                                      |
| ------ | ---------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| `GET`  | `/v1/health`                 | none                                 | Process health and running release                           |
| `GET`  | `/v1/capabilities`           | none                                 | Published capabilities and their maturity                    |
| `POST` | `/v1/names/validate`         | `X-Checkdrop-Key`                    | Full name, titles, safe formatting                           |
| `POST` | `/v1/emails/validate`        | `X-Checkdrop-Key`                    | Syntax, normalization, domain typos, DNS/MX                  |
| `POST` | `/v1/phones/validate`        | `X-Checkdrop-Key`                    | Czech phone format and normalization                         |
| `POST` | `/v1/addresses/validate`     | `X-Checkdrop-Key`                    | Address completeness and match with RÚIAN                    |
| `POST` | `/v1/addresses/autocomplete` | `X-Checkdrop-Key`                    | Czech address suggestions from the local RÚIAN copy          |
| `POST` | `/v1/company-ids/validate`   | `X-Checkdrop-Key`                    | IČO format, checksum and ARES                                |
| `POST` | `/v1/companies/autocomplete` | `X-Checkdrop-Key`                    | Czech company search by name or exact IČO                    |
| `POST` | `/v1/assist/interactions`    | `X-Checkdrop-Key` or public site key | Shown, applied, kept or undone outcome of one suggestion     |
| `POST` | `/v1/checkout/events`        | public site key                      | Form progress events ([details](../checkout-measurement.md)) |

Administration routes are not part of the public API. An unknown path returns `404`.

## Common rules

- API keys are created per site in the administration and shown once. Keep them on your server;
  never put them in a browser, HTML, URL, cookie or tag manager. The embed script uses only the
  public site key and the page's origin.
- JSON bodies are limited to 8 KiB; responses use `Cache-Control: no-store`.
- `Idempotency-Key` is 1–128 characters. Without it the server uses its own request ID.
- `Server-Timing: checkdrop;dur=…` reports the API's processing time.
- A timeout, `429`, `5xx`, an invalid response or an unavailable source must never block the form.
- Only `country: "CZ"` is accepted so far.

## Names

The name check keeps first name, surname, initials and known titles. It fixes spacing and
unambiguous capitalization, for example `MUDr.Michal POřický` → `MUDr. Michal Pořický`, and keeps
hyphens, apostrophes and particles (`Anna-Marie Dvořáková`, `Jean O'Neill`, `Ludwig van Beethoven`).
It never adds missing diacritics or guesses the spelling of an unknown name: unusual mixed case is
`risky` without a suggestion; digits, emoji and broken separators are `invalid`. Titles do not count
as a name, so `MUDr. Novák` stays incomplete. A form can use one `full_name` field or separate
`first_name` and `last_name` fields.

## Companies (ARES)

`POST /v1/companies/autocomplete` takes a query of at least three characters and returns at most
five companies. Names are searched in ARES; an exact eight-digit IČO uses the same check as
`/v1/company-ids/validate`. ARES cannot search by a partial IČO, so a numeric prefix can only match
a company the server has recently loaded. Both operations return the same `company` object with
name, normalized IČO, optional DIČ and structured registered address.

In a form, choosing a company fills only the mapped company and billing fields as one step that can
be undone; the delivery address is never changed. Timeouts or ARES outages change nothing.

## Address autocomplete

Autocomplete uses the installation's local RÚIAN copy; the query is not sent to any third party.

```http
POST https://<your-installation>/v1/addresses/autocomplete
Content-Type: application/json
X-Checkdrop-Key: <server-side key>
X-Checkdrop-Client: example-shop-checkout/1.0
Idempotency-Key: <random request ID>
```

```json
{ "query": "Dlouhá 1 Praha", "country": "CZ", "limit": 6 }
```

Response:

```json
{
  "object": "address_suggestion_list",
  "request_id": "…",
  "status": "matched",
  "country": "CZ",
  "suggestions": [
    {
      "id": "21725721",
      "label": "Dlouhá 928/1, Staré Město, 110 00 Praha 1",
      "street_line": "Dlouhá 928/1",
      "street": "Dlouhá",
      "house_number": "928",
      "orientation_number": "1",
      "city": "Praha",
      "city_part": "Staré Město",
      "postal_code": "11000"
    }
  ],
  "evidence": [
    { "source": "ruian", "checked_at": "…", "state": "confirmed", "detail": "ruian.snapshot.…" }
  ]
}
```

`status` is `matched` (at least one suggestion), `no_match` (RÚIAN available, nothing found) or
`unavailable` (the local source is temporarily unavailable; continue without suggestions).

If you build your own form integration: query after at least three characters and 250–350 ms
without typing, cancel the previous request, show at most six suggestions accessibly, fill fields
only after the person picks one, use `street_line`, `city` and `postal_code` instead of parsing
`label`, and leave manual input untouched on errors.

## E-mail

The e-mail check covers syntax and domain normalization, common domain typos, selected disposable
domains and role addresses (`info@`, `support@`), and a real DNS lookup of MX and address records
with a two-second deadline. If DNS cannot be evaluated safely, the result is `unknown` and the form
continues. It does not prove that a mailbox exists or belongs to the person.

A known typo returns `status: "correctable"`, the code `email.domain_typo` and the full corrected
address in `suggestion`. Only known variants of common providers are corrected, so a less common but
correct company domain is never changed:

| Correct domain | Recognized typos (examples)                                                |
| -------------- | -------------------------------------------------------------------------- |
| `gmail.com`    | `gmil.com`, `gmial.com`, `gmeil.com`, `gmelj.com`, `gamil.com`, `gmail.co` |
| `seznam.cz`    | `sezman.cz`, `sezam.cz`, `sznam.cz`                                        |
| `email.cz`     | `emial.cz`, `emai.cz`                                                      |
| `centrum.cz`   | `centum.cz`, `cenrum.cz`                                                   |
| `outlook.com`  | `outlok.com`, `outllok.com`                                                |
| `hotmail.com`  | `hotmial.com`, `hotmal.com`                                                |
| `yahoo.com`    | `yaho.com`, `yahoo.co`                                                     |
| `icloud.com`   | `iclud.com`, `iclou.com`                                                   |

```json
{ "email": "jan.novak@gmil.com", "policy": "assist" }
```

| Code                      | Meaning                                  |
| ------------------------- | ---------------------------------------- |
| `email.syntax_invalid`    | Invalid syntax                           |
| `email.domain_typo`       | Known likely domain typo                 |
| `email.domain_no_dns`     | The domain has no usable DNS record      |
| `email.domain_no_mx`      | No MX record; the address record is used |
| `email.domain_disposable` | Known disposable domain                  |
| `email.local_role`        | Shared role address instead of a person  |

## The embed script

`<script src="https://<your-installation>/v1/embed.js" data-checkdrop-site="…">` loads the site's
field mapping from the installation, so changes in the administration apply without touching the
page. Each mapped field is set separately: off, observe only, or suggest; fields with suggestions
can also stop a submit whose details make delivery impossible. Suggestions change a value only after
the person confirms them; a valid Czech phone number is formatted while typing and can be restored
with one click. Names, e-mails and phones are checked when the field is left; addresses and
companies are suggested while typing.

One page can define several forms, each with its own `root_selector`. Billing and shipping fields
are separate groups; RÚIAN and ARES never copy values between them. Passwords, newsletter and
consent fields are never mapped or sent. Shown suggestions and their outcome are stored with the
encrypted observation and kept for 90 days.

## Errors

| HTTP  | What to do                                   |
| ----- | -------------------------------------------- |
| `400` | Contract error; fix the integration          |
| `401` | Missing or invalid API key                   |
| `413` | Body larger than 8 KiB                       |
| `415` | The request is not `application/json`        |
| `429` | Respect `Retry-After`; do not block the form |
| `503` | Temporarily unavailable; fail open           |

## Not included

- Foreign addresses.
- Proof that a specific mailbox exists.
- Whether a phone number is active on a network.
- Changing data without the person's decision.
