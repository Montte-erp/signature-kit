import { Signatures } from "@signature-kit/signatures";
import { SignatureHttpClient } from "@signature-kit/http";
import type { Certificate, SignatureAlgorithm, SignerAdapter } from "@signature-kit/signatures";
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  SignInputSchema,
  VerifyInputSchema,
} from "@signature-kit/signatures";
import { daysUntilExpiry, parseCertificate, toSignerIdentity } from "@signature-kit/certificates";
import { pemToDer } from "@signature-kit/crypto/pem";
import { Clock, Effect, Layer, Match, Redacted, Schema } from "effect";
import { A1RemoteFetchSchema, A1RemoteSourceSchema, A1SignerOptionsSchema } from "./config.js";
import type {
  A1CertificateProfile,
  A1RemoteFetch,
  A1RemoteSource,
  A1SignerOptions,
} from "./config.js";

const RSA_ALGORITHM_NAME = "RSASSA-PKCS1-v1_5";

const RsaAlgorithmHashSchema = Schema.Literals(["SHA-1", "SHA-256", "SHA-512"]);
type RsaAlgorithmHash = (typeof RsaAlgorithmHashSchema)["Type"];

type RsaAlgorithm = {
  readonly name: typeof RSA_ALGORITHM_NAME;
  readonly hash: RsaAlgorithmHash;
};

const rsaAlgorithmHash = (algorithm: SignatureAlgorithm): RsaAlgorithmHash =>
  Match.value(algorithm).pipe(
    Match.when("rsa-sha1", (): RsaAlgorithmHash => "SHA-1"),
    Match.when("rsa-sha256", (): RsaAlgorithmHash => "SHA-256"),
    Match.when("rsa-sha512", (): RsaAlgorithmHash => "SHA-512"),
    Match.exhaustive,
  );

const rsaAlgorithm = (algorithm: SignatureAlgorithm): RsaAlgorithm => ({
  name: RSA_ALGORITHM_NAME,
  hash: rsaAlgorithmHash(algorithm),
});

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
    catch: () =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.keyImportFailed,
        retryable: false,
        reason: `Failed to import ${format} key for ${algorithm}.`,
        operation: SignatureKitOperationValue.cryptoImport,
      }),
  });

const importPrivateKey = (
  privateKey: Redacted.Redacted<string>,
  algorithm: SignatureAlgorithm,
): Effect.Effect<CryptoKey, SignatureKitError> =>
  pemToDer(Redacted.value(privateKey)).pipe(
    Effect.mapError(
      (error) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.keyImportFailed,
          retryable: false,
          reason: error.reason ?? error.message,
          operation: SignatureKitOperationValue.cryptoImport,
        }),
    ),
    Effect.flatMap((keyData) => importKey("pkcs8", keyData, algorithm, "sign")),
  );

const importPublicKey = (
  publicKeyDer: Uint8Array,
  algorithm: SignatureAlgorithm,
): Effect.Effect<CryptoKey, SignatureKitError> =>
  importKey("spki", publicKeyDer, algorithm, "verify");

const signWithKey = (
  key: CryptoKey,
  algorithm: SignatureAlgorithm,
  content: Uint8Array,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  Effect.gen(function* () {
    const signature = yield* Effect.tryPromise({
      try: () => crypto.subtle.sign(rsaAlgorithm(algorithm).name, key, toBufferSource(content)),
      catch: () =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.signFailed,
          retryable: false,
          operation: SignatureKitOperationValue.cryptoSign,
        }),
    });
    return new Uint8Array(signature);
  });

const verifyWithKey = (
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
    catch: () =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.verifyFailed,
        retryable: false,
        operation: SignatureKitOperationValue.cryptoVerify,
      }),
  });

const cachedKey = (
  cache: Map<SignatureAlgorithm, CryptoKey>,
  algorithm: SignatureAlgorithm,
  load: (algorithm: SignatureAlgorithm) => Effect.Effect<CryptoKey, SignatureKitError>,
): Effect.Effect<CryptoKey, SignatureKitError> => {
  const cached = cache.get(algorithm);
  if (cached !== undefined) return Effect.succeed(cached);
  return load(algorithm).pipe(Effect.tap((key) => Effect.sync(() => cache.set(algorithm, key))));
};

const loadA1Certificate = (
  options: A1SignerOptions,
): Effect.Effect<Certificate, SignatureKitError> =>
  Schema.decodeUnknownEffect(A1SignerOptionsSchema)(options).pipe(
    Effect.mapError((issue) => {
      return new SignatureKitError({
        code: SignatureKitErrorCodeValue.invalidInput,
        retryable: false,
        reason: "Invalid A1 signer options.",
        operation: SignatureKitOperationValue.schemaDecode,
        schemaName: "A1SignerOptions",
        issueMessage: String(issue),
      });
    }),
    Effect.flatMap((valid) => parseCertificate(valid.pfx, valid.password)),
  );

const certificateProfile = (
  certificate: Certificate,
): Effect.Effect<A1CertificateProfile, SignatureKitError> =>
  Effect.gen(function* () {
    const currentTime = yield* Clock.currentTimeMillis;
    if (currentTime > certificate.validity.notAfter.getTime()) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.certificateExpired,
          retryable: false,
          reason: `A1 certificate expired at ${certificate.validity.notAfter.toISOString()}.`,
        }),
      );
    }

    if (currentTime < certificate.validity.notBefore.getTime()) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.certificateNotYetValid,
          retryable: false,
          reason: `A1 certificate is not valid before ${certificate.validity.notBefore.toISOString()}.`,
        }),
      );
    }

    const document = certificate.brazilian.cnpj ?? certificate.brazilian.cpf;
    if (document === null) {
      return yield* Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.missingBrIdentifier,
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
      Schema.decodeUnknownEffect(SignInputSchema)(input).pipe(
        Effect.mapError((issue) => {
          return new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            reason: "Invalid sign input.",
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: "SignInput",
            issueMessage: String(issue),
          });
        }),
        Effect.flatMap((valid) =>
          signingKey(valid.algorithm).pipe(
            Effect.flatMap((key) => signWithKey(key, valid.algorithm, valid.content)),
            Effect.map((signature) => ({ algorithm: valid.algorithm, signature })),
          ),
        ),
      ),
    verify: (input) =>
      Schema.decodeUnknownEffect(VerifyInputSchema)(input).pipe(
        Effect.mapError((issue) => {
          return new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            reason: "Invalid verify input.",
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: "VerifyInput",
            issueMessage: String(issue),
          });
        }),
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

export const loadA1SignerAdapter = (
  options: A1SignerOptions,
): Effect.Effect<SignerAdapter, SignatureKitError> =>
  loadA1Certificate(options).pipe(Effect.map(createA1SignerAdapter));

export const parseA1CertificateProfile = (
  options: A1SignerOptions,
): Effect.Effect<A1CertificateProfile, SignatureKitError> =>
  loadA1Certificate(options).pipe(Effect.flatMap(certificateProfile));

export const a1SignaturesLayer = (
  options: A1SignerOptions,
): Layer.Layer<Signatures, SignatureKitError> =>
  Layer.effect(Signatures, loadA1Certificate(options).pipe(Effect.map(createA1SignerAdapter)));

const redactPresignedUrl = (url: string): string => {
  if (!URL.canParse(url)) return "<redacted>";
  const sanitized = new URL(url);
  sanitized.username = "";
  sanitized.password = "";
  sanitized.hash = "";
  for (const key of sanitized.searchParams.keys()) {
    sanitized.searchParams.set(key, "<redacted>");
  }
  return sanitized.toString();
};

export const fetchA1Pkcs12 = (
  source: A1RemoteFetch,
): Effect.Effect<Uint8Array, SignatureKitError, SignatureHttpClient> =>
  Schema.decodeUnknownEffect(A1RemoteFetchSchema)(source).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          operation: SignatureKitOperationValue.schemaDecode,
          schemaName: "A1RemoteFetch",
          issueMessage: String(issue),
        }),
    ),
    Effect.flatMap((valid) =>
      SignatureHttpClient.use((http) =>
        http
          .requestBytes({
            method: "GET",
            url: valid.url,
            diagnosticUrl: redactPresignedUrl(valid.url),
            ...(valid.headers === undefined ? {} : { headers: valid.headers }),
          })
          .pipe(
            Effect.flatMap((bytes) =>
              bytes.byteLength === 0
                ? Effect.fail(
                    new SignatureKitError({
                      code: SignatureKitErrorCodeValue.emptyFile,
                      retryable: false,
                      reason: "The fetched A1 certificate is empty.",
                    }),
                  )
                : Effect.succeed(bytes),
            ),
          ),
      ),
    ),
  );

const loadA1CertificateFromRemoteSource = (
  source: A1RemoteSource,
): Effect.Effect<Certificate, SignatureKitError, SignatureHttpClient> =>
  Schema.decodeUnknownEffect(A1RemoteSourceSchema)(source).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          operation: SignatureKitOperationValue.schemaDecode,
          schemaName: "A1RemoteSource",
          issueMessage: String(issue),
        }),
    ),
    Effect.flatMap((valid) =>
      fetchA1Pkcs12(valid).pipe(
        Effect.flatMap((pfx) => loadA1Certificate({ pfx, password: valid.password })),
      ),
    ),
  );

export const a1SignaturesLayerFromUrl = (
  source: A1RemoteSource,
): Layer.Layer<Signatures, SignatureKitError, SignatureHttpClient> =>
  Layer.effect(
    Signatures,
    loadA1CertificateFromRemoteSource(source).pipe(Effect.map(createA1SignerAdapter)),
  );

export const parseA1CertificateProfileFromUrl = (
  source: A1RemoteSource,
): Effect.Effect<A1CertificateProfile, SignatureKitError, SignatureHttpClient> =>
  loadA1CertificateFromRemoteSource(source).pipe(Effect.flatMap(certificateProfile));
