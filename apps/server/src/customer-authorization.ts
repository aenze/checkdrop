import type {
  CustomerPermission,
  createCustomerAccessStore,
  VerifiedCustomerIdentity,
} from "@checkdrop/db";

export type CustomerAuthorization =
  | { readonly status: "allowed"; readonly projectRef: string }
  | { readonly status: "unauthenticated" }
  | { readonly status: "forbidden" };

/** The verifier must validate signature, issuer, audience and expiry. Never decode-only. */
export interface CustomerAuthorizationDependencies {
  readonly verifyBearer: (token: string) => Promise<VerifiedCustomerIdentity | null>;
  readonly accessStore: Pick<ReturnType<typeof createCustomerAccessStore>, "authorize">;
}

export function createCustomerAuthorizer(dependencies: CustomerAuthorizationDependencies) {
  return async (
    request: Request,
    permission: CustomerPermission,
  ): Promise<CustomerAuthorization> => {
    const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(
      request.headers.get("Authorization") ?? "",
    );
    if (!match?.[1] || match[1].length > 8192) return { status: "unauthenticated" };
    const identity = await dependencies.verifyBearer(match[1]);
    if (!identity) return { status: "unauthenticated" };
    // Project selection is untrusted until membership is verified in the database.
    const projectRef = request.headers.get("X-Checkdrop-Project") ?? "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectRef)) return { status: "forbidden" };
    const access = await dependencies.accessStore.authorize(identity, projectRef, permission);
    if (!access || access.projectRef !== projectRef) return { status: "forbidden" };
    return { status: "allowed", projectRef: access.projectRef };
  };
}

export type CustomerAuthorizer = ReturnType<typeof createCustomerAuthorizer>;
