import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("pilot persistence", () => {
  it("stores only key verifiers and redacted M1 usage dimensions", () => {
    const migration = readFileSync(
      new URL("../migrations/0004_internal_api.sql", import.meta.url),
      "utf8",
    );
    const constraints = readFileSync(
      new URL("../migrations/0005_api_key_format_constraints.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS app.api_keys");
    expect(migration).toContain("verifier text NOT NULL");
    expect(migration).not.toMatch(/secret|raw_(?:input|value)|request_body/i);
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS app.usage_events");
    expect(migration).toContain("idempotency_key_hash text NOT NULL");
    expect(migration).toContain("UNIQUE (api_key_id, operation, idempotency_key_hash)");
    expect(constraints).toContain("api_keys_prefix_format");
    expect(constraints).toContain("api_keys_verifier_format");
  });

  it("adds bounded, redacted M2 shadow measurements", () => {
    const migration = readFileSync(
      new URL("../migrations/0006_shadow_measurements.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("integration_mode text NOT NULL DEFAULT 'api'");
    expect(migration).toContain("client_name text");
    expect(migration).toContain("duration_ms integer NOT NULL DEFAULT 0");
    expect(migration).toContain("integration_mode IN ('api', 'shadow')");
    expect(migration).toContain("duration_ms >= 0 AND duration_ms <= 300000");
    expect(migration).not.toMatch(/raw_(?:input|value)|request_body/i);
  });

  it("locks persisted pilot metadata to server-safe formats", () => {
    const migration = readFileSync(
      new URL("../migrations/0007_pilot_security_constraints.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("usage_events_request_id_format");
    expect(migration).toContain("usage_events_idempotency_hash_format");
    expect(migration).toContain("client_name !~* '^cdp_'");
    expect(migration).toContain("client_name ~ '[A-Za-z]'");
  });

  it("stores audit outputs with bounded retention instead of raw CSV uploads", () => {
    const migration = readFileSync(
      new URL("../migrations/0008_audit_imports.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS app.audit_imports");
    expect(migration).toContain("dataset jsonb NOT NULL");
    expect(migration).toContain("corrected_csv text NOT NULL");
    expect(migration).toContain("expires_at timestamptz NOT NULL");
    expect(migration).toContain("expires_at > created_at");
    expect(migration).not.toMatch(/raw_csv|source_csv|request_body/i);
  });

  it("adds a durable import queue and clears temporary source CSV data", () => {
    const migration = readFileSync(
      new URL("../migrations/0010_async_audit_imports.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("state text NOT NULL DEFAULT 'completed'");
    expect(migration).toContain("source_csv text");
    expect(migration).toContain("lease_token text");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS app.audit_import_rows");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS audit_imports_queue_idx");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS audit_import_rows_search_trgm");
    expect(migration).toContain("source_csv IS NULL");
    expect(migration).toContain("source_csv IS NOT NULL");
  });

  it("separates user imports from QA batches without deleting existing data", () => {
    const migration = readFileSync(
      new URL("../migrations/0012_audit_import_purpose.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("purpose text NOT NULL DEFAULT 'user'");
    expect(migration).toContain("SET purpose = 'test'");
    expect(migration).toContain("purpose IN ('user', 'test')");
    expect(migration).not.toContain("DELETE FROM app.audit_imports");
  });

  it("retains encrypted shadow observations for the authorized 90-day window", () => {
    const migration = readFileSync(
      new URL("../migrations/0013_shadow_observations.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS app.shadow_observations");
    expect(migration).toContain("input_preview text NOT NULL");
    expect(migration).toContain("proposed_preview text");
    expect(migration).toContain("expires_at <= created_at + interval '25 hours'");
    expect(migration).toContain("UNIQUE (api_key_id, operation, idempotency_key_hash)");
    expect(migration).not.toMatch(/raw_(?:input|value)|request_body/i);

    const retentionMigration = readFileSync(
      new URL("../migrations/0019_shadow_observation_retention_90d.sql", import.meta.url),
      "utf8",
    );
    expect(retentionMigration).toContain("shadow_observations_check1");
    expect(retentionMigration).toContain("interval '90 days'");
    expect(retentionMigration).toContain("SET expires_at = created_at + interval '90 days'");
    expect(retentionMigration).not.toMatch(
      /input_value\s+text|proposed_value\s+text|request_body/i,
    );
  });

  it("schedules value-free cleanup after the retention window", () => {
    const cleanupCli = readFileSync(
      new URL("../src/cleanup-shadow-observations-cli.ts", import.meta.url),
      "utf8",
    );
    const jobs = readFileSync(new URL("../../../apps/server/src/jobs.ts", import.meta.url), "utf8");
    const compose = readFileSync(new URL("../../../compose.yaml", import.meta.url), "utf8");

    expect(cleanupCli).toContain("DELETE FROM app.shadow_observations WHERE expires_at <= now()");
    expect(cleanupCli).not.toMatch(/input_value|proposed_value|request_body/i);
    // Every installation runs the daily cleanup in its own jobs service.
    expect(jobs).toContain("cleanup-shadow-observations-cli.js");
    expect(compose).toMatch(/\n  jobs:\n[\s\S]*command: \["node", "dist\/jobs.js"\]/);
  });

  it("allows masked address and company observations without widening retention", () => {
    const migration = readFileSync(
      new URL("../migrations/0014_shadow_address_company_operations.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("'address.validate'");
    expect(migration).toContain("'company_id.validate'");
    expect(migration).not.toMatch(/raw_(?:input|value)|request_body|expires_at/i);
  });

  it("adds bounded ciphertext columns for full operator-only shadow values", () => {
    const migration = readFileSync(
      new URL("../migrations/0018_encrypted_shadow_values.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("input_value_ciphertext text");
    expect(migration).toContain("proposed_value_ciphertext text");
    expect(migration).toContain("char_length(input_value_ciphertext) BETWEEN 20 AND 12000");
    expect(migration).not.toMatch(/input_value\s+text|proposed_value\s+text/i);
  });

  it("links customer assist decisions to the encrypted observation without duplicating PII", () => {
    const migration = readFileSync(
      new URL("../migrations/0020_assist_outcomes.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("assist_shown_at timestamptz");
    expect(migration).toContain("assist_outcome IN ('applied', 'kept', 'undone')");
    expect(migration).toContain("shadow_observations_project_assist_idx");
    expect(migration).toContain("shadow_observations_key_request_idx");
    expect(migration).not.toMatch(/email_value|phone_value|request_body|raw_input/i);
  });

  it("adds universal form roots, canonical company fields and bounded changed-field metadata", () => {
    const migration = readFileSync(
      new URL("../migrations/0023_universal_form_assistance.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("root_selector text NOT NULL DEFAULT 'body'");
    expect(migration).toContain("'first_name', 'last_name'");
    expect(migration).toContain("'company_name'");
    expect(migration).toContain("'profile_details_enabled'");
    expect(migration).toContain("'alternate_shipping_enabled'");
    expect(migration).toContain("assist_changed_fields text[]");
    expect(migration).toContain("DROP INDEX IF EXISTS app.integration_forms_match_idx");
    expect(migration).not.toMatch(/raw_input|request_body|password/i);
  });

  it("stores self-service integrations and structural form mappings without field values", () => {
    const migration = readFileSync(
      new URL("../migrations/0015_integrations_and_form_mapping.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS app.integrations");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS app.form_scans");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS app.integration_fields");
    expect(migration).toContain("detected_fields jsonb");
    expect(migration).toContain("validation_mode IN ('off', 'shadow', 'suggest', 'normalize')");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS integration_id");
    expect(migration).not.toMatch(/field_value|form_values|request_body|raw_input/i);
  });

  it("keeps structural configuration history for safe rollback", () => {
    const migration = readFileSync(
      new URL("../migrations/0016_integration_config_history.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS app.integration_config_versions");
    expect(migration).toContain("fields jsonb NOT NULL");
    expect(migration).toContain("PRIMARY KEY (integration_id, version)");
    expect(migration).toContain("jsonb_agg");
    expect(migration).not.toMatch(/field_value|form_values|request_body|raw_input/i);
  });

  it("separates multiple form profiles on one website without storing submitted values", () => {
    const migration = readFileSync(
      new URL("../migrations/0017_multi_form_sites.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS app.integration_forms");
    expect(migration).toContain("match_mode IN ('exact', 'prefix')");
    expect(migration).toContain("UNIQUE (integration_id, match_mode, path_pattern)");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS form_id");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS app.integration_form_config_versions");
    expect(migration).not.toMatch(/field_value|form_values|request_body|raw_input/i);
  });

  it("groups one checkout without storing the browser session identifier", () => {
    const migration = readFileSync(
      new URL("../migrations/0021_checkout_session_grouping.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("checkout_session_ref text");
    expect(migration).toContain("checkout_session_ref ~ '^[a-f0-9]{64}$'");
    expect(migration).toContain("shadow_observations_project_session_created_idx");
    expect(migration).not.toMatch(/session_id|session_uuid|browser_session|raw_session/i);

    const store = readFileSync(new URL("../src/shadow-observation.ts", import.meta.url), "utf8");
    expect(store).toMatch(/count\(DISTINCT \$\{caseKey\}\)/);
    expect(store).toMatch(/GROUP BY \$\{caseKey\}/);
    expect(store).toMatch(/array_position\(\$\$\{caseKeysIndex\}::text\[\], \$\{caseKey\}\)/);
    expect(store).toMatch(/'observation:' \|\| \$\{alias\}\.id/);
  });

  it("searches encrypted cases through bounded blind-index tokens", () => {
    const migration = readFileSync(
      new URL("../migrations/0022_shadow_observation_search.sql", import.meta.url),
      "utf8",
    );
    const store = readFileSync(new URL("../src/shadow-observation.ts", import.meta.url), "utf8");
    const backfill = readFileSync(
      new URL("../src/backfill-shadow-search-cli.ts", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("search_tokens text[]");
    expect(migration).toContain("USING gin (search_tokens)");
    expect(migration).toContain("cardinality(search_tokens) <= 256");
    expect(migration).not.toMatch(/customer_name|email_value|phone_value|raw_input/i);
    expect(store).toContain("search_observation.search_tokens @>");
    expect(store).toContain("createShadowObservationSearchIndex");
    expect(backfill).toContain("input_value_ciphertext");
    expect(backfill).not.toMatch(/process\.stdout\.write\([^)]*(?:value|ciphertext)/i);
  });
});
