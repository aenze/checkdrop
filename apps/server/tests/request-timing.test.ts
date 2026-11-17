import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { measureRequestPhase, type RequestTiming, requestTiming } from "../src/request-timing.js";

describe("request timing", () => {
  it("includes authentication and durable writes without changing the legacy validation timer", async () => {
    let time = 0;
    const reports: RequestTiming[] = [];
    const app = new Hono();
    app.use(
      "*",
      requestTiming(
        () => time,
        (report) => reports.push(report),
      ),
    );
    app.post("/v1/test/:id", async (context) => {
      await measureRequestPhase(context, "auth", async () => {
        time += 80;
      });
      time += 2;
      await measureRequestPhase(context, "usage", async () => {
        time += 120;
      });
      await measureRequestPhase(context, "observation", async () => {
        time += 180;
      });
      context.header("Server-Timing", "checkdrop;dur=2");
      return context.json({ ok: true });
    });
    const response = await app.request("/v1/test/private-id?email=private", { method: "POST" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Server-Timing")).toBe(
      "checkdrop;dur=2, total;dur=382.00, auth;dur=80.00, usage;dur=120.00, observation;dur=180.00",
    );
    expect(reports).toEqual([
      {
        route: "/v1/test/:id",
        status: 200,
        totalMs: 382,
        phases: { auth: 80, usage: 120, observation: 180 },
      },
    ]);
    expect(JSON.stringify(reports)).not.toContain("private");
  });
});
