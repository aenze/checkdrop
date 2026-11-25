import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
}));
vi.mock("pg", () => ({
  Pool: class {
    query = mocks.query;
    connect = mocks.connect;
    end = mocks.end;
  },
}));

import { createPostgresIntegrationStore, IntegrationVersionConflict } from "../src/integration.js";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
});
describe("runtime integration projection and concurrent editing", () => {
  it("loads the runtime in one parameterized query without fields or observation aggregates", async () => {
    const runtime = { id: "integration-a", state: "paused", forms: [], apiKeys: [] };
    mocks.query.mockResolvedValue({ rows: [{ runtime }] });
    const store = createPostgresIntegrationStore("test-only");
    expect(await store.getRuntimeIntegrationById?.("integration-a")).toEqual(runtime);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0]?.[1]).toEqual(["integration-a"]);
    expect(mocks.query.mock.calls[0]?.[0]).not.toMatch(/shadow_observations|integration_fields/);
  });
  it("loads the hosted config in one query without keys or observation aggregates", async () => {
    const runtime = {
      id: "integration-a",
      projectRef: "project-a",
      clientName: "shop",
      environment: "live",
      state: "shadow",
      configVersion: 3,
      forms: [
        {
          id: "form-a",
          name: "Pokladna",
          matchMode: "exact",
          pathPattern: "/checkout",
          rootSelector: "body",
          state: "configured",
          configVersion: 2,
          isDefault: true,
          createdAt: "2026-11-01T10:00:00.123+00:00",
          fields: [],
        },
      ],
    };
    mocks.query.mockResolvedValue({ rows: [{ runtime }] });
    const store = createPostgresIntegrationStore("test-only");
    const config = await store.getRuntimeConfigById?.("integration-a");
    expect(config?.forms[0]?.createdAt).toEqual(new Date("2026-11-01T10:00:00.123Z"));
    expect(config).toMatchObject({ id: "integration-a", forms: [{ id: "form-a", fields: [] }] });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0]?.[1]).toEqual(["integration-a"]);
    expect(mocks.query.mock.calls[0]?.[0]).toContain("integration_fields");
    expect(mocks.query.mock.calls[0]?.[0]).not.toMatch(/shadow_observations|api_keys/);

    mocks.query.mockResolvedValue({ rows: [] });
    expect(await store.getRuntimeConfigById?.("missing")).toBeNull();
  });
  it("stores and reads the required-phone flag next to the other guards", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "form", config_version: 3 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ config_version: 4 }] })
      .mockResolvedValue({ rows: [] });
    const store = createPostgresIntegrationStore("test-only");
    const phone = {
      id: "field-phone",
      sourceSelector: "#phone",
      sourceLabel: "Telefon",
      sourceName: "phone",
      canonicalField: "phone",
      context: "billing",
      conditionKey: null,
      required: true,
      requireValidPhone: true,
      submitSelector: ".JS_orderSendButton",
      validationMode: "suggest",
      validationTrigger: "blur",
      confidence: null,
      detected: false,
    } as const;
    await store.replaceFormFields("project", "integration", "form", [phone], new Date(), 3);
    const insert = mocks.query.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO app.integration_fields"),
    );
    expect(insert?.[0]).toContain("require_valid_phone");
    expect(insert?.[0]).toContain("fill_village_street");
    expect(insert?.[1]).toHaveLength(20);
    // require_domestic_address, require_valid_phone, fill_village_street
    expect(insert?.[1]?.slice(-3)).toEqual([false, true, false]);

    mocks.query.mockReset();
    mocks.query.mockResolvedValue({ rows: [{ runtime: { id: "integration-a", forms: [] } }] });
    await store.getRuntimeConfigById?.("integration-a");
    expect(mocks.query.mock.calls[0]?.[0]).toContain(
      "'requireValidPhone', field.require_valid_phone",
    );
    expect(mocks.query.mock.calls[0]?.[0]).toContain(
      "'fillVillageStreet', field.fill_village_street",
    );
  });
  it("checks the saved version under a lock and rolls back before deleting any fields", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "form", config_version: 4 }] })
      .mockResolvedValue({ rows: [] });
    const store = createPostgresIntegrationStore("test-only");
    await expect(
      store.replaceFormFields("project", "integration", "form", [], new Date(), 3),
    ).rejects.toBeInstanceOf(IntegrationVersionConflict);
    expect(mocks.query.mock.calls[1]?.[0]).toContain("FOR UPDATE");
    expect(mocks.query.mock.calls.map((call) => call[0])).toContain("ROLLBACK");
    expect(mocks.query.mock.calls.some((call) => /DELETE|UPDATE app\./.test(call[0]))).toBe(false);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});
