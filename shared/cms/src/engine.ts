/**
 * Low-level Web Crypto helpers shared by the CMS sign/verify/timestamp paths.
 *
 * pkijs auto-detects Bun's global Web Crypto, so no `setEngine` call is needed.
 * These helpers only normalize buffers and lift `crypto.subtle.digest` into the
 * Effect channel with a tagged failure.
 */

import { Effect } from "effect";
import {
  type CmsHashAlgorithm,
  CmsError,
  CmsErrorCodeValue,
  CmsOperationValue,
  safeCauseMetadata,
  webCryptoHashName,
} from "./config";

/** Copy into a fresh ArrayBuffer so asn1js/pkijs/SubtleCrypto see a clean buffer. */
export const toArrayBuffer = (data: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
};

/** A fresh ArrayBuffer-backed view that satisfies `BufferSource`. */
export const toBufferSource = (data: Uint8Array): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
};

export const digest = (
  algorithm: CmsHashAlgorithm,
  data: Uint8Array,
): Effect.Effect<Uint8Array, CmsError> =>
  Effect.tryPromise({
    try: () => crypto.subtle.digest(webCryptoHashName(algorithm), toBufferSource(data)),
    catch: (cause) =>
      new CmsError({
        code: CmsErrorCodeValue.unsupportedAlgorithm,
        reason: `Failed to digest with ${algorithm}.`,
        operation: CmsOperationValue.attributes,
        ...safeCauseMetadata(cause),
      }),
  }).pipe(Effect.map((buffer) => new Uint8Array(buffer)));
