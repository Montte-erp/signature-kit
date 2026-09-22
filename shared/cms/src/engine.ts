import { Effect } from "effect";
import { CmsError, CmsErrorCodeValue, CmsOperationValue, webCryptoHashName } from "./config.js";
import type { CmsHashAlgorithm } from "./config.js";

export const digest = (
  algorithm: CmsHashAlgorithm,
  data: Uint8Array,
): Effect.Effect<Uint8Array, CmsError> =>
  Effect.tryPromise({
    try: () => crypto.subtle.digest(webCryptoHashName(algorithm), new Uint8Array(data)),
    catch: () =>
      new CmsError({
        code: CmsErrorCodeValue.unsupportedAlgorithm,
        reason: `Failed to digest with ${algorithm}.`,
        operation: CmsOperationValue.attributes,
      }),
  }).pipe(Effect.map((buffer) => new Uint8Array(buffer)));
