import { describe, expect, it } from "vitest";
import { lookupEmailDns } from "../src/dns.js";

describe("email DNS boundary", () => {
  it("cancels unresolved queries and fails open at the application deadline", async () => {
    let canceled = false;
    const never = new Promise<readonly unknown[]>(() => {});

    const result = await lookupEmailDns("slow.example", {
      timeoutMs: 5,
      resolver: {
        resolveMx: async () => never,
        resolve4: async () => never,
        cancel() {
          canceled = true;
        },
      },
    });

    expect(canceled).toBe(true);
    expect(result).toMatchObject({
      state: "unavailable",
      hasMx: false,
      hasAddress: false,
      detail: "DNS lookup exceeded the validation deadline.",
    });
  });
});
