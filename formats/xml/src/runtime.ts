import "reflect-metadata";
import { DOMImplementation, DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { Context, Effect, Layer } from "effect";
import { XmlError, XmlErrorCodeValue, XmlOperationValue } from "./config";

export type XmlRuntimeService = {
  readonly parse: (xml: string) => Effect.Effect<Document, XmlError>;
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

  return Effect.tryPromise({
    try: async () => {
      // dynamic-import: xmldsigjs transitively checks reflect-metadata during CJS evaluation; load after the polyfill.
      const [{ Application }, { setNodeDependencies }] = await Promise.all([
        import("xmldsigjs"),
        import("xml-core"),
      ]);
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
  Effect.tryPromise({
    try: async () => {
      // dynamic-import: xmldsigjs transitively checks reflect-metadata during CJS evaluation; load after the polyfill.
      const { Parse } = await import("xmldsigjs");
      return Parse(xml);
    },
    catch: () =>
      new XmlError({
        code: XmlErrorCodeValue.invalidXml,
        retryable: false,
        operation: XmlOperationValue.parse,
      }),
  });

const importVerificationKey = (
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
    try: async () => {
      // dynamic-import: @peculiar/x509 checks reflect-metadata during CJS evaluation; load after the polyfill.
      const { X509Certificate } = await import("@peculiar/x509");
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
  configureXmlRuntime.pipe(
    Effect.map(() => ({
      parse: parseXml,
      importVerificationKey,
      exportCertificateVerificationKey,
    })),
  ),
);
