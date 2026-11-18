# Security boundaries

What an installation protects: the customer values typed into forms, the administrator accounts,
the secrets in `.env` and the database.

## Network

- Caddy (`web`) is the only service with host ports (80 and 443, or one local port behind another
  proxy). It terminates HTTPS and forwards to the server (`app`).
- PostgreSQL runs only on the internal compose network `database`; it has no host port.
- Containers run read-only, without Linux capabilities and with `no-new-privileges`.

## Administration

- Default sign-in is an administrator account with e-mail and password. Caddy checks the session
  with `forward_auth` before it serves the administration or the administration API.
- The first account is created with a one-time setup code printed by the installer.
- `CHECKDROP_ADMIN_AUTH=external` turns the password sign-in off for installations behind an access
  proxy that authenticates every request. Use it only when nothing reaches Caddy around that proxy.

## Secrets

- The installer generates the database password, operator token, internal API key, embed signing
  secret, observation encryption key and setup code into `.env` with mode 600. Caddy adds the
  operator token and internal key to administration requests on the server side. They are never printed, except the setup
  code, which a person needs.
- Backups (`backups/`, mode 700) contain the database dump and a copy of `.env`; protect them like
  `.env`.
- API keys are shown once and stored only as one-way verifiers.

## Form data

- The page embeds one script tag with a public site key. The script loads a configuration bound to
  the site's allowed origins; no secret is ever sent to the browser.
- New fields only observe. Suggestions change a value only after the person confirms them, except
  formatting a valid Czech phone number, which can be undone with one click. Stopping a submit
  whose details make delivery impossible is a per-field setting that the administrator turns on.
- If Checkdrop does not answer in time, or any request fails, the form submits as before.
- Full values shown in the monitor are encrypted per value (AES-256-GCM, bound to the observation and
  field) with a key kept outside PostgreSQL. Observations and checkout events are deleted after
  90 days by the `jobs` service.
- Logs use field allow-lists and never contain request bodies, typed values, keys or sessions.
- Request bodies are size-limited before parsing, requests are rate-limited, and every external
  source (ARES, DNS, ČÚZK) has a timeout and reports `unknown` instead of failing the form.

Report vulnerabilities as described in [SECURITY.md](../../SECURITY.md).
