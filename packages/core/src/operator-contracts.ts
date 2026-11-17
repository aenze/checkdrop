/** Operator wire contracts; no database or server runtime dependencies. */
export type Environment = "test" | "live";
export type IntegrationState = "draft" | "scanned" | "configured" | "shadow" | "paused";
export type IntegrationFormState = "draft" | "scanned" | "configured" | "paused";
export type MatchMode = "exact" | "prefix";
export type CanonicalField =
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
export type FieldContext = "billing" | "shipping" | "company" | "shared";
export type ValidationMode = "off" | "shadow" | "suggest";
export type ValidationTrigger = "input" | "blur" | "submit";

export interface IntegrationField {
  readonly id?: string;
  readonly selector: string;
  readonly label: string;
  readonly name: string | null;
  readonly canonical_field: CanonicalField;
  readonly context: FieldContext;
  readonly condition_key: string | null;
  readonly required: boolean;
  readonly require_complete_name?: boolean;
  readonly require_domestic_address?: boolean;
  readonly submit_selector?: string | null;
  readonly validation_mode: ValidationMode;
  readonly validation_trigger: ValidationTrigger;
  readonly confidence: number | null;
  readonly detected: boolean;
}

export interface ApiKeySummary {
  readonly id: string;
  readonly name: string;
  readonly key_prefix: string;
  readonly environment: Environment;
  readonly state: "active" | "revoked";
  readonly created_at: string;
  readonly last_used_at: string | null;
}

export interface Integration {
  readonly object?: "integration";
  readonly id: string;
  readonly name: string;
  readonly client_name: string;
  readonly environment: Environment;
  readonly form_url: string;
  readonly state: IntegrationState;
  readonly config_version: number;
  readonly site_key: string;
  readonly embed_script: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly fields: readonly IntegrationField[];
  readonly forms: readonly IntegrationFormProfile[];
  readonly api_keys: readonly ApiKeySummary[];
  readonly activity: {
    readonly last_key_used_at: string | null;
    readonly observation_count_24h: number;
    readonly last_observation_at: string | null;
  };
}

export interface IntegrationFormProfile {
  readonly object?: "integration_form";
  readonly id: string;
  readonly name: string;
  readonly form_url: string;
  readonly match_mode: MatchMode;
  readonly path_pattern: string;
  readonly root_selector: string;
  readonly state: IntegrationFormState;
  readonly config_version: number;
  readonly is_default: boolean;
  readonly created_at: string;
  readonly updated_at: string;
  readonly fields: readonly IntegrationField[];
}

export interface ConfigVersion {
  readonly version: number;
  readonly field_count: number;
  readonly created_at: string;
  readonly current: boolean;
}

export interface FormScan {
  readonly id: string;
  readonly sanitizedUrl: string;
  readonly pageTitle: string | null;
  readonly formCount: number;
  readonly fields: readonly {
    readonly selector: string;
    readonly rootSelector?: string;
    readonly label: string;
    readonly name: string | null;
    readonly canonicalField: CanonicalField;
    readonly context: FieldContext;
    readonly required: boolean;
    readonly validationMode: ValidationMode;
    readonly validationTrigger: ValidationTrigger;
    readonly confidence: number;
  }[];
  readonly drift: {
    readonly changed: boolean;
    readonly missing_selectors: readonly string[];
    readonly added_selectors: readonly string[];
  };
}
