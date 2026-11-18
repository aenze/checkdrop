# ADR-0001: Validation-first modular monolith

Status: Accepted on 2026-08-15.

Context: written for the 2026 hosted pilot; ADR-0011 describes the current setup.

## Decision

The Czech pilot runs one Node.js/Hono application and one PostgreSQL database behind Caddy and
Cloudflare. Background work eventually uses the same image with a different command. An
S3-compatible object store and PostgreSQL-backed queue are introduced only when batch workflows
exist.

Cloudflare Workers, D1, Queues, Workflows, Durable Objects, Hyperdrive, OpenSearch, Redis, PostGIS,
Kubernetes, and runtime country-pack plugins are not pilot dependencies.

## Why

The main uncertainty is validation accuracy and customer value, not global infrastructure. One
database permits transactions, simpler deletion, one backup system, direct reporting, and local
parity. PostgreSQL `pg_trgm` gets a measured opportunity before another search engine is considered.

## Growth boundary

Add a system only after a measured bottleneck or isolation requirement identifies its owner,
failure mode, operating cost, and removal plan.
