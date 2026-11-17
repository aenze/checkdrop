import { createHash, randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { normalizeCzechAddressSearch } from "@checkdrop/pack-cz";
import { Pool, type PoolClient } from "pg";
import { SaxesParser } from "saxes";

export interface RuianMetadata {
  vfrVersion: string;
  recordType: string;
  batchType: string;
  fileType: string;
  generatedAt: Date;
  effectiveAt: Date;
}

export interface RuianAddress {
  id: string;
  municipality: string;
  municipalityPart: string | null;
  street: string | null;
  houseNumberType: string;
  houseNumber: string;
  orientationNumber: string | null;
  postalCode: string;
  addressLine: string;
  searchFull: string;
  searchCity: string;
  searchStreet: string;
  searchPostalCode: string;
}

export type RuianXmlEvent =
  | { type: "metadata"; metadata: RuianMetadata }
  | { type: "address"; address: RuianAddress };

export interface RuianImportResult {
  datasetVersionId: string;
  sourceVersion: string;
  effectiveAt: string;
  rowCount: number;
  checksum: string;
  state: "active" | "staged";
  /** False when ANALYZE failed after the commit; autovacuum then refreshes planner statistics. */
  statisticsRefreshed: boolean;
}

export interface ImportRuianOptions {
  connectionString: string;
  input: AsyncIterable<Buffer | string>;
  activate?: boolean;
  batchSize?: number;
  onProgress?: (progress: RuianImportProgress) => void;
}

export interface RuianImportProgress {
  phase: "preparing" | "parsing" | "validating" | "persisting" | "complete";
  rowCount: number;
}

export interface ActiveRuianDataset {
  datasetVersionId: string;
  sourceVersion: string;
  effectiveAt: string;
  rowCount: number;
}

export interface PrunedRuianDatasets {
  datasets: number;
  addresses: number;
  /** Present when addresses were deleted; false when the following ANALYZE failed. */
  statisticsRefreshed?: boolean;
}

/**
 * Refreshes planner statistics after millions of address rows were added or deleted, so the
 * first searches on a new dataset are not planned from the previous one's row counts. The data
 * is already committed, so a failure is reported instead of thrown.
 */
async function analyzeAddresses(client: PoolClient): Promise<boolean> {
  try {
    await client.query("ANALYZE reference_cz.addresses, reference_cz.dataset_versions");
    return true;
  } catch {
    return false;
  }
}

type RawAddress = Partial<{
  id: string;
  municipality: string;
  municipalityPart: string;
  street: string;
  houseNumberType: string;
  houseNumber: string;
  orientationNumber: string;
  orientationLetter: string;
  postalCode: string;
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
}>;

type RawMetadata = Partial<{
  vfrVersion: string;
  recordType: string;
  batchType: string;
  fileType: string;
  generatedAt: string;
  effectiveAt: string;
}>;

const addressFields = {
  AdresniMistoKod: "id",
  ObecNazev: "municipality",
  CastObceNazev: "municipalityPart",
  UliceNazev: "street",
  TypCislaDomovnihoKod: "houseNumberType",
  CisloDomovni: "houseNumber",
  CisloOrientacni: "orientationNumber",
  CisloOrientacniPismeno: "orientationLetter",
  PostaKod: "postalCode",
  RadekAdresy1: "addressLine1",
  RadekAdresy2: "addressLine2",
  RadekAdresy3: "addressLine3",
} as const satisfies Record<string, keyof RawAddress>;

const metadataFields = {
  VerzeVFR: "vfrVersion",
  TypZaznamu: "recordType",
  TypDavky: "batchType",
  TypSouboru: "fileType",
  Datum: "generatedAt",
  ISUI: "effectiveAt",
} as const satisfies Record<string, keyof RawMetadata>;

export async function* parseRuianAddressXml(
  input: AsyncIterable<Buffer | string>,
): AsyncGenerator<RuianXmlEvent> {
  const parser = new SaxesParser();
  const events: RuianXmlEvent[] = [];
  const metadata: RawMetadata = {};
  let currentAddress: RawAddress | null = null;
  let currentElement: string | null = null;
  let currentText = "";
  let metadataSeen = false;
  let decoder = new StringDecoder("utf8");

  parser.on("opentag", (tag) => {
    const element = localName(tag.name);
    if (element === "Adresa") {
      currentAddress = {};
    }
    currentElement = element;
    currentText = "";
  });

  parser.on("text", (text) => {
    if (currentElement) {
      currentText += text;
    }
  });

  parser.on("cdata", (text) => {
    if (currentElement) {
      currentText += text;
    }
  });

  parser.on("closetag", (tag) => {
    const element = localName(tag.name);
    const value = currentText.trim();
    const addressField = addressFields[element as keyof typeof addressFields];
    const metadataField = metadataFields[element as keyof typeof metadataFields];

    if (currentAddress && addressField && value) {
      currentAddress[addressField] = value;
    } else if (!currentAddress && metadataField && value) {
      metadata[metadataField] = value;
    }

    if (element === "Hlavicka") {
      events.push({ type: "metadata", metadata: buildMetadata(metadata) });
      metadataSeen = true;
    } else if (element === "Adresa" && currentAddress) {
      events.push({ type: "address", address: buildAddress(currentAddress) });
      currentAddress = null;
    }

    currentElement = null;
    currentText = "";
  });

  for await (const chunk of input) {
    if (typeof chunk === "string") {
      parser.write(decoder.end());
      decoder = new StringDecoder("utf8");
      parser.write(chunk);
    } else {
      parser.write(decoder.write(chunk));
    }
    while (events.length > 0) {
      const event = events.shift();
      if (event) {
        yield event;
      }
    }
  }

  parser.write(decoder.end());
  parser.close();
  while (events.length > 0) {
    const event = events.shift();
    if (event) {
      yield event;
    }
  }

  if (!metadataSeen) {
    throw new Error("RÚIAN VFR header was not found.");
  }
}

export async function importRuianAddresses(
  options: ImportRuianOptions,
): Promise<RuianImportResult> {
  const pool = new Pool({ connectionString: options.connectionString });
  const client = await pool.connect();
  const checksum = createHash("sha256");
  const batch: RuianAddress[] = [];
  const batchSize = options.batchSize ?? 1_000;
  const activate = options.activate ?? true;
  let metadata: RuianMetadata | null = null;
  let parsedRows = 0;

  try {
    options.onProgress?.({ phase: "preparing", rowCount: 0 });
    await createTemporaryImportTable(client);

    async function* hashingInput(): AsyncGenerator<Buffer | string> {
      for await (const chunk of options.input) {
        checksum.update(chunk);
        yield chunk;
      }
    }

    for await (const event of parseRuianAddressXml(hashingInput())) {
      if (event.type === "metadata") {
        metadata = event.metadata;
        continue;
      }

      batch.push(event.address);
      parsedRows += 1;
      if (parsedRows % 100_000 === 0) {
        options.onProgress?.({ phase: "parsing", rowCount: parsedRows });
      }
      if (batch.length >= batchSize) {
        await insertTemporaryBatch(client, batch);
        batch.length = 0;
      }
    }

    if (batch.length > 0) {
      await insertTemporaryBatch(client, batch);
    }

    if (!metadata) {
      throw new Error("RÚIAN metadata is required before activation.");
    }
    validateMetadata(metadata);
    options.onProgress?.({ phase: "validating", rowCount: parsedRows });
    const rowCount = await validateTemporaryImport(client, parsedRows);
    const datasetVersionId = randomUUID();
    const sourceVersion = metadata.effectiveAt.toISOString();
    const digest = checksum.digest("hex");

    options.onProgress?.({ phase: "persisting", rowCount });
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO reference_cz.dataset_versions
          (id, source, version, effective_at, row_count, checksum, state)
         VALUES ($1, 'ruian-st-uads', $2, $3, $4, $5, 'staged')`,
        [datasetVersionId, sourceVersion, metadata.effectiveAt, rowCount, digest],
      );
      await client.query(
        `INSERT INTO reference_cz.addresses (
          id, dataset_version_id, municipality, municipality_part, street,
          house_number_type, house_number, orientation_number, postal_code, address_line,
          search_full, search_city, search_street, search_postal_code
        )
        SELECT
          id, $1, municipality, municipality_part, street,
          house_number_type, house_number, orientation_number, postal_code, address_line,
          search_full, search_city, search_street, search_postal_code
        FROM pg_temp.ruian_addresses_stage`,
        [datasetVersionId],
      );

      if (activate) {
        await client.query(
          `UPDATE reference_cz.dataset_versions
           SET state = 'archived', archived_at = now()
           WHERE source = 'ruian-st-uads' AND state = 'active'`,
        );
        await client.query(
          `UPDATE reference_cz.dataset_versions
           SET state = 'active', archived_at = NULL
           WHERE id = $1 AND state = 'staged'`,
          [datasetVersionId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    const statisticsRefreshed = await analyzeAddresses(client);

    const result: RuianImportResult = {
      datasetVersionId,
      sourceVersion,
      effectiveAt: metadata.effectiveAt.toISOString(),
      rowCount,
      checksum: digest,
      state: activate ? "active" : "staged",
      statisticsRefreshed,
    };
    options.onProgress?.({ phase: "complete", rowCount });
    return result;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function getActiveRuianDataset(
  connectionString: string,
): Promise<ActiveRuianDataset | null> {
  const pool = new Pool({ connectionString });
  try {
    const result = await pool.query<{
      id: string;
      version: string;
      effective_at: Date;
      row_count: number;
    }>(
      `SELECT id, version, effective_at, row_count
       FROM reference_cz.dataset_versions
       WHERE source = 'ruian-st-uads' AND state = 'active'
       ORDER BY effective_at DESC
       LIMIT 1`,
    );
    const row = result.rows[0];
    return row
      ? {
          datasetVersionId: row.id,
          sourceVersion: row.version,
          effectiveAt: row.effective_at.toISOString(),
          rowCount: row.row_count,
        }
      : null;
  } finally {
    await pool.end();
  }
}

export async function pruneArchivedRuianDatasets(
  connectionString: string,
  archivedBefore: Date,
): Promise<PrunedRuianDatasets> {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const candidates = await client.query<{ id: string }>(
      `SELECT id
       FROM reference_cz.dataset_versions
       WHERE source = 'ruian-st-uads'
         AND state = 'archived'
         AND archived_at IS NOT NULL
         AND archived_at <= $1
       FOR UPDATE`,
      [archivedBefore],
    );
    const ids = candidates.rows.map((row) => row.id);
    if (ids.length === 0) {
      await client.query("COMMIT");
      return { datasets: 0, addresses: 0 };
    }
    const deletedAddresses = await client.query(
      "DELETE FROM reference_cz.addresses WHERE dataset_version_id = ANY($1::text[])",
      [ids],
    );
    const deletedDatasets = await client.query(
      "DELETE FROM reference_cz.dataset_versions WHERE id = ANY($1::text[])",
      [ids],
    );
    await client.query("COMMIT");
    return {
      datasets: deletedDatasets.rowCount ?? 0,
      addresses: deletedAddresses.rowCount ?? 0,
      statisticsRefreshed: await analyzeAddresses(client),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function localName(qualifiedName: string): string {
  return qualifiedName.includes(":")
    ? (qualifiedName.split(":").at(-1) ?? qualifiedName)
    : qualifiedName;
}

function buildMetadata(raw: RawMetadata): RuianMetadata {
  const required = [
    ["VerzeVFR", raw.vfrVersion],
    ["TypZaznamu", raw.recordType],
    ["TypDavky", raw.batchType],
    ["TypSouboru", raw.fileType],
    ["Datum", raw.generatedAt],
    ["PlatnostDatK/ISUI", raw.effectiveAt],
  ] as const;
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`RÚIAN VFR header is missing: ${missing.join(", ")}.`);
  }

  const generatedAt = parseCzechLocalDate(raw.generatedAt as string);
  const effectiveAt = parseCzechLocalDate(raw.effectiveAt as string);
  if (Number.isNaN(generatedAt.valueOf()) || Number.isNaN(effectiveAt.valueOf())) {
    throw new Error("RÚIAN VFR header contains an invalid date.");
  }

  return {
    vfrVersion: raw.vfrVersion as string,
    recordType: raw.recordType as string,
    batchType: raw.batchType as string,
    fileType: raw.fileType as string,
    generatedAt,
    effectiveAt,
  };
}

function parseCzechLocalDate(value: string): Date {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    return new Date(value);
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value);
  if (!match) {
    return new Date(Number.NaN);
  }

  const [, year, month, day, hour, minute, second, milliseconds = "0"] = match;
  const components = [year, month, day, hour, minute, second];
  if (components.some((component) => component === undefined)) {
    return new Date(Number.NaN);
  }

  const utcGuess = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(milliseconds.padEnd(3, "0")),
  );
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const zonedParts = Object.fromEntries(
    formatter
      .formatToParts(new Date(utcGuess))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const timezoneOffset =
    Date.UTC(
      zonedParts.year ?? 0,
      (zonedParts.month ?? 1) - 1,
      zonedParts.day ?? 1,
      zonedParts.hour ?? 0,
      zonedParts.minute ?? 0,
      zonedParts.second ?? 0,
    ) - utcGuess;

  return new Date(utcGuess - timezoneOffset);
}

function buildAddress(raw: RawAddress): RuianAddress {
  const required = [
    ["AdresniMistoKod", raw.id],
    ["ObecNazev", raw.municipality],
    ["CisloDomovni", raw.houseNumber],
    ["PostaKod", raw.postalCode],
  ] as const;
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`RÚIAN address is missing: ${missing.join(", ")}.`);
  }

  const municipality = raw.municipality as string;
  const houseNumber = raw.houseNumber as string;
  const postalCode = (raw.postalCode as string).replace(/\s+/g, "");
  const orientationNumber = raw.orientationNumber
    ? `${raw.orientationNumber}${raw.orientationLetter ?? ""}`
    : null;
  const compoundNumber = orientationNumber ? `${houseNumber}/${orientationNumber}` : houseNumber;
  const municipalityPart = raw.municipalityPart || null;
  const street = raw.street || null;
  const addressLine = [raw.addressLine1, raw.addressLine2, raw.addressLine3]
    .filter((value): value is string => Boolean(value))
    .join(", ");
  const structuredAddress = [
    street,
    compoundNumber,
    municipalityPart && municipalityPart !== municipality ? municipalityPart : null,
    municipality,
    postalCode,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return {
    id: raw.id as string,
    municipality,
    municipalityPart,
    street,
    houseNumberType: raw.houseNumberType ?? "",
    houseNumber,
    orientationNumber,
    postalCode,
    addressLine: addressLine || structuredAddress,
    searchFull: normalizeCzechAddressSearch(structuredAddress),
    searchCity: normalizeCzechAddressSearch(municipality),
    searchStreet: normalizeCzechAddressSearch(
      [street ?? municipalityPart ?? municipality, compoundNumber].join(" "),
    ),
    searchPostalCode: postalCode.replace(/\D/g, ""),
  };
}

function validateMetadata(metadata: RuianMetadata): void {
  if (metadata.fileType !== "ST_UADS") {
    throw new Error(`Expected RÚIAN ST_UADS, received ${metadata.fileType}.`);
  }
  if (metadata.batchType !== "Plna") {
    throw new Error(`Expected a full RÚIAN batch, received ${metadata.batchType}.`);
  }
}

async function createTemporaryImportTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TEMP TABLE ruian_addresses_stage (
      id text PRIMARY KEY,
      municipality text NOT NULL,
      municipality_part text,
      street text,
      house_number_type text NOT NULL,
      house_number text NOT NULL,
      orientation_number text,
      postal_code text NOT NULL,
      address_line text NOT NULL,
      search_full text NOT NULL,
      search_city text NOT NULL,
      search_street text NOT NULL,
      search_postal_code text NOT NULL
    ) ON COMMIT PRESERVE ROWS
  `);
}

async function insertTemporaryBatch(
  client: PoolClient,
  batch: readonly RuianAddress[],
): Promise<void> {
  await client.query(
    `INSERT INTO pg_temp.ruian_addresses_stage (
      id, municipality, municipality_part, street, house_number_type, house_number,
      orientation_number, postal_code, address_line, search_full, search_city,
      search_street, search_postal_code
    )
    SELECT * FROM unnest(
      $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
      $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[]
    )`,
    [
      batch.map((row) => row.id),
      batch.map((row) => row.municipality),
      batch.map((row) => row.municipalityPart),
      batch.map((row) => row.street),
      batch.map((row) => row.houseNumberType),
      batch.map((row) => row.houseNumber),
      batch.map((row) => row.orientationNumber),
      batch.map((row) => row.postalCode),
      batch.map((row) => row.addressLine),
      batch.map((row) => row.searchFull),
      batch.map((row) => row.searchCity),
      batch.map((row) => row.searchStreet),
      batch.map((row) => row.searchPostalCode),
    ],
  );
}

async function validateTemporaryImport(client: PoolClient, parsedRows: number): Promise<number> {
  const result = await client.query<{ row_count: string; invalid_postal_codes: string }>(`
    SELECT
      count(*)::text AS row_count,
      count(*) FILTER (WHERE search_postal_code !~ '^[0-9]{5}$')::text AS invalid_postal_codes
    FROM pg_temp.ruian_addresses_stage
  `);
  const rowCount = Number(result.rows[0]?.row_count ?? 0);
  const invalidPostalCodes = Number(result.rows[0]?.invalid_postal_codes ?? 0);

  if (rowCount === 0) {
    throw new Error("RÚIAN import produced zero addresses.");
  }
  if (rowCount !== parsedRows) {
    throw new Error(`RÚIAN row-count mismatch: parsed ${parsedRows}, staged ${rowCount}.`);
  }
  if (invalidPostalCodes > 0) {
    throw new Error(`RÚIAN import contains ${invalidPostalCodes} invalid postal codes.`);
  }
  return rowCount;
}
