import { createCustomerAccessStore } from "@checkdrop/db";
import { createCustomerAuthorizer } from "./customer-authorization.js";
import { createCustomerTokenVerifier, customerRemoteKeys } from "./customer-token.js";

/** Explicit opt-in only. Existing operator deployments remain unchanged. */
export function configuredCustomerAuthorization(env: NodeJS.ProcessEnv) {
  if (!env.CHECKDROP_CUSTOMER_AUTH_ENABLED || env.CHECKDROP_CUSTOMER_AUTH_ENABLED === "0")
    return undefined;
  if (env.CHECKDROP_CUSTOMER_AUTH_ENABLED !== "1")
    throw new Error("CHECKDROP_CUSTOMER_AUTH_ENABLED must be 0 or 1");
  const issuer = env.CHECKDROP_CUSTOMER_AUTH_ISSUER;
  const audience = env.CHECKDROP_CUSTOMER_AUTH_AUDIENCE;
  const jwks = env.CHECKDROP_CUSTOMER_AUTH_JWKS_URL;
  const database = env.CHECKDROP_DATABASE_URL;
  if (!issuer || !audience || !jwks || !database)
    throw new Error("Customer authentication requires issuer, audience, JWKS URL and database");
  const issuerUrl = new URL(issuer);
  if (issuerUrl.protocol !== "https:" || issuerUrl.username || issuerUrl.password || issuerUrl.hash)
    throw new Error("Customer issuer must be a trusted HTTPS URL");
  const verifyBearer = createCustomerTokenVerifier({
    issuer,
    audience,
    keys: customerRemoteKeys(jwks),
  });
  return createCustomerAuthorizer({
    verifyBearer,
    accessStore: createCustomerAccessStore(database),
  });
}
