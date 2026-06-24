/**
 * The first e-signature adapter: A1 / PKCS#12.
 */

import { createSignatureKit } from "@signature-kit/core/runtime";
import type { SignatureKitRuntime } from "@signature-kit/core/runtime";
import { createSignaturesService, Signatures } from "@signature-kit/core/signatures";
import type { Certificate, SignatureAlgorithm, SignerAdapter } from "@signature-kit/core/config";
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  SignatureKitSchemaNameValue,
  schemaErrorMetadata,
  signInputSchema,
  verifyInputSchema,
} from "@signature-kit/core/config";
import { daysUntilExpiry, parseCertificate, toSignerIdentity } from "@signature-kit/certificates";
import { Effect, Layer, Schema } from "effect";
import type { A1CertificateProfile, A1SignerOptions } from "./config";
import { a1SignerOptionsSchema } from "./config";
import { importPrivateKey, importPublicKey, signWithKey, verifyWithKey } from "./web-crypto";

/** Cache WebCrypto imports per adapter and algorithm. */
const cachedKey = (
  cache: Map<SignatureAlgorithm, CryptoKey>,
  algorithm: SignatureAlgorithm,
  load: (algorithm: SignatureAlgorithm) => Effect.Effect<CryptoKey, SignatureKitError>,
): Effect.Effect<CryptoKey, SignatureKitError> => {
  const cached = cache.get(algorithm);
  if (cached !== undefined) return Effect.succeed(cached);
  return load(algorithm).pipe(Effect.tap((key) => Effect.sync(() => cache.set(algorithm, key))));
};

const decodeA1SignerOptions = (
  options: A1SignerOptions,
): Effect.Effect<A1SignerOptions, SignatureKitError> =>
  Schema.decodeUnknownEffect(a1SignerOptionsSchema)(options).pipe(
    Effect.mapError(
      (error) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          reason: "Invalid A1 signer options.",
          operation: SignatureKitOperationValue.schemaDecode,
          schemaName: SignatureKitSchemaNameValue.a1SignerOptions,
          ...schemaErrorMetadata(error),
        }),
    ),
  );

const certificateProfile = (
  certificate: Certificate,
): Effect.Effect<A1CertificateProfile, SignatureKitError> =>
  Effect.gen(function* () {
    if (!certificate.isValid) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          reason: `A1 certificate is not valid on the current date. Validity: ${certificate.validity.notBefore.toISOString()} to ${certificate.validity.notAfter.toISOString()}.`,
        }),
      );
    }

    const document = certificate.brazilian.cnpj ?? certificate.brazilian.cpf;
    if (document === null) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          reason: "A1 certificate does not contain a Brazilian CPF or CNPJ.",
        }),
      );
    }

    return {
      document,
      subject: certificate.subject.commonName ?? certificate.subject.raw,
      organization: certificate.subject.organization,
      issuer: certificate.issuer.commonName ?? certificate.issuer.raw,
      serialNumber: certificate.serialNumber,
      fingerprint: certificate.fingerprint,
      validFrom: certificate.validity.notBefore,
      validTo: certificate.validity.notAfter,
      daysUntilExpiry: daysUntilExpiry(certificate),
    };
  });

/** Build an A1 signer adapter from an already-parsed core {@link Certificate}. */
export const createA1SignerAdapter = (certificate: Certificate): SignerAdapter => {
  const privateKeys = new Map<SignatureAlgorithm, CryptoKey>();
  const publicKeys = new Map<SignatureAlgorithm, CryptoKey>();

  const signingKey = (algorithm: SignatureAlgorithm) =>
    cachedKey(privateKeys, algorithm, (validAlgorithm) =>
      importPrivateKey(certificate.privateKeyPem, validAlgorithm),
    );

  const verificationKey = (algorithm: SignatureAlgorithm) =>
    cachedKey(publicKeys, algorithm, (validAlgorithm) =>
      importPublicKey(certificate.publicKeyDer, validAlgorithm),
    );

  return {
    id: "a1",
    inspect: () => Effect.succeed(toSignerIdentity(certificate)),
    certificate: () => Effect.succeed(certificate),
    importSigningKey: signingKey,
    sign: (input) =>
      Schema.decodeUnknownEffect(signInputSchema)(input).pipe(
        Effect.mapError(
          (error) =>
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.invalidInput,
              retryable: false,
              reason: "Invalid sign input.",
              operation: SignatureKitOperationValue.schemaDecode,
              schemaName: SignatureKitSchemaNameValue.signInput,
              ...schemaErrorMetadata(error),
            }),
        ),
        Effect.flatMap((valid) =>
          signingKey(valid.algorithm).pipe(
            Effect.flatMap((key) => signWithKey(key, valid.algorithm, valid.content)),
            Effect.map((signature) => ({ algorithm: valid.algorithm, signature })),
          ),
        ),
      ),
    verify: (input) =>
      Schema.decodeUnknownEffect(verifyInputSchema)(input).pipe(
        Effect.mapError(
          (error) =>
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.invalidInput,
              retryable: false,
              reason: "Invalid verify input.",
              operation: SignatureKitOperationValue.schemaDecode,
              schemaName: SignatureKitSchemaNameValue.verifyInput,
              ...schemaErrorMetadata(error),
            }),
        ),
        Effect.flatMap((valid) =>
          verificationKey(valid.algorithm).pipe(
            Effect.flatMap((key) =>
              verifyWithKey(key, valid.algorithm, valid.signature, valid.content),
            ),
            Effect.map((val32) => ({ valid: val32, algorithm: valid.algorithm })),
          ),
        ),
      ),
  };
};

/** Load an A1 container and build the adapter in one Effect. */
export const loadA1SignerAdapter = (
  options: A1SignerOptions,
): Effect.Effect<SignerAdapter, SignatureKitError> =>
  decodeA1SignerOptions(options).pipe(
    Effect.flatMap((valid) => parseCertificate(valid.pfx, valid.password)),
    Effect.map(createA1SignerAdapter),
  );

/** Load an A1 container and return the small runtime facade used by apps. */
export const loadA1SignatureKit = (
  options: A1SignerOptions,
): Effect.Effect<SignatureKitRuntime, SignatureKitError> =>
  loadA1SignerAdapter(options).pipe(Effect.map((signer) => createSignatureKit({ signer })));

/** Parse and validate the certificate metadata most app integrations store. */
export const parseA1CertificateProfile = (
  options: A1SignerOptions,
): Effect.Effect<A1CertificateProfile, SignatureKitError> =>
  decodeA1SignerOptions(options).pipe(
    Effect.flatMap((valid) => parseCertificate(valid.pfx, valid.password)),
    Effect.flatMap(certificateProfile),
  );

/** Load an A1 container and provide the agnostic core Signatures service. */
export const a1SignaturesLayer = (
  options: A1SignerOptions,
): Layer.Layer<Signatures, SignatureKitError> =>
  Layer.effect(
    Signatures,
    loadA1SignerAdapter(options).pipe(Effect.map((signer) => createSignaturesService(signer))),
  );
