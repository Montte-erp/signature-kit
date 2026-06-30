import { DOMImplementation, DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { Application, Parse } from "xmldsigjs";
import { setNodeDependencies } from "xml-core";
import { Context, Effect, Layer } from "effect";
import { XmlError, XmlErrorCodeValue, XmlOperationValue } from "./config";

export type XmlRuntimeService = {
  readonly parse: (xml: string) => Effect.Effect<Document, XmlError>;
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

export const xmlRuntimeLayer: Layer.Layer<XmlRuntime, XmlError> = Layer.effect(
  XmlRuntime,
  configureXmlRuntime.pipe(
    Effect.map(() => ({
      parse: parseXml,
    })),
  ),
);
