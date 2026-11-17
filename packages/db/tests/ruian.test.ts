import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseRuianAddressXml, type RuianXmlEvent } from "../src/ruian.js";

describe("RÚIAN ST_UADS parser", () => {
  it("streams metadata and normalized Czech addresses", async () => {
    const fixtureUrl = new URL("../../../fixtures/ruian/sample-addresses.xml", import.meta.url);
    const events: RuianXmlEvent[] = [];

    for await (const event of parseRuianAddressXml(createReadStream(fixtureUrl))) {
      events.push(event);
    }

    const metadata = events.find((event) => event.type === "metadata");
    const addresses = events
      .filter(
        (event): event is Extract<RuianXmlEvent, { type: "address" }> => event.type === "address",
      )
      .map((event) => event.address);

    expect(metadata).toMatchObject({
      type: "metadata",
      metadata: {
        vfrVersion: "3.1",
        fileType: "ST_UADS",
        batchType: "Plna",
        effectiveAt: new Date("2026-05-31T20:06:19Z"),
      },
    });
    expect(addresses).toHaveLength(3);
    expect(addresses[0]).toMatchObject({
      id: "19",
      municipality: "Arnoltice",
      street: null,
      houseNumber: "1",
      postalCode: "40714",
      searchFull: "1 arnoltice 40714",
    });
    expect(addresses[1]).toMatchObject({
      id: "4065",
      street: "Děčínská",
      searchFull: "decinska 3 dolni kamenice ceska kamenice 40721",
    });
    expect(addresses[2]).toMatchObject({
      id: "105058",
      orientationNumber: "18a",
      searchStreet: "tyrsova 23 18a",
    });
  });

  it("preserves UTF-8 characters split across byte chunks", async () => {
    const fixtureUrl = new URL("../../../fixtures/ruian/sample-addresses.xml", import.meta.url);
    const fixture = await readFile(fixtureUrl);
    const streetNames: Array<string | null> = [];

    async function* oneByteAtATime(): AsyncGenerator<Buffer> {
      for (const byte of fixture) {
        yield Buffer.from([byte]);
      }
    }

    for await (const event of parseRuianAddressXml(oneByteAtATime())) {
      if (event.type === "address") {
        streetNames.push(event.address.street);
      }
    }

    expect(streetNames).toContain("Děčínská");
    expect(streetNames).toContain("Tyršova");
  });
});
