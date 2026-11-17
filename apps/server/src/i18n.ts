import type { Context } from "hono";

export type Locale = "cs" | "en";

/** The administration sends X-Checkdrop-Locale; other clients may rely on Accept-Language. */
export function requestLocale(context: Context): Locale {
  const explicit = context.req.header("X-Checkdrop-Locale");
  if (explicit === "en" || explicit === "cs") return explicit;
  const accepted = context.req.header("Accept-Language") ?? "";
  return /^\s*(cs|sk)\b/i.test(accepted) || accepted === "" ? "cs" : "en";
}

/** Czech first, English second, chosen by the request. */
export function msg(context: Context, cs: string, en: string): string {
  return requestLocale(context) === "en" ? en : cs;
}
