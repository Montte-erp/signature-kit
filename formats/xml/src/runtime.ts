import "reflect-metadata";
import { X509Certificate } from "@peculiar/x509";
import { bytesToBase64, base64ToBytes } from "@signature-kit/crypto/base64";
import { DOMImplementation, DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { Cache, Context, Effect, Layer } from "effect";
import { Application, Parse, SignedXml } from "xmldsigjs";
import { setNodeDependencies } from "xml-core";
import { XmlError, XmlErrorCodeValue, XmlOperationValue } from "./config";
import type { XmlVerificationKeySource } from "./config";

type XmlVerificationKeyCacheKey = {
  readonly source: XmlVerificationKeySource;
  readonly derBase64: string;
  readonly algorithmName: string;
  readonly algorithmHash: string;
};

export type XmlRuntimeService = {
  readonly parse: (xml: string) => Effect.Effect<Document, XmlError>;
  readonly signedXml: () => Effect.Effect<typeof SignedXml, XmlError>;
  readonly importVerificationKey: (
    publicKeyDer: Uint8Array,
    algorithm: RsaHashedImportParams,
  ) => Effect.Effect<CryptoKey, XmlError>;
  readonly exportCertificateVerificationKey: (
    certificateDer: Uint8Array,
    algorithm: RsaHashedImportParams,
  ) => Effect.Effect<CryptoKey, XmlError>;
};

export class XmlRuntime extends Context.Service<XmlRuntime, XmlRuntimeService>()(
  "@signature-kit/xml/Runtime",
) {}

const algorithmHashName = (algorithm: RsaHashedImportParams): string =>
  typeof algorithm.hash === "string" ? algorithm.hash : algorithm.hash.name;

const verificationKeyCacheKey = (
  source: XmlVerificationKeySource,
  der: Uint8Array,
  algorithm: RsaHashedImportParams,
): XmlVerificationKeyCacheKey => ({
  source,
  derBase64: bytesToBase64(der),
  algorithmName: algorithm.name,
  algorithmHash: algorithmHashName(algorithm),
});

const verificationAlgorithm = (key: XmlVerificationKeyCacheKey): RsaHashedImportParams => ({
  name: key.algorithmName,
  hash: key.algorithmHash,
});

const configureXmlRuntime: Effect.Effect<void, XmlError> = Effect.suspend(() => {
  if (globalThis.crypto === undefined) {
    return Effect.fail(
      new XmlError({
        code: XmlErrorCodeValue.runtimeUnavailable,
        retryable: false,
        reason: "Web Crypto is not available in this runtime.",
        operation: XmlOperationValue.runtime,
      }),
    );
  }

  return Effect.try({
    try: () => {
      Application.setEngine("signature-kit", globalThis.crypto);
      setNodeDependencies({ DOMImplementation, DOMParser, XMLSerializer });
    },
    catch: () =>
      new XmlError({
        code: XmlErrorCodeValue.runtimeUnavailable,
        retryable: false,
        reason: "XML runtime setup failed.",
        operation: XmlOperationValue.runtime,
      }),
  });
});

const parseXml = (xml: string): Effect.Effect<Document, XmlError> =>
  Effect.try({
    try: () => Parse(xml),
    catch: () =>
      new XmlError({
        code: XmlErrorCodeValue.invalidXml,
        retryable: false,
        operation: XmlOperationValue.parse,
      }),
  });

const importSpkiVerificationKey = (
  publicKeyDer: Uint8Array,
  algorithm: RsaHashedImportParams,
): Effect.Effect<CryptoKey, XmlError> =>
  Effect.tryPromise({
    try: () => {
      const keyBytes = new ArrayBuffer(publicKeyDer.byteLength);
      new Uint8Array(keyBytes).set(publicKeyDer);
      return crypto.subtle.importKey("spki", keyBytes, algorithm, true, ["verify"]);
    },
    catch: () =>
      new XmlError({
        code: XmlErrorCodeValue.keyImportFailed,
        retryable: false,
        operation: XmlOperationValue.keyImport,
      }),
  });

const exportCertificateVerificationKey = (
  certificateDer: Uint8Array,
  algorithm: RsaHashedImportParams,
): Effect.Effect<CryptoKey, XmlError> =>
  Effect.tryPromise({
    try: () => {
      const certificateBytes = new ArrayBuffer(certificateDer.byteLength);
      new Uint8Array(certificateBytes).set(certificateDer);
      return new X509Certificate(certificateBytes).publicKey.export(algorithm, ["verify"]);
    },
    catch: () =>
      new XmlError({
        code: XmlErrorCodeValue.keyImportFailed,
        retryable: false,
        operation: XmlOperationValue.keyImport,
      }),
  });

export const xmlRuntimeLayer: Layer.Layer<XmlRuntime, XmlError> = Layer.effect(
  XmlRuntime,
  Effect.gen(function* () {
    yield* configureXmlRuntime;
    const verificationKeys = yield* Cache.make({
      capacity: 32,
      timeToLive: "Infinity",
      lookup: (key: XmlVerificationKeyCacheKey) =>
        base64ToBytes(key.derBase64).pipe(
          Effect.orDie,
          Effect.flatMap((der) =>
            key.source === "spki"
              ? importSpkiVerificationKey(der, verificationAlgorithm(key))
              : exportCertificateVerificationKey(der, verificationAlgorithm(key)),
          ),
        ),
    });

    return {
      parse: parseXml,
      signedXml: () => Effect.succeed(SignedXml),
      importVerificationKey: (publicKeyDer, algorithm) =>
        Cache.get(verificationKeys, verificationKeyCacheKey("spki", publicKeyDer, algorithm)),
      exportCertificateVerificationKey: (certificateDer, algorithm) =>
        Cache.get(
          verificationKeys,
          verificationKeyCacheKey("certificate", certificateDer, algorithm),
        ),
    };
  }),
);
