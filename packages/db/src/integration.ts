import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { interactivePoolOptions } from "./interactive-pool.js";
import type { CreatePilotApiKeyInput } from "./pilot.js";

export type IntegrationEnvironment = "test" | "live";
export type IntegrationState = "draft" | "scanned" | "configured" | "shadow" | "paused";
export type IntegrationFormState = "draft" | "scanned" | "configured" | "paused";
export type IntegrationFormMatchMode = "exact" | "prefix";
export type CanonicalFormField =
  | "customer_type"
  | "full_name"
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "street_line"
  | "city"
  | "postal_code"
  | "country"
  | "company_id"
  | "company_name"
  | "vat_id"
  | "profile_details_enabled"
  | "alternate_shipping_enabled"
  | "unmapped";
export type FormFieldContext = "billing" | "shipping" | "company" | "shared";
/**
 * `suggest` is deliberately limited by the operator API to non-blocking name/e-mail guidance,
 * silent safe Czech phone formatting, and customer-confirmed RÚIAN address selection.
 */
export type FieldValidationMode = "off" | "shadow" | "suggest";
export type FieldValidationTrigger = "input" | "blur" | "submit";

export interface IntegrationField {
  readonly id: string;
  readonly sourceSelector: string;
  readonly sourceLabel: string;
  readonly sourceName: string | null;
  readonly canonicalField: CanonicalFormField;
  readonly context: FormFieldContext;
  readonly conditionKey: string | null;
  readonly required: boolean;
  readonly requireCompleteName?: boolean;
  readonly requireDomesticAddress?: boolean;
  readonly requireValidPhone?: boolean;
  readonly fillVillageStreet?: boolean;
  readonly submitSelector?: string | null;
  readonly validationMode: FieldValidationMode;
  readonly validationTrigger: FieldValidationTrigger;
  readonly confidence: number | null;
  readonly detected: boolean;
}

export interface IntegrationApiKeySummary {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly environment: IntegrationEnvironment;
  readonly state: "active" | "revoked";
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface IntegrationActivity {
  readonly lastKeyUsedAt: Date | null;
  readonly observationCount24h: number;
  readonly lastObservationAt: Date | null;
}

export interface IntegrationConfigVersionSummary {
  readonly version: number;
  readonly fieldCount: number;
  readonly createdAt: Date;
}

export interface IntegrationFormRecord {
  readonly id: string;
  readonly integrationId: string;
  readonly name: string;
  readonly formUrl: string;
  readonly matchMode: IntegrationFormMatchMode;
  readonly pathPattern: string;
  readonly rootSelector?: string;
  readonly state: IntegrationFormState;
  readonly configVersion: number;
  readonly isDefault: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly fields: readonly IntegrationField[];
}

export interface IntegrationRecord {
  readonly id: string;
  readonly projectRef: string;
  readonly name: string;
  readonly clientName: string;
  readonly environment: IntegrationEnvironment;
  readonly formUrl: string;
  readonly state: IntegrationState;
  readonly configVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly fields: readonly IntegrationField[];
  readonly forms: readonly IntegrationFormRecord[];
  readonly apiKeys: readonly IntegrationApiKeySummary[];
  readonly activity: IntegrationActivity;
}

export interface CreateIntegrationInput {
  readonly id: string;
  readonly projectRef: string;
  readonly name: string;
  readonly clientName: string;
  readonly environment: IntegrationEnvironment;
  readonly formUrl: string;
  readonly initialFormName?: string;
  readonly createdAt: Date;
}

export interface CreateIntegrationFormInput {
  readonly id: string;
  readonly integrationId: string;
  readonly projectRef: string;
  readonly name: string;
  readonly formUrl: string;
  readonly matchMode: IntegrationFormMatchMode;
  readonly pathPattern: string;
  readonly rootSelector?: string;
  readonly createdAt: Date;
}

export interface SaveIntegrationFieldInput extends IntegrationField {}

export interface SaveFormScanInput {
  readonly id: string;
  readonly integrationId: string;
  readonly formId: string;
  readonly projectRef: string;
  readonly sanitizedUrl: string;
  readonly state: "completed" | "failed";
  readonly detectedFields: readonly unknown[];
  readonly errorCode: string | null;
  readonly createdAt: Date;
}

export class IntegrationVersionConflict extends Error {
  constructor() {
    super(
      "Konfiguraci mezitím změnil jiný uživatel. Načtěte aktuální verzi; rozpracované změny zůstávají zachované.",
    );
    this.name = "IntegrationVersionConflict";
  }
}

export type RuntimeIntegration = Pick<
  IntegrationRecord,
  "id" | "projectRef" | "clientName" | "formUrl" | "state"
> & {
  readonly forms: readonly Pick<IntegrationFormRecord, "id" | "name" | "state" | "isDefault">[];
  readonly apiKeys: readonly Pick<
    IntegrationApiKeySummary,
    "id" | "name" | "keyPrefix" | "environment" | "state"
  >[];
};

export type RuntimeIntegrationField = Pick<
  IntegrationField,
  | "sourceSelector"
  | "canonicalField"
  | "context"
  | "conditionKey"
  | "required"
  | "requireCompleteName"
  | "requireDomesticAddress"
  | "requireValidPhone"
  | "fillVillageStreet"
  | "submitSelector"
  | "validationMode"
  | "validationTrigger"
>;

export type RuntimeIntegrationForm = Pick<
  IntegrationFormRecord,
  | "id"
  | "name"
  | "matchMode"
  | "pathPattern"
  | "rootSelector"
  | "state"
  | "configVersion"
  | "isDefault"
  | "createdAt"
> & { readonly fields: readonly RuntimeIntegrationField[] };

/** What the hosted script's config needs: forms and fields, without keys or activity. */
export type RuntimeIntegrationConfig = Pick<
  IntegrationRecord,
  "id" | "projectRef" | "clientName" | "environment" | "state" | "configVersion"
> & { readonly forms: readonly RuntimeIntegrationForm[] };

export interface IntegrationStore {
  listIntegrations(projectRef: string): Promise<readonly IntegrationRecord[]>;
  getIntegration(projectRef: string, id: string): Promise<IntegrationRecord | null>;
  getIntegrationById(id: string): Promise<IntegrationRecord | null>;
  getRuntimeIntegrationById?(id: string): Promise<RuntimeIntegration | null>;
  getRuntimeConfigById?(id: string): Promise<RuntimeIntegrationConfig | null>;
  createIntegration(input: CreateIntegrationInput): Promise<IntegrationRecord>;
  createForm(input: CreateIntegrationFormInput): Promise<IntegrationRecord | null>;
  setFormRootSelector?(
    projectRef: string,
    integrationId: string,
    formId: string,
    rootSelector: string,
    updatedAt: Date,
  ): Promise<IntegrationRecord | null>;
  replaceFormFields(
    projectRef: string,
    integrationId: string,
    formId: string,
    fields: readonly SaveIntegrationFieldInput[],
    updatedAt: Date,
    expectedVersion?: number,
  ): Promise<IntegrationRecord | null>;
  setFormState(
    projectRef: string,
    integrationId: string,
    formId: string,
    state: IntegrationFormState,
    updatedAt: Date,
  ): Promise<IntegrationRecord | null>;
  replaceFields(
    projectRef: string,
    integrationId: string,
    fields: readonly SaveIntegrationFieldInput[],
    updatedAt: Date,
  ): Promise<IntegrationRecord | null>;
  setState(
    projectRef: string,
    integrationId: string,
    state: IntegrationState,
    updatedAt: Date,
  ): Promise<IntegrationRecord | null>;
  saveFormScan(input: SaveFormScanInput): Promise<void>;
  createApiKey(
    projectRef: string,
    integrationId: string,
    environment: IntegrationEnvironment,
    input: CreatePilotApiKeyInput,
  ): Promise<void>;
  revokeApiKey(
    projectRef: string,
    integrationId: string,
    keyId: string,
    revokedAt: Date,
  ): Promise<boolean>;
  listConfigVersions(
    projectRef: string,
    integrationId: string,
  ): Promise<readonly IntegrationConfigVersionSummary[]>;
  listFormConfigVersions(
    projectRef: string,
    integrationId: string,
    formId: string,
  ): Promise<readonly IntegrationConfigVersionSummary[]>;
  rollbackConfigVersion(
    projectRef: string,
    integrationId: string,
    version: number,
    updatedAt: Date,
  ): Promise<IntegrationRecord | null>;
  rollbackFormConfigVersion(
    projectRef: string,
    integrationId: string,
    formId: string,
    version: number,
    updatedAt: Date,
  ): Promise<IntegrationRecord | null>;
  close(): Promise<void>;
}

interface IntegrationRow {
  id: string;
  project_ref: string;
  name: string;
  client_name: string;
  environment: IntegrationEnvironment;
  form_url: string;
  state: IntegrationState;
  config_version: number;
  created_at: Date;
  updated_at: Date;
}

interface IntegrationFieldRow {
  id: string;
  integration_id: string;
  form_id: string;
  source_selector: string;
  source_label: string;
  source_name: string | null;
  canonical_field: CanonicalFormField;
  field_context: FormFieldContext;
  condition_key: string | null;
  required: boolean;
  require_complete_name: boolean;
  require_domestic_address: boolean;
  require_valid_phone: boolean;
  fill_village_street: boolean;
  submit_selector: string | null;
  validation_mode: FieldValidationMode;
  validation_trigger: FieldValidationTrigger;
  confidence: number | null;
  detected: boolean;
}

interface IntegrationFormRow {
  id: string;
  integration_id: string;
  name: string;
  form_url: string;
  match_mode: IntegrationFormMatchMode;
  path_pattern: string;
  root_selector: string;
  state: IntegrationFormState;
  config_version: number;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

interface IntegrationApiKeyRow {
  id: string;
  integration_id: string;
  name: string;
  key_prefix: string;
  environment: IntegrationEnvironment;
  state: "active" | "revoked";
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

interface IntegrationActivityRow {
  integration_id: string;
  last_key_used_at: Date | null;
  observation_count_24h: string;
  last_observation_at: Date | null;
}

interface IntegrationConfigVersionRow {
  version: number;
  fields: readonly SaveIntegrationFieldInput[];
  created_at: Date;
}

export function createPostgresIntegrationStore(connectionString: string): IntegrationStore {
  const pool = new Pool({ ...interactivePoolOptions, connectionString });

  return {
    async listIntegrations(projectRef) {
      const rows = await pool.query<IntegrationRow>(
        `SELECT id, project_ref, name, client_name, environment, form_url, state,
                config_version, created_at, updated_at
         FROM app.integrations
         WHERE project_ref = $1
         ORDER BY updated_at DESC`,
        [projectRef],
      );
      return hydrateIntegrations(pool, rows.rows);
    },

    async getIntegration(projectRef, id) {
      const result = await pool.query<IntegrationRow>(
        `SELECT id, project_ref, name, client_name, environment, form_url, state,
                config_version, created_at, updated_at
         FROM app.integrations
         WHERE project_ref = $1 AND id = $2
         LIMIT 1`,
        [projectRef, id],
      );
      const records = await hydrateIntegrations(pool, result.rows);
      return records[0] ?? null;
    },

    async getIntegrationById(id) {
      const result = await pool.query<IntegrationRow>(
        `SELECT id, project_ref, name, client_name, environment, form_url, state,
                config_version, created_at, updated_at
         FROM app.integrations
         WHERE id = $1
         LIMIT 1`,
        [id],
      );
      const records = await hydrateIntegrations(pool, result.rows);
      return records[0] ?? null;
    },

    async getRuntimeIntegrationById(id) {
      // Independent subqueries avoid multiplying forms by keys. No observations or field rows.
      const result = await pool.query<{ runtime: RuntimeIntegration }>(
        `SELECT json_build_object(
           'id', integration.id, 'projectRef', integration.project_ref,
           'clientName', integration.client_name, 'state', integration.state,
           'formUrl', COALESCE((SELECT form_url FROM app.integration_forms
             WHERE integration_id = integration.id ORDER BY is_default DESC, created_at, id LIMIT 1), integration.form_url),
           'forms', COALESCE((SELECT json_agg(json_build_object(
             'id', id, 'name', name, 'state', state, 'isDefault', is_default)
             ORDER BY is_default DESC, created_at, id)
             FROM app.integration_forms WHERE integration_id = integration.id), '[]'::json),
           'apiKeys', COALESCE((SELECT json_agg(key) FROM (
             SELECT id, name, key_prefix AS "keyPrefix", environment, state
             FROM app.api_keys WHERE integration_id = integration.id AND state = 'active'
             ORDER BY created_at DESC, id LIMIT 1
           ) AS key), '[]'::json)
         ) AS runtime FROM app.integrations AS integration WHERE integration.id = $1`,
        [id],
      );
      return result.rows[0]?.runtime ?? null;
    },

    async getRuntimeConfigById(id) {
      // One round trip; the orders match hydrateIntegrations so the config stays byte-identical.
      const result = await pool.query<{
        runtime: Omit<RuntimeIntegrationConfig, "forms"> & {
          forms: (Omit<RuntimeIntegrationForm, "createdAt"> & { createdAt: string })[];
        };
      }>(
        `SELECT json_build_object(
           'id', integration.id, 'projectRef', integration.project_ref,
           'clientName', integration.client_name, 'environment', integration.environment,
           'state', integration.state, 'configVersion', integration.config_version,
           'forms', COALESCE((SELECT json_agg(json_build_object(
             'id', form.id, 'name', form.name, 'matchMode', form.match_mode,
             'pathPattern', form.path_pattern, 'rootSelector', form.root_selector,
             'state', form.state, 'configVersion', form.config_version,
             'isDefault', form.is_default, 'createdAt', form.created_at,
             'fields', COALESCE((SELECT json_agg(json_build_object(
               'sourceSelector', field.source_selector, 'canonicalField', field.canonical_field,
               'context', field.field_context, 'conditionKey', field.condition_key,
               'required', field.required, 'requireCompleteName', field.require_complete_name,
               'requireDomesticAddress', field.require_domestic_address,
               'requireValidPhone', field.require_valid_phone,
               'fillVillageStreet', field.fill_village_street,
               'submitSelector', field.submit_selector, 'validationMode', field.validation_mode,
               'validationTrigger', field.validation_trigger)
               ORDER BY field.field_context, field.source_label, field.source_selector)
               FROM app.integration_fields AS field
               WHERE field.integration_id = integration.id AND field.form_id = form.id), '[]'::json))
             ORDER BY form.is_default DESC, form.created_at, form.id)
             FROM app.integration_forms AS form WHERE form.integration_id = integration.id), '[]'::json)
         ) AS runtime FROM app.integrations AS integration WHERE integration.id = $1`,
        [id],
      );
      const runtime = result.rows[0]?.runtime;
      if (!runtime) return null;
      return {
        ...runtime,
        forms: runtime.forms.map((form) => ({ ...form, createdAt: new Date(form.createdAt) })),
      };
    },

    async createIntegration(input) {
      const client = await pool.connect();
      const formId = defaultIntegrationFormId(input.id);
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO app.integrations (
             id, project_ref, name, client_name, environment, form_url, state,
             config_version, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'draft', 1, $7, $7)`,
          [
            input.id,
            input.projectRef,
            input.name,
            input.clientName,
            input.environment,
            input.formUrl,
            input.createdAt,
          ],
        );
        await client.query(
          `INSERT INTO app.integration_forms (
             id, integration_id, name, form_url, match_mode, path_pattern, state,
             config_version, is_default, root_selector, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, 'exact', $5, 'draft', 1, true, 'body', $6, $6)`,
          [
            formId,
            input.id,
            input.initialFormName?.trim() || "Hlavní formulář",
            input.formUrl,
            pathFromFormUrl(input.formUrl),
            input.createdAt,
          ],
        );
        await client.query(
          `INSERT INTO app.integration_config_versions (
             integration_id, version, fields, created_at
           ) VALUES ($1, 1, '[]'::jsonb, $2)`,
          [input.id, input.createdAt],
        );
        await client.query(
          `INSERT INTO app.integration_form_config_versions (
             form_id, version, fields, created_at
           ) VALUES ($1, 1, '[]'::jsonb, $2)`,
          [formId, input.createdAt],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      const record = await this.getIntegration(input.projectRef, input.id);
      if (!record) throw new Error("Created integration could not be reloaded.");
      return record;
    },

    async createForm(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<{ id: string }>(
          `INSERT INTO app.integration_forms (
             id, integration_id, name, form_url, match_mode, path_pattern, state,
             config_version, is_default, root_selector, created_at, updated_at
           )
           SELECT $3, id, $4, $5, $6, $7, 'draft', 1, false, $8, $9, $9
           FROM app.integrations
           WHERE project_ref = $1 AND id = $2
           RETURNING id`,
          [
            input.projectRef,
            input.integrationId,
            input.id,
            input.name,
            input.formUrl,
            input.matchMode,
            input.pathPattern,
            input.rootSelector?.trim() || "body",
            input.createdAt,
          ],
        );
        if (!result.rows[0]) {
          await client.query("ROLLBACK");
          return null;
        }
        await client.query(
          `INSERT INTO app.integration_form_config_versions (
             form_id, version, fields, created_at
           ) VALUES ($1, 1, '[]'::jsonb, $2)`,
          [input.id, input.createdAt],
        );
        await client.query(
          `UPDATE app.integrations SET updated_at = $3
           WHERE project_ref = $1 AND id = $2`,
          [input.projectRef, input.integrationId, input.createdAt],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return this.getIntegration(input.projectRef, input.integrationId);
    },

    async setFormRootSelector(projectRef, integrationId, formId, rootSelector, updatedAt) {
      const result = await pool.query(
        `UPDATE app.integration_forms AS form
         SET root_selector = $4, updated_at = $5
         FROM app.integrations AS integration
         WHERE integration.project_ref = $1
           AND integration.id = $2
           AND form.integration_id = integration.id
           AND form.id = $3`,
        [projectRef, integrationId, formId, rootSelector, updatedAt],
      );
      if ((result.rowCount ?? 0) === 0) return null;
      await pool.query(
        `UPDATE app.integrations SET updated_at = $3
         WHERE project_ref = $1 AND id = $2`,
        [projectRef, integrationId, updatedAt],
      );
      return this.getIntegration(projectRef, integrationId);
    },

    async replaceFields(projectRef, integrationId, fields, updatedAt) {
      const form = await pool.query<{ id: string }>(
        `SELECT form.id
         FROM app.integration_forms AS form
         JOIN app.integrations AS integration ON integration.id = form.integration_id
         WHERE integration.project_ref = $1 AND integration.id = $2 AND form.is_default
         LIMIT 1`,
        [projectRef, integrationId],
      );
      const formId = form.rows[0]?.id;
      return formId
        ? this.replaceFormFields(projectRef, integrationId, formId, fields, updatedAt)
        : null;
    },

    async replaceFormFields(projectRef, integrationId, formId, fields, updatedAt, expectedVersion) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const owner = await client.query<{ id: string; config_version: number }>(
          `SELECT form.id, form.config_version
           FROM app.integration_forms AS form
           JOIN app.integrations AS integration ON integration.id = form.integration_id
           WHERE integration.project_ref = $1 AND integration.id = $2 AND form.id = $3
           FOR UPDATE`,
          [projectRef, integrationId, formId],
        );
        if (!owner.rows[0]) {
          await client.query("ROLLBACK");
          return null;
        }
        if (expectedVersion !== undefined && owner.rows[0].config_version !== expectedVersion)
          throw new IntegrationVersionConflict();
        await client.query("DELETE FROM app.integration_fields WHERE form_id = $1", [formId]);
        for (const field of fields) {
          await insertField(client, integrationId, formId, field, updatedAt);
        }
        const versionResult = await client.query<{ config_version: number }>(
          `UPDATE app.integration_forms
           SET state = 'configured', config_version = config_version + 1, updated_at = $3
           WHERE integration_id = $1 AND id = $2
           RETURNING config_version`,
          [integrationId, formId, updatedAt],
        );
        const version = versionResult.rows[0]?.config_version;
        if (!version) throw new Error("Updated integration version could not be resolved.");
        await client.query(
          `INSERT INTO app.integration_form_config_versions (
             form_id, version, fields, created_at
           ) VALUES ($1, $2, $3::jsonb, $4)`,
          [formId, version, JSON.stringify(fields), updatedAt],
        );
        await client.query(
          `UPDATE app.integrations
           SET state = CASE WHEN state = 'shadow' THEN 'paused' ELSE 'configured' END,
               config_version = config_version + 1,
               updated_at = $3
           WHERE project_ref = $1 AND id = $2`,
          [projectRef, integrationId, updatedAt],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return this.getIntegration(projectRef, integrationId);
    },

    async setState(projectRef, integrationId, state, updatedAt) {
      const result = await pool.query<{ id: string; config_version: number }>(
        `UPDATE app.integrations SET state = $3, updated_at = $4
         WHERE project_ref = $1 AND id = $2
         RETURNING id`,
        [projectRef, integrationId, state, updatedAt],
      );
      return result.rows[0] ? this.getIntegration(projectRef, integrationId) : null;
    },

    async setFormState(projectRef, integrationId, formId, state, updatedAt) {
      const result = await pool.query<{ id: string }>(
        `UPDATE app.integration_forms AS form
         SET state = $4, updated_at = $5
         FROM app.integrations AS integration
         WHERE integration.id = form.integration_id
           AND integration.project_ref = $1
           AND integration.id = $2
           AND form.id = $3
         RETURNING form.id`,
        [projectRef, integrationId, formId, state, updatedAt],
      );
      if (!result.rows[0]) return null;
      await pool.query(
        `UPDATE app.integrations SET updated_at = $3
         WHERE project_ref = $1 AND id = $2`,
        [projectRef, integrationId, updatedAt],
      );
      return this.getIntegration(projectRef, integrationId);
    },

    async saveFormScan(input) {
      const result = await pool.query<{ id: string }>(
        `SELECT form.id
         FROM app.integration_forms AS form
         JOIN app.integrations AS integration ON integration.id = form.integration_id
         WHERE integration.project_ref = $1 AND integration.id = $2 AND form.id = $3`,
        [input.projectRef, input.integrationId, input.formId],
      );
      if (!result.rows[0]) throw new Error("Form does not belong to the operator project.");
      await pool.query(
        `INSERT INTO app.form_scans (
           id, integration_id, form_id, sanitized_url, state, detected_fields, error_code, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [
          input.id,
          input.integrationId,
          input.formId,
          input.sanitizedUrl,
          input.state,
          JSON.stringify(input.detectedFields),
          input.errorCode,
          input.createdAt,
        ],
      );
      if (input.state === "completed") {
        await pool.query(
          `UPDATE app.integration_forms
           SET state = CASE WHEN state = 'draft' THEN 'scanned' ELSE state END,
               updated_at = $3
           WHERE integration_id = $1 AND id = $2`,
          [input.integrationId, input.formId, input.createdAt],
        );
        await pool.query(
          `UPDATE app.integrations
           SET state = CASE WHEN state = 'draft' THEN 'scanned' ELSE state END,
               updated_at = $3
           WHERE project_ref = $1 AND id = $2`,
          [input.projectRef, input.integrationId, input.createdAt],
        );
      }
    },

    async createApiKey(projectRef, integrationId, environment, input) {
      await pool.query(
        `INSERT INTO app.api_keys (
           id, project_ref, name, key_prefix, verifier, state, created_at,
           integration_id, environment
         )
         SELECT $3, $1, $4, $5, $6, $7, $8, id, $9
         FROM app.integrations
         WHERE project_ref = $1 AND id = $2`,
        [
          projectRef,
          integrationId,
          input.id,
          input.name,
          input.keyPrefix,
          input.verifier,
          input.state,
          input.createdAt,
          environment,
        ],
      );
    },

    async revokeApiKey(projectRef, integrationId, keyId, revokedAt) {
      const result = await pool.query<{ id: string }>(
        `UPDATE app.api_keys
         SET state = 'revoked', revoked_at = $4
         WHERE project_ref = $1 AND integration_id = $2 AND id = $3 AND state = 'active'
         RETURNING id`,
        [projectRef, integrationId, keyId, revokedAt],
      );
      return Boolean(result.rows[0]);
    },

    async listConfigVersions(projectRef, integrationId) {
      const form = await pool.query<{ id: string }>(
        `SELECT form.id
         FROM app.integration_forms AS form
         JOIN app.integrations AS integration ON integration.id = form.integration_id
         WHERE integration.project_ref = $1 AND integration.id = $2 AND form.is_default
         LIMIT 1`,
        [projectRef, integrationId],
      );
      const formId = form.rows[0]?.id;
      return formId ? this.listFormConfigVersions(projectRef, integrationId, formId) : [];
    },

    async listFormConfigVersions(projectRef, integrationId, formId) {
      const result = await pool.query<IntegrationConfigVersionRow>(
        `SELECT version, fields, created_at
         FROM app.integration_form_config_versions
         WHERE form_id = $3
           AND EXISTS (
             SELECT 1
             FROM app.integration_forms AS form
             JOIN app.integrations AS integration ON integration.id = form.integration_id
             WHERE integration.project_ref = $1
               AND integration.id = $2
               AND form.id = $3
           )
         ORDER BY version DESC`,
        [projectRef, integrationId, formId],
      );
      return result.rows.map((row) => ({
        version: row.version,
        fieldCount: Array.isArray(row.fields) ? row.fields.length : 0,
        createdAt: row.created_at,
      }));
    },

    async rollbackConfigVersion(projectRef, integrationId, version, updatedAt) {
      const form = await pool.query<{ id: string }>(
        `SELECT form.id
         FROM app.integration_forms AS form
         JOIN app.integrations AS integration ON integration.id = form.integration_id
         WHERE integration.project_ref = $1 AND integration.id = $2 AND form.is_default
         LIMIT 1`,
        [projectRef, integrationId],
      );
      const formId = form.rows[0]?.id;
      return formId
        ? this.rollbackFormConfigVersion(projectRef, integrationId, formId, version, updatedAt)
        : null;
    },

    async rollbackFormConfigVersion(projectRef, integrationId, formId, version, updatedAt) {
      const result = await pool.query<IntegrationConfigVersionRow>(
        `SELECT version, fields, created_at
         FROM app.integration_form_config_versions
         WHERE form_id = $3 AND version = $4
           AND EXISTS (
             SELECT 1
             FROM app.integration_forms AS form
             JOIN app.integrations AS integration ON integration.id = form.integration_id
             WHERE integration.project_ref = $1
               AND integration.id = $2
               AND form.id = $3
           )
         LIMIT 1`,
        [projectRef, integrationId, formId, version],
      );
      const snapshot = result.rows[0];
      if (!snapshot || !Array.isArray(snapshot.fields)) return null;
      return this.replaceFormFields(
        projectRef,
        integrationId,
        formId,
        snapshot.fields.map((field) => ({ ...field, id: randomUUID() })),
        updatedAt,
      );
    },

    async close() {
      await pool.end();
    },
  };
}

async function hydrateIntegrations(
  pool: Pool,
  rows: readonly IntegrationRow[],
): Promise<readonly IntegrationRecord[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [formResult, fieldResult, keyResult, activityResult] = await Promise.all([
    pool.query<IntegrationFormRow>(
      `SELECT id, integration_id, name, form_url, match_mode, path_pattern, root_selector, state,
              config_version, is_default, created_at, updated_at
       FROM app.integration_forms
       WHERE integration_id = ANY($1::text[])
       ORDER BY is_default DESC, created_at, id`,
      [ids],
    ),
    pool.query<IntegrationFieldRow>(
      `SELECT id, integration_id, form_id, source_selector, source_label, source_name,
              canonical_field, field_context, condition_key, required, validation_mode,
              validation_trigger, confidence, detected, require_complete_name, submit_selector,
              require_domestic_address, require_valid_phone, fill_village_street
       FROM app.integration_fields
       WHERE integration_id = ANY($1::text[])
       ORDER BY field_context, source_label, source_selector`,
      [ids],
    ),
    pool.query<IntegrationApiKeyRow>(
      `SELECT id, integration_id, name, key_prefix, environment, state,
              created_at, last_used_at, revoked_at
       FROM app.api_keys
       WHERE integration_id = ANY($1::text[])
       ORDER BY created_at DESC`,
      [ids],
    ),
    pool.query<IntegrationActivityRow>(
      `SELECT
         key.integration_id,
         max(key.last_used_at) FILTER (WHERE key.state = 'active') AS last_key_used_at,
         count(observation.id) FILTER (WHERE observation.created_at > now() - interval '24 hours')::text
           AS observation_count_24h,
         max(observation.created_at) FILTER (WHERE observation.expires_at > now())
           AS last_observation_at
       FROM app.api_keys AS key
       LEFT JOIN app.shadow_observations AS observation ON observation.api_key_id = key.id
       WHERE key.integration_id = ANY($1::text[])
       GROUP BY key.integration_id`,
      [ids],
    ),
  ]);
  return rows.map((row) => {
    const activity = activityResult.rows.find((item) => item.integration_id === row.id);
    const forms = formResult.rows
      .filter((form) => form.integration_id === row.id)
      .map((form) => ({
        id: form.id,
        integrationId: form.integration_id,
        name: form.name,
        formUrl: form.form_url,
        matchMode: form.match_mode,
        pathPattern: form.path_pattern,
        rootSelector: form.root_selector,
        state: form.state,
        configVersion: form.config_version,
        isDefault: form.is_default,
        createdAt: form.created_at,
        updatedAt: form.updated_at,
        fields: fieldResult.rows.filter((field) => field.form_id === form.id).map(mapField),
      }));
    const defaultForm = forms.find((form) => form.isDefault) ?? forms[0];
    return {
      id: row.id,
      projectRef: row.project_ref,
      name: row.name,
      clientName: row.client_name,
      environment: row.environment,
      formUrl: defaultForm?.formUrl ?? row.form_url,
      state: row.state,
      configVersion: row.config_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      fields: defaultForm?.fields ?? [],
      forms,
      apiKeys: keyResult.rows
        .filter((key) => key.integration_id === row.id)
        .map((key) => ({
          id: key.id,
          name: key.name,
          keyPrefix: key.key_prefix,
          environment: key.environment,
          state: key.state,
          createdAt: key.created_at,
          lastUsedAt: key.last_used_at,
          revokedAt: key.revoked_at,
        })),
      activity: {
        lastKeyUsedAt: activity?.last_key_used_at ?? null,
        observationCount24h: Number(activity?.observation_count_24h ?? 0),
        lastObservationAt: activity?.last_observation_at ?? null,
      },
    };
  });
}

function mapField(row: IntegrationFieldRow): IntegrationField {
  return {
    id: row.id,
    sourceSelector: row.source_selector,
    sourceLabel: row.source_label,
    sourceName: row.source_name,
    canonicalField: row.canonical_field,
    context: row.field_context,
    conditionKey: row.condition_key,
    required: row.required,
    requireCompleteName: row.require_complete_name ?? false,
    requireDomesticAddress: row.require_domestic_address ?? false,
    requireValidPhone: row.require_valid_phone ?? false,
    fillVillageStreet: row.fill_village_street ?? false,
    submitSelector: row.submit_selector ?? null,
    validationMode: row.validation_mode,
    validationTrigger: row.validation_trigger,
    confidence: row.confidence,
    detected: row.detected,
  };
}

async function insertField(
  client: PoolClient,
  integrationId: string,
  formId: string,
  field: SaveIntegrationFieldInput,
  updatedAt: Date,
) {
  await client.query(
    `INSERT INTO app.integration_fields (
       id, integration_id, form_id, source_selector, source_label, source_name, canonical_field,
       field_context, condition_key, required, validation_mode, validation_trigger,
       confidence, detected, created_at, updated_at, require_complete_name, submit_selector,
       require_domestic_address, require_valid_phone, fill_village_street
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $16, $17, $18,
       $19, $20)`,
    [
      field.id,
      integrationId,
      formId,
      field.sourceSelector,
      field.sourceLabel,
      field.sourceName,
      field.canonicalField,
      field.context,
      field.conditionKey,
      field.required,
      field.validationMode,
      field.validationTrigger,
      field.confidence,
      field.detected,
      updatedAt,
      field.requireCompleteName ?? false,
      field.submitSelector ?? null,
      field.requireDomesticAddress ?? false,
      field.requireValidPhone ?? false,
      field.fillVillageStreet ?? false,
    ],
  );
}

export function normalizeIntegrationPath(value: string): string | null {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 1_024 ||
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  ) {
    return null;
  }
  let pathname: string;
  try {
    const parsed = new URL(trimmed, "https://checkdrop.invalid");
    if (parsed.origin !== "https://checkdrop.invalid") return null;
    pathname = parsed.pathname;
  } catch {
    return null;
  }
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

type RoutableForm = Pick<
  IntegrationFormRecord,
  "pathPattern" | "matchMode" | "rootSelector" | "state" | "isDefault" | "createdAt"
>;

export function selectIntegrationForms<Form extends RoutableForm>(
  integration: { readonly forms: readonly Form[] },
  rawPath: string | null,
): readonly Form[] {
  if (rawPath === null) {
    const fallback = integration.forms.find((form) => form.isDefault);
    return fallback?.state === "configured" ? [fallback] : [];
  }
  const path = normalizeIntegrationPath(rawPath);
  if (!path) return [];
  const matches = integration.forms.filter((form) => {
    if (form.state !== "configured") return false;
    const pattern = normalizeIntegrationPath(form.pathPattern);
    if (!pattern) return false;
    return form.matchMode === "exact"
      ? pattern === path
      : pattern === "/" || path === pattern || path.startsWith(`${pattern}/`);
  });
  const byRoot = new Map<string, Form>();
  for (const form of matches) {
    const rootSelector = form.rootSelector ?? "body";
    const current = byRoot.get(rootSelector);
    const score = (form.matchMode === "exact" ? 10_000 : 0) + form.pathPattern.length;
    const currentScore = current
      ? (current.matchMode === "exact" ? 10_000 : 0) + current.pathPattern.length
      : -1;
    if (!current || score > currentScore) byRoot.set(rootSelector, form);
  }
  return [...byRoot.values()].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
    return left.createdAt.getTime() - right.createdAt.getTime();
  });
}

function defaultIntegrationFormId(integrationId: string): string {
  return `${integrationId}-form-1`;
}

function pathFromFormUrl(formUrl: string): string {
  const path = normalizeIntegrationPath(new URL(formUrl).pathname);
  if (!path) throw new Error("Integration form URL does not contain a valid path.");
  return path;
}
