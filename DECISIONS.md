# Decisions

| ID       | Decision                                                                                                                                                                                                      | Status              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| ADR-0001 | Node.js modular monolith on one PostgreSQL database ([details](docs/adr/0001-modular-monolith.md))                                                                                                            | Accepted            |
| ADR-0011 | Open source without open-core: one application for every installation, AGPL server, MIT core, packs, checkout script and plugins, automatic updates ([details](docs/adr/0011-open-source-one-application.md)) | Accepted 2026-11-17 |

Earlier decisions (ADR-0002 to ADR-0010) were made during private development and are not
published. ADR-0011 supersedes ADR-0008, which kept self-hosting for later.

Deferred until there is a measured need: object storage for files, job queues, Redis, PostGIS,
OpenSearch, multi-region operation, public signup and billing.
