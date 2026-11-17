import { randomUUID } from "node:crypto";
import type { PilotStore } from "@checkdrop/db";
import { extractApiKeyPrefix, hashApiKey } from "./api-key.js";

const PLACEHOLDER = /replace-with|change-me|changeme|^local-|example/i;

/**
 * Refuses to start a production server with missing, short or sample secrets, so a copied
 * example file can never protect real customer data.
 */
export function assertInstanceSecrets(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const problems: string[] = [];
  const secret = (name: string, minimum: number, required: boolean) => {
    const value = env[name]?.trim();
    if (!value) {
      if (required) problems.push(`${name} is missing`);
      return;
    }
    if (value.length < minimum) problems.push(`${name} must have at least ${minimum} characters`);
    if (PLACEHOLDER.test(value)) problems.push(`${name} still contains a sample value`);
  };
  secret("CHECKDROP_DATABASE_URL", 12, true);
  secret("CHECKDROP_OPERATOR_TOKEN", 32, true);
  secret("CHECKDROP_EMBED_SIGNING_SECRET", 32, true);
  secret("CHECKDROP_OBSERVATION_ENCRYPTION_KEY", 43, true);
  secret("CHECKDROP_PILOT_API_KEY", 40, false);
  secret("CHECKDROP_ADMIN_SETUP_CODE", 16, false);
  if (problems.length > 0) {
    throw new Error(
      `Checkdrop will not start with unsafe settings: ${problems.join("; ")}. Run the installer or generate new values.`,
    );
  }
}

/**
 * The administration's validation tools call the API with CHECKDROP_PILOT_API_KEY. A new
 * installation generates that key itself; this registers it once so no manual step is needed.
 */
export async function ensureConfiguredPilotKey(
  env: NodeJS.ProcessEnv,
  store: Pick<PilotStore, "findApiKeyByPrefix" | "createApiKey">,
  now: () => Date = () => new Date(),
): Promise<"registered" | "present" | "not_configured"> {
  const key = env.CHECKDROP_PILOT_API_KEY?.trim();
  const prefix = key ? extractApiKeyPrefix(key) : null;
  if (!key || !prefix) return "not_configured";
  if (await store.findApiKeyByPrefix(prefix)) return "present";
  await store.createApiKey({
    id: randomUUID(),
    projectRef: env.CHECKDROP_OPERATOR_PROJECT_REF?.trim() || "default",
    name: "Administration",
    keyPrefix: prefix,
    verifier: hashApiKey(key),
    state: "active",
    createdAt: now(),
  });
  return "registered";
}
