# Architecture overview

Request path: Caddy (`web`, HTTPS) → Hono server (`app`, port 8787) → PostgreSQL 18 (`postgres`).
Caddy serves the administration build and forwards `/v1/` and the administration API to the server.
The `jobs` service runs from the same image and handles scheduled work: the address import after
installation, the daily RÚIAN check, 90-day cleanup and expired sessions. `migrate` applies database
migrations before every start of the server. See [self-hosting.md](../self-hosting.md).

The validation core (`packages/core`) does not know about HTTP or databases. It defines the
`CountryPack` interface and the international e-mail rules. `@checkdrop/pack-cz` is the first country
pack: Czech e-mail providers, phone, IČO, DIČ and address normalization. The server picks a pack by
the request's country code (`apps/server/src/country-packs.ts`) and refuses a country without one.
`@checkdrop/db` owns the Kysely types and explicit SQL migrations. PostgreSQL stores RÚIAN, hashed
keys, versioned site configurations, administrator accounts, encrypted observations and checkout
events.

The page loads `/v1/embed.js` with a public site key. The script fetches the origin-bound site
configuration directly from the installation; no proxy, npm SDK or secret browser key is needed.
Fields have off, observe and suggest modes, and each field can optionally stop a submit whose
details make delivery impossible. Observing never changes a value. Network or provider failures do
not prevent the form from submitting.

Observations and checkout events are deleted after 90 days. Session and order references are stored
as HMACs; purchases reported by the browser are not payment confirmations. No AI model takes part in
validation.
