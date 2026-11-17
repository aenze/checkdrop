# Architecture overview

Updated 2026-09-17. [Runtime evidence](../operations/runtime-2026-09-17.md) separates observed state
from repository-only capability.

Main request path: Cloudflare proxy/security → host Nginx → server-local Caddy web container
(`127.0.0.1:14371` → `8080`) → Hono application (`8787`) → PostgreSQL 18. Nginx separates the public
website, Access-protected operator host and allow-listed API host. The main runtime is on a dedicated Linux server,
not Cloudflare Workers. Caddy serves the Astro/React build and proxies supported API routes.

The validation core does not know about HTTP or databases. It defines the `CountryPack` interface
and the international e-mail rules. `@checkdrop/pack-cz` is the first country pack: Czech e-mail
providers, phone, IČO, DIČ and address normalization. The server picks a pack by the request's
country code (`apps/server/src/country-packs.ts`) and refuses a country without one. `@checkdrop/db`
owns Kysely types and explicit SQL migrations. PostgreSQL stores RÚIAN, hashed keys, versioned
integrations, encrypted observations, blind search indexes and checkout events. Account/role/
invitation/magic-link primitives are in the repository; customer access is not active and production
account migrations were not checked in this review. The worker will use the same application image
and packages when background jobs become necessary.

The hosted `/v1/embed.js` loads origin-bound public-site configuration directly from the API; no
integrator proxy, npm SDK or secret browser key is required. Fields have off/shadow/suggest modes.
Shadow does not mutate values. Assistance can format valid Czech phones, offer explicit e-mail
corrections, fill customer-selected RÚIAN addresses, show name guidance and offer ARES companies.
The existing explicit complete-name submit guard is separate from non-blocking delivery-name hints.
Network/provider failures do not prevent checkout.

The operator application uses server-injected credentials behind Cloudflare Access. Its shared
proxy is not a customer-session boundary and must not be exposed simply by relaxing Access.
The public own-input demo uses a separate server-held key and narrow same-origin endpoints; it
does not create shadow observations. Automatic model examples do not perform live validation.

Observations and checkout events have a 90-day lifecycle. Session/order references use HMAC;
browser-reported purchases are not server confirmation or payment evidence. Cloudflare R2 already
stores operational PostgreSQL backups, independently of future customer file storage. Scheduled
operations handle backups, RÚIAN updates and expired-observation cleanup.

Inbound Cloudflare Email Routing is separate from outbound Email Sending. Sending/magic-link
primitives are prepared but not connected to customer HTTP/session login. Customer file storage,
job queues and billing are not implemented. No AI model participates in synchronous validation.
