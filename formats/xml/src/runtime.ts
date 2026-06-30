import { DOMImplementation, DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { Application } from "xmldsigjs";
import { setNodeDependencies } from "xml-core";
import { Context, Effect, Layer } from "effect";
import { XmlError, XmlErrorCodeValue, XmlOperationValue } from "./config";

export class XmlRuntime extends Context.Service<XmlRuntime, { readonly configured: boolean }>()(
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
  configureXmlRuntime.pipe(Effect.map(() => ({ configured: true }))),
);
