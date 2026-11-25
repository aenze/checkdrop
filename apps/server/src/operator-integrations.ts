import { timingSafeEqual } from "node:crypto";
import type {
  CanonicalFormField,
  CheckoutEventStore,
  FieldValidationMode,
  FieldValidationTrigger,
  FormFieldContext,
  InstanceStatusStore,
  IntegrationEnvironment,
  IntegrationFormMatchMode,
  IntegrationFormRecord,
  IntegrationFormState,
  IntegrationRecord,
  IntegrationState,
  IntegrationStore,
  SaveIntegrationFieldInput,
  ShadowObservationAssistFilter,
  ShadowObservationFilter,
  ShadowObservationOperation,
  ShadowObservationStatus,
  ShadowObservationStore,
} from "@checkdrop/db";
import { IntegrationVersionConflict, normalizeIntegrationPath } from "@checkdrop/db";
import type { Context, Hono } from "hono";
import { generatePilotApiKey } from "./api-key.js";
import type { CustomerAuthorizer } from "./customer-authorization.js";
import {
  FormScanError,
  type FormScanResult,
  sanitizeFormUrl,
  scanFormUrl,
} from "./form-scanner.js";
import { type Locale, msg, requestLocale } from "./i18n.js";
import { PROBLEM_TYPE_BASE } from "./instance-config.js";
import { isNewerVersion, type UpdateState } from "./instance-state.js";
import { serializeIntegration } from "./operator-serialization.js";

const MAX_OPERATOR_BODY_BYTES = 64 * 1_024;

/** A message built outside a route; the route picks the language with msg(). */
interface Bilingual {
  readonly cs: string;
  readonly en: string;
}

const canonicalFields: readonly CanonicalFormField[] = [
  "customer_type",
  "full_name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "street_line",
  "city",
  "postal_code",
  "country",
  "company_id",
  "company_name",
  "vat_id",
  "profile_details_enabled",
  "alternate_shipping_enabled",
  "unmapped",
];
const fieldContexts: readonly FormFieldContext[] = ["billing", "shipping", "company", "shared"];
const validationModes: readonly FieldValidationMode[] = ["off", "shadow", "suggest"];
const validationTriggers: readonly FieldValidationTrigger[] = ["input", "blur", "submit"];
const integrationStates: readonly IntegrationState[] = [
  "draft",
  "scanned",
  "configured",
  "shadow",
  "paused",
];
const integrationFormStates: readonly IntegrationFormState[] = ["configured", "paused"];
const integrationFormMatchModes: readonly IntegrationFormMatchMode[] = ["exact", "prefix"];
const observationOperations: readonly ShadowObservationOperation[] = [
  "name.validate",
  "email.validate",
  "phone.validate",
  "address.validate",
  "company_id.validate",
];
const observationStatuses: readonly ShadowObservationStatus[] = [
  "valid",
  "correctable",
  "risky",
  "invalid",
  "unknown",
];
const observationAssistOutcomes: readonly ShadowObservationAssistFilter[] = [
  "shown_only",
  "applied",
  "kept",
  "undone",
  "none",
];

export interface OperatorInstanceDependencies {
  readonly release: string;
  readonly adminAuthMode: string;
  readonly status: InstanceStatusStore | null;
  readonly readUpdateState: () => Promise<UpdateState | null>;
}

export interface OperatorIntegrationDependencies {
  readonly instance?: OperatorInstanceDependencies;
  readonly customerAuthorizer?: CustomerAuthorizer;
  readonly checkoutEventStore?: CheckoutEventStore | null;
  readonly store: IntegrationStore | null;
  readonly operatorToken: string | null;
  readonly projectRef: string | null;
  readonly observationStore?: ShadowObservationStore | null;
  /** The locale only names generated text, such as the label of an unnamed field. */
  readonly scanForm?: (url: string, locale: Locale) => Promise<FormScanResult>;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}

export function registerOperatorIntegrationRoutes(
  app: Hono,
  dependencies: OperatorIntegrationDependencies,
) {
  const now = dependencies.now ?? (() => new Date());
  const randomId = dependencies.randomId ?? (() => crypto.randomUUID());
  const scanForm =
    dependencies.scanForm ?? ((url: string, locale: Locale) => scanFormUrl(url, { locale }));

  app.get("/v1/operator/checkout-sessions", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    if (!dependencies.checkoutEventStore)
      return context.json(
        {
          detail: msg(
            context,
            "Měření košíku není dostupné.",
            "Checkout measurement is not available.",
          ),
        },
        503,
      );
    const from = new Date(context.req.query("from") ?? Date.now() - 86400000);
    const sessionRefs = context.req.queries("session_ref");
    if (
      sessionRefs &&
      (sessionRefs.length > 100 || sessionRefs.some((ref) => !/^[a-f0-9]{64}$/.test(ref)))
    )
      return context.json({ detail: msg(context, "Neplatné relace.", "Invalid sessions.") }, 400);
    if (!Number.isFinite(from.getTime()))
      return context.json({ detail: msg(context, "Neplatné datum.", "Invalid date.") }, 400);
    const data = await dependencies.checkoutEventStore.list(
      operator.projectRef,
      from,
      context.req.query("include_tests") === "1",
      sessionRefs,
    );
    return operatorJson(context, {
      object: "checkout_session_list",
      data,
      completion_tracking: "browser_reported",
    });
  });

  /** The installation itself: version, updates and address data, never customer data. */
  app.get("/v1/operator/instance", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const instance = dependencies.instance;
    if (!instance)
      return operatorProblem(
        context,
        503,
        msg(context, "Stav instalace není dostupný.", "Installation status is not available."),
      );
    const [addressData, jobs, update] = await Promise.all([
      instance.status?.activeAddressData().catch(() => null) ?? null,
      instance.status?.jobs().catch(() => []) ?? [],
      instance.readUpdateState(),
    ]);
    const addressJob = jobs.find((job) => job.name === "address-data") ?? null;
    return operatorJson(context, {
      object: "instance",
      version: instance.release,
      admin_auth: instance.adminAuthMode,
      update: update && {
        ...update,
        available:
          update.latest_version !== null && isNewerVersion(update.latest_version, instance.release),
      },
      address_data: {
        state: addressData
          ? "ready"
          : addressJob?.state === "running"
            ? "importing"
            : addressJob?.state === "failed"
              ? "failed"
              : "missing",
        version: addressData?.version ?? null,
        effective_at: addressData?.effectiveAt ?? null,
        row_count: addressData?.rowCount ?? null,
        last_attempt_at: addressJob?.startedAt ?? null,
        message: addressJob?.state === "failed" ? addressJob.message : null,
      },
      jobs: jobs.map((job) => ({
        name: job.name,
        state: job.state,
        started_at: job.startedAt,
        finished_at: job.finishedAt,
      })),
    });
  });

  app.get("/v1/operator/integrations", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const data = await operator.store.listIntegrations(operator.projectRef);
    return operatorJson(context, {
      object: "integration_list",
      request_id: context.get("requestId"),
      data: data.map((record) => serializeIntegration(record)),
    });
  });

  app.get("/v1/operator/observations", async (context) => {
    return listOperatorObservations(context, dependencies, now);
  });

  app.post("/v1/operator/observations/search", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const body = await readOperatorJson(context);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["query"]) || typeof body.query !== "string") {
      return operatorProblem(
        context,
        400,
        msg(context, "Vyhledávání vyžaduje textový dotaz.", "Search requires a text query."),
      );
    }
    const search = body.query.trim();
    const hasControlCharacters = [...search].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    });
    if (search.length < 2 || search.length > 120 || hasControlCharacters) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Hledaný text musí mít 2–120 znaků.",
          "The search text must be 2–120 characters long.",
        ),
      );
    }
    return listOperatorObservations(context, dependencies, now, search);
  });

  app.post("/v1/operator/integrations", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const body = await readOperatorJson(context);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["name", "client_name", "environment", "form_url", "form_name"])) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Požadavek obsahuje nepodporovaná pole.",
          "The request contains unsupported fields.",
        ),
      );
    }
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Název napojení musí mít 1–120 znaků.",
          "The connection name must be 1–120 characters long.",
        ),
      );
    }
    if (
      typeof body.client_name !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(body.client_name) ||
      !/[A-Za-z]/.test(body.client_name)
    ) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Identifikátor integrace nemá povolený formát.",
          "The integration identifier has an unsupported format.",
        ),
      );
    }
    if (body.environment !== "test" && body.environment !== "live") {
      return operatorProblem(
        context,
        400,
        msg(context, "Prostředí musí být test nebo live.", "The environment must be test or live."),
      );
    }
    if (typeof body.form_url !== "string") {
      return operatorProblem(
        context,
        400,
        msg(context, "Zadejte URL formuláře.", "Enter the form URL."),
      );
    }
    if (
      body.form_name !== undefined &&
      (typeof body.form_name !== "string" || !body.form_name.trim() || body.form_name.length > 120)
    ) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Název prvního formuláře musí mít 1–120 znaků.",
          "The first form name must be 1–120 characters long.",
        ),
      );
    }
    let formUrl: string;
    try {
      const parsed = sanitizeFormUrl(body.form_url);
      parsed.search = "";
      formUrl = parsed.toString();
    } catch (error) {
      return operatorProblem(
        context,
        400,
        error instanceof FormScanError
          ? msg(context, error.cs, error.en)
          : msg(context, "URL formuláře není platná.", "The form URL is not valid."),
      );
    }
    const created = await operator.store.createIntegration({
      id: randomId(),
      projectRef: operator.projectRef,
      name: body.name.trim(),
      clientName: body.client_name,
      environment: body.environment,
      formUrl,
      ...(typeof body.form_name === "string" ? { initialFormName: body.form_name.trim() } : {}),
      createdAt: now(),
    });
    return operatorJson(context, serializeIntegration(created), 201);
  });

  app.get("/v1/operator/integrations/:id", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const record = await operator.store.getIntegration(
      operator.projectRef,
      context.req.param("id"),
    );
    return record
      ? operatorJson(context, serializeIntegration(record))
      : operatorProblem(
          context,
          404,
          msg(context, "Napojení nebylo nalezeno.", "Connection not found."),
        );
  });

  app.post("/v1/operator/integrations/:id/forms", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const integration = await operator.store.getIntegration(
      operator.projectRef,
      context.req.param("id"),
    );
    if (!integration)
      return operatorProblem(
        context,
        404,
        msg(context, "Webové napojení nebylo nalezeno.", "Website connection not found."),
      );
    const body = await readOperatorJson(context);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["name", "form_url", "match_mode", "path_pattern", "root_selector"])) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Požadavek obsahuje nepodporovaná pole.",
          "The request contains unsupported fields.",
        ),
      );
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 120) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Název formuláře musí mít 1–120 znaků.",
          "The form name must be 1–120 characters long.",
        ),
      );
    }
    if (typeof body.form_url !== "string") {
      return operatorProblem(
        context,
        400,
        msg(context, "Zadejte URL formuláře.", "Enter the form URL."),
      );
    }
    const matchMode = body.match_mode ?? "exact";
    if (!integrationFormMatchModes.includes(matchMode as IntegrationFormMatchMode)) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Pravidlo cesty musí být přesná cesta nebo prefix.",
          "The path rule must be an exact path or a prefix.",
        ),
      );
    }
    let parsed: URL;
    try {
      parsed = sanitizeFormUrl(body.form_url);
      parsed.search = "";
      parsed.hash = "";
    } catch (error) {
      return operatorProblem(
        context,
        400,
        error instanceof FormScanError
          ? msg(context, error.cs, error.en)
          : msg(context, "URL formuláře není platná.", "The form URL is not valid."),
      );
    }
    if (parsed.origin !== new URL(integration.formUrl).origin) {
      return operatorProblem(
        context,
        409,
        msg(
          context,
          "Formuláře jednoho webu musí být na stejné doméně. Pro jinou doménu založte nové napojení.",
          "Forms of one website must be on the same domain. Create a new connection for another domain.",
        ),
      );
    }
    const requestedPattern =
      typeof body.path_pattern === "string" ? body.path_pattern : parsed.pathname;
    const pathPattern = normalizeIntegrationPath(requestedPattern);
    if (!pathPattern) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Cesta formuláře musí začínat / a nesmí obsahovat dotaz.",
          "The form path must start with / and must not contain a query.",
        ),
      );
    }
    const rootSelector = normalizeRootSelector(body.root_selector);
    if (!rootSelector) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Kořen formuláře musí být platný CSS selektor do 512 znaků.",
          "The form root must be a valid CSS selector of up to 512 characters.",
        ),
      );
    }
    if (
      integration.forms.some(
        (form) =>
          form.matchMode === matchMode &&
          form.pathPattern === pathPattern &&
          (form.rootSelector ?? "body") === rootSelector,
      )
    ) {
      return operatorProblem(
        context,
        409,
        msg(
          context,
          "Pro tuto cestu už formulář existuje.",
          "A form already exists for this path.",
        ),
      );
    }
    const saved = await operator.store.createForm({
      id: randomId(),
      integrationId: integration.id,
      projectRef: operator.projectRef,
      name,
      formUrl: parsed.toString(),
      matchMode: matchMode as IntegrationFormMatchMode,
      pathPattern,
      rootSelector,
      createdAt: now(),
    });
    return saved
      ? operatorJson(context, serializeIntegration(saved), 201)
      : operatorProblem(
          context,
          404,
          msg(context, "Webové napojení nebylo nalezeno.", "Website connection not found."),
        );
  });

  app.put("/v1/operator/integrations/:id/forms/:formId/root", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const body = await readOperatorJson(context);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["root_selector"])) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Požadavek obsahuje nepodporovaná pole.",
          "The request contains unsupported fields.",
        ),
      );
    }
    const rootSelector = normalizeRootSelector(body.root_selector);
    if (!rootSelector) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Kořen formuláře musí být platný CSS selektor do 512 znaků.",
          "The form root must be a valid CSS selector of up to 512 characters.",
        ),
      );
    }
    if (!operator.store.setFormRootSelector) {
      return operatorProblem(
        context,
        503,
        msg(
          context,
          "Úprava kořene formuláře není na serveru dostupná.",
          "Changing the form root is not available on this server.",
        ),
      );
    }
    const saved = await operator.store.setFormRootSelector(
      operator.projectRef,
      context.req.param("id"),
      context.req.param("formId"),
      rootSelector,
      now(),
    );
    return saved
      ? operatorJson(context, serializeIntegration(saved))
      : operatorProblem(context, 404, msg(context, "Formulář nebyl nalezen.", "Form not found."));
  });

  app.post("/v1/operator/integrations/:id/forms/:formId/scan", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const integration = await operator.store.getIntegration(
      operator.projectRef,
      context.req.param("id"),
    );
    const form = integration?.forms.find(
      (candidate) => candidate.id === context.req.param("formId"),
    );
    if (!integration || !form)
      return operatorProblem(
        context,
        404,
        msg(context, "Formulář nebyl nalezen.", "Form not found."),
      );
    const body = await readOperatorJson(context, true);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["url"]) || (body.url !== undefined && typeof body.url !== "string")) {
      return operatorProblem(
        context,
        400,
        msg(context, "Volitelná URL musí být text.", "The optional URL must be a string."),
      );
    }
    const scanUrl = typeof body.url === "string" ? body.url : form.formUrl;
    const scanId = randomId();
    try {
      const scan = await scanForm(scanUrl, requestLocale(context));
      if (new URL(scan.sanitizedUrl).origin !== new URL(integration.formUrl).origin) {
        return operatorProblem(
          context,
          409,
          msg(
            context,
            "Skenovaná stránka musí být na doméně tohoto webu.",
            "The scanned page must be on this website's domain.",
          ),
        );
      }
      await operator.store.saveFormScan({
        id: scanId,
        integrationId: integration.id,
        formId: form.id,
        projectRef: operator.projectRef,
        sanitizedUrl: scan.sanitizedUrl,
        state: "completed",
        detectedFields: scan.fields,
        errorCode: null,
        createdAt: now(),
      });
      return operatorJson(context, {
        object: "form_scan",
        request_id: context.get("requestId"),
        id: scanId,
        ...scan,
        drift: compareFormSelectorDrift(form, scan),
      });
    } catch (error) {
      const code = error instanceof FormScanError ? error.code : "fetch_failed";
      await operator.store.saveFormScan({
        id: scanId,
        integrationId: integration.id,
        formId: form.id,
        projectRef: operator.projectRef,
        sanitizedUrl: form.formUrl,
        state: "failed",
        detectedFields: [],
        errorCode: code,
        createdAt: now(),
      });
      return operatorProblem(
        context,
        400,
        error instanceof FormScanError
          ? msg(context, error.cs, error.en)
          : msg(context, "Sken formuláře selhal.", "The form scan failed."),
        { scan_code: code },
      );
    }
  });

  app.put("/v1/operator/integrations/:id/forms/:formId/fields", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const body = await readOperatorJson(context);
    if (body instanceof Response) return body;
    if (
      !hasOnlyKeys(body, ["fields", "expected_version"]) ||
      !Array.isArray(body.fields) ||
      body.fields.length > 100
    ) {
      return operatorProblem(
        context,
        400,
        msg(context, "Pošlete nejvýše 100 mapovaných polí.", "Send at most 100 mapped fields."),
      );
    }
    if (
      body.expected_version !== undefined &&
      (!Number.isSafeInteger(body.expected_version) || Number(body.expected_version) < 1)
    ) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Výchozí verze konfigurace musí být kladné celé číslo.",
          "The base configuration version must be a positive integer.",
        ),
      );
    }
    const fields: SaveIntegrationFieldInput[] = [];
    for (const value of body.fields) {
      const parsed = parseMappedField(value, randomId);
      if (!parsed)
        return operatorProblem(
          context,
          400,
          msg(context, "Mapování pole není platné.", "The field mapping is not valid."),
        );
      fields.push(parsed);
    }
    const fieldProblem = validateMappedFields(fields);
    if (fieldProblem)
      return operatorProblem(context, 409, msg(context, fieldProblem.cs, fieldProblem.en));
    try {
      const saved = await operator.store.replaceFormFields(
        operator.projectRef,
        context.req.param("id"),
        context.req.param("formId"),
        fields,
        now(),
        body.expected_version as number | undefined,
      );
      return saved
        ? operatorJson(context, serializeIntegration(saved))
        : operatorProblem(context, 404, msg(context, "Formulář nebyl nalezen.", "Form not found."));
    } catch (error) {
      if (error instanceof IntegrationVersionConflict)
        return operatorProblem(
          context,
          409,
          msg(
            context,
            error.message,
            "Someone else changed the configuration in the meantime. Load the current version; your unsaved changes are kept.",
          ),
        );
      throw error;
    }
  });

  app.post("/v1/operator/integrations/:id/forms/:formId/state", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const body = await readOperatorJson(context);
    if (body instanceof Response) return body;
    if (
      !hasOnlyKeys(body, ["state"]) ||
      !integrationFormStates.includes(body.state as IntegrationFormState)
    ) {
      return operatorProblem(
        context,
        400,
        msg(context, "Stav formuláře není podporovaný.", "The form state is not supported."),
      );
    }
    const integration = await operator.store.getIntegration(
      operator.projectRef,
      context.req.param("id"),
    );
    const form = integration?.forms.find(
      (candidate) => candidate.id === context.req.param("formId"),
    );
    if (!integration || !form)
      return operatorProblem(
        context,
        404,
        msg(context, "Formulář nebyl nalezen.", "Form not found."),
      );
    if (body.state === "configured") {
      const activationProblem = validateFormActivation(form);
      if (activationProblem)
        return operatorProblem(
          context,
          409,
          msg(context, activationProblem.cs, activationProblem.en),
        );
    }
    const saved = await operator.store.setFormState(
      operator.projectRef,
      integration.id,
      form.id,
      body.state as IntegrationFormState,
      now(),
    );
    return saved
      ? operatorJson(context, serializeIntegration(saved))
      : operatorProblem(context, 404, msg(context, "Formulář nebyl nalezen.", "Form not found."));
  });

  app.get("/v1/operator/integrations/:id/forms/:formId/versions", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const integration = await operator.store.getIntegration(
      operator.projectRef,
      context.req.param("id"),
    );
    const form = integration?.forms.find(
      (candidate) => candidate.id === context.req.param("formId"),
    );
    if (!integration || !form)
      return operatorProblem(
        context,
        404,
        msg(context, "Formulář nebyl nalezen.", "Form not found."),
      );
    const versions = await operator.store.listFormConfigVersions(
      operator.projectRef,
      integration.id,
      form.id,
    );
    return operatorJson(context, {
      object: "integration_form_config_version_list",
      data: versions.map((version) => ({
        version: version.version,
        field_count: version.fieldCount,
        created_at: version.createdAt.toISOString(),
        current: version.version === form.configVersion,
      })),
    });
  });

  app.post("/v1/operator/integrations/:id/forms/:formId/rollback", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const body = await readOperatorJson(context);
    if (body instanceof Response) return body;
    if (
      !hasOnlyKeys(body, ["version"]) ||
      !Number.isInteger(body.version) ||
      Number(body.version) < 1
    ) {
      return operatorProblem(
        context,
        400,
        msg(context, "Zadejte platnou verzi konfigurace.", "Enter a valid configuration version."),
      );
    }
    const restored = await operator.store.rollbackFormConfigVersion(
      operator.projectRef,
      context.req.param("id"),
      context.req.param("formId"),
      Number(body.version),
      now(),
    );
    return restored
      ? operatorJson(context, serializeIntegration(restored))
      : operatorProblem(
          context,
          404,
          msg(
            context,
            "Požadovaná verze konfigurace nebyla nalezena.",
            "The requested configuration version was not found.",
          ),
        );
  });

  app.post("/v1/operator/integrations/:id/scan", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const integration = await operator.store.getIntegration(
      operator.projectRef,
      context.req.param("id"),
    );
    if (!integration)
      return operatorProblem(
        context,
        404,
        msg(context, "Napojení nebylo nalezeno.", "Connection not found."),
      );
    const body = await readOperatorJson(context, true);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["url"]) || (body.url !== undefined && typeof body.url !== "string")) {
      return operatorProblem(
        context,
        400,
        msg(context, "Volitelná URL musí být text.", "The optional URL must be a string."),
      );
    }
    const scanUrl = typeof body.url === "string" ? body.url : integration.formUrl;
    const defaultForm = integration.forms.find((form) => form.isDefault) ?? integration.forms[0];
    if (!defaultForm)
      return operatorProblem(
        context,
        404,
        msg(context, "Výchozí formulář nebyl nalezen.", "Default form not found."),
      );
    const scanId = randomId();
    try {
      const scan = await scanForm(scanUrl, requestLocale(context));
      await operator.store.saveFormScan({
        id: scanId,
        integrationId: integration.id,
        formId: defaultForm.id,
        projectRef: operator.projectRef,
        sanitizedUrl: scan.sanitizedUrl,
        state: "completed",
        detectedFields: scan.fields,
        errorCode: null,
        createdAt: now(),
      });
      return operatorJson(context, {
        object: "form_scan",
        request_id: context.get("requestId"),
        id: scanId,
        ...scan,
        drift: compareSelectorDrift(integration, scan),
      });
    } catch (error) {
      const code = error instanceof FormScanError ? error.code : "fetch_failed";
      await operator.store.saveFormScan({
        id: scanId,
        integrationId: integration.id,
        formId: defaultForm.id,
        projectRef: operator.projectRef,
        sanitizedUrl: integration.formUrl,
        state: "failed",
        detectedFields: [],
        errorCode: code,
        createdAt: now(),
      });
      return operatorProblem(
        context,
        400,
        error instanceof FormScanError
          ? msg(context, error.cs, error.en)
          : msg(context, "Sken formuláře selhal.", "The form scan failed."),
        { scan_code: code },
      );
    }
  });

  app.put("/v1/operator/integrations/:id/fields", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const body = await readOperatorJson(context);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["fields"]) || !Array.isArray(body.fields) || body.fields.length > 100) {
      return operatorProblem(
        context,
        400,
        msg(context, "Pošlete nejvýše 100 mapovaných polí.", "Send at most 100 mapped fields."),
      );
    }
    const fields: SaveIntegrationFieldInput[] = [];
    for (const value of body.fields) {
      const parsed = parseMappedField(value, randomId);
      if (!parsed)
        return operatorProblem(
          context,
          400,
          msg(context, "Mapování pole není platné.", "The field mapping is not valid."),
        );
      fields.push(parsed);
    }
    const fieldProblem = validateMappedFields(fields);
    if (fieldProblem)
      return operatorProblem(context, 409, msg(context, fieldProblem.cs, fieldProblem.en));
    const saved = await operator.store.replaceFields(
      operator.projectRef,
      context.req.param("id"),
      fields,
      now(),
    );
    return saved
      ? operatorJson(context, serializeIntegration(saved))
      : operatorProblem(
          context,
          404,
          msg(context, "Napojení nebylo nalezeno.", "Connection not found."),
        );
  });

  app.post("/v1/operator/integrations/:id/keys", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const integration = await operator.store.getIntegration(
      operator.projectRef,
      context.req.param("id"),
    );
    if (!integration)
      return operatorProblem(
        context,
        404,
        msg(context, "Napojení nebylo nalezeno.", "Connection not found."),
      );
    const body = await readOperatorJson(context);
    if (body instanceof Response) return body;
    if (!hasOnlyKeys(body, ["name", "environment"])) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Požadavek obsahuje nepodporovaná pole.",
          "The request contains unsupported fields.",
        ),
      );
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const environment: IntegrationEnvironment =
      body.environment === "test" || body.environment === "live"
        ? body.environment
        : integration.environment;
    if (!name || name.length > 120) {
      return operatorProblem(
        context,
        400,
        msg(
          context,
          "Název klíče musí mít 1–120 znaků.",
          "The key name must be 1–120 characters long.",
        ),
      );
    }
    const generated = generatePilotApiKey();
    const keyId = randomId();
    const createdAt = now();
    await operator.store.createApiKey(operator.projectRef, integration.id, environment, {
      id: keyId,
      projectRef: operator.projectRef,
      name,
      keyPrefix: generated.prefix,
      verifier: generated.verifier,
      state: "active",
      createdAt,
    });
    return operatorJson(
      context,
      {
        object: "api_key_secret",
        request_id: context.get("requestId"),
        id: keyId,
        name,
        environment,
        key_prefix: generated.prefix,
        api_key: generated.key,
        created_at: createdAt.toISOString(),
        shown_once: true,
      },
      201,
    );
  });

  app.delete("/v1/operator/integrations/:id/keys/:keyId", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const integration = await operator.store.getIntegration(
      operator.projectRef,
      context.req.param("id"),
    );
    if (!integration)
      return operatorProblem(
        context,
        404,
        msg(context, "Napojení nebylo nalezeno.", "Connection not found."),
      );
    const activeKeys = integration.apiKeys.filter((key) => key.state === "active");
    if (
      integration.state === "shadow" &&
      activeKeys.length === 1 &&
      activeKeys[0]?.id === context.req.param("keyId")
    ) {
      return operatorProblem(
        context,
        409,
        msg(
          context,
          "Poslední aktivní klíč nelze zneplatnit za běhu. Nejdříve shadow test pozastavte.",
          "The last active key cannot be revoked while running. Pause the shadow test first.",
        ),
      );
    }
    const revoked = await operator.store.revokeApiKey(
      operator.projectRef,
      context.req.param("id"),
      context.req.param("keyId"),
      now(),
    );
    return revoked
      ? operatorJson(context, { object: "api_key_revocation", revoked: true })
      : operatorProblem(
          context,
          404,
          msg(context, "Aktivní API klíč nebyl nalezen.", "Active API key not found."),
        );
  });

  app.post("/v1/operator/integrations/:id/state", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const body = await readOperatorJson(context);
    if (body instanceof Response) return body;
    if (
      !hasOnlyKeys(body, ["state"]) ||
      !integrationStates.includes(body.state as IntegrationState)
    ) {
      return operatorProblem(
        context,
        400,
        msg(context, "Stav napojení není podporovaný.", "The connection state is not supported."),
      );
    }
    const integration = await operator.store.getIntegration(
      operator.projectRef,
      context.req.param("id"),
    );
    if (!integration)
      return operatorProblem(
        context,
        404,
        msg(context, "Napojení nebylo nalezeno.", "Connection not found."),
      );
    if (body.state === "shadow") {
      const activationProblem = validateActivation(integration);
      if (activationProblem)
        return operatorProblem(
          context,
          409,
          msg(context, activationProblem.cs, activationProblem.en),
        );
      if (!integration.apiKeys.some((key) => key.state === "active")) {
        const generated = generatePilotApiKey();
        await operator.store.createApiKey(
          operator.projectRef,
          integration.id,
          integration.environment,
          {
            id: randomId(),
            projectRef: operator.projectRef,
            name: "Hosted script runtime",
            keyPrefix: generated.prefix,
            verifier: generated.verifier,
            state: "active",
            createdAt: now(),
          },
        );
      }
    }
    const saved = await operator.store.setState(
      operator.projectRef,
      integration.id,
      body.state as IntegrationState,
      now(),
    );
    return saved
      ? operatorJson(context, serializeIntegration(saved))
      : operatorProblem(
          context,
          404,
          msg(context, "Napojení nebylo nalezeno.", "Connection not found."),
        );
  });

  app.get("/v1/operator/integrations/:id/versions", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const integration = await operator.store.getIntegration(
      operator.projectRef,
      context.req.param("id"),
    );
    if (!integration)
      return operatorProblem(
        context,
        404,
        msg(context, "Napojení nebylo nalezeno.", "Connection not found."),
      );
    const versions = await operator.store.listConfigVersions(operator.projectRef, integration.id);
    return operatorJson(context, {
      object: "integration_config_version_list",
      data: versions.map((version) => ({
        version: version.version,
        field_count: version.fieldCount,
        created_at: version.createdAt.toISOString(),
        current: version.version === integration.configVersion,
      })),
    });
  });

  app.post("/v1/operator/integrations/:id/rollback", async (context) => {
    const operator = await authenticateOperator(context, dependencies);
    if (operator instanceof Response) return operator;
    const body = await readOperatorJson(context);
    if (body instanceof Response) return body;
    if (
      !hasOnlyKeys(body, ["version"]) ||
      !Number.isInteger(body.version) ||
      Number(body.version) < 1
    ) {
      return operatorProblem(
        context,
        400,
        msg(context, "Zadejte platnou verzi konfigurace.", "Enter a valid configuration version."),
      );
    }
    const restored = await operator.store.rollbackConfigVersion(
      operator.projectRef,
      context.req.param("id"),
      Number(body.version),
      now(),
    );
    return restored
      ? operatorJson(context, serializeIntegration(restored))
      : operatorProblem(
          context,
          404,
          msg(
            context,
            "Požadovaná verze konfigurace nebyla nalezena.",
            "The requested configuration version was not found.",
          ),
        );
  });
}

async function listOperatorObservations(
  context: Context,
  dependencies: OperatorIntegrationDependencies,
  now: () => Date,
  search?: string,
) {
  const operator = await authenticateOperator(context, dependencies);
  if (operator instanceof Response) return operator;
  const observationStore = dependencies.observationStore;
  if (!observationStore) {
    return operatorProblem(
      context,
      503,
      msg(
        context,
        "Shadow monitor není na serveru nakonfigurovaný.",
        "The shadow monitor is not configured on this server.",
      ),
    );
  }
  if (search && observationStore.searchEnabled === false) {
    return operatorProblem(
      context,
      503,
      msg(
        context,
        "Vyhledávání monitoru není na serveru nakonfigurované.",
        "Monitor search is not configured on this server.",
      ),
    );
  }
  const page = boundedInteger(context.req.query("page"), 1, 100_000, 1);
  const pageSize = boundedInteger(context.req.query("page_size"), 1, 100, 25);
  const requestedFilter = context.req.query("filter") ?? "all";
  const checkoutOutcome = supportedQueryValue(context.req.query("checkout_outcome"), [
    "completed",
    "active",
    "abandoned",
    "unmeasured",
  ] as const);
  if (checkoutOutcome === null)
    return operatorProblem(
      context,
      400,
      msg(context, "Stav košíku není podporovaný.", "The checkout state is not supported."),
    );
  const filter: ShadowObservationFilter | null = ["all", "changed", "review"].includes(
    requestedFilter,
  )
    ? (requestedFilter as ShadowObservationFilter)
    : null;
  if (!filter)
    return operatorProblem(
      context,
      400,
      msg(context, "Filtr monitoru není podporovaný.", "The monitor filter is not supported."),
    );
  const operation = supportedQueryValue(context.req.query("operation"), observationOperations);
  if (operation === null)
    return operatorProblem(
      context,
      400,
      msg(context, "Pole monitoru není podporované.", "The monitor field is not supported."),
    );
  const resultClass = supportedQueryValue(context.req.query("result"), observationStatuses);
  if (resultClass === null)
    return operatorProblem(
      context,
      400,
      msg(context, "Výsledek monitoru není podporovaný.", "The monitor result is not supported."),
    );
  const assistOutcome = supportedQueryValue(
    context.req.query("assist_outcome"),
    observationAssistOutcomes,
  );
  if (assistOutcome === null) {
    return operatorProblem(
      context,
      400,
      msg(context, "Reakce zákazníka není podporovaná.", "The customer response is not supported."),
    );
  }
  const clientName = boundedClientName(context.req.query("client_name"));
  if (clientName === null)
    return operatorProblem(
      context,
      400,
      msg(context, "Identifikátor webu není platný.", "The website identifier is not valid."),
    );
  const formId = boundedIdentifier(context.req.query("form_id"), 160);
  if (formId === null)
    return operatorProblem(
      context,
      400,
      msg(context, "Identifikátor formuláře není platný.", "The form identifier is not valid."),
    );
  const checkoutSessionRef = boundedSessionRef(context.req.query("session_ref"));
  if (checkoutSessionRef === null) {
    return operatorProblem(
      context,
      400,
      msg(
        context,
        "Identifikátor zákaznického případu není platný.",
        "The customer case identifier is not valid.",
      ),
    );
  }
  const from = boundedObservationDate(context.req.query("from"));
  const to = boundedObservationDate(context.req.query("to"));
  if (from === null || to === null || (from && to && from > to)) {
    return operatorProblem(
      context,
      400,
      msg(context, "Časové období monitoru není platné.", "The monitor time range is not valid."),
    );
  }
  // The dashboard needs only the aggregate. The store has no summary-only query, so a
  // zero-row page skips loading and decrypting observations; the case count still runs.
  const summaryOnly = context.req.query("summary_only") === "1";
  try {
    const result = await observationStore.list(operator.projectRef, now(), {
      offset: summaryOnly ? 0 : (page - 1) * pageSize,
      limit: summaryOnly ? 0 : pageSize,
      filter,
      ...(operation ? { operation } : {}),
      ...(resultClass ? { resultClass } : {}),
      ...(assistOutcome ? { assistOutcome } : {}),
      ...(clientName ? { clientName } : {}),
      ...(formId ? { formId } : {}),
      ...(checkoutSessionRef ? { checkoutSessionRef } : {}),
      ...(checkoutOutcome ? { checkoutOutcome } : {}),
      ...(search ? { search } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    const summary = {
      total: result.summary.total,
      proposed_changes: result.summary.proposedChanges,
      review_required: result.summary.reviewRequired,
      average_server_latency_ms: result.summary.averageDurationMs,
      p95_server_latency_ms: result.summary.p95DurationMs,
      assist_shown: result.summary.assistShown,
      assist_applied: result.summary.assistApplied,
      assist_kept: result.summary.assistKept,
      assist_undone: result.summary.assistUndone,
    };
    if (summaryOnly) {
      return operatorJson(context, {
        object: "shadow_observation_summary",
        request_id: context.get("requestId"),
        summary,
      });
    }
    return operatorJson(context, {
      object: "shadow_observation_list",
      request_id: context.get("requestId"),
      data: result.observations.map((observation) => ({
        id: observation.id,
        request_id: observation.requestId,
        operation: observation.operation,
        client_name: observation.clientName,
        form_id: observation.formId,
        form_name: observation.formName,
        checkout_session_ref: observation.checkoutSessionRef,
        input_value: observation.inputValue ?? observation.inputPreview,
        proposed_value: observation.proposedValue ?? observation.proposedPreview,
        value_visibility: observation.inputValue === null ? "masked_legacy" : "full",
        input_preview: observation.inputPreview,
        proposed_preview: observation.proposedPreview,
        changed: observation.changed,
        status: observation.resultClass,
        action: observation.action,
        issue_codes: observation.issueCodes,
        evidence_sources: observation.evidenceSources,
        server_latency_ms: observation.durationMs,
        assist_shown_at: observation.assistShownAt?.toISOString() ?? null,
        assist_outcome: observation.assistOutcome,
        assist_outcome_at: observation.assistOutcomeAt?.toISOString() ?? null,
        assist_changed_fields: observation.assistChangedFields ?? [],
        observed_at: observation.createdAt.toISOString(),
        expires_at: observation.expiresAt.toISOString(),
      })),
      summary,
      pagination: {
        page,
        page_size: pageSize,
        total: result.total,
        pages: Math.max(1, Math.ceil(result.total / pageSize)),
      },
    });
  } catch {
    return operatorProblem(
      context,
      503,
      msg(
        context,
        "Shadow monitor je dočasně nedostupný.",
        "The shadow monitor is temporarily unavailable.",
      ),
    );
  }
}

function compareSelectorDrift(integration: IntegrationRecord, scan: FormScanResult) {
  const saved = new Set(
    integration.fields.filter((field) => field.detected).map((field) => field.sourceSelector),
  );
  const detected = new Set(scan.fields.map((field) => field.selector));
  const missing = [...saved].filter((selector) => !detected.has(selector));
  const added = [...detected].filter((selector) => !saved.has(selector));
  return {
    changed: saved.size > 0 && (missing.length > 0 || added.length > 0),
    missing_selectors: missing,
    added_selectors: saved.size > 0 ? added : [],
  };
}

function compareFormSelectorDrift(form: IntegrationFormRecord, scan: FormScanResult) {
  const saved = new Set(
    form.fields.filter((field) => field.detected).map((field) => field.sourceSelector),
  );
  const detected = new Set(scan.fields.map((field) => field.selector));
  const missing = [...saved].filter((selector) => !detected.has(selector));
  const added = [...detected].filter((selector) => !saved.has(selector));
  return {
    changed: saved.size > 0 && (missing.length > 0 || added.length > 0),
    missing_selectors: missing,
    added_selectors: saved.size > 0 ? added : [],
  };
}

async function authenticateOperator(
  context: Context,
  dependencies: OperatorIntegrationDependencies,
): Promise<{ store: IntegrationStore; projectRef: string } | Response> {
  // Never downgrade a customer request to the shared operator credential.
  if (
    context.req.header("Authorization") !== undefined ||
    context.req.header("X-Checkdrop-Project") !== undefined
  ) {
    if (!dependencies.store || !dependencies.customerAuthorizer) {
      return operatorProblem(
        context,
        503,
        msg(
          context,
          "Zákaznické přihlášení zatím není aktivní.",
          "Customer sign-in is not active yet.",
        ),
      );
    }
    const readOnly =
      context.req.method === "GET" ||
      (context.req.method === "POST" && context.req.path === "/v1/operator/observations/search");
    try {
      const result = await dependencies.customerAuthorizer(
        context.req.raw,
        readOnly ? "read" : "configure",
      );
      if (result.status === "unauthenticated")
        return operatorProblem(
          context,
          401,
          msg(context, "Přihlaste se ke svému účtu.", "Sign in to your account."),
        );
      if (result.status === "forbidden")
        return operatorProblem(
          context,
          403,
          msg(
            context,
            "K tomuto projektu nebo akci nemáte oprávnění.",
            "You do not have permission for this project or action.",
          ),
        );
      return { store: dependencies.store, projectRef: result.projectRef };
    } catch {
      // Database/verifier outages must not disclose data or reuse an earlier access decision.
      return operatorProblem(
        context,
        503,
        msg(
          context,
          "Ověření oprávnění není dočasně dostupné.",
          "Permission checks are temporarily unavailable.",
        ),
      );
    }
  }
  if (!dependencies.store || !dependencies.operatorToken || !dependencies.projectRef) {
    return operatorProblem(
      context,
      503,
      msg(
        context,
        "Správa napojení není na serveru nakonfigurovaná.",
        "Connection management is not configured on this server.",
      ),
    );
  }
  const supplied = context.req.header("X-Checkdrop-Operator-Key") ?? "";
  const candidate = Buffer.from(supplied);
  const expected = Buffer.from(dependencies.operatorToken);
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
    return operatorProblem(
      context,
      401,
      msg(
        context,
        "Správa napojení vyžaduje přihlášeného operátora.",
        "Connection management requires a signed-in operator.",
      ),
    );
  }
  return { store: dependencies.store, projectRef: dependencies.projectRef };
}

async function readOperatorJson(
  context: Context,
  optional = false,
): Promise<Record<string, unknown> | Response> {
  const contentType = context.req.header("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (optional && !context.req.header("Content-Length")) return {};
  if (contentType !== "application/json") {
    return operatorProblem(
      context,
      415,
      msg(context, "Požadavek musí být application/json.", "The request must be application/json."),
    );
  }
  const declaredLength = Number(context.req.header("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OPERATOR_BODY_BYTES) {
    return operatorProblem(
      context,
      413,
      msg(context, "Požadavek překračuje limit 64 KiB.", "The request exceeds the 64 KiB limit."),
    );
  }
  let text: string;
  try {
    text = await context.req.text();
  } catch {
    return operatorProblem(
      context,
      400,
      msg(context, "Tělo požadavku nelze přečíst.", "The request body cannot be read."),
    );
  }
  if (new TextEncoder().encode(text).byteLength > MAX_OPERATOR_BODY_BYTES) {
    return operatorProblem(
      context,
      413,
      msg(context, "Požadavek překračuje limit 64 KiB.", "The request exceeds the 64 KiB limit."),
    );
  }
  if (optional && !text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : operatorProblem(
          context,
          400,
          msg(context, "Tělo musí být JSON objekt.", "The body must be a JSON object."),
        );
  } catch {
    return operatorProblem(
      context,
      400,
      msg(context, "Tělo neobsahuje platný JSON.", "The body is not valid JSON."),
    );
  }
}

function parseMappedField(
  value: unknown,
  randomId: () => string,
): SaveIntegrationFieldInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const field = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(field, [
      "selector",
      "label",
      "name",
      "canonical_field",
      "context",
      "condition_key",
      "required",
      "require_complete_name",
      "require_domestic_address",
      "require_valid_phone",
      "fill_village_street",
      "submit_selector",
      "validation_mode",
      "validation_trigger",
      "confidence",
      "detected",
    ]) ||
    typeof field.selector !== "string" ||
    !field.selector.trim() ||
    field.selector.length > 512 ||
    typeof field.label !== "string" ||
    field.label.length > 240 ||
    (field.name !== null && field.name !== undefined && typeof field.name !== "string") ||
    !canonicalFields.includes(field.canonical_field as CanonicalFormField) ||
    !fieldContexts.includes(field.context as FormFieldContext) ||
    (field.condition_key !== null &&
      field.condition_key !== undefined &&
      typeof field.condition_key !== "string") ||
    typeof field.required !== "boolean" ||
    (field.require_complete_name !== undefined &&
      typeof field.require_complete_name !== "boolean") ||
    (field.require_domestic_address !== undefined &&
      typeof field.require_domestic_address !== "boolean") ||
    (field.require_valid_phone !== undefined && typeof field.require_valid_phone !== "boolean") ||
    (field.fill_village_street !== undefined && typeof field.fill_village_street !== "boolean") ||
    (field.submit_selector !== undefined &&
      field.submit_selector !== null &&
      (typeof field.submit_selector !== "string" ||
        !field.submit_selector.trim() ||
        field.submit_selector.length > 512)) ||
    !validationModes.includes(field.validation_mode as FieldValidationMode) ||
    !validationTriggers.includes(field.validation_trigger as FieldValidationTrigger) ||
    (field.confidence !== null &&
      field.confidence !== undefined &&
      (!Number.isInteger(field.confidence) ||
        Number(field.confidence) < 0 ||
        Number(field.confidence) > 100)) ||
    typeof field.detected !== "boolean"
  ) {
    return null;
  }
  return {
    id: randomId(),
    sourceSelector: field.selector.trim(),
    sourceLabel: field.label.trim(),
    sourceName: typeof field.name === "string" ? field.name.slice(0, 240) : null,
    canonicalField: field.canonical_field as CanonicalFormField,
    context: field.context as FormFieldContext,
    conditionKey:
      typeof field.condition_key === "string" ? field.condition_key.slice(0, 120) : null,
    required: field.required,
    requireCompleteName: field.require_complete_name === true,
    requireDomesticAddress: field.require_domestic_address === true,
    requireValidPhone: field.require_valid_phone === true,
    fillVillageStreet: field.fill_village_street === true,
    submitSelector: typeof field.submit_selector === "string" ? field.submit_selector.trim() : null,
    validationMode: field.validation_mode as FieldValidationMode,
    validationTrigger: field.validation_trigger as FieldValidationTrigger,
    confidence: typeof field.confidence === "number" ? field.confidence : null,
    detected: field.detected,
  };
}

const executableFields = new Set<CanonicalFormField>([
  "full_name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "street_line",
  "company_id",
  "company_name",
]);

function validateMappedFields(fields: readonly SaveIntegrationFieldInput[]): Bilingual | null {
  const selectorKeys = new Set<string>();
  const canonicalKeys = new Set<string>();
  const hasCustomerType = fields.some(
    (field) => field.canonicalField === "customer_type" && field.validationMode === "shadow",
  );
  for (const field of fields) {
    if (
      field.requireCompleteName &&
      (!["full_name", "first_name", "last_name"].includes(field.canonicalField) ||
        field.validationMode === "off")
    ) {
      return {
        cs: "Povinné celé jméno lze zapnout pouze u kontrolovaného osobního jména.",
        en: "A required full name can only be turned on for a checked personal name.",
      };
    }
    if (
      field.requireDomesticAddress &&
      (field.canonicalField !== "postal_code" || field.validationMode === "off")
    ) {
      return {
        cs: "Doručení jen v ČR lze zapnout pouze u kontrolovaného PSČ.",
        en: "Delivery to the Czech Republic only can only be turned on for a checked PSČ.",
      };
    }
    if (
      field.requireValidPhone &&
      (field.canonicalField !== "phone" || field.validationMode === "off")
    ) {
      return {
        cs: "Povinný platný telefon lze zapnout pouze u kontrolovaného telefonu.",
        en: "A required valid phone can only be turned on for a checked phone field.",
      };
    }
    if (
      field.fillVillageStreet &&
      (field.canonicalField !== "street_line" || field.validationMode !== "suggest")
    ) {
      return {
        cs: "Doplňování obce u adres bez ulic lze zapnout pouze u ulice v režimu návrhů.",
        en: "Completing village addresses can only be turned on for a street field that suggests.",
      };
    }
    if (field.requireCompleteName && ["first_name", "last_name"].includes(field.canonicalField)) {
      const counterpart = fields.find(
        (candidate) =>
          candidate.context === field.context &&
          candidate.canonicalField ===
            (field.canonicalField === "first_name" ? "last_name" : "first_name"),
      );
      if (
        !counterpart?.requireCompleteName ||
        counterpart.conditionKey !== field.conditionKey ||
        counterpart.submitSelector !== field.submitSelector
      ) {
        return {
          cs: "U rozděleného jména zapněte povinnost u jména i příjmení ve stejné skupině, se stejnou podmínkou a tlačítkem dokončení.",
          en: "For a split name, make both first and last name required in the same group, with the same condition and submit button.",
        };
      }
    }
    const selectorKey = `${field.context}:${field.sourceSelector}`;
    if (selectorKeys.has(selectorKey)) {
      return {
        cs: `Selektor ${field.sourceSelector} je ve stejné části objednávky použit vícekrát.`,
        en: `Selector ${field.sourceSelector} is used more than once in the same part of the order.`,
      };
    }
    selectorKeys.add(selectorKey);
    if (
      field.canonicalField !== "unmapped" &&
      !["customer_type", "profile_details_enabled", "alternate_shipping_enabled"].includes(
        field.canonicalField,
      ) &&
      field.validationMode !== "off"
    ) {
      const canonicalKey = `${field.context}:${field.canonicalField}`;
      if (canonicalKeys.has(canonicalKey)) {
        return {
          cs: `Význam ${field.canonicalField} je ve stejné části objednávky přiřazen vícekrát.`,
          en: `Meaning ${field.canonicalField} is assigned more than once in the same part of the order.`,
        };
      }
      canonicalKeys.add(canonicalKey);
    }
    if (
      field.conditionKey !== null &&
      field.conditionKey !== "customer_type=private" &&
      field.conditionKey !== "customer_type=company" &&
      field.conditionKey !== "profile_details_enabled=true" &&
      field.conditionKey !== "alternate_shipping_enabled=true" &&
      field.conditionKey !== "profile_details_enabled=true&customer_type=company"
    ) {
      return { cs: "Podmínka pole není podporovaná.", en: "The field condition is not supported." };
    }
    if (field.conditionKey?.includes("customer_type=") && !hasCustomerType) {
      return {
        cs: "Podmíněná kontrola vyžaduje namapované pole Soukromě / na firmu.",
        en: "A conditional check requires a mapped private / business customer field.",
      };
    }
    if (
      field.conditionKey?.includes("profile_details_enabled=true") &&
      !fields.some((candidate) => candidate.canonicalField === "profile_details_enabled")
    ) {
      return {
        cs: "Podmínka rozšířených údajů vyžaduje namapovanou volbu Chci vyplnit všechny údaje.",
        en: "The extended details condition requires a mapped option for filling in all details.",
      };
    }
    if (
      field.conditionKey === "alternate_shipping_enabled=true" &&
      !fields.some((candidate) => candidate.canonicalField === "alternate_shipping_enabled")
    ) {
      return {
        cs: "Doručovací pole vyžaduje namapovanou volbu Doručit na jinou adresu.",
        en: "A delivery field requires a mapped option for delivery to a different address.",
      };
    }
    if (field.validationMode === "suggest") {
      const blurAssist = ["full_name", "first_name", "last_name", "email", "phone"].includes(
        field.canonicalField,
      );
      const addressAssist = field.canonicalField === "street_line";
      const companyAssist = ["company_name", "company_id"].includes(field.canonicalField);
      if (!blurAssist && !addressAssist && !companyAssist) {
        return {
          cs: "Asistovaný návrh je možné zapnout pro jméno, firmu, IČO, e-mail, telefon a ulici.",
          en: "Assisted suggestions can be turned on for name, company, IČO, email, phone and street.",
        };
      }
      if (blurAssist && field.validationTrigger !== "blur") {
        return {
          cs: "Asistence jména, e-mailu a telefonu se spouští po opuštění pole.",
          en: "Name, email and phone assistance runs when the field loses focus.",
        };
      }
      if ((addressAssist || companyAssist) && field.validationTrigger !== "input") {
        return {
          cs: "Adresní a firemní návrhy se spouští průběžně při psaní.",
          en: "Address and company suggestions run while typing.",
        };
      }
    }
  }
  return null;
}

function validateActivation(integration: IntegrationRecord): Bilingual | null {
  const configuredForms = integration.forms.filter((form) => form.state === "configured");
  if (configuredForms.length === 0) {
    return {
      cs: "Před aktivací nastavte alespoň jeden formulář.",
      en: "Configure at least one form before activation.",
    };
  }
  for (const form of configuredForms) {
    const problem = validateFormActivation(form);
    if (problem) return { cs: `${form.name}: ${problem.cs}`, en: `${form.name}: ${problem.en}` };
  }
  return null;
}

function validateFormActivation(form: IntegrationFormRecord): Bilingual | null {
  const active = form.fields.filter(
    (field) => field.validationMode !== "off" && executableFields.has(field.canonicalField),
  );
  if (active.length === 0) {
    return {
      cs: "Před aktivací zapojte alespoň jedno kontrolované pole, například e-mail nebo jméno.",
      en: "Before activation, turn on at least one checked field, such as email or name.",
    };
  }
  for (const address of active.filter((field) => field.canonicalField === "street_line")) {
    const supporting = new Set(
      form.fields
        .filter(
          (field) =>
            field.context === address.context &&
            field.validationMode === "shadow" &&
            ["city", "postal_code", "country"].includes(field.canonicalField),
        )
        .map((field) => field.canonicalField),
    );
    const requiredAddressFields: readonly CanonicalFormField[] = ["city", "postal_code", "country"];
    const missing = requiredAddressFields.filter((field) => !supporting.has(field));
    if (missing.length > 0) {
      return {
        cs: "Kontrola adresy vyžaduje ve stejné části objednávky také město, PSČ a zemi.",
        en: "Address checks also require city, PSČ and country in the same part of the order.",
      };
    }
  }
  return null;
}

function normalizeRootSelector(value: unknown): string | null {
  if (value === undefined) return "body";
  if (typeof value !== "string") return null;
  const selector = value.trim();
  const hasControlCharacter = [...selector].some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
  if (!selector || selector.length > 512 || hasControlCharacter) return null;
  if (selector.includes("{") || selector.includes("}")) return null;
  return selector;
}

function boundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function supportedQueryValue<const Value extends string>(
  value: string | undefined,
  supported: readonly Value[],
): Value | undefined | null {
  if (value === undefined || value === "") return undefined;
  return supported.includes(value as Value) ? (value as Value) : null;
}

function boundedIdentifier(value: string | undefined, maximum: number): string | undefined | null {
  if (value === undefined || value === "") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum ? normalized : null;
}

function boundedClientName(value: string | undefined): string | undefined | null {
  if (value === undefined || value === "") return undefined;
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(value) && /[A-Za-z]/.test(value) ? value : null;
}

function boundedSessionRef(value: string | undefined): string | undefined | null {
  if (value === undefined || value === "") return undefined;
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function boundedObservationDate(value: string | undefined): Date | undefined | null {
  if (value === undefined || value === "") return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function operatorJson(context: Context, body: unknown, status: 200 | 201 = 200) {
  return context.json(body, status, { "Cache-Control": "no-store" });
}

function operatorProblem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 503,
  detail: string,
  extra: Record<string, unknown> = {},
) {
  return context.json(
    {
      type: `${PROBLEM_TYPE_BASE}/operator-${status}`,
      title: msg(context, "Napojení nelze zpracovat", "Connection request could not be processed"),
      status,
      detail,
      request_id: context.get("requestId"),
      ...extra,
    },
    status,
    { "Content-Type": "application/problem+json", "Cache-Control": "no-store" },
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const accepted = new Set(allowed);
  return Object.keys(value).every((key) => accepted.has(key));
}
