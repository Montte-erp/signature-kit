/**
 * Web Crypto (SubtleCrypto) boundary for byte signing and verification.
 *
 * The private key PEM is unwrapped from `Redacted` only here, at the exact
 * import point, and never logged. RSA-SHA256/512 map to RSASSA-PKCS1-v1_5.
 */

import { pemToDer } from "@signature-kit/crypto";
import type { SignatureAlgorithm } from "@signature-kit/contracts";
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  safeCauseMetadata,
} from "@signature-kit/contracts";
import { Effect, Redacted } from "effect";

const RSA_ALGORITHM_NAME = "RSASSA-PKCS1-v1_5";

type RsaAlgorithm = {
  readonly name: typeof RSA_ALGORITHM_NAME;
  readonly hash: "SHA-256" | "SHA-512";
};

const rsaAlgorithm = (algorithm: SignatureAlgorithm): RsaAlgorithm => ({
  name: RSA_ALGORITHM_NAME,
  hash: algorithm === "rsa-sha512" ? "SHA-512" : "SHA-256",
});

/** Copy into a fresh ArrayBuffer-backed view so it satisfies `BufferSource`. */
const toBufferSource = (data: Uint8Array): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
};

const importKey = (
  format: "pkcs8" | "spki",
  keyData: Uint8Array,
  algorithm: SignatureAlgorithm,
  usage: "sign" | "verify",
): Effect.Effect<CryptoKey, SignatureKitError> =>
  Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(format, toBufferSource(keyData), rsaAlgorithm(algorithm), false, [
        usage,
      ]),
    catch: (cause) =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.keyImportFailed,
        retryable: false,
        reason: `Failed to import ${format} key for ${algorithm}.`,
        operation: SignatureKitOperationValue.cryptoImport,
        ...safeCauseMetadata(cause),
      }),
  });

export const importPrivateKey = (
  privateKey: Redacted.Redacted<string>,
  algorithm: SignatureAlgorithm,
): Effect.Effect<CryptoKey, SignatureKitError> =>
  importKey("pkcs8", pemToDer(Redacted.value(privateKey)), algorithm, "sign");

export const importPublicKey = (
  publicKeyDer: Uint8Array,
  algorithm: SignatureAlgorithm,
): Effect.Effect<CryptoKey, SignatureKitError> =>
  importKey("spki", publicKeyDer, algorithm, "verify");

export const signWithKey = (
  key: CryptoKey,
  algorithm: SignatureAlgorithm,
  content: Uint8Array,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  Effect.gen(function* () {
    const signature = yield* Effect.tryPromise({
      try: () => crypto.subtle.sign(rsaAlgorithm(algorithm).name, key, toBufferSource(content)),
      catch: (cause) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.signFailed,
          retryable: false,
          operation: SignatureKitOperationValue.cryptoSign,
          ...safeCauseMetadata(cause),
        }),
    });
    return new Uint8Array(signature);
  });

export const verifyWithKey = (
  key: CryptoKey,
  algorithm: SignatureAlgorithm,
  signature: Uint8Array,
  content: Uint8Array,
): Effect.Effect<boolean, SignatureKitError> =>
  Effect.tryPromise({
    try: () =>
      crypto.subtle.verify(
        rsaAlgorithm(algorithm).name,
        key,
        toBufferSource(signature),
        toBufferSource(content),
      ),
    catch: (cause) =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.verifyFailed,
        retryable: false,
        operation: SignatureKitOperationValue.cryptoVerify,
        ...safeCauseMetadata(cause),
      }),
  });
