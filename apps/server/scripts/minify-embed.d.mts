export function minifyEmbedScript(source: string): Promise<string>;
export function describeEmbedScript(code: string): {
  sha256: string;
  bytes: number;
  gzipBytes: number;
};
