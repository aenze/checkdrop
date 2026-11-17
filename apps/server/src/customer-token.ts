import type { VerifiedCustomerIdentity } from "@checkdrop/db";
import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from "jose";

export function createCustomerTokenVerifier(options: {
  readonly issuer: string;
  readonly audience: string;
  readonly keys: JWTVerifyGetKey;
}) {
  if (!options.issuer || !options.audience)
    throw new Error("Customer token issuer and audience are required");
  return async (token: string): Promise<VerifiedCustomerIdentity | null> => {
    try {
      const { payload } = await jwtVerify(token, options.keys, {
        issuer: options.issuer,
        audience: options.audience,
        algorithms: ["RS256", "ES256"],
        requiredClaims: ["sub", "iss", "aud", "exp", "iat"],
        maxTokenAge: "1h",
        clockTolerance: 5,
      });
      if (!payload.sub || payload.sub.length > 512) return null;
      // Roles and projects in the token are deliberately ignored: the DB is authoritative.
      return { issuer: options.issuer, subject: payload.sub };
    } catch (error) {
      if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) return null;
      throw error;
    }
  };
}

/** URL comes only from trusted server configuration, never from JWT jku/x5u headers. */
export function customerRemoteKeys(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new Error("Customer JWKS must use a trusted HTTPS URL without credentials");
  }
  return createRemoteJWKSet(parsed, {
    timeoutDuration: 2500,
    cooldownDuration: 30000,
    cacheMaxAge: 300000,
  });
}
