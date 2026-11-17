# Contributing

Thank you for helping. Issues and pull requests are welcome in Czech or English.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Security problems go through [SECURITY.md](SECURITY.md), never a public issue.
- Checkdrop is maintained by a small team; we answer issues within a few working days.

## Development

Node.js 24 and pnpm 10 (`corepack enable`).

```bash
pnpm install --frozen-lockfile
pnpm run ci          # format, lint, types, tests, build
./checkdrop install --local   # the whole installation on http://localhost:8080 (needs Docker)
```

## Rules

- Change the OpenAPI contract in `packages/contracts` with any public API change.
- Add tests for every decision, issue code and failure mode; keep the checkout fail-open.
- Never log raw e-mails, phone numbers, addresses, company IDs, tokens or request bodies.
- Use invented values in fixtures and tests, never real customer data.
- Migrations only add: a released server must keep working on the next schema, because updates
  migrate first and roll back the application if the new version is unhealthy.
- Administration texts are written as Czech and English pairs with `t(cs, en)`; server messages for
  the administration with `msg(context, cs, en)`.
- Keep UI changes compact and verify them at desktop and mobile widths.

By contributing you agree that your contribution is licensed under the licence of the package you
change (AGPL-3.0 or MIT, see the `LICENSE` files).
