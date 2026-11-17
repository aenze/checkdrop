import { Pool } from "pg";
import { interactivePoolOptions } from "./interactive-pool.js";
import {
  createShadowObservationCipher,
  type ShadowObservationCipher,
} from "./shadow-observation-crypto.js";
import { createShadowObservationSearchIndex } from "./shadow-observation-search.js";

export type ShadowObservationOperation =
  | "name.validate"
  | "email.validate"
  | "phone.validate"
  | "address.validate"
  | "company_id.validate";
export type ShadowObservationFilter = "all" | "changed" | "review";
export type ShadowObservationStatus = "valid" | "correctable" | "risky" | "invalid" | "unknown";
export type ShadowObservationAssistFilter = "shown_only" | "applied" | "kept" | "undone" | "none";
export type ShadowObservationAction =
  | "accept"
  | "normalize"
  | "suggest"
  | "warn"
  | "block"
  | "defer"
  | "fail_open";
export type AssistInteractionEvent = "shown" | "applied" | "kept" | "undone";
export type AssistOutcome = Exclude<AssistInteractionEvent, "shown">;

export interface RecordAssistInteractionInput {
  readonly projectRef: string;
  readonly apiKeyId: string;
  readonly requestId: string;
  readonly event: AssistInteractionEvent;
  readonly proposedValue?: string;
  readonly proposedPreview?: string;
  readonly changedFields?: readonly string[];
  readonly occurredAt: Date;
}

export interface SaveShadowObservationInput {
  readonly id: string;
  readonly requestId: string;
  readonly projectRef: string;
  readonly apiKeyId: string;
  readonly operation: ShadowObservationOperation;
  readonly idempotencyKeyHash: string;
  readonly clientName: string;
  readonly formId: string | null;
  readonly checkoutSessionRef: string | null;
  readonly inputValue: string;
  readonly proposedValue: string | null;
  readonly inputPreview: string;
  readonly proposedPreview: string | null;
  readonly changed: boolean;
  readonly resultClass: ShadowObservationStatus;
  readonly action: ShadowObservationAction;
  readonly issueCodes: readonly string[];
  readonly evidenceSources: readonly string[];
  readonly durationMs: number;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface StoredShadowObservation {
  readonly id: string;
  readonly requestId: string;
  readonly operation: ShadowObservationOperation;
  readonly clientName: string;
  readonly formId: string | null;
  readonly formName: string | null;
  readonly checkoutSessionRef: string | null;
  readonly inputValue: string | null;
  readonly proposedValue: string | null;
  readonly inputPreview: string;
  readonly proposedPreview: string | null;
  readonly changed: boolean;
  readonly resultClass: ShadowObservationStatus;
  readonly action: ShadowObservationAction;
  readonly issueCodes: readonly string[];
  readonly evidenceSources: readonly string[];
  readonly durationMs: number;
  readonly assistShownAt: Date | null;
  readonly assistOutcome: AssistOutcome | null;
  readonly assistOutcomeAt: Date | null;
  readonly assistChangedFields?: readonly string[];
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface ShadowObservationSummary {
  readonly total: number;
  readonly proposedChanges: number;
  readonly reviewRequired: number;
  readonly averageDurationMs: number;
  readonly p95DurationMs: number;
  readonly assistShown: number;
  readonly assistApplied: number;
  readonly assistKept: number;
  readonly assistUndone: number;
}

export interface ShadowObservationListPage {
  readonly observations: readonly StoredShadowObservation[];
  /** Number of customer cases selected by the active filters. */
  readonly total: number;
  readonly summary: ShadowObservationSummary;
}

export interface ShadowObservationListOptions {
  readonly offset: number;
  readonly limit: number;
  readonly filter: ShadowObservationFilter;
  readonly operation?: ShadowObservationOperation;
  readonly resultClass?: ShadowObservationStatus;
  readonly assistOutcome?: ShadowObservationAssistFilter;
  /** Integration client identifier; limits the page to one connected website. */
  readonly clientName?: string;
  readonly formId?: string;
  readonly checkoutSessionRef?: string;
  readonly checkoutOutcome?: "completed" | "active" | "abandoned" | "unmeasured";
  readonly search?: string;
  readonly from?: Date;
  readonly to?: Date;
}

export interface ShadowObservationStore {
  readonly fullValuesEnabled: boolean;
  readonly searchEnabled?: boolean;
  save(input: SaveShadowObservationInput): Promise<boolean>;
  recordAssistInteraction(input: RecordAssistInteractionInput): Promise<boolean>;
  list(
    projectRef: string,
    now: Date,
    options: ShadowObservationListOptions,
  ): Promise<ShadowObservationListPage>;
  deleteExpired(now: Date): Promise<number>;
  close(): Promise<void>;
}

interface ShadowObservationRow {
  id: string;
  request_id: string;
  operation: ShadowObservationOperation;
  client_name: string;
  form_id: string | null;
  form_name: string | null;
  checkout_session_ref: string | null;
  input_value_ciphertext: string | null;
  proposed_value_ciphertext: string | null;
  input_preview: string;
  proposed_preview: string | null;
  changed: boolean;
  result_class: ShadowObservationStatus;
  action: ShadowObservationAction;
  issue_codes: string[];
  evidence_sources: string[];
  duration_ms: number;
  assist_shown_at: Date | null;
  assist_outcome: AssistOutcome | null;
  assist_outcome_at: Date | null;
  assist_changed_fields: string[];
  created_at: Date;
  expires_at: Date;
}

interface ShadowSummaryRow {
  total: string;
  filtered_total: string;
  proposed_changes: string;
  review_required: string;
  average_duration_ms: string | null;
  p95_duration_ms: string | null;
  assist_shown: string;
  assist_applied: string;
  assist_kept: string;
  assist_undone: string;
}

interface ShadowCaseRow {
  case_key: string;
  latest_created_at: Date;
}

interface ShadowCaseCountRow {
  total: string;
}

const observationColumns = `observation.id, observation.request_id, observation.operation,
  observation.client_name, observation.form_id, form.name AS form_name,
  observation.checkout_session_ref,
  observation.input_value_ciphertext, observation.proposed_value_ciphertext,
  observation.input_preview, observation.proposed_preview, observation.changed,
  observation.result_class, observation.action, observation.issue_codes,
  observation.evidence_sources, observation.duration_ms, observation.created_at,
  observation.expires_at, observation.assist_shown_at, observation.assist_outcome,
  observation.assist_outcome_at, observation.assist_changed_fields`;

export function createPostgresShadowObservationStore(
  connectionString: string,
  encryptionKey?: string | null,
): ShadowObservationStore {
  const pool = new Pool({ ...interactivePoolOptions, connectionString, max: 6 });
  const cipher = createShadowObservationCipher(encryptionKey);
  const searchIndex = createShadowObservationSearchIndex(encryptionKey);

  return {
    fullValuesEnabled: cipher !== null,
    searchEnabled: searchIndex !== null,

    async save(input) {
      // A single INSERT is atomic on its own; an explicit transaction only added round trips.
      const searchTokens = searchIndex?.valueTokens(input.inputValue) ?? [];
      const result = await pool.query<{ id: string }>(
        `INSERT INTO app.shadow_observations (
             id, request_id, project_ref, api_key_id, operation, idempotency_key_hash,
             client_name, form_id, checkout_session_ref, input_value_ciphertext, proposed_value_ciphertext,
             input_preview, proposed_preview, changed, result_class, action, issue_codes,
             evidence_sources, duration_ms, created_at, expires_at, search_tokens,
             search_index_version, assist_changed_fields
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
             $17, $18, $19, $20, $21, $22, $23, $24
           )
           ON CONFLICT (api_key_id, operation, idempotency_key_hash) DO NOTHING
           RETURNING id`,
        [
          input.id,
          input.requestId,
          input.projectRef,
          input.apiKeyId,
          input.operation,
          input.idempotencyKeyHash,
          input.clientName,
          input.formId,
          input.checkoutSessionRef,
          encryptValue(cipher, input.inputValue, input.id, "input"),
          input.proposedValue !== null
            ? encryptValue(cipher, input.proposedValue, input.id, "proposed")
            : null,
          input.inputPreview,
          input.proposedPreview,
          input.changed,
          input.resultClass,
          input.action,
          [...input.issueCodes],
          [...input.evidenceSources],
          input.durationMs,
          input.createdAt,
          input.expiresAt,
          searchTokens,
          searchIndex?.version ?? 0,
          [],
        ],
      );
      return result.rows.length === 1;
    },

    async recordAssistInteraction(input) {
      const isShown = input.event === "shown";
      const selectedAddress =
        input.event === "applied" && input.proposedValue ? input.proposedValue : null;
      if (!selectedAddress) {
        const result = await pool.query<{ id: string }>(
          `UPDATE app.shadow_observations
           SET assist_shown_at = COALESCE(assist_shown_at, $4),
               assist_outcome = CASE WHEN $5::boolean THEN assist_outcome ELSE $6::text END,
               assist_outcome_at = CASE WHEN $5::boolean THEN assist_outcome_at ELSE $4 END,
               assist_changed_fields = CASE WHEN $5::boolean THEN assist_changed_fields ELSE $7::text[] END
           WHERE project_ref = $1
             AND api_key_id = $2
             AND request_id = $3
             AND operation IN ('name.validate', 'email.validate', 'phone.validate', 'address.validate', 'company_id.validate')
             AND expires_at > $4
           RETURNING id`,
          [
            input.projectRef,
            input.apiKeyId,
            input.requestId,
            input.occurredAt,
            isShown,
            isShown ? null : input.event,
            [...(input.changedFields ?? [])],
          ],
        );
        return result.rows.length === 1;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const selected = await client.query<{ id: string }>(
          `SELECT id
           FROM app.shadow_observations
           WHERE project_ref = $1
             AND api_key_id = $2
             AND request_id = $3
             AND operation IN ('address.validate', 'company_id.validate')
             AND expires_at > $4
           FOR UPDATE`,
          [input.projectRef, input.apiKeyId, input.requestId, input.occurredAt],
        );
        const observation = selected.rows[0];
        if (!observation) {
          await client.query("COMMIT");
          return false;
        }
        const result = await client.query<{ id: string }>(
          `UPDATE app.shadow_observations
           SET assist_shown_at = COALESCE(assist_shown_at, $2),
               assist_outcome = $3::text,
               assist_outcome_at = $2,
               proposed_value_ciphertext = $4,
               proposed_preview = $5,
               changed = TRUE,
               assist_changed_fields = $6::text[],
               search_tokens = ARRAY(
                 SELECT DISTINCT token FROM unnest(search_tokens || $7::text[]) AS token
               ),
               search_index_version = CASE
                 WHEN cardinality($7::text[]) > 0 THEN 1
                 ELSE search_index_version
               END
           WHERE id = $1
           RETURNING id`,
          [
            observation.id,
            input.occurredAt,
            input.event,
            encryptValue(cipher, selectedAddress, observation.id, "proposed"),
            input.proposedPreview ?? null,
            [...(input.changedFields ?? [])],
            searchIndex?.valueTokens(selectedAddress) ?? [],
          ],
        );
        await client.query("COMMIT");
        return result.rows.length === 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async list(projectRef, now, options) {
      const caseFilter = buildShadowFilter(projectRef, now, options, "observation", searchIndex);
      const summaryScope = buildShadowFilter(
        projectRef,
        now,
        { ...options, filter: "all" },
        "observation",
        searchIndex,
      );
      const selectedSummaryCondition =
        options.filter === "changed"
          ? "changed"
          : options.filter === "review"
            ? "result_class IN ('risky', 'invalid', 'unknown')"
            : "TRUE";
      const offsetIndex = caseFilter.values.length + 1;
      const limitIndex = caseFilter.values.length + 2;
      const caseKey = shadowCaseKey("observation");
      const [casePage, caseCount, summary] = await Promise.all([
        pool.query<ShadowCaseRow>(
          `SELECT ${caseKey} AS case_key,
                  max(observation.created_at) AS latest_created_at
           FROM app.shadow_observations AS observation
           WHERE ${caseFilter.sql}
           GROUP BY ${caseKey}
           ORDER BY latest_created_at DESC, case_key DESC
           OFFSET $${offsetIndex} LIMIT $${limitIndex}`,
          [...caseFilter.values, options.offset, options.limit],
        ),
        pool.query<ShadowCaseCountRow>(
          `SELECT count(DISTINCT ${caseKey})::text AS total
           FROM app.shadow_observations AS observation
           WHERE ${caseFilter.sql}`,
          caseFilter.values,
        ),
        pool.query<ShadowSummaryRow>(
          `SELECT
             count(*)::text AS total,
             count(*) FILTER (WHERE ${selectedSummaryCondition})::text AS filtered_total,
             count(*) FILTER (WHERE changed)::text AS proposed_changes,
             count(*) FILTER (WHERE result_class IN ('risky', 'invalid', 'unknown'))::text AS review_required,
             avg(duration_ms)::text AS average_duration_ms,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::text AS p95_duration_ms,
             count(*) FILTER (WHERE assist_shown_at IS NOT NULL)::text AS assist_shown,
             count(*) FILTER (WHERE assist_outcome = 'applied')::text AS assist_applied,
             count(*) FILTER (WHERE assist_outcome = 'kept')::text AS assist_kept,
             count(*) FILTER (WHERE assist_outcome = 'undone')::text AS assist_undone
           FROM app.shadow_observations AS observation
           WHERE ${summaryScope.sql}`,
          summaryScope.values,
        ),
      ]);
      const selectedCaseKeys = casePage.rows.map((row) => row.case_key);
      const detailOptions: ShadowObservationListOptions = {
        offset: 0,
        limit: options.limit,
        filter: "all",
        ...(options.clientName ? { clientName: options.clientName } : {}),
        ...(options.formId ? { formId: options.formId } : {}),
        ...(options.from ? { from: options.from } : {}),
        ...(options.to ? { to: options.to } : {}),
      };
      const detailScope = buildShadowFilter(
        projectRef,
        now,
        detailOptions,
        "observation",
        searchIndex,
      );
      const caseKeysIndex = detailScope.values.length + 1;
      const observations =
        selectedCaseKeys.length === 0
          ? { rows: [] as ShadowObservationRow[] }
          : await pool.query<ShadowObservationRow>(
              `SELECT ${observationColumns}
               FROM app.shadow_observations AS observation
               LEFT JOIN app.integration_forms AS form ON form.id = observation.form_id
               WHERE ${detailScope.sql}
                 AND ${caseKey} = ANY($${caseKeysIndex}::text[])
               ORDER BY array_position($${caseKeysIndex}::text[], ${caseKey}),
                        observation.created_at DESC,
                        observation.id DESC`,
              [...detailScope.values, selectedCaseKeys],
            );
      const aggregate = summary.rows[0];
      return {
        observations: observations.rows.map((row) => mapObservation(row, cipher)),
        total: Number(caseCount.rows[0]?.total ?? 0),
        summary: {
          total: Number(aggregate?.total ?? 0),
          proposedChanges: Number(aggregate?.proposed_changes ?? 0),
          reviewRequired: Number(aggregate?.review_required ?? 0),
          averageDurationMs: roundedMetric(aggregate?.average_duration_ms),
          p95DurationMs: roundedMetric(aggregate?.p95_duration_ms),
          assistShown: Number(aggregate?.assist_shown ?? 0),
          assistApplied: Number(aggregate?.assist_applied ?? 0),
          assistKept: Number(aggregate?.assist_kept ?? 0),
          assistUndone: Number(aggregate?.assist_undone ?? 0),
        },
      };
    },

    async deleteExpired(now) {
      let total = 0;
      // Bound lock duration and transaction size, including after a missed cleanup run.
      for (;;) {
        const result = await pool.query(
          `WITH expired AS (
             SELECT id FROM app.shadow_observations WHERE expires_at <= $1
             ORDER BY expires_at, id LIMIT 1000 FOR UPDATE SKIP LOCKED
           ) DELETE FROM app.shadow_observations AS observation
             USING expired WHERE observation.id = expired.id`,
          [now],
        );
        const deleted = result.rowCount ?? 0;
        total += deleted;
        if (deleted < 1000) return total;
      }
    },

    async close() {
      await pool.end();
    },
  };
}

function shadowCaseKey(alias: string): string {
  return `COALESCE(${alias}.checkout_session_ref, 'observation:' || ${alias}.id)`;
}

function buildShadowFilter(
  projectRef: string,
  now: Date,
  options: ShadowObservationListOptions,
  alias: string,
  searchIndex: ReturnType<typeof createShadowObservationSearchIndex>,
): { readonly sql: string; readonly values: unknown[] } {
  const column = (name: string) => `${alias}.${name}`;
  const values: unknown[] = [projectRef, now];
  const clauses = [`${column("project_ref")} = $1`, `${column("expires_at")} > $2`];
  const parameter = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (options.filter === "changed") clauses.push(column("changed"));
  if (options.checkoutOutcome) {
    clauses.push(`COALESCE((SELECT CASE
      WHEN bool_or(ce.event='purchase_reported') THEN 'completed'
      WHEN max(ce.created_at) <= $2::timestamptz - interval '30 minutes' THEN 'abandoned'
      ELSE 'active' END FROM app.checkout_events ce
      WHERE ce.project_ref=$1 AND ce.session_ref=${column("checkout_session_ref")}
      AND ce.created_at >= $2::timestamptz - interval '90 days'
      GROUP BY ce.session_ref), 'unmeasured') = ${parameter(options.checkoutOutcome)}`);
  }
  if (options.filter === "review") {
    clauses.push(`${column("result_class")} IN ('risky', 'invalid', 'unknown')`);
  }
  if (options.operation) {
    clauses.push(`${column("operation")} = ${parameter(options.operation)}`);
  }
  if (options.resultClass) {
    clauses.push(`${column("result_class")} = ${parameter(options.resultClass)}`);
  }
  if (options.assistOutcome === "shown_only") {
    clauses.push(`${column("assist_shown_at")} IS NOT NULL`);
    clauses.push(`${column("assist_outcome")} IS NULL`);
  } else if (options.assistOutcome === "none") {
    clauses.push(`${column("assist_shown_at")} IS NULL`);
  } else if (options.assistOutcome) {
    clauses.push(`${column("assist_outcome")} = ${parameter(options.assistOutcome)}`);
  }
  if (options.clientName) {
    clauses.push(`${column("client_name")} = ${parameter(options.clientName)}`);
  }
  if (options.formId) clauses.push(`${column("form_id")} = ${parameter(options.formId)}`);
  if (options.checkoutSessionRef) {
    clauses.push(`${column("checkout_session_ref")} = ${parameter(options.checkoutSessionRef)}`);
  }
  if (options.search) {
    const normalizedSearch = options.search.trim().toLocaleLowerCase("cs-CZ");
    const queryTokens = searchIndex?.queryTokens(normalizedSearch) ?? [];
    const searchConditions: string[] = [];
    if (queryTokens.length > 0) {
      searchConditions.push(
        `search_observation.search_index_version = 1 AND search_observation.search_tokens @> ${parameter(queryTokens)}::text[]`,
      );
    }
    if (/^[a-f0-9]{2,64}$/.test(normalizedSearch)) {
      searchConditions.push(
        `search_observation.checkout_session_ref LIKE ${parameter(`${normalizedSearch}%`)}`,
      );
    }
    clauses.push(
      searchConditions.length === 0
        ? "FALSE"
        : `EXISTS (
             SELECT 1
             FROM app.shadow_observations AS search_observation
             WHERE search_observation.project_ref = ${column("project_ref")}
               AND search_observation.expires_at > $2
               AND ${shadowCaseKey("search_observation")} = ${shadowCaseKey(alias)}
               AND (${searchConditions.map((condition) => `(${condition})`).join(" OR ")})
           )`,
    );
  }
  if (options.from) clauses.push(`${column("created_at")} >= ${parameter(options.from)}`);
  if (options.to) clauses.push(`${column("created_at")} <= ${parameter(options.to)}`);

  return { sql: clauses.join(" AND "), values };
}

function mapObservation(
  row: ShadowObservationRow,
  cipher: ShadowObservationCipher | null,
): StoredShadowObservation {
  return {
    id: row.id,
    requestId: row.request_id,
    operation: row.operation,
    clientName: row.client_name,
    formId: row.form_id,
    formName: row.form_name,
    checkoutSessionRef: row.checkout_session_ref,
    inputValue: decryptValue(cipher, row.input_value_ciphertext, row.id, "input"),
    proposedValue: decryptValue(cipher, row.proposed_value_ciphertext, row.id, "proposed"),
    inputPreview: row.input_preview,
    proposedPreview: row.proposed_preview,
    changed: row.changed,
    resultClass: row.result_class,
    action: row.action,
    issueCodes: row.issue_codes,
    evidenceSources: row.evidence_sources,
    durationMs: row.duration_ms,
    assistShownAt: row.assist_shown_at,
    assistOutcome: row.assist_outcome,
    assistOutcomeAt: row.assist_outcome_at,
    assistChangedFields: row.assist_changed_fields ?? [],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function encryptValue(
  cipher: ShadowObservationCipher | null,
  value: string,
  observationId: string,
  field: "input" | "proposed",
): string | null {
  return cipher?.encrypt(value, `${observationId}:${field}`) ?? null;
}

function decryptValue(
  cipher: ShadowObservationCipher | null,
  envelope: string | null,
  observationId: string,
  field: "input" | "proposed",
): string | null {
  if (!cipher || !envelope) return null;
  try {
    return cipher.decrypt(envelope, `${observationId}:${field}`);
  } catch {
    return null;
  }
}

function roundedMetric(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : 0;
}
