# ADR-0011: Open source, one application for every installation

Status: accepted by the owner on 17 November 2026. Supersedes ADR-0008.

## Decision

- Checkdrop is published as open source in full, with no open-core split: there is no closed or
  paid-only feature. What is paid is the service: installation, operation, data maintenance and
  support by ECOZZ s.r.o., which operates Checkdrop (Aenze is the brand).
- The server, administration, database layer and installation tools are AGPL-3.0-only. The
  validation core (`packages/core`), country packs, the hosted checkout script, the API contract and
  plugins are MIT, so everything that runs inside a shop or is embedded elsewhere is permissive.
- The public repository is `aenze/checkdrop` under the Aenze organisation. Copyright: ECOZZ s.r.o.
  and Checkdrop contributors. The name and logo belong to Aenze s.r.o.
- Contributions are accepted under the licence of the package they change (inbound = outbound),
  without a CLA. Consequence: contributed code cannot later be relicensed by Aenze alone.
- Every installation runs the same release images, including the hosted service at checkdrop.dev.
  Installations differ only in data, connections and `.env`. The marketing website is built
  separately (`CHECKDROP_WEB_TARGET=site`) and is not part of an installation.
- Administrator accounts with passwords are the default sign-in. An access proxy (`external`) is an
  exception for installations that already authenticate every request.
- Installations update themselves daily from GitHub releases: backup, verified files, migrations
  first, health check, rollback. Migrations only add, so a rolled-back server keeps working.
- Scheduled work (address data, retention cleanup) runs in each installation's jobs service.
- National data is never redistributed; each installation downloads it from the source.

## Why

Shops want their customer data on their own infrastructure, and selling deployment and data
maintenance fits better than selling access. One application avoids two products drifting apart.
The AGPL keeps improvements of hosted forks public; MIT keeps plugins embeddable in shops of any
licence.

## Consequences

- Public issues, security reports and releases need a maintained process (SECURITY.md).
