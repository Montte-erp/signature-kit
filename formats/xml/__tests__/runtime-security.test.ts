import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signatures } from "@signature-kit/signatures";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Redacted, Result } from "effect";
import { XmlRuntime, xmlRuntimeLayer } from "../src/runtime";
import { verifyXml } from "../src/verify";
import { signXml } from "../src/sign";

const PASSWORD = Redacted.make("changeit");
const RUNTIME_TEST_KEY = new Uint8Array([1]);

const malformedXmlInputs = [
  "<!DOCTYPE root><root/>",
  '<!DOCTYPE root [<!ENTITY attack "EVIL">]><root>&attack;</root>',
  "<root>&undeclared;</root>",
  "<root/>JUNK",
  "JUNK<root/>",
  "<root/><other/>",
  "<!--before--><root/>",
  "<?before?><root/>",
  "<root/><?after?>",
  "<root/><!--after-->",
  '<?xml version="2.0"?><root/>',
  '<?xml version="1.1"?><root/>',
  '<root/><?xml version="1.0"?>',
  "<root>\u0000</root>",
  "<root>&#0;</root>",
  "<root>&#x100010000;</root>",
];

const xpathTransformXml = `<root>
  <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
    <ds:SignedInfo>
      <ds:Reference URI="">
        <ds:Transforms>
          <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
            <ds:XPath>self::node()</ds:XPath>
          </ds:Transform>
        </ds:Transforms>
      </ds:Reference>
    </ds:SignedInfo>
  </ds:Signature>
</root>`;

const canonicalizationSignature = `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <ds:SignedInfo>
    <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>
    <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
    <ds:Reference URI="">
      <ds:Transforms>
        <ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>
      </ds:Transforms>
      <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
      <ds:DigestValue>AA==</ds:DigestValue>
    </ds:Reference>
  </ds:SignedInfo>
  <ds:SignatureValue>AA==</ds:SignatureValue>
</ds:Signature>`;

describe("XML runtime security", () => {
  it.effect("rejects parser diagnostics, document types, and trailing content", () =>
    Effect.gen(function* () {
      const xmlRuntime = yield* XmlRuntime;

      for (const xml of malformedXmlInputs) {
        const result = yield* Effect.result(xmlRuntime.parse(xml));

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("xml.INVALID_XML");
          expect(result.failure.operation).toBe("xml.parse");
        }
      }
    }).pipe(Effect.provide(xmlRuntimeLayer)),
  );

  it.effect("accepts XML declarations and byte-order marks at document start", () =>
    Effect.gen(function* () {
      const xmlRuntime = yield* XmlRuntime;
      for (const xml of [
        '<?xml version="1.0"?><root/>',
        '\ufeff<?xml version="1.0"?><root/>',
        "\ufeff\n<root/>",
      ]) {
        const document = yield* xmlRuntime.parse(xml);
        expect(document.documentElement?.tagName).toBe("root");
      }
    }).pipe(Effect.provide(xmlRuntimeLayer)),
  );

  it.effect("allows numeric-reference syntax in non-expanded markup", () =>
    Effect.gen(function* () {
      const xmlRuntime = yield* XmlRuntime;
      const xmlInputs = [
        "<root><!--&#x100010000;--></root>",
        "<root><![CDATA[&#x100010000;]]></root>",
        "<root><?x &#x100010000;?></root>",
      ];

      for (const xml of xmlInputs) {
        const document = yield* xmlRuntime.parse(xml);
        expect(document.documentElement?.tagName).toBe("root");
      }
    }).pipe(Effect.provide(xmlRuntimeLayer)),
  );

  it.effect("rejects XPath transforms before XMLDSig dispatch", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        verifyXml({ xml: xpathTransformXml, publicKeyDer: RUNTIME_TEST_KEY }).pipe(
          Effect.provide(xmlRuntimeLayer),
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("xml.UNSUPPORTED_ALGORITHM");
        expect(result.failure.operation).toBe("xml.verify");
      }
    }),
  );

  it.effect("rejects non-root framing before signing", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const signaturesLayer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const result = yield* Effect.result(
        signXml({ xml: "<?app-role admin?><root/>" }).pipe(
          Effect.provide(signaturesLayer),
          Effect.provide(xmlRuntimeLayer),
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("xml.INVALID_XML");
        expect(result.failure.operation).toBe("xml.parse");
      }
    }),
  );

  it.effect("rejects a prepended processing instruction on a document reference", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const signaturesLayer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const certificate = yield* signatures.certificate().pipe(Effect.provide(signaturesLayer));
      const signed = yield* signXml({ xml: "<root/>" }).pipe(
        Effect.provide(signaturesLayer),
        Effect.provide(xmlRuntimeLayer),
      );
      const result = yield* Effect.result(
        verifyXml({
          xml: `<?app-role admin?>${signed}`,
          publicKeyDer: certificate.publicKeyDer,
        }).pipe(Effect.provide(xmlRuntimeLayer)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("xml.INVALID_XML");
        expect(result.failure.operation).toBe("xml.parse");
      }
    }),
  );

  it.effect("does not return signed XML above runtime namespace limits", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const signaturesLayer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const certificate = yield* signatures.certificate().pipe(Effect.provide(signaturesLayer));
      const namespaces = (count: number): string =>
        Array.from({ length: count }, (_, index) => `xmlns:n${index}="urn:n${index}"`).join(" ");
      const signed = yield* signXml({
        xml: `<root ${namespaces(63)}/>`,
      }).pipe(Effect.provide(signaturesLayer), Effect.provide(xmlRuntimeLayer));
      const verified = yield* verifyXml({
        xml: signed,
        publicKeyDer: certificate.publicKeyDer,
      }).pipe(Effect.provide(xmlRuntimeLayer));
      const result = yield* Effect.result(
        signXml({
          xml: `<root ${namespaces(64)}/>`,
        }).pipe(Effect.provide(signaturesLayer), Effect.provide(xmlRuntimeLayer)),
      );

      expect(verified.valid).toBe(true);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("xml.SIGN_FAILED");
        expect(result.failure.operation).toBe("xml.sign");
      }
    }),
  );

  it.effect(
    "rejects deeply nested XML before canonicalization and preserves valid signatures",
    () =>
      Effect.gen(function* () {
        const pfx = yield* readA1Fixture("ecpf");
        const signaturesLayer = a1SignaturesLayer({ pfx, password: PASSWORD });
        const certificate = yield* signatures.certificate().pipe(Effect.provide(signaturesLayer));
        const signed = yield* signXml({
          xml: '<?xml version="1.0"?><root Id="root"><payload>trusted</payload></root>',
          referenceId: "root",
        }).pipe(Effect.provide(signaturesLayer), Effect.provide(xmlRuntimeLayer));
        const verified = yield* verifyXml({
          xml: signed,
          publicKeyDer: certificate.publicKeyDer,
        }).pipe(Effect.provide(xmlRuntimeLayer));
        const openingElements = "<nested>".repeat(12_000);
        const closingElements = "</nested>".repeat(12_000);
        const deeplyNested = signed.replace(
          "<payload>trusted</payload>",
          `${openingElements}<payload>trusted</payload>${closingElements}`,
        );
        const result = yield* Effect.result(
          verifyXml({
            xml: deeplyNested,
            publicKeyDer: certificate.publicKeyDer,
          }).pipe(Effect.provide(xmlRuntimeLayer)),
        );

        expect(verified.valid).toBe(true);
        expect(deeplyNested).not.toBe(signed);
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("xml.INVALID_XML");
          expect(result.failure.operation).toBe("xml.parse");
        }
      }),
  );

  it.effect("rejects signed XML that smuggles an entity declaration", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const signaturesLayer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const certificate = yield* signatures.certificate().pipe(Effect.provide(signaturesLayer));
      const signed = yield* signXml({
        xml: '<root Id="root"><payload>&amp;attack;</payload></root>',
        referenceId: "root",
      }).pipe(Effect.provide(signaturesLayer), Effect.provide(xmlRuntimeLayer));
      const smuggled = signed
        .replace("<root", '<!DOCTYPE root [<!ENTITY attack "EVIL">]><root')
        .replace("&amp;attack;", "&attack;");
      const result = yield* Effect.result(
        verifyXml({
          xml: smuggled,
          publicKeyDer: certificate.publicKeyDer,
        }).pipe(Effect.provide(xmlRuntimeLayer)),
      );

      expect(smuggled).not.toBe(signed);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("xml.INVALID_XML");
        expect(result.failure.operation).toBe("xml.parse");
      }
    }),
  );

  it.effect("rejects raw XmlRuntime XPath signing", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const signaturesLayer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const signingKey = yield* signatures
        .importSigningKey("rsa-sha256")
        .pipe(Effect.provide(signaturesLayer));
      const xmlRuntime = yield* XmlRuntime;
      const document = yield* xmlRuntime.parse('<root Id="root"><payload>trusted</payload></root>');
      const SignedXml = yield* xmlRuntime.signedXml();
      const signedXml = new SignedXml();
      const result = yield* Effect.result(
        Effect.tryPromise({
          try: () =>
            signedXml.Sign({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, signingKey, document, {
              references: [
                {
                  hash: "SHA-256",
                  transforms: [{ name: "xpath", selector: "self::node()" }],
                  uri: "#root",
                },
              ],
            }),
          catch: (cause) => cause,
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          code: "xml.UNSUPPORTED_ALGORITHM",
          operation: "xml.sign",
        });
      }
    }).pipe(Effect.provide(xmlRuntimeLayer)),
  );

  it.effect("rejects raw XmlRuntime XPath URI signing", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const signaturesLayer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const signingKey = yield* signatures
        .importSigningKey("rsa-sha256")
        .pipe(Effect.provide(signaturesLayer));
      const xmlRuntime = yield* XmlRuntime;
      const document = yield* xmlRuntime.parse('<root Id="root"><payload>trusted</payload></root>');
      const SignedXml = yield* xmlRuntime.signedXml();
      const signedXml = new SignedXml();
      const result = yield* Effect.result(
        Effect.tryPromise({
          try: () =>
            signedXml.Sign({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, signingKey, document, {
              references: [
                {
                  hash: "SHA-256",
                  transforms: ["http://www.w3.org/TR/1999/REC-xpath-19991116"],
                  uri: "#root",
                },
              ],
            }),
          catch: (cause) => cause,
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          code: "xml.UNSUPPORTED_ALGORITHM",
          operation: "xml.sign",
        });
      }
    }).pipe(Effect.provide(xmlRuntimeLayer)),
  );

  it.effect("rejects XPath already loaded into raw SignedXml state", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const signaturesLayer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const signingKey = yield* signatures
        .importSigningKey("rsa-sha256")
        .pipe(Effect.provide(signaturesLayer));
      const signed = yield* signXml({
        xml: '<root Id="root"><payload>trusted</payload></root>',
        referenceId: "root",
      }).pipe(Effect.provide(signaturesLayer), Effect.provide(xmlRuntimeLayer));
      const xpathSigned = signed.replace(
        '<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>',
        '<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>self::node()</ds:XPath></ds:Transform>',
      );
      const xmlRuntime = yield* XmlRuntime;
      const document = yield* xmlRuntime.parse(xpathSigned);
      const signatureElement = document
        .getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")
        .item(0);

      expect(xpathSigned).not.toBe(signed);
      expect(signatureElement).not.toBeNull();
      if (signatureElement === null) {
        return;
      }

      const SignedXml = yield* xmlRuntime.signedXml();
      const rawForVerification = new SignedXml(document);
      rawForVerification.LoadXml(signatureElement);
      const verification = yield* Effect.result(
        Effect.tryPromise({
          try: () => rawForVerification.Verify(),
          catch: (cause) => cause,
        }),
      );
      const rawForSigning = new SignedXml(document);
      rawForSigning.LoadXml(signatureElement);
      const signing = yield* Effect.result(
        Effect.tryPromise({
          try: () =>
            rawForSigning.Sign(
              { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
              signingKey,
              document,
            ),
          catch: (cause) => cause,
        }),
      );

      expect(Result.isFailure(verification)).toBe(true);
      if (Result.isFailure(verification)) {
        expect(verification.failure).toMatchObject({
          code: "xml.UNSUPPORTED_ALGORITHM",
          operation: "xml.verify",
        });
      }
      expect(Result.isFailure(signing)).toBe(true);
      if (Result.isFailure(signing)) {
        expect(signing.failure).toMatchObject({
          code: "xml.UNSUPPORTED_ALGORITHM",
          operation: "xml.sign",
        });
      }
    }).pipe(Effect.provide(xmlRuntimeLayer)),
  );

  it.effect("rejects canonicalization-width inputs before verification", () =>
    Effect.gen(function* () {
      const namespaceAttributes = Array.from(
        { length: 10_000 },
        (_, index) => `xmlns:p${index}="urn:p${index}"`,
      ).join(" ");
      const xml = `<root ${namespaceAttributes}>${"<a/>".repeat(100_000)}${canonicalizationSignature}</root>`;
      const result = yield* Effect.result(
        verifyXml({ xml, publicKeyDer: RUNTIME_TEST_KEY }).pipe(Effect.provide(xmlRuntimeLayer)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("xml.INVALID_XML");
        expect(result.failure.operation).toBe("xml.parse");
      }
    }),
  );

  it.effect("rejects excessive XML start elements before parsing", () =>
    Effect.gen(function* () {
      const xmlRuntime = yield* XmlRuntime;
      const result = yield* Effect.result(
        xmlRuntime.parse(`<root>${"<a/>".repeat(16_384)}</root>`),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("xml.INVALID_XML");
        expect(result.failure.operation).toBe("xml.parse");
      }
    }).pipe(Effect.provide(xmlRuntimeLayer)),
  );

  it.effect("rejects XML with excessive namespace declarations", () =>
    Effect.gen(function* () {
      const namespaceAttributes = Array.from(
        { length: 65 },
        (_, index) => `xmlns:p${index}="urn:p${index}"`,
      ).join(" ");
      const xmlRuntime = yield* XmlRuntime;
      const result = yield* Effect.result(xmlRuntime.parse(`<root ${namespaceAttributes}/>`));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("xml.INVALID_XML");
        expect(result.failure.operation).toBe("xml.parse");
      }
    }).pipe(Effect.provide(xmlRuntimeLayer)),
  );

  it.effect("rejects excessive XML node-producing markup before parsing", () =>
    Effect.gen(function* () {
      const xmlRuntime = yield* XmlRuntime;
      const nodeProducingMarkup = ["<!---->", "<?x?>", "<![CDATA[]]>"];

      for (const markup of nodeProducingMarkup) {
        const result = yield* Effect.result(
          xmlRuntime.parse(`<root>${markup.repeat(16_385)}</root>`),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("xml.INVALID_XML");
          expect(result.failure.operation).toBe("xml.parse");
        }
      }
    }).pipe(Effect.provide(xmlRuntimeLayer)),
  );

  it.effect("rejects oversized InclusiveNamespaces PrefixList before verification", () =>
    Effect.gen(function* () {
      const prefixLists = [
        Array.from({ length: 65 }, (_, index) => `p${index}`).join(" "),
        "p".repeat(4_097),
      ];

      for (const prefixList of prefixLists) {
        const xml = `<root>${canonicalizationSignature.replace(
          '<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>',
          `<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"><ec:InclusiveNamespaces xmlns:ec="http://www.w3.org/2001/10/xml-exc-c14n#" PrefixList="${prefixList}"/></ds:Transform>`,
        )}</root>`;
        const result = yield* Effect.result(
          verifyXml({ xml, publicKeyDer: RUNTIME_TEST_KEY }).pipe(Effect.provide(xmlRuntimeLayer)),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("xml.VERIFY_FAILED");
          expect(result.failure.operation).toBe("xml.verify");
        }
      }
    }),
  );

  it.effect("rejects raw loaded oversized InclusiveNamespaces PrefixList", () =>
    Effect.gen(function* () {
      const prefixList = Array.from({ length: 65 }, (_, index) => `p${index}`).join(" ");
      const xml = `<root>${canonicalizationSignature.replace(
        '<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>',
        `<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"><ec:InclusiveNamespaces xmlns:ec="http://www.w3.org/2001/10/xml-exc-c14n#" PrefixList="${prefixList}"/></ds:Transform>`,
      )}</root>`;
      const pfx = yield* readA1Fixture("ecpf");
      const signaturesLayer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const signingKey = yield* signatures
        .importSigningKey("rsa-sha256")
        .pipe(Effect.provide(signaturesLayer));
      const xmlRuntime = yield* XmlRuntime;
      const document = yield* xmlRuntime.parse(xml);
      const signatureElement = document
        .getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")
        .item(0);

      expect(signatureElement).not.toBeNull();
      if (signatureElement === null) {
        return;
      }

      const SignedXml = yield* xmlRuntime.signedXml();
      const rawForVerification = new SignedXml(document);
      rawForVerification.LoadXml(signatureElement);
      const verification = yield* Effect.result(
        Effect.tryPromise({
          try: () => rawForVerification.Verify(),
          catch: (cause) => cause,
        }),
      );
      const rawForSigning = new SignedXml(document);
      rawForSigning.LoadXml(signatureElement);
      const signing = yield* Effect.result(
        Effect.tryPromise({
          try: () =>
            rawForSigning.Sign(
              { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
              signingKey,
              document,
            ),
          catch: (cause) => cause,
        }),
      );

      expect(Result.isFailure(verification)).toBe(true);
      if (Result.isFailure(verification)) {
        expect(verification.failure).toMatchObject({
          code: "xml.VERIFY_FAILED",
          operation: "xml.verify",
        });
      }
      expect(Result.isFailure(signing)).toBe(true);
      if (Result.isFailure(signing)) {
        expect(signing.failure).toMatchObject({
          code: "xml.SIGN_FAILED",
          operation: "xml.sign",
        });
      }
    }).pipe(Effect.provide(xmlRuntimeLayer)),
  );
});
