/**
 * A1 certificate container loading.
 *
 * `parseCertificate` is deliberately in the A1 signer package: PKCS#12 is one
 * backend, not the core runtime. X.509 parsing lives in `@signature-kit/x509`.
 */

import { derToPem, parsePkcs12 } from "@signature-kit/crypto";
import type { CryptoError } from "@signature-kit/crypto";
import type { Certificate } from "@signature-kit/contracts";
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  safeCauseMetadata,
} from "@signature-kit/contracts";
import { extractBrazilianFields, parseX509 } from "@signature-kit/x509";
import { Effect, Redacted } from "effect";

// =============================================================================
// Public API
// =============================================================================

/** Parse a `.pfx`/`.p12` container into a normalized {@link Certificate}. */
export const parseCertificate = (
  pfx: Uint8Array,
  password: Redacted.Redacted<string>,
): Effect.Effect<Certificate, SignatureKitError> =>
  Effect.gen(function* () {
    if (pfx.length === 0) {
      return yield* Effect.fail(
        new SignatureKitError({ code: SignatureKitErrorCodeValue.emptyFile, retryable: false }),
      );
    }
    if (!isLikelyPkcs12(pfx)) {
      const detected = detectFileType(pfx);
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidFormat,
          retryable: false,
          reason: `The file does not appear to be a PKCS#12 certificate${detected === null ? "" : ` (detected: ${detected})`}.`,
        }),
      );
    }

    const pkcs12 = yield* parsePkcs12(pfx, password).pipe(Effect.mapError(fromCrypto));
    const certPem = derToPem(pkcs12.certificate, "CERTIFICATE");
    const keyPem = derToPem(pkcs12.privateKey, "PRIVATE KEY");
    const x509 = yield* parseX509(pkcs12.certificate);
    const fingerprint = yield* digestSha256Hex(pkcs12.certificate);

    return {
      serialNumber: x509.serialNumber,
      subject: x509.subject,
      issuer: x509.issuer,
      validity: x509.validity,
      fingerprint,
      subjectAltName: x509.subjectAltName,
      isValid: checkValidity(x509.validity),
      brazilian: extractBrazilianFields(x509.subject.raw, x509.subjectAltName),
      certPem,
      certificateDer: pkcs12.certificate,
      publicKeyDer: x509.publicKeyDer,
      privateKeyPem: Redacted.make(keyPem),
    } satisfies Certificate;
  });

// =============================================================================
// Internals
// =============================================================================

const fromCrypto = (error: CryptoError): SignatureKitError => {
  const code = ((): SignatureKitError["code"] => {
    switch (error.code) {
      case "crypto.WRONG_PASSWORD":
        return SignatureKitErrorCodeValue.wrongPassword;
      case "crypto.UNSUPPORTED_ALGORITHM":
        return SignatureKitErrorCodeValue.unsupportedAlgorithm;
      case "crypto.NO_CERTIFICATE":
        return SignatureKitErrorCodeValue.noCertificate;
      case "crypto.NO_PRIVATE_KEY":
        return SignatureKitErrorCodeValue.noPrivateKey;
      case "crypto.INVALID_FORMAT":
        return SignatureKitErrorCodeValue.invalidFormat;
      case "crypto.DECODE_ERROR":
      case "crypto.CORRUPTED_FILE":
      case "crypto.CIPHER_ERROR":
        return SignatureKitErrorCodeValue.corruptedFile;
      case "crypto.UNKNOWN":
        return SignatureKitErrorCodeValue.unknown;
    }
  })();
  return new SignatureKitError({
    code,
    retryable: false,
    reason: error.message,
    operation: SignatureKitOperationValue.pkcs12Parse,
  });
};

const toBufferSource = (data: Uint8Array): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
};

const digestSha256Hex = (data: Uint8Array): Effect.Effect<string, SignatureKitError> =>
  Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", toBufferSource(data)),
    catch: (cause) =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.digestFailed,
        retryable: false,
        operation: SignatureKitOperationValue.cryptoDigest,
        ...safeCauseMetadata(cause),
      }),
  }).pipe(
    Effect.map((buffer) =>
      Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    ),
  );

const checkValidity = (validity: Certificate["validity"]): boolean => {
  const now = Date.now();
  return now >= validity.notBefore.getTime() && now <= validity.notAfter.getTime();
};

const isLikelyPkcs12 = (data: Uint8Array): boolean => data.length >= 4 && data[0] === 0x30;

const detectFileType = (data: Uint8Array): string | null => {
  if (data.length < 4) return "file too small";
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return "PDF";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "PNG";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "JPEG";
  if (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04)
    return "ZIP/Office";
  if (data[0] === 0x2d && data[1] === 0x2d && data[2] === 0x2d && data[3] === 0x2d)
    return "PEM text";
  return null;
};
