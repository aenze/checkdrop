/** The origin the generated snippet loads from, so the CSP hint matches this installation. */
export function snippetOrigin(snippet: string): string {
  const source = /\ssrc="([^"]+)"/.exec(snippet)?.[1];
  try {
    return source ? new URL(source).origin : "";
  } catch {
    return "";
  }
}
