import { describe, expect, it } from "vitest";
import type { CaseCheckout } from "./case-checkout";
import { checkoutOutcome, checkoutOutcomeKind } from "./checkout-outcome";

const now = Date.parse("2026-09-07T20:00:00Z");
const row = {
  last_seen_at: new Date(now - 31 * 60000).toISOString(),
  purchase_reported: false,
} as CaseCheckout;
describe("case checkout outcome", () => {
  it("does not label missing tracking as abandonment", () =>
    expect(checkoutOutcome([], now)).toBe("Výsledek neměřen"));
  it("labels inactivity only as probable abandonment", () =>
    expect(checkoutOutcome([row], now)).toBe("Pravděpodobně opuštěný"));
  it("prefers reported purchase even after inactivity", () =>
    expect(checkoutOutcome([{ ...row, purchase_reported: true }], now)).toBe(
      "Dokončení zachyceno",
    ));
  it("returns to active when activity resumes", () =>
    expect(checkoutOutcome([{ ...row, last_seen_at: new Date(now).toISOString() }], now)).toBe(
      "Rozpracovaný košík",
    ));
  it("reports a language-independent kind for icons", () => {
    expect(checkoutOutcomeKind([], now)).toBe("unmeasured");
    expect(checkoutOutcomeKind([row], now)).toBe("abandoned");
    expect(checkoutOutcomeKind([{ ...row, purchase_reported: true }], now)).toBe("completed");
  });
});
