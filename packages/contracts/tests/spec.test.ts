import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("OpenAPI source", () => {
  it("declares the expected public contract", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../openapi.yaml"), "utf8");
    const document = parse(source) as {
      openapi: string;
      paths: Record<string, { get?: Record<string, unknown>; post?: Record<string, unknown> }>;
    };

    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/v1/health"]).toBeDefined();
    expect(document.paths["/v1/emails/validate"]).toBeDefined();
    expect(document.paths["/v1/names/validate"]).toBeDefined();
    const validationSecurity = [{ ApiKey: [] }, { SiteKey: [] }];
    expect(document.paths["/v1/embed.js"]?.get?.security).toEqual([]);
    expect(document.paths["/v1/integration/config"]?.get?.security).toEqual(validationSecurity);
    expect(document.paths["/v1/phones/validate"]).toBeDefined();
    expect(document.paths["/v1/addresses/validate"]).toBeDefined();
    expect(document.paths["/v1/addresses/autocomplete"]).toBeDefined();
    expect(document.paths["/v1/company-ids/validate"]).toBeDefined();
    expect(document.paths["/v1/companies/autocomplete"]).toBeDefined();
    expect(document.paths["/v1/operator/observations"]?.get?.security).toEqual([
      { OperatorKey: [] },
    ]);
    expect(document.paths["/v1/operator/observations/search"]?.post?.security).toEqual([
      { OperatorKey: [] },
    ]);
    expect(source).toContain("The customer query stays in the request body");
    expect(document.paths["/v1/emails/validate"]?.post?.security).toEqual(validationSecurity);
    expect(document.paths["/v1/names/validate"]?.post?.security).toEqual(validationSecurity);
    expect(document.paths["/v1/phones/validate"]?.post?.security).toEqual(validationSecurity);
    expect(document.paths["/v1/addresses/validate"]?.post?.security).toEqual(validationSecurity);
    expect(document.paths["/v1/addresses/autocomplete"]?.post?.security).toEqual(
      validationSecurity,
    );
    expect(document.paths["/v1/company-ids/validate"]?.post?.security).toEqual(validationSecurity);
    expect(document.paths["/v1/companies/autocomplete"]?.post?.security).toEqual(
      validationSecurity,
    );
    expect(document.paths["/v1/emails/validate"]?.post?.["x-checkdrop-shadow"]).toBe(
      "implemented-milestone-2",
    );
    expect(source).toContain("name: X-Checkdrop-Client");
    expect(source).toContain("name: X-Checkdrop-Mode");
    expect(source).toContain("name: X-Checkdrop-Observe");
    expect(document.paths["/v1/imports"]).toBeUndefined();
    expect(source).not.toContain("name: X-Checkdrop-Import-Purpose");
    expect(source).toContain("const: shadow");
    expect(source).toContain("Server-Timing:");
    expect(source).toContain("ShadowObservationList:");
    expect(source).toContain("required: [first_name, last_name, address, country]");
    expect(source).toContain("address.country");
    expect(source).toContain("person.title_normalized");
    expect(source).toContain("person.capitalization_normalized");
    expect(source).toContain("person.capitalization_ambiguous");
    expect(source).toContain("person.invalid_characters");
    expect(Object.keys(document.paths).some((path) => path.includes("signup"))).toBe(false);
  });
});
