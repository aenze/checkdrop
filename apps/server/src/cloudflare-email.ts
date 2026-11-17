export interface LoginEmailSender {
  sendLogin(email: string, link: string): Promise<void>;
}

/** Transactional sending, not Email Routing. Credentials and links must never be logged. */
export function createCloudflareLoginEmail(options: {
  readonly accountId: string;
  readonly apiToken: string;
  readonly from: string;
  readonly loginOrigin: string;
  readonly fetch?: typeof fetch;
}): LoginEmailSender {
  if (
    !/^[a-f0-9]{32}$/i.test(options.accountId) ||
    !options.apiToken ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(options.from)
  )
    throw new Error("Cloudflare Email Sending configuration is invalid");
  const origin = new URL(options.loginOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("Login origin must be a trusted HTTPS origin");
  const send = options.fetch ?? fetch;
  return {
    async sendLogin(email, link) {
      const target = new URL(link);
      if (
        target.origin !== origin.origin ||
        target.pathname !== "/login/confirm" ||
        target.search ||
        !/^#token=[A-Za-z0-9_-]{43}$/.test(target.hash) ||
        !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
        email.length > 320
      )
        throw new Error("Invalid login email");
      const response = await send(
        `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/email/sending/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: options.from,
            to: email,
            subject: "Přihlášení do Checkdropu",
            text: `Pro přihlášení do Checkdropu otevřete tento odkaz:\n\n${link}\n\nOdkaz platí 15 minut a lze ho použít pouze jednou, ve stejném prohlížeči, ve kterém jste o něj požádali.\n\nPokud jste o přihlášení nežádali, zprávu ignorujte. Nikomu tento odkaz nepřeposílejte.`,
          }),
          signal: AbortSignal.timeout(8000),
          redirect: "error",
        },
      );
      if (!response.ok) throw new Error("Cloudflare login email unavailable");
      const body = (await response.json()) as {
        success?: boolean;
        result?: { queued?: string[]; delivered?: string[] };
      };
      const recipients = [...(body.result?.queued ?? []), ...(body.result?.delivered ?? [])];
      if (
        body.success !== true ||
        !recipients.some((recipient) => recipient.toLowerCase() === email.toLowerCase())
      )
        throw new Error("Cloudflare login email not accepted");
    },
  };
}
