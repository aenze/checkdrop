import type { Context, MiddlewareHandler } from "hono";

export interface RequestTiming {
  readonly route: string;
  readonly status: number;
  readonly totalMs: number;
  readonly phases: Readonly<Record<string, number>>;
}
const requests = new WeakMap<Context, { clock: () => number; phases: Record<string, number> }>();

export function requestTiming(
  clock: () => number,
  report?: (value: RequestTiming) => void,
): MiddlewareHandler {
  return async (context, next) => {
    const started = clock();
    const state = { clock, phases: {} as Record<string, number> };
    requests.set(context, state);
    await next();
    const totalMs = Math.max(0, clock() - started);
    const existing = context.res.headers.get("Server-Timing");
    context.header(
      "Server-Timing",
      [
        existing,
        `total;dur=${totalMs.toFixed(2)}`,
        ...Object.entries(state.phases).map(([name, ms]) => `${name};dur=${ms.toFixed(2)}`),
      ]
        .filter(Boolean)
        .join(", "),
    );
    // No query strings, customer values, keys or unbounded path parameters.
    try {
      report?.({
        route: context.req.routePath || "unmatched",
        status: context.res.status,
        totalMs,
        phases: state.phases,
      });
    } catch {
      // Diagnostics must not turn a completed request into a failure.
    } finally {
      requests.delete(context);
    }
  };
}

export async function measureRequestPhase<T>(
  context: Context,
  name: "auth" | "usage" | "observation",
  work: () => Promise<T>,
): Promise<T> {
  const state = requests.get(context);
  if (!state) return work();
  const started = state.clock();
  try {
    return await work();
  } finally {
    state.phases[name] = (state.phases[name] ?? 0) + Math.max(0, state.clock() - started);
  }
}
