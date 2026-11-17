import { createPostgresPilotStore } from "@checkdrop/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { configuredCustomerAuthorization } from "./customer-auth-config.js";
import { assertInstanceSecrets, ensureConfiguredPilotKey } from "./instance-bootstrap.js";
import { readInstanceConfig } from "./instance-config.js";

assertInstanceSecrets();
const instanceConfig = readInstanceConfig();
if (process.env.CHECKDROP_DATABASE_URL && process.env.CHECKDROP_PILOT_API_KEY) {
  const pilotStore = createPostgresPilotStore(process.env.CHECKDROP_DATABASE_URL);
  const result = await ensureConfiguredPilotKey(process.env, pilotStore).finally(() =>
    pilotStore.close(),
  );
  process.stdout.write(`${JSON.stringify({ event: "pilot_key", result })}\n`);
}
const port = Number(process.env.PORT ?? "8787");
const customerAuthorizer = configuredCustomerAuthorization(process.env);
serve(
  {
    fetch: createApp({
      instanceConfig,
      ...(customerAuthorizer ? { customerAuthorizer } : {}),
      onRequestTiming: (timing) => {
        process.stdout.write(`${JSON.stringify({ event: "request_timing", ...timing })}\n`);
      },
    }).fetch,
    hostname: "0.0.0.0",
    port,
  },
  ({ port: activePort }) => {
    process.stdout.write(`Checkdrop server listening on port ${activePort}\n`);
  },
);
