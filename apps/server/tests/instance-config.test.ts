import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { embedSnippet, readInstanceConfig } from "../src/instance-config.js";
import { serializeIntegration } from "../src/operator-serialization.js";

describe("instance configuration", () => {
  it("keeps the hosted service addresses and requires sign-in when nothing is configured", () => {
    expect(readInstanceConfig({})).toEqual({
      publicApiUrl: "https://api.checkdrop.dev",
      publicAdminUrl: "https://app.checkdrop.dev",
      adminAuthMode: "password",
    });
    expect(readInstanceConfig({ CHECKDROP_ADMIN_AUTH: "external" }).adminAuthMode).toBe("external");
  });

  it("uses one origin for API and administration of a self-hosted installation", () => {
    expect(
      readInstanceConfig({
        CHECKDROP_PUBLIC_API_URL: "https://checks.example.com/",
        CHECKDROP_ADMIN_AUTH: "password",
      }),
    ).toEqual({
      publicApiUrl: "https://checks.example.com",
      publicAdminUrl: "https://checks.example.com",
      adminAuthMode: "password",
    });
    expect(
      readInstanceConfig({ CHECKDROP_PUBLIC_API_URL: "http://localhost:8080" }).publicApiUrl,
    ).toBe("http://localhost:8080");
  });

  it.each([
    "http://checks.example.com",
    "https://checks.example.com/checkdrop",
    "https://user:pass@checks.example.com",
    "not a url",
  ])("refuses %s as a public address", (value) => {
    expect(() => readInstanceConfig({ CHECKDROP_PUBLIC_API_URL: value })).toThrow();
  });

  it("refuses an unknown administration sign-in mode", () => {
    expect(() => readInstanceConfig({ CHECKDROP_ADMIN_AUTH: "none" })).toThrow();
  });

  it("generates the snippet for the configured installation", () => {
    expect(embedSnippet("https://checks.example.com", "cdp_site_abc")).toBe(
      '<script async src="https://checks.example.com/v1/embed.js" data-checkdrop-site="cdp_site_abc"></script>',
    );
    const integration = serializeIntegration(
      {
        id: "abc",
        projectRef: "p",
        name: "Shop",
        clientName: "shop",
        environment: "test",
        formUrl: "https://shop.example/checkout",
        state: "draft",
        configVersion: 1,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        fields: [],
        forms: [],
        apiKeys: [],
        activity: { lastKeyUsedAt: null, lastObservationAt: null, observationCount24h: 0 },
      } as unknown as Parameters<typeof serializeIntegration>[0],
      "https://checks.example.com",
    );
    expect(integration.embed_script).toContain('src="https://checks.example.com/v1/embed.js"');
  });

  it("names the hosted domain only in the one place that holds the defaults", () => {
    const root = new URL("../../../", import.meta.url);
    const files = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "apps/server/src", "packages"],
      { cwd: root, encoding: "utf8" },
    )
      .split("\n")
      .filter((file) => /\/src\/.*\.ts$/.test(file) && !file.endsWith(".test.ts"));
    const offenders = files.filter(
      (file) =>
        file !== "apps/server/src/instance-config.ts" &&
        readFileSync(new URL(file, root), "utf8").includes("checkdrop.dev"),
    );
    expect(offenders).toEqual([]);
  });
});
