import { Effect } from "effect";
import {
  type CmsHashAlgorithm,
  CmsError,
  CmsErrorCodeValue,
  CmsOperationValue,
  webCryptoHashName,
} from "./config";

export const toArrayBuffer = (data: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
};

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
    catch: () =>
      new CmsError({
        code: CmsErrorCodeValue.unsupportedAlgorithm,
        reason: `Failed to digest with ${algorithm}.`,
        operation: CmsOperationValue.attributes,
      }),
  }).pipe(Effect.map((buffer) => new Uint8Array(buffer)));
