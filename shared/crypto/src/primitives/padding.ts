import { Effect } from "effect";
import { CryptoError, CryptoErrorCodeValue } from "../config.js";

export const removePkcs7Padding = (
  data: Uint8Array,
  blockSize: number,
): Effect.Effect<Uint8Array, CryptoError> => {
  const pad = data[data.length - 1] ?? 0;
  if (pad === 0 || pad > blockSize) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.cipherError,
        reason: "Invalid PKCS#7 padding.",
      }),
    );
  }
  for (let i = data.length - pad; i < data.length; i++) {
    if (data[i] !== pad) {
      return Effect.fail(
        new CryptoError({
          code: CryptoErrorCodeValue.cipherError,
          reason: "Invalid PKCS#7 padding.",
        }),
      );
    }
  }
  return Effect.succeed(data.subarray(0, data.length - pad));
};
