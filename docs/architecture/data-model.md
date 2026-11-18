# Data model progression

## Reference data

- `reference_cz.dataset_versions`: source version, effective time, checksum, row count, activation
  state.
- `reference_cz.addresses`: RÚIAN address parts and deterministic search columns indexed with
  `pg_trgm`.
- `reference_cz.addresses_active`: the single active source version.

The importer stages and validates a snapshot before one transaction activates it. A failed import
never replaces active data.

## Application data

- `app.api_keys`: API keys created in the administration, with prefix, one-way verifier, project
  ownership and lifecycle state. Full keys are never persisted.
- `app.usage_events`: idempotent operation metadata, units, result class, bounded client metadata,
  duration, and a key-scoped HMAC. It does not store the validated value or request body.
- `app.integrations` and mapping history: origin, site identifier, state, form `root_selector`, field
  selectors, validation mode/trigger, and rollback versions. Multiple profiles may match one path
  when they have distinct roots, for example checkout, registration modal, billing, and shipping.
- `app.shadow_observations`: AES-256-GCM encrypted input/proposal values, masked legacy fallbacks,
  technical evidence, and the customer's shown/applied/kept/undone assist outcome for the
  monitor. The outcome points to the same concrete encrypted e-mail or phone observation,
  so the administrator sees who acted without duplicating plaintext PII. Rows are project-isolated and
  expire after 90 days. Atomic address/company assistance also stores a bounded allowlist of changed
  field names, not another plaintext payload. The encryption key is stored outside PostgreSQL.
- `app.admin_users`, `app.admin_sessions`: administrator accounts and their sessions.
- `app.instance_jobs`: state of the installation's scheduled jobs.

## Legacy audit tables

Migrations `0008` and `0010`–`0012` created an early PostgreSQL CSV/job implementation. Its
runtime, API, worker, and UI are removed. The migrations remain immutable so existing databases can
continue forward safely. Dropping unused tables requires a new forward migration after backup and
production usage verification.

## Later

If batch file processing is added, files go to object storage with a real queue lifecycle;
PostgreSQL must not again be the primary file blob and polling queue.
