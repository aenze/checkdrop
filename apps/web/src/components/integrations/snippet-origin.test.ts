import { describe, expect, it } from "vitest";
import { snippetOrigin } from "./snippet";

describe("CSP hint in the installation step", () => {
  it("names the origin the generated snippet actually loads from", () => {
    expect(
      snippetOrigin(
        '<script async src="https://checks.example.com/v1/embed.js" data-checkdrop-site="cdp_site_a"></script>',
      ),
    ).toBe("https://checks.example.com");
    expect(
      snippetOrigin(
        '<script async src="https://api.checkdrop.dev/v1/embed.js" data-checkdrop-site="cdp_site_a"></script>',
      ),
    ).toBe("https://api.checkdrop.dev");
    expect(snippetOrigin("")).toBe("");
  });
});
