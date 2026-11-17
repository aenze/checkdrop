import { describe, expect, it } from "vitest";
import { looksForeignToCzechia } from "../src/index.js";

// Shapes seen on a live Czech checkout between August and October 2026, with invented streets.
describe("looksForeignToCzechia", () => {
  it.each([
    ["Hlavná 12", "Topoľčany", "955 01"],
    ["Jonáša 4", "Bratislava", "84108"],
    ["Hlavná 12", "Topolcany", "955 01"],
    ["Mierová 3", "Košice", "SK-040 01"],
    ["Námestie SNP 1", "Banská Bystrica", "974 01"],
    ["Hlavná 1", "Šaľa", null],
    ["Dunajská 1, Slovensko", "Bratislava", null],
  ])("flags %s, %s %s", (address, city, postalCode) => {
    expect(looksForeignToCzechia(address, city, postalCode)).toBe(true);
  });

  it.each([
    ["Bratislavská 12/3", "Břeclav", "690 02"],
    ["Košická 7", "Ostrava", "702 00"],
    ["Liptovská 4", "Opava", "746 01"],
    ["Zvolenská 10", "Prachatice", "383 01"],
    ["Trnava 12", "Trnava", "763 18"],
    ["Lipová 5", "Skalice u České Lípy", "471 17"],
    ["Stará cesta 9", "Zruč-Senec", "330 08"],
    ["Mudroňova 5", "Praha", "160 00"],
    ["Ostrovní 2", "Praha 1", ""],
    ["Ostrovní 2", "Praha 1", "110 0"],
  ])("keeps %s, %s %s", (address, city, postalCode) => {
    expect(looksForeignToCzechia(address, city, postalCode)).toBe(false);
  });
});
