export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ProviderRuntimeOptions {
  readonly fetchImpl?: FetchLike;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

export class ProviderTimeoutError extends Error {
  constructor() {
    super("Provider request timed out.");
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderResponseError extends Error {
  constructor() {
    super("Provider response is invalid or exceeds the configured limit.");
    this.name = "ProviderResponseError";
  }
}

export async function fetchWithTimeout(
  fetchImpl: FetchLike,
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readBoundedJson(
  response: Response,
  timeoutMs: number,
  maxBodyBytes = 65_536,
): Promise<unknown> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("Provider timeoutMs must be an integer between 1 and 30000.");
  }
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 1_048_576) {
    throw new Error("Provider maxBodyBytes must be an integer between 1 and 1048576.");
  }

  const declaredLength = response.headers.get("Content-Length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBodyBytes)
  ) {
    await response.body?.cancel();
    throw new ProviderResponseError();
  }

  const reader = response.body?.getReader();
  if (!reader) throw new ProviderResponseError();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = Symbol("provider-response-timeout");
  const deadline = new Promise<typeof timeout>((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve(timeout);
    }, timeoutMs);
  });

  try {
    while (true) {
      const result = await Promise.race([reader.read(), deadline]);
      if (result === timeout) {
        await reader.cancel(new ProviderTimeoutError());
        throw new ProviderTimeoutError();
      }
      const { done, value } = result;
      if (done) break;
      total += value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel();
        throw new ProviderResponseError();
      }
      chunks.push(value);
    }
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new ProviderResponseError();
  }
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nullableString(value: unknown, maxLength = 4_096): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}
