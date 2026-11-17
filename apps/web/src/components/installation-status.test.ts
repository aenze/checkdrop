import { describe, expect, it } from "vitest";
import { addressText, type Instance, updateText } from "./installation-status";

const base: Instance = {
  version: "0.1.0",
  update: {
    auto_update: true,
    latest_version: "0.1.0",
    checked_at: null,
    available: false,
    last_update: null,
  },
  address_data: {
    state: "ready",
    effective_at: "2026-11-03T00:00:00Z",
    row_count: 2950000,
    message: null,
  },
};

describe("installation status texts", () => {
  it("tells whether the installation is current and how it updates", () => {
    expect(updateText(base)).toBe("Aktuální. Aktualizuje se automaticky.");
    expect(
      updateText({
        ...base,
        update: {
          ...(base.update as NonNullable<Instance["update"]>),
          latest_version: "0.2.0",
          available: true,
        },
      }),
    ).toBe("Verze 0.2.0 se nainstaluje při příští automatické aktualizaci.");
    expect(
      updateText({
        ...base,
        update: {
          auto_update: true,
          latest_version: "0.2.0",
          checked_at: null,
          available: true,
          last_update: {
            state: "rolled_back",
            from: "0.1.0",
            to: "0.2.0",
            at: "2026-11-12T03:00:00Z",
          },
        },
      }),
    ).toBe("Aktualizace na 0.2.0 se nepovedla, běží dál 0.1.0.");
  });
  it("describes the address data", () => {
    expect(addressText(base)).toMatch(/^2\s950\s000 adres, stav k 3\. 11\. 2026$/);
    expect(
      addressText({ ...base, address_data: { ...base.address_data, state: "importing" } }),
    ).toBe("Stahují se. Kontrola adres se zapne sama.");
  });
});
