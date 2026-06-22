import { DOMImplementation, DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { Application } from "xmldsigjs";
import { setNodeDependencies } from "xml-core";
import { Effect } from "effect";
import { XmlError, XmlErrorCodeValue, XmlOperationValue } from "./config";

const XML_RSA_ALGORITHM_NAME = "RSASSA-PKCS1-v1_5";
let runtimeConfigured = false;

export const ensureXmlRuntime = (): Effect.Effect<void, XmlError> => {
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

  if (!runtimeConfigured) {
    Application.setEngine("signature-kit", globalThis.crypto);
    setNodeDependencies({ DOMImplementation, DOMParser, XMLSerializer });
    runtimeConfigured = true;
  }

  return Effect.void;
};

export const xmlSignatureAlgorithm = (
  algorithm: "rsa-sha256" | "rsa-sha512",
): RsaHashedImportParams => ({
  name: XML_RSA_ALGORITHM_NAME,
  hash: algorithm === "rsa-sha512" ? "SHA-512" : "SHA-256",
});

export const xmlDigestAlgorithm = (algorithm: "rsa-sha256" | "rsa-sha512"): "SHA-256" | "SHA-512" =>
  algorithm === "rsa-sha512" ? "SHA-512" : "SHA-256";

export const toBufferSource = (data: Uint8Array): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
};
