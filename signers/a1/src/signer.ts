/**
 * The first e-signature adapter: A1 / PKCS#12.
 */
import { Signatures } from "@signature-kit/core/signatures";
import { SignatureHttpClient } from "@signature-kit/core/http";
import type { Certificate, SignatureAlgorithm, SignerAdapter } from "@signature-kit/core/config";
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  SignatureKitSchemaNameValue,
  SignInputSchema,
  VerifyInputSchema,
} from "@signature-kit/core/config";
import { daysUntilExpiry, parseCertificate, toSignerIdentity } from "@signature-kit/certificates";
import { pemToDer } from "@signature-kit/crypto/pem";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import {
  A1RemoteFetchSchema,
  A1RemoteSourceSchema,
  A1SignerOptionsSchema,
  type A1CertificateProfile,
  type A1RemoteFetch,
  type A1RemoteSource,
  type A1SignerOptions,
} from "./config";

const RSA_ALGORITHM_NAME = "RSASSA-PKCS1-v1_5";

type RsaAlgorithm = {
  readonly name: typeof RSA_ALGORITHM_NAME;
  readonly hash: "SHA-1" | "SHA-256" | "SHA-512";
};

const rsaAlgorithm = (algorithm: SignatureAlgorithm): RsaAlgorithm => ({
  name: RSA_ALGORITHM_NAME,
  hash: algorithm === "rsa-sha1" ? "SHA-1" : algorithm === "rsa-sha512" ? "SHA-512" : "SHA-256",
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
  importKey("pkcs8", pemToDer(Redacted.value(privateKey)), algorithm, "sign");

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

export type A1SignerMaterial = {
  readonly certificate: Certificate;
  readonly profile: A1CertificateProfile;
  readonly signer: SignerAdapter;
};

export class A1Signer extends Context.Service<A1Signer, A1SignerMaterial>()(
  "@signature-kit/a1/Signer",
) {}

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
        schemaName: SignatureKitSchemaNameValue.a1SignerOptions,
        issueMessage: String(issue),
      });
    }),
    Effect.flatMap((valid) => parseCertificate(valid.pfx, valid.password)),
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
      Schema.decodeUnknownEffect(SignInputSchema)(input).pipe(
        Effect.mapError((issue) => {
          return new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            reason: "Invalid sign input.",
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.signInput,
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
            schemaName: SignatureKitSchemaNameValue.verifyInput,
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

const loadA1SignerMaterial = (
  options: A1SignerOptions,
): Effect.Effect<A1SignerMaterial, SignatureKitError> =>
  loadA1Certificate(options).pipe(
    Effect.flatMap((certificate) =>
      certificateProfile(certificate).pipe(
        Effect.map((profile) => ({
          certificate,
          profile,
          signer: createA1SignerAdapter(certificate),
        })),
      ),
    ),
  );

/** Load an A1 container and expose its parsed certificate, profile, and signer. */
export const a1SignerLayer = (options: A1SignerOptions): Layer.Layer<A1Signer, SignatureKitError> =>
  Layer.effect(A1Signer, loadA1SignerMaterial(options));

/** Load an A1 container and build the adapter in one Effect. */
export const loadA1SignerAdapter = (
  options: A1SignerOptions,
): Effect.Effect<SignerAdapter, SignatureKitError> =>
  loadA1Certificate(options).pipe(Effect.map(createA1SignerAdapter));

/** Parse and validate the certificate metadata most app integrations store. */
export const parseA1CertificateProfile = (
  options: A1SignerOptions,
): Effect.Effect<A1CertificateProfile, SignatureKitError> =>
  loadA1Certificate(options).pipe(Effect.flatMap(certificateProfile));

/** Load an A1 container and provide the agnostic core Signatures service. */
export const a1SignaturesLayer = (
  options: A1SignerOptions,
): Layer.Layer<Signatures, SignatureKitError> =>
  Layer.effect(Signatures, loadA1Certificate(options).pipe(Effect.map(createA1SignerAdapter)));

// ---------------------------------------------------------------------------
// Remote A1 material — fetch the PKCS#12 (.pfx) from a (presigned) URL.
//
// The A1 container usually lives in object storage (e.g. S3) and is handed to
// the signer as a short-lived presigned URL. Fetching is the ONLY thing that
// changes versus the local-bytes path: the fetched bytes flow into exactly the
// same loadA1Certificate -> createA1SignerAdapter pipeline, so the signer, the
// profile, and the Signatures layer behave identically. The private key never
// leaves this process — only the encrypted PKCS#12 is fetched, then decrypted
// locally with the Redacted password.
// ---------------------------------------------------------------------------

const redactPresignedUrl = (url: string): string => {
  if (!URL.canParse(url)) return "<redacted>";
  const sanitized = new URL(url);
  for (const key of sanitized.searchParams.keys()) {
    sanitized.searchParams.set(key, "<redacted>");
  }
  return sanitized.toString();
};

/** Fetch the A1 PKCS#12 (.pfx) bytes from a (presigned) URL via a GET. */
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
          schemaName: SignatureKitSchemaNameValue.a1RemoteFetch,
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

/** Provide the agnostic core Signatures service from a remote (URL) A1 container. */
export const a1SignaturesLayerFromUrl = (
  source: A1RemoteSource,
): Layer.Layer<Signatures, SignatureKitError, SignatureHttpClient> =>
  Layer.effect(
    Signatures,
    Schema.decodeUnknownEffect(A1RemoteSourceSchema)(source).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: SignatureKitSchemaNameValue.a1RemoteSource,
            issueMessage: String(issue),
          }),
      ),
      Effect.flatMap((valid) =>
        fetchA1Pkcs12(valid).pipe(
          Effect.flatMap((pfx) => loadA1Certificate({ pfx, password: valid.password })),
          Effect.map(createA1SignerAdapter),
        ),
      ),
    ),
  );

/** Parse and validate the A1 certificate metadata from a remote (URL) container. */
export const parseA1CertificateProfileFromUrl = (
  source: A1RemoteSource,
): Effect.Effect<A1CertificateProfile, SignatureKitError, SignatureHttpClient> =>
  Schema.decodeUnknownEffect(A1RemoteSourceSchema)(source).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          operation: SignatureKitOperationValue.schemaDecode,
          schemaName: SignatureKitSchemaNameValue.a1RemoteSource,
          issueMessage: String(issue),
        }),
    ),
    Effect.flatMap((valid) =>
      fetchA1Pkcs12(valid).pipe(
        Effect.flatMap((pfx) => parseA1CertificateProfile({ pfx, password: valid.password })),
      ),
    ),
  );
