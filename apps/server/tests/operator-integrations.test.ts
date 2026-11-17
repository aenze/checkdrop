import type {
  CreateIntegrationInput,
  CreatePilotApiKeyInput,
  IntegrationEnvironment,
  IntegrationFormRecord,
  IntegrationFormState,
  IntegrationRecord,
  IntegrationState,
  IntegrationStore,
  PilotStore,
  SaveFormScanInput,
  ShadowObservationStore,
} from "@checkdrop/db";
import { IntegrationVersionConflict } from "@checkdrop/db";
import { describe, expect, it, vi } from "vitest";
import { hashApiKey } from "../src/api-key.js";
import { createApp } from "../src/app.js";

function memoryIntegrationStore(): IntegrationStore & {
  readonly scans: SaveFormScanInput[];
} {
  const records = new Map<string, IntegrationRecord>();
  const versions = new Map<
    string,
    Array<{ version: number; fields: IntegrationRecord["fields"]; createdAt: Date }>
  >();
  const scans: SaveFormScanInput[] = [];
  return {
    scans,
    async listIntegrations(projectRef) {
      return [...records.values()].filter((record) => record.projectRef === projectRef);
    },
    async getIntegration(projectRef, id) {
      const record = records.get(id);
      return record?.projectRef === projectRef ? record : null;
    },
    async getIntegrationById(id) {
      return records.get(id) ?? null;
    },
    async createIntegration(input: CreateIntegrationInput) {
      const form: IntegrationFormRecord = {
        id: `${input.id}-form-1`,
        integrationId: input.id,
        name: input.initialFormName ?? "Hlavní formulář",
        formUrl: input.formUrl,
        matchMode: "exact",
        pathPattern: new URL(input.formUrl).pathname,
        state: "draft",
        configVersion: 1,
        isDefault: true,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        fields: [],
      };
      const record: IntegrationRecord = {
        id: input.id,
        projectRef: input.projectRef,
        name: input.name,
        clientName: input.clientName,
        environment: input.environment,
        formUrl: input.formUrl,
        state: "draft",
        configVersion: 1,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        fields: [],
        forms: [form],
        apiKeys: [],
        activity: {
          lastKeyUsedAt: null,
          observationCount24h: 0,
          lastObservationAt: null,
        },
      };
      records.set(record.id, record);
      versions.set(form.id, [{ version: 1, fields: [], createdAt: input.createdAt }]);
      return record;
    },
    async createForm(input) {
      const record = records.get(input.integrationId);
      if (!record || record.projectRef !== input.projectRef) return null;
      const form: IntegrationFormRecord = {
        id: input.id,
        integrationId: input.integrationId,
        name: input.name,
        formUrl: input.formUrl,
        matchMode: input.matchMode,
        pathPattern: input.pathPattern,
        state: "draft",
        configVersion: 1,
        isDefault: false,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        fields: [],
      };
      const updated = { ...record, forms: [...record.forms, form], updatedAt: input.createdAt };
      records.set(record.id, updated);
      versions.set(form.id, [{ version: 1, fields: [], createdAt: input.createdAt }]);
      return updated;
    },
    async replaceFields(projectRef, integrationId, fields, updatedAt) {
      const record = records.get(integrationId);
      if (!record || record.projectRef !== projectRef) return null;
      const form = record.forms.find((candidate) => candidate.isDefault);
      return form
        ? this.replaceFormFields(projectRef, integrationId, form.id, fields, updatedAt)
        : null;
    },
    async replaceFormFields(projectRef, integrationId, formId, fields, updatedAt, expectedVersion) {
      const record = records.get(integrationId);
      const form = record?.forms.find((candidate) => candidate.id === formId);
      if (!record || record.projectRef !== projectRef || !form) return null;
      if (expectedVersion !== undefined && form.configVersion !== expectedVersion)
        throw new IntegrationVersionConflict();
      const updatedForm: IntegrationFormRecord = {
        ...form,
        state: "configured",
        configVersion: form.configVersion + 1,
        updatedAt,
        fields,
      };
      const updated: IntegrationRecord = {
        ...record,
        state: "configured",
        configVersion: record.configVersion + 1,
        updatedAt,
        fields: updatedForm.isDefault ? fields : record.fields,
        forms: record.forms.map((candidate) =>
          candidate.id === updatedForm.id ? updatedForm : candidate,
        ),
      };
      records.set(integrationId, updated);
      versions.get(formId)?.unshift({
        version: updatedForm.configVersion,
        fields,
        createdAt: updatedAt,
      });
      return updated;
    },
    async setState(projectRef, integrationId, state: IntegrationState, updatedAt) {
      const record = records.get(integrationId);
      if (!record || record.projectRef !== projectRef) return null;
      const updated = { ...record, state, updatedAt };
      records.set(integrationId, updated);
      return updated;
    },
    async setFormState(projectRef, integrationId, formId, state: IntegrationFormState, updatedAt) {
      const record = records.get(integrationId);
      const form = record?.forms.find((candidate) => candidate.id === formId);
      if (!record || record.projectRef !== projectRef || !form) return null;
      const updated = {
        ...record,
        updatedAt,
        forms: record.forms.map((candidate) =>
          candidate.id === formId ? { ...candidate, state, updatedAt } : candidate,
        ),
      };
      records.set(integrationId, updated);
      return updated;
    },
    async saveFormScan(input) {
      scans.push(input);
      const record = records.get(input.integrationId);
      if (record && input.state === "completed") {
        const forms = record.forms.map((form) =>
          form.id === input.formId && form.state === "draft"
            ? { ...form, state: "scanned" as const, updatedAt: input.createdAt }
            : form,
        );
        records.set(input.integrationId, {
          ...record,
          state: "scanned",
          updatedAt: input.createdAt,
          forms,
        });
      }
    },
    async createApiKey(
      projectRef: string,
      integrationId: string,
      environment: IntegrationEnvironment,
      input: CreatePilotApiKeyInput,
    ) {
      const record = records.get(integrationId);
      if (!record || record.projectRef !== projectRef) throw new Error("not found");
      records.set(integrationId, {
        ...record,
        apiKeys: [
          {
            id: input.id,
            name: input.name,
            keyPrefix: input.keyPrefix,
            environment,
            state: input.state,
            createdAt: input.createdAt,
            lastUsedAt: null,
            revokedAt: null,
          },
          ...record.apiKeys,
        ],
      });
    },
    async revokeApiKey(projectRef, integrationId, keyId, revokedAt) {
      const record = records.get(integrationId);
      if (!record || record.projectRef !== projectRef) return false;
      let revoked = false;
      const apiKeys = record.apiKeys.map((key) => {
        if (key.id !== keyId || key.state !== "active") return key;
        revoked = true;
        return { ...key, state: "revoked" as const, revokedAt };
      });
      records.set(integrationId, { ...record, apiKeys });
      return revoked;
    },
    async listConfigVersions(projectRef, integrationId) {
      const record = records.get(integrationId);
      if (!record || record.projectRef !== projectRef) return [];
      const form = record.forms.find((candidate) => candidate.isDefault);
      return form ? this.listFormConfigVersions(projectRef, integrationId, form.id) : [];
    },
    async listFormConfigVersions(projectRef, integrationId, formId) {
      const record = records.get(integrationId);
      if (!record || record.projectRef !== projectRef) return [];
      return (versions.get(formId) ?? []).map((version) => ({
        version: version.version,
        fieldCount: version.fields.length,
        createdAt: version.createdAt,
      }));
    },
    async rollbackConfigVersion(projectRef, integrationId, version, updatedAt) {
      const record = records.get(integrationId);
      const form = record?.forms.find((candidate) => candidate.isDefault);
      return form
        ? this.rollbackFormConfigVersion(projectRef, integrationId, form.id, version, updatedAt)
        : null;
    },
    async rollbackFormConfigVersion(projectRef, integrationId, formId, version, updatedAt) {
      const record = records.get(integrationId);
      const form = record?.forms.find((candidate) => candidate.id === formId);
      const snapshot = versions.get(formId)?.find((candidate) => candidate.version === version);
      if (!record || record.projectRef !== projectRef || !form || !snapshot) return null;
      const restoredFields = snapshot.fields.map((field, index) => ({
        ...field,
        id: `rollback-${index}`,
      }));
      const updatedForm = {
        ...form,
        state: "configured" as const,
        configVersion: form.configVersion + 1,
        updatedAt,
        fields: restoredFields,
      };
      const updated: IntegrationRecord = {
        ...record,
        state: "configured",
        configVersion: record.configVersion + 1,
        updatedAt,
        fields: form.isDefault ? restoredFields : record.fields,
        forms: record.forms.map((candidate) => (candidate.id === formId ? updatedForm : candidate)),
      };
      records.set(integrationId, updated);
      versions.get(formId)?.unshift({
        version: updatedForm.configVersion,
        fields: restoredFields,
        createdAt: updatedAt,
      });
      return updated;
    },
    async close() {},
  };
}

describe("self-service integration operator API", () => {
  it("does not expose a known integration ID belonging to another customer", async () => {
    const store = memoryIntegrationStore();
    await store.createIntegration({
      id: "victim-integration",
      projectRef: "victim-project",
      name: "Private shop",
      clientName: "private-shop",
      environment: "test",
      formUrl: "https://private.example/checkout",
      createdAt: new Date(),
    });
    const response = await createApp({
      integrationStore: store,
      customerAuthorizer: async () => ({ status: "allowed", projectRef: "own-project" }),
    }).request("/v1/operator/integrations/victim-integration", {
      headers: { Authorization: "Bearer customer-token" },
    });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Private shop");
  });
  it("scopes customer listing to the authorized project, not the operator project", async () => {
    const store = memoryIntegrationStore();
    const list = vi.spyOn(store, "listIntegrations");
    const app = createApp({
      integrationStore: store,
      operatorProjectRef: "internal-project",
      customerAuthorizer: async () => ({ status: "allowed", projectRef: "customer-project" }),
    });
    const response = await app.request("/v1/operator/integrations?project_ref=victim", {
      headers: {
        Authorization: "Bearer verified-token",
        "X-Checkdrop-Project": "customer-project",
      },
    });
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith("customer-project");
  });

  it.each([
    ["POST", "/v1/operator/integrations"],
    ["POST", "/v1/operator/integrations/id/forms"],
    ["PUT", "/v1/operator/integrations/id/forms/form/root"],
    ["POST", "/v1/operator/integrations/id/forms/form/scan"],
    ["PUT", "/v1/operator/integrations/id/forms/form/fields"],
    ["POST", "/v1/operator/integrations/id/forms/form/state"],
    ["POST", "/v1/operator/integrations/id/forms/form/rollback"],
    ["POST", "/v1/operator/integrations/id/scan"],
    ["PUT", "/v1/operator/integrations/id/fields"],
    ["POST", "/v1/operator/integrations/id/keys"],
    ["DELETE", "/v1/operator/integrations/id/keys/key"],
    ["POST", "/v1/operator/integrations/id/state"],
    ["POST", "/v1/operator/integrations/id/rollback"],
  ])("checks configure permission before %s %s", async (method, path) => {
    const authorizer = vi.fn(async () => ({ status: "forbidden" as const }));
    const response = await createApp({
      integrationStore: memoryIntegrationStore(),
      customerAuthorizer: authorizer,
    }).request(path, { method, headers: { Authorization: "Bearer viewer-token" } });
    expect(response.status).toBe(403);
    expect(authorizer).toHaveBeenCalledWith(expect.any(Request), "configure");
  });

  it("treats monitor POST search as read permission", async () => {
    const authorizer = vi.fn(async () => ({ status: "forbidden" as const }));
    const response = await createApp({
      integrationStore: memoryIntegrationStore(),
      customerAuthorizer: authorizer,
    }).request("/v1/operator/observations/search", {
      method: "POST",
      headers: { Authorization: "Bearer viewer-token" },
    });
    expect(response.status).toBe(403);
    expect(authorizer).toHaveBeenCalledWith(expect.any(Request), "read");
  });

  it("does not fall back to the operator token for a rejected customer", async () => {
    const response = await createApp({
      integrationStore: memoryIntegrationStore(),
      operatorToken: "operator-secret",
      operatorProjectRef: "internal",
      customerAuthorizer: async () => ({ status: "unauthenticated" }),
    }).request("/v1/operator/integrations", {
      headers: { Authorization: "Bearer invalid", "X-Checkdrop-Operator-Key": "operator-secret" },
    });
    expect(response.status).toBe(401);
  });

  it("fails closed during authorization outages", async () => {
    const response = await createApp({
      integrationStore: memoryIntegrationStore(),
      customerAuthorizer: async () => {
        throw new Error("database unavailable");
      },
    }).request("/v1/operator/integrations", { headers: { Authorization: "Bearer token" } });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("database unavailable");
  });

  it("keeps customer login disabled without configured authorization", async () => {
    const response = await createApp({ integrationStore: memoryIntegrationStore() }).request(
      "/v1/operator/integrations",
      { headers: { Authorization: "Bearer token" } },
    );
    expect(response.status).toBe(503);
  });

  it("requires the server-held operator credential", async () => {
    const response = await createApp({
      integrationStore: memoryIntegrationStore(),
      operatorToken: "operator-secret-value",
      operatorProjectRef: "project-a",
    }).request("/v1/operator/integrations");
    expect(response.status).toBe(401);
  });

  it("does not activate an address without city, postal code, and Czech country context", async () => {
    const store = memoryIntegrationStore();
    const createdAt = new Date("2026-08-17T12:00:00.000Z");
    const integration = await store.createIntegration({
      id: "address-integration",
      projectRef: "project-a",
      name: "Objednávka",
      clientName: "shop-checkout",
      environment: "test",
      formUrl: "https://shop.example/checkout",
      createdAt,
    });
    await store.replaceFields(
      "project-a",
      integration.id,
      [
        {
          id: "street-field",
          sourceSelector: "#street",
          sourceLabel: "Ulice a číslo",
          sourceName: "street",
          canonicalField: "street_line",
          context: "billing",
          conditionKey: null,
          required: true,
          validationMode: "shadow",
          validationTrigger: "blur",
          confidence: 100,
          detected: true,
        },
      ],
      createdAt,
    );
    const app = createApp({
      integrationStore: store,
      operatorToken: "operator-secret-value",
      operatorProjectRef: "project-a",
    });
    const response = await app.request(`/v1/operator/integrations/${integration.id}/state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Checkdrop-Operator-Key": "operator-secret-value",
      },
      body: JSON.stringify({ state: "shadow" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      detail: expect.stringContaining("město, PSČ a zemi"),
    });
  });

  it("allows fail-open assistance for names, contacts and structured Czech addresses", async () => {
    const store = memoryIntegrationStore();
    const createdAt = new Date("2026-08-25T12:00:00.000Z");
    const integration = await store.createIntegration({
      id: "email-assist-integration",
      projectRef: "project-a",
      name: "Objednávka",
      clientName: "shop-checkout",
      environment: "test",
      formUrl: "https://shop.example/checkout",
      createdAt,
    });
    const form = integration.forms[0];
    expect(form).toBeDefined();
    const app = createApp({
      integrationStore: store,
      operatorToken: "operator-secret-value",
      operatorProjectRef: "project-a",
    });
    const headers = {
      "Content-Type": "application/json",
      "X-Checkdrop-Operator-Key": "operator-secret-value",
    };
    const endpoint = `/v1/operator/integrations/${integration.id}/forms/${form?.id}/fields`;
    const field = (canonical_field: string, validation_trigger: string) => ({
      selector: `#${canonical_field}`,
      label: canonical_field,
      name: canonical_field,
      canonical_field,
      context: "billing",
      condition_key: null,
      required: true,
      validation_mode: "suggest",
      validation_trigger,
      confidence: 100,
      detected: true,
    });

    const wrongField = await app.request(endpoint, {
      method: "PUT",
      headers,
      body: JSON.stringify({ fields: [field("company_id", "blur")] }),
    });
    expect(wrongField.status).toBe(409);
    await expect(wrongField.json()).resolves.toMatchObject({
      detail: expect.stringContaining("Adresní a firemní návrhy"),
    });

    const wrongTrigger = await app.request(endpoint, {
      method: "PUT",
      headers,
      body: JSON.stringify({ fields: [field("email", "input")] }),
    });
    expect(wrongTrigger.status).toBe(409);
    await expect(wrongTrigger.json()).resolves.toMatchObject({
      detail: expect.stringContaining("opuštění pole"),
    });

    const wrongAddressTrigger = await app.request(endpoint, {
      method: "PUT",
      headers,
      body: JSON.stringify({ fields: [field("street_line", "blur")] }),
    });
    expect(wrongAddressTrigger.status).toBe(409);
    await expect(wrongAddressTrigger.json()).resolves.toMatchObject({
      detail: expect.stringContaining("Adresní a firemní návrhy"),
    });

    const shadowField = (canonical_field: string) => ({
      ...field(canonical_field, "blur"),
      validation_mode: "shadow",
    });

    const saved = await app.request(endpoint, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        fields: [
          field("full_name", "blur"),
          field("email", "blur"),
          field("phone", "blur"),
          field("street_line", "input"),
          shadowField("city"),
          shadowField("postal_code"),
          shadowField("country"),
        ],
      }),
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      forms: [
        {
          id: form?.id,
          fields: [
            {
              canonical_field: "full_name",
              validation_mode: "suggest",
              validation_trigger: "blur",
            },
            { canonical_field: "email", validation_mode: "suggest", validation_trigger: "blur" },
            { canonical_field: "phone", validation_mode: "suggest", validation_trigger: "blur" },
            {
              canonical_field: "street_line",
              validation_mode: "suggest",
              validation_trigger: "input",
            },
            { canonical_field: "city", validation_mode: "shadow" },
            { canonical_field: "postal_code", validation_mode: "shadow" },
            { canonical_field: "country", validation_mode: "shadow" },
          ],
        },
      ],
    });

    const activated = await app.request(`/v1/operator/integrations/${integration.id}/state`, {
      method: "POST",
      headers,
      body: JSON.stringify({ state: "shadow" }),
    });
    expect(activated.status).toBe(200);
  });

  it("persists an explicit name guard and rejects guards on unrelated or incomplete split mappings", async () => {
    const store = memoryIntegrationStore();
    const integration = await store.createIntegration({
      id: "name-guard",
      projectRef: "project-a",
      name: "Name QA",
      clientName: "name-qa",
      environment: "test",
      formUrl: "https://example.test/checkout",
      createdAt: new Date(),
    });
    const app = createApp({
      integrationStore: store,
      operatorToken: "operator-secret-value",
      operatorProjectRef: "project-a",
    });
    const headers = {
      "Content-Type": "application/json",
      "X-Checkdrop-Operator-Key": "operator-secret-value",
    };
    const endpoint = `/v1/operator/integrations/${integration.id}/forms/${integration.forms[0]?.id}/fields`;
    const field = {
      selector: "#name",
      label: "Jméno",
      name: "name",
      canonical_field: "full_name",
      context: "billing",
      condition_key: null,
      required: true,
      require_complete_name: true,
      submit_selector: ".finish",
      validation_mode: "shadow",
      validation_trigger: "blur",
      confidence: null,
      detected: false,
    };
    const saved = await app.request(endpoint, {
      method: "PUT",
      headers,
      body: JSON.stringify({ fields: [field], expected_version: 1 }),
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      forms: [{ fields: [{ require_complete_name: true, submit_selector: ".finish" }] }],
    });
    for (const canonical_field of ["email", "first_name", "company_name"]) {
      const rejected = await app.request(endpoint, {
        method: "PUT",
        headers,
        body: JSON.stringify({ fields: [{ ...field, canonical_field }] }),
      });
      expect(rejected.status).toBe(409);
    }
  });

  it("persists a domestic-only PSČ and rejects it on any other field", async () => {
    const store = memoryIntegrationStore();
    const integration = await store.createIntegration({
      id: "domestic-guard",
      projectRef: "project-a",
      name: "Domestic QA",
      clientName: "domestic-qa",
      environment: "test",
      formUrl: "https://example.test/checkout",
      createdAt: new Date(),
    });
    const app = createApp({
      integrationStore: store,
      operatorToken: "operator-secret-value",
      operatorProjectRef: "project-a",
    });
    const headers = {
      "Content-Type": "application/json",
      "X-Checkdrop-Operator-Key": "operator-secret-value",
    };
    const endpoint = `/v1/operator/integrations/${integration.id}/forms/${integration.forms[0]?.id}/fields`;
    const field = {
      selector: "#zip",
      label: "PSČ",
      name: "zip",
      canonical_field: "postal_code",
      context: "shipping",
      condition_key: null,
      required: false,
      require_domestic_address: true,
      submit_selector: ".finish",
      validation_mode: "shadow",
      validation_trigger: "blur",
      confidence: null,
      detected: false,
    };
    const saved = await app.request(endpoint, {
      method: "PUT",
      headers,
      body: JSON.stringify({ fields: [field], expected_version: 1 }),
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      forms: [{ fields: [{ require_domestic_address: true, submit_selector: ".finish" }] }],
    });
    for (const patch of [{ canonical_field: "city" }, { validation_mode: "off" }]) {
      const rejected = await app.request(endpoint, {
        method: "PUT",
        headers,
        body: JSON.stringify({ fields: [{ ...field, ...patch }] }),
      });
      expect(rejected.status).toBe(409);
    }
  });

  it("creates, scans, maps, keys and activates an integration", async () => {
    const store = memoryIntegrationStore();
    let id = 0;
    const app = createApp({
      integrationStore: store,
      operatorToken: "operator-secret-value",
      operatorProjectRef: "project-a",
      randomId: () => `id-${++id}`,
      now: () => new Date("2026-08-17T12:00:00.000Z"),
      scanForm: async () => ({
        sanitizedUrl: "https://shop.example/checkout",
        pageTitle: "Objednávka",
        formCount: 1,
        fields: [
          {
            selector: "#name",
            label: "Jméno a příjmení",
            name: "billing_name",
            inputType: "text",
            canonicalField: "full_name",
            context: "billing",
            required: true,
            validationMode: "shadow",
            validationTrigger: "blur",
            confidence: 98,
            autocomplete: "name",
          },
        ],
      }),
    });
    const headers = {
      "Content-Type": "application/json",
      "X-Checkdrop-Operator-Key": "operator-secret-value",
    };

    const created = await app.request("/v1/operator/integrations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Example shop checkout",
        client_name: "example-shop-checkout/1.0",
        environment: "test",
        form_url: "https://shop.example/checkout?session=secret",
      }),
    });
    expect(created.status).toBe(201);
    const integration = (await created.json()) as {
      id: string;
      form_url: string;
      site_key: string;
      embed_script: string;
    };
    expect(integration.form_url).toBe("https://shop.example/checkout");
    expect(integration).toMatchObject({
      site_key: `cdp_site_${integration.id}`,
      embed_script: expect.stringContaining("https://api.checkdrop.dev/v1/embed.js"),
    });

    const scanned = await app.request(`/v1/operator/integrations/${integration.id}/scan`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(scanned.status).toBe(200);
    expect(((await scanned.clone().json()) as { drift: { changed: boolean } }).drift.changed).toBe(
      false,
    );
    expect(store.scans[0]?.detectedFields).toHaveLength(1);

    const invalidCondition = await app.request(
      `/v1/operator/integrations/${integration.id}/fields`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          fields: [
            {
              selector: "#name",
              label: "Jméno a příjmení",
              name: "billing_name",
              canonical_field: "full_name",
              context: "billing",
              condition_key: "customer_type=private",
              required: true,
              validation_mode: "shadow",
              validation_trigger: "blur",
              confidence: 98,
              detected: true,
            },
          ],
        }),
      },
    );
    expect(invalidCondition.status).toBe(409);
    await expect(invalidCondition.json()).resolves.toMatchObject({
      detail: expect.stringContaining("Soukromě / na firmu"),
    });

    const fields = await app.request(`/v1/operator/integrations/${integration.id}/fields`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        fields: [
          {
            selector: "#name",
            label: "Jméno a příjmení",
            name: "billing_name",
            canonical_field: "full_name",
            context: "billing",
            condition_key: null,
            required: true,
            validation_mode: "shadow",
            validation_trigger: "blur",
            confidence: 98,
            detected: true,
          },
        ],
      }),
    });
    expect(fields.status).toBe(200);

    const versions = await app.request(`/v1/operator/integrations/${integration.id}/versions`, {
      headers,
    });
    expect(versions.status).toBe(200);
    await expect(versions.json()).resolves.toMatchObject({
      data: [
        { version: 2, field_count: 1, current: true },
        { version: 1, field_count: 0, current: false },
      ],
    });

    const rolledBack = await app.request(`/v1/operator/integrations/${integration.id}/rollback`, {
      method: "POST",
      headers,
      body: JSON.stringify({ version: 1 }),
    });
    expect(rolledBack.status).toBe(200);
    await expect(rolledBack.json()).resolves.toMatchObject({ config_version: 3, fields: [] });

    const restoredFields = await app.request(`/v1/operator/integrations/${integration.id}/fields`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        fields: [
          {
            selector: "#name",
            label: "Jméno a příjmení",
            name: "billing_name",
            canonical_field: "full_name",
            context: "billing",
            condition_key: null,
            required: true,
            validation_mode: "shadow",
            validation_trigger: "blur",
            confidence: 98,
            detected: true,
          },
        ],
      }),
    });
    expect(restoredFields.status).toBe(200);

    const keyResponse = await app.request(`/v1/operator/integrations/${integration.id}/keys`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Example test", environment: "test" }),
    });
    expect(keyResponse.status).toBe(201);
    const key = (await keyResponse.json()) as { id: string; api_key: string; shown_once: boolean };
    expect(key.api_key).toMatch(/^cdp_/);
    expect(key.shown_once).toBe(true);

    const activated = await app.request(`/v1/operator/integrations/${integration.id}/state`, {
      method: "POST",
      headers,
      body: JSON.stringify({ state: "shadow" }),
    });
    expect(activated.status).toBe(200);
    expect(((await activated.json()) as { state: string }).state).toBe("shadow");

    const protectedRevoke = await app.request(
      `/v1/operator/integrations/${integration.id}/keys/${key.id}`,
      { method: "DELETE", headers: { "X-Checkdrop-Operator-Key": "operator-secret-value" } },
    );
    expect(protectedRevoke.status).toBe(409);

    const paused = await app.request(`/v1/operator/integrations/${integration.id}/state`, {
      method: "POST",
      headers,
      body: JSON.stringify({ state: "paused" }),
    });
    expect(paused.status).toBe(200);
    const revoked = await app.request(
      `/v1/operator/integrations/${integration.id}/keys/${key.id}`,
      { method: "DELETE", headers: { "X-Checkdrop-Operator-Key": "operator-secret-value" } },
    );
    expect(revoked.status).toBe(200);
  });

  it("serves the saved mapping only to the API key linked to that integration", async () => {
    const integrationStore = memoryIntegrationStore();
    const createdAt = new Date("2026-08-17T12:00:00.000Z");
    await integrationStore.createIntegration({
      id: "integration-1",
      projectRef: "project-a",
      name: "Objednávka",
      clientName: "example-shop-checkout",
      environment: "test",
      formUrl: "https://shop.example/checkout",
      createdAt,
    });
    await integrationStore.replaceFields(
      "project-a",
      "integration-1",
      [
        {
          id: "field-1",
          sourceSelector: "#billing-name",
          sourceLabel: "Jméno a příjmení",
          sourceName: "billing_name",
          canonicalField: "full_name",
          context: "billing",
          conditionKey: "customer_type=private",
          required: true,
          validationMode: "shadow",
          validationTrigger: "blur",
          confidence: 98,
          detected: true,
        },
      ],
      createdAt,
    );
    const rawKey = `cdp_abcdef123456_${"x".repeat(43)}`;
    const pilotStore: PilotStore = {
      async findApiKeyByPrefix() {
        return {
          id: "key-1",
          projectRef: "project-a",
          name: "Test",
          keyPrefix: "cdp_abcdef123456",
          verifier: hashApiKey(rawKey),
          state: "active",
          integrationId: "integration-1",
          environment: "test",
        };
      },
      async createApiKey() {},
      async recordUsage() {
        return true;
      },
      async close() {},
    };
    const response = await createApp({ pilotStore, integrationStore }).request(
      "/v1/integration/config",
      { headers: { "X-Checkdrop-Key": rawKey } },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      object: "integration_config",
      integration_id: "integration-1",
      config_version: 2,
      fields: [
        {
          selector: "#billing-name",
          canonical_field: "full_name",
          condition_key: "customer_type=private",
          validation_mode: "shadow",
        },
      ],
    });
  });

  it("runs the hosted script from the configured origin without exposing a private API key", async () => {
    const integrationStore = memoryIntegrationStore();
    const createdAt = new Date("2026-08-18T12:00:00.000Z");
    const created = await integrationStore.createIntegration({
      id: "integration-embed",
      projectRef: "project-a",
      name: "Hosted checkout",
      clientName: "example-shop-checkout/1.0",
      environment: "test",
      formUrl: "https://shop.example/checkout",
      createdAt,
    });
    await integrationStore.replaceFields(
      "project-a",
      "integration-embed",
      [
        {
          id: "field-name",
          sourceSelector: "#billing-name",
          sourceLabel: "Jméno a příjmení",
          sourceName: "billing_name",
          canonicalField: "full_name",
          context: "billing",
          conditionKey: null,
          required: true,
          validationMode: "shadow",
          validationTrigger: "blur",
          confidence: 100,
          detected: true,
        },
      ],
      createdAt,
    );
    const registration = await integrationStore.createForm({
      id: "integration-embed-form-registration",
      integrationId: "integration-embed",
      projectRef: "project-a",
      name: "Registrace",
      formUrl: "https://shop.example/account/register",
      matchMode: "exact",
      pathPattern: "/account/register",
      createdAt,
    });
    expect(registration).not.toBeNull();
    await integrationStore.replaceFormFields(
      "project-a",
      "integration-embed",
      "integration-embed-form-registration",
      [
        {
          id: "field-registration-email",
          sourceSelector: "#registration-email",
          sourceLabel: "E-mail",
          sourceName: "email",
          canonicalField: "email",
          context: "shared",
          conditionKey: null,
          required: true,
          validationMode: "shadow",
          validationTrigger: "blur",
          confidence: 100,
          detected: true,
        },
      ],
      createdAt,
    );
    await integrationStore.createApiKey("project-a", "integration-embed", "test", {
      id: "embed-runtime-key",
      projectRef: "project-a",
      name: "Hosted script runtime",
      keyPrefix: "cdp_abcdef123456",
      verifier: hashApiKey(`cdp_abcdef123456_${"x".repeat(43)}`),
      state: "active",
      createdAt,
    });
    await integrationStore.setState("project-a", "integration-embed", "shadow", createdAt);

    const usage: string[] = [];
    const pilotStore: PilotStore = {
      async findApiKeyByPrefix() {
        return null;
      },
      async createApiKey() {},
      async recordUsage(input) {
        usage.push(input.operation);
        return true;
      },
      async close() {},
    };
    const app = createApp({
      pilotStore,
      integrationStore,
      embedSigningSecret: "embed-signing-secret-with-at-least-32-characters",
      now: () => createdAt,
    });
    const site = "cdp_site_integration-embed";
    const checkoutRecords: unknown[] = [];
    const checkoutApp = createApp({
      pilotStore,
      integrationStore,
      embedSigningSecret: "embed-signing-secret-with-at-least-32-characters",
      checkoutEventStore: {
        async record(e) {
          checkoutRecords.push(e);
        },
        async list() {
          return [];
        },
      },
    });
    const eventUrl = `/v1/checkout/events?site=${site}&form=${created.forms[0]?.id}&session=12345678-1234-4234-8234-123456789abc`;
    const eventBody = {
      event_id: "12345678-1234-4234-8234-123456789abd",
      event: "started",
      source: "test",
      reason: "none",
      field: "email",
      context: "shared",
    };
    const sendEvent = (body: object, origin = "https://shop.example") =>
      checkoutApp.request(eventUrl, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await sendEvent(eventBody)).status).toBe(204);
    expect(checkoutRecords).toHaveLength(1);
    expect(checkoutRecords[0]).toMatchObject({
      projectRef: "project-a",
      formId: created.forms[0]?.id,
      source: "test",
    });
    expect(JSON.stringify(checkoutRecords)).not.toContain("123456789abc");
    expect((await sendEvent({ ...eventBody, email: "private@example.cz" })).status).toBe(400);
    expect((await sendEvent({ ...eventBody, event: "order_confirmed" })).status).toBe(400);
    expect((await sendEvent(eventBody, "https://evil.example")).status).toBe(403);
    const purchase = {
      ...eventBody,
      event: "purchase_reported",
      field: "none",
      context: "none",
      order_ref: "QA-123",
      purchase_channel: "b2c",
    };
    expect((await sendEvent({ ...purchase, order_ref: "" })).status).toBe(400);
    expect((await sendEvent({ ...purchase, purchase_channel: "unknown" })).status).toBe(400);
    expect((await sendEvent(purchase)).status).toBe(204);
    expect(JSON.stringify(checkoutRecords)).not.toContain("QA-123");
    expect(checkoutRecords.at(-1)).toMatchObject({
      event: "purchase_reported",
      purchaseChannel: "b2c",
    });
    const origin = "https://shop.example";

    const script = await app.request("/v1/embed.js");
    expect(script.status).toBe(200);
    expect(script.headers.get("Content-Type")).toContain("application/javascript");
    expect(await script.text()).toContain("dataset.checkdropSite");

    const config = await app.request(`/v1/integration/config?site=${site}&path=%2Fcheckout`, {
      headers: { Origin: origin },
    });
    expect(config.status).toBe(200);
    expect(config.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    await expect(config.json()).resolves.toMatchObject({
      integration_id: "integration-embed",
      state: "shadow",
      features: { address_components: true },
      form: { id: created.forms[0]?.id, name: "Hlavní formulář", match_mode: "exact" },
      fields: [{ selector: "#billing-name", canonical_field: "full_name" }],
    });

    const registrationConfig = await app.request(
      `/v1/integration/config?site=${site}&path=%2Faccount%2Fregister`,
      { headers: { Origin: origin } },
    );
    expect(registrationConfig.status).toBe(200);
    await expect(registrationConfig.json()).resolves.toMatchObject({
      state: "shadow",
      form: { id: "integration-embed-form-registration", name: "Registrace" },
      fields: [{ selector: "#registration-email", canonical_field: "email" }],
    });

    const unmatchedConfig = await app.request(
      `/v1/integration/config?site=${site}&path=%2Fcontact`,
      { headers: { Origin: origin } },
    );
    expect(unmatchedConfig.status).toBe(200);
    await expect(unmatchedConfig.json()).resolves.toMatchObject({
      state: "unmatched",
      form: null,
      fields: [],
    });

    const preflight = await app.request(`/v1/names/validate?site=${site}`, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(origin);

    const validation = await app.request(
      `/v1/names/validate?site=${site}&form=${created.forms[0]?.id}`,
      {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: "  Pavel   Novák, ",
          customer_type: "private",
          context: "billing",
          policy: "assist",
        }),
      },
    );
    expect(validation.status).toBe(200);
    expect(validation.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    await expect(validation.json()).resolves.toMatchObject({
      status: "correctable",
      action: "suggest",
      normalized: "Pavel Novák",
    });
    expect(usage).toEqual(["name.validate"]);

    const unknownForm = await app.request(`/v1/names/validate?site=${site}&form=unknown-form`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: "Jan Novák" }),
    });
    expect(unknownForm.status).toBe(403);

    const wrongOrigin = await app.request(`/v1/integration/config?site=${site}`, {
      headers: { Origin: "https://attacker.example" },
    });
    expect(wrongOrigin.status).toBe(403);
    expect(wrongOrigin.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const importAttempt = await app.request(`/v1/imports?site=${site}`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "text/csv" },
      body: "email\\njan@example.cz",
    });
    expect(importAttempt.status).toBe(404);
  });

  it("adds independent form profiles to any website and rejects cross-domain mixing", async () => {
    const store = memoryIntegrationStore();
    let id = 0;
    const app = createApp({
      integrationStore: store,
      operatorToken: "operator-secret-value",
      operatorProjectRef: "project-a",
      randomId: () => `generic-id-${++id}`,
      now: () => new Date("2026-08-19T09:00:00.000Z"),
    });
    const headers = {
      "Content-Type": "application/json",
      "X-Checkdrop-Operator-Key": "operator-secret-value",
    };
    const created = await app.request("/v1/operator/integrations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Example shop",
        form_name: "Objednávka",
        client_name: "example-shop-forms",
        environment: "test",
        form_url: "https://shop.example/checkout",
      }),
    });
    expect(created.status).toBe(201);
    const website = (await created.json()) as { id: string; forms: readonly { name: string }[] };
    expect(website.forms).toMatchObject([{ name: "Objednávka" }]);

    const added = await app.request(`/v1/operator/integrations/${website.id}/forms`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Zákaznický účet",
        form_url: "https://shop.example/account/register?campaign=ignored",
        match_mode: "prefix",
      }),
    });
    expect(added.status).toBe(201);
    await expect(added.json()).resolves.toMatchObject({
      forms: [
        { name: "Objednávka", path_pattern: "/checkout", is_default: true },
        {
          name: "Zákaznický účet",
          form_url: "https://shop.example/account/register",
          path_pattern: "/account/register",
          match_mode: "prefix",
        },
      ],
    });

    const crossDomain = await app.request(`/v1/operator/integrations/${website.id}/forms`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Cizí formulář",
        form_url: "https://other.example/contact",
        match_mode: "exact",
      }),
    });
    expect(crossDomain.status).toBe(409);
    await expect(crossDomain.json()).resolves.toMatchObject({
      detail: expect.stringContaining("stejné doméně"),
    });
  });

  it("creates the internal runtime credential automatically when shadow is activated", async () => {
    const store = memoryIntegrationStore();
    const createdAt = new Date("2026-08-18T12:00:00.000Z");
    const integration = await store.createIntegration({
      id: "automatic-runtime",
      projectRef: "project-a",
      name: "Simple install",
      clientName: "simple-install/1.0",
      environment: "test",
      formUrl: "https://shop.example/checkout",
      createdAt,
    });
    await store.replaceFields(
      "project-a",
      integration.id,
      [
        {
          id: "email-field",
          sourceSelector: "#email",
          sourceLabel: "E-mail",
          sourceName: "email",
          canonicalField: "email",
          context: "billing",
          conditionKey: null,
          required: true,
          validationMode: "shadow",
          validationTrigger: "blur",
          confidence: 100,
          detected: true,
        },
      ],
      createdAt,
    );
    const response = await createApp({
      integrationStore: store,
      operatorToken: "operator-secret-value",
      operatorProjectRef: "project-a",
      randomId: () => "generated-runtime-key",
      now: () => createdAt,
    }).request(`/v1/operator/integrations/${integration.id}/state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Checkdrop-Operator-Key": "operator-secret-value",
      },
      body: JSON.stringify({ state: "shadow" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: "shadow",
      api_keys: [{ name: "Hosted script runtime", state: "active" }],
    });
  });

  it("serves operator-authenticated shadow observations to the admin monitor", async () => {
    const observationStore: ShadowObservationStore = {
      fullValuesEnabled: true,
      async save() {
        return true;
      },
      async recordAssistInteraction() {
        return true;
      },
      async list(projectRef, _now, options) {
        expect(projectRef).toBe("project-a");
        expect(options).toEqual({
          offset: 0,
          limit: 25,
          filter: "changed",
          operation: "email.validate",
          resultClass: "correctable",
          assistOutcome: "applied",
          clientName: "shop-checkout",
          formId: "checkout-form",
          checkoutSessionRef: "a".repeat(64),
          checkoutOutcome: "completed",
          from: new Date("2026-08-01T00:00:00.000Z"),
          to: new Date("2026-08-29T00:00:00.000Z"),
        });
        return {
          observations: [
            {
              id: "observation-1",
              requestId: "request-1",
              operation: "email.validate",
              clientName: "shop-checkout",
              formId: "checkout-form",
              formName: "Objednávka",
              checkoutSessionRef: "a".repeat(64),
              inputValue: "jan.novak@gmil.com",
              proposedValue: "jan.novak@gmail.com",
              inputPreview: "j***@gmil.com",
              proposedPreview: "j***@gmail.com",
              changed: true,
              resultClass: "correctable",
              action: "suggest",
              issueCodes: ["email.domain_typo"],
              evidenceSources: ["format"],
              durationMs: 12,
              assistShownAt: new Date("2026-08-17T12:00:01.000Z"),
              assistOutcome: "applied",
              assistOutcomeAt: new Date("2026-08-17T12:00:02.000Z"),
              createdAt: new Date("2026-08-17T12:00:00.000Z"),
              expiresAt: new Date("2026-08-18T12:00:00.000Z"),
            },
            {
              id: "observation-2",
              requestId: "request-2",
              operation: "phone.validate",
              clientName: "shop-checkout",
              formId: "checkout-form",
              formName: "Objednávka",
              checkoutSessionRef: "a".repeat(64),
              inputValue: "+420 777 123 456",
              proposedValue: null,
              inputPreview: "+420 *** *** 456",
              proposedPreview: null,
              changed: false,
              resultClass: "valid",
              action: "accept",
              issueCodes: [],
              evidenceSources: ["libphonenumber"],
              durationMs: 8,
              assistShownAt: null,
              assistOutcome: null,
              assistOutcomeAt: null,
              createdAt: new Date("2026-08-17T11:59:59.000Z"),
              expiresAt: new Date("2026-08-18T11:59:59.000Z"),
            },
          ],
          total: 1,
          summary: {
            total: 1,
            proposedChanges: 1,
            reviewRequired: 0,
            averageDurationMs: 12,
            p95DurationMs: 12,
            assistShown: 1,
            assistApplied: 1,
            assistKept: 0,
            assistUndone: 0,
          },
        };
      },
      async deleteExpired() {
        return 0;
      },
      async close() {},
    };
    const app = createApp({
      integrationStore: memoryIntegrationStore(),
      shadowObservationStore: observationStore,
      operatorToken: "operator-secret-value",
      operatorProjectRef: "project-a",
    });
    const query = new URLSearchParams({
      page_size: "25",
      filter: "changed",
      operation: "email.validate",
      result: "correctable",
      assist_outcome: "applied",
      client_name: "shop-checkout",
      form_id: "checkout-form",
      session_ref: "a".repeat(64),
      checkout_outcome: "completed",
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-29T00:00:00.000Z",
    });
    const response = await app.request(`/v1/operator/observations?${query}`, {
      headers: { "X-Checkdrop-Operator-Key": "operator-secret-value" },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      object: "shadow_observation_list",
      summary: { total: 1, proposed_changes: 1, assist_shown: 1, assist_applied: 1 },
      pagination: { page: 1, page_size: 25, total: 1, pages: 1 },
    });
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      operation: "email.validate",
      checkout_session_ref: "a".repeat(64),
      input_value: "jan.novak@gmil.com",
      proposed_value: "jan.novak@gmail.com",
      value_visibility: "full",
      changed: true,
      assist_outcome: "applied",
      assist_shown_at: "2026-08-17T12:00:01.000Z",
      assist_outcome_at: "2026-08-17T12:00:02.000Z",
    });
    expect(body.data[1]).toMatchObject({
      operation: "phone.validate",
      checkout_session_ref: "a".repeat(64),
      changed: false,
    });
    const invalidOutcome = await app.request("/v1/operator/observations?checkout_outcome=paid", {
      headers: { "X-Checkdrop-Operator-Key": "operator-secret-value" },
    });
    expect(invalidOutcome.status).toBe(400);
    const invalidClient = await app.request("/v1/operator/observations?client_name=%20shop", {
      headers: { "X-Checkdrop-Operator-Key": "operator-secret-value" },
    });
    expect(invalidClient.status).toBe(400);
  });

  it("returns only the summary for the dashboard without loading observation rows", async () => {
    let receivedOptions: unknown;
    const observationStore: ShadowObservationStore = {
      fullValuesEnabled: true,
      async save() {
        return true;
      },
      async recordAssistInteraction() {
        return true;
      },
      async list(_projectRef, _now, options) {
        receivedOptions = options;
        return {
          observations: [],
          total: 7,
          summary: {
            total: 12,
            proposedChanges: 3,
            reviewRequired: 1,
            averageDurationMs: 9,
            p95DurationMs: 20,
            assistShown: 4,
            assistApplied: 2,
            assistKept: 1,
            assistUndone: 1,
          },
        };
      },
      async deleteExpired() {
        return 0;
      },
      async close() {},
    };
    const app = createApp({
      integrationStore: memoryIntegrationStore(),
      shadowObservationStore: observationStore,
      operatorToken: "operator-secret-value",
      operatorProjectRef: "project-a",
    });
    const response = await app.request(
      "/v1/operator/observations?summary_only=1&page=3&filter=all&from=2026-08-01T00:00:00.000Z",
      { headers: { "X-Checkdrop-Operator-Key": "operator-secret-value" } },
    );

    expect(response.status).toBe(200);
    expect(receivedOptions).toEqual({
      offset: 0,
      limit: 0,
      filter: "all",
      from: new Date("2026-08-01T00:00:00.000Z"),
    });
    const body = await response.json();
    expect(body).toMatchObject({
      object: "shadow_observation_summary",
      summary: { total: 12, assist_shown: 4, assist_applied: 2, assist_kept: 1, assist_undone: 1 },
    });
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("pagination");
  });

  it("searches complete customer cases without putting personal data in the URL", async () => {
    let receivedSearch: string | undefined;
    const observationStore: ShadowObservationStore = {
      fullValuesEnabled: true,
      searchEnabled: true,
      async save() {
        return true;
      },
      async recordAssistInteraction() {
        return true;
      },
      async list(_projectRef, _now, options) {
        receivedSearch = options.search;
        return {
          observations: [],
          total: 0,
          summary: {
            total: 0,
            proposedChanges: 0,
            reviewRequired: 0,
            averageDurationMs: 0,
            p95DurationMs: 0,
            assistShown: 0,
            assistApplied: 0,
            assistKept: 0,
            assistUndone: 0,
          },
        };
      },
      async deleteExpired() {
        return 0;
      },
      async close() {},
    };
    const app = createApp({
      integrationStore: memoryIntegrationStore(),
      shadowObservationStore: observationStore,
      operatorToken: "operator-secret-value",
      operatorProjectRef: "project-a",
    });
    const response = await app.request("/v1/operator/observations/search?page=1&filter=all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Checkdrop-Operator-Key": "operator-secret-value",
      },
      body: JSON.stringify({ query: "Andrea Králová" }),
    });

    expect(response.status).toBe(200);
    expect(receivedSearch).toBe("Andrea Králová");
    expect(response.url).not.toContain("Andrea");

    const tooShort = await app.request("/v1/operator/observations/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Checkdrop-Operator-Key": "operator-secret-value",
      },
      body: JSON.stringify({ query: "A" }),
    });
    expect(tooShort.status).toBe(400);
  });
});
