import { randomUUID } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createPostgresPilotStore } from "@checkdrop/db";
import { generatePilotApiKey } from "./api-key.js";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--out");
const nameIndex = args.indexOf("--name");
const projectIndex = args.indexOf("--project");
const outputArgument = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
const name = nameIndex >= 0 ? args[nameIndex + 1] : "Czech pilot";
const projectRef = projectIndex >= 0 ? args[projectIndex + 1] : "pilot-cz";
const connectionString = process.env.CHECKDROP_DATABASE_URL;

if (!connectionString || !outputArgument || !name || !projectRef) {
  process.stderr.write(
    "Usage: CHECKDROP_DATABASE_URL=... pnpm pilot-key:create -- --out <secure-file> [--name <name>] [--project <ref>]\n",
  );
  process.exitCode = 2;
} else {
  const outputPath = resolve(outputArgument);
  const generated = generatePilotApiKey();
  const store = createPostgresPilotStore(connectionString);
  let outputCreated = false;

  try {
    const handle = await open(outputPath, "wx", 0o600);
    outputCreated = true;
    try {
      await handle.writeFile(
        `${JSON.stringify(
          {
            api_key: generated.key,
            key_prefix: generated.prefix,
            project_ref: projectRef,
            created_at: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      await handle.close();
    }

    await store.createApiKey({
      id: randomUUID(),
      projectRef,
      name,
      keyPrefix: generated.prefix,
      verifier: generated.verifier,
      state: "active",
      createdAt: new Date(),
    });

    process.stdout.write(
      `${JSON.stringify({ created: true, key_prefix: generated.prefix, output_file: outputPath })}\n`,
    );
  } catch (error) {
    if (outputCreated) await unlink(outputPath).catch(() => undefined);
    throw error;
  } finally {
    await store.close();
  }
}
