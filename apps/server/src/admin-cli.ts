import { createAdminAccountStore } from "@checkdrop/db";
import { adminPasswordProblem, hashAdminPassword, normalizeAdminEmail } from "./admin-auth.js";

/**
 * Server-side administrator tools; no e-mail service is needed.
 *   node dist/admin-cli.js reset-password <email>   (new password on stdin)
 *   node dist/admin-cli.js delete-expired-sessions
 */
const [command, emailArgument] = process.argv.slice(2);
const connectionString = process.env.CHECKDROP_DATABASE_URL;
if (!connectionString) {
  process.stderr.write("CHECKDROP_DATABASE_URL is required.\n");
  process.exit(2);
}
const store = createAdminAccountStore(connectionString);

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

try {
  if (command === "reset-password") {
    const email = normalizeAdminEmail(emailArgument);
    if (!email) throw new Error("Usage: reset-password <email>, new password on stdin.");
    const password = await readStdin();
    const problem = adminPasswordProblem(password);
    if (problem) throw new Error(`Password rejected: ${problem} (at least 12 characters).`);
    if (!(await store.setPassword(email, await hashAdminPassword(password))))
      throw new Error("No administrator with this e-mail.");
    process.stdout.write(`${JSON.stringify({ status: "password_reset", email })}\n`);
  } else if (command === "delete-expired-sessions") {
    const removed = await store.deleteExpiredSessions(new Date());
    process.stdout.write(`${JSON.stringify({ status: "ok", removed })}\n`);
  } else {
    throw new Error("Commands: reset-password <email> | delete-expired-sessions");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await store.close();
}
