import { DOMImplementation, DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { Application } from "xmldsigjs";
import { setNodeDependencies } from "xml-core";
import { Context, Effect, Layer } from "effect";
import type { SignatureAlgorithm } from "@signature-kit/core/config";
import { XmlError, XmlErrorCodeValue, XmlOperationValue } from "./config";

const XML_RSA_ALGORITHM_NAME = "RSASSA-PKCS1-v1_5";

export type XmlRuntimeService = {
  readonly ensure: Effect.Effect<void, XmlError>;
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

  Application.setEngine("signature-kit", globalThis.crypto);
  setNodeDependencies({ DOMImplementation, DOMParser, XMLSerializer });
  return Effect.void;
});

export const xmlRuntimeLayer: Layer.Layer<XmlRuntime, XmlError> = Layer.effect(
  XmlRuntime,
  Effect.cached(configureXmlRuntime).pipe(Effect.map((ensure) => ({ ensure }))),
);

export const xmlSignatureAlgorithm = (algorithm: SignatureAlgorithm): RsaHashedImportParams => ({
  name: XML_RSA_ALGORITHM_NAME,
  hash: algorithm === "rsa-sha1" ? "SHA-1" : algorithm === "rsa-sha512" ? "SHA-512" : "SHA-256",
});

export const xmlDigestAlgorithm = (
  algorithm: SignatureAlgorithm,
): "SHA-1" | "SHA-256" | "SHA-512" =>
  algorithm === "rsa-sha1" ? "SHA-1" : algorithm === "rsa-sha512" ? "SHA-512" : "SHA-256";

export const toBufferSource = (data: Uint8Array): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
};
