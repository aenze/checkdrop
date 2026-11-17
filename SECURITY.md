# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability
reporting on this repository (Security → Report a vulnerability), or e-mail
support@checkdrop.dev with “security” in the subject.

Include the affected version (`./checkdrop status` shows it), the component, steps to reproduce, the
impact and any known mitigation. We confirm receipt within 3 working days and aim to ship a fix for
a confirmed high-severity issue within 14 days. Fixes reach every installation through the automatic
update; the release notes say when an update is security-relevant.

## Supported versions

Only the newest release receives fixes. Installations update automatically unless the operator
turned that off.

## How Checkdrop protects data

- Every installation has its own database; no data is sent to the Checkdrop project.
- Full values in the monitor are encrypted with AES-256-GCM and deleted after 90 days; logs and the
  usage ledger never contain raw e-mails, phones, addresses, company IDs, tokens or request bodies.
- Administrator passwords are stored as scrypt hashes, sessions as SHA-256 digests in an HttpOnly
  cookie; sign-in is same-origin only and rate limited.
- The web server checks the session before every administration page and admin API request; the
  internal operator key never reaches a browser.
- API keys are stored only as one-way verifiers. The shop's browser uses a public, origin-bound site
  identifier, never a secret.
- PostgreSQL is only reachable inside the installation's private Docker network.
- The server refuses to start with missing, short or sample secrets.

See [docs/architecture/security.md](docs/architecture/security.md) for the threat model.
