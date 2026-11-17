import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface ShadowObservationCipher {
  encrypt(value: string, associatedData: string): string;
  decrypt(envelope: string, associatedData: string): string;
}

export function createShadowObservationCipher(
  encodedKey: string | null | undefined,
): ShadowObservationCipher | null {
  const compact = encodedKey?.trim();
  if (!compact) return null;
  const key = Buffer.from(compact, "base64url");
  if (key.length !== KEY_BYTES) {
    throw new Error("CHECKDROP_OBSERVATION_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }

  return {
    encrypt(value, associatedData) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      cipher.setAAD(Buffer.from(associatedData, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [
        ENVELOPE_VERSION,
        iv.toString("base64url"),
        tag.toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(".");
    },

    decrypt(envelope, associatedData) {
      const [version, encodedIv, encodedTag, encodedCiphertext, trailing] = envelope.split(".");
      if (
        version !== ENVELOPE_VERSION ||
        !encodedIv ||
        !encodedTag ||
        encodedCiphertext === undefined ||
        trailing !== undefined
      ) {
        throw new Error("Unsupported shadow observation encryption envelope.");
      }
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encodedIv, "base64url"));
      decipher.setAAD(Buffer.from(associatedData, "utf8"));
      decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(encodedCiphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
