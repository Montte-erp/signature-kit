/**
 * PKCS#7 unpadding helper.
 *
 * Validates the trailing PKCS#7 padding of a decrypted block stream and returns
 * the plaintext with the padding removed. Invalid padding fails with a tagged
 * `CryptoError` at the decision point rather than throwing.
 */

import { Effect } from "effect";
import { CryptoError, CryptoErrorCodeValue } from "../config";

export const removePkcs7Padding = (
  data: Uint8Array,
  blockSize: number,
): Effect.Effect<Uint8Array, CryptoError> => {
  if (data.length === 0) return Effect.succeed(data);
  const pad = data[data.length - 1]!;
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
