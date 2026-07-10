import { describe, expect, it } from "@effect/vitest";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signatures } from "@signature-kit/signatures";
import { signXml } from "../src/sign";
import { verifyXml } from "../src/verify";
import type { XmlRequiredReference } from "../src/config";
import { Cause, Effect, Exit, Redacted, Result } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { xmlRuntimeLayer } from "../src/runtime";

const PASSWORD = Redacted.make("changeit");
const BILLING_NAMESPACE = "urn:signature-kit:billing";

describe("XML-DSig verification hardening", () => {
  it.effect("binds a required reference to its namespace-aware direct-child path", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const publicKeyDer = yield* signatures.certificate().pipe(
        Effect.map((certificate) => certificate.publicKeyDer),
        Effect.provide(layer),
      );
      const source = `<Envelope xmlns="${BILLING_NAMESPACE}"><Body Id="body"><Amount>100</Amount></Body></Envelope>`;
      const signed = yield* signXml({ xml: source, referenceId: "body" }).pipe(
        Effect.provide(layer),
        Effect.provide(xmlRuntimeLayer),
      );
      const requiredReference: XmlRequiredReference = {
        uri: "#body",
        path: [
          { localName: "Envelope", namespaceUri: BILLING_NAMESPACE },
          { localName: "Body", namespaceUri: BILLING_NAMESPACE },
        ],
      };
      const relocated = signed.replace(
        '<Body Id="body"><Amount>100</Amount></Body>',
        '<Body><Amount>999</Amount></Body><Wrapper><Body Id="body"><Amount>100</Amount></Body></Wrapper>',
      );
      const verified = yield* verifyXml({
        xml: signed,
        publicKeyDer,
        requiredReference,
      }).pipe(Effect.provide(xmlRuntimeLayer));
      const generic = yield* verifyXml({
        xml: relocated,
        publicKeyDer,
      }).pipe(Effect.provide(xmlRuntimeLayer));
      const wrapped = yield* verifyXml({
        xml: relocated,
        publicKeyDer,
        requiredReference,
      }).pipe(Effect.provide(xmlRuntimeLayer));

      expect(relocated).not.toBe(signed);
      expect(verified.valid).toBe(true);
      expect(generic.valid).toBe(true);
      expect(wrapped.valid).toBe(false);
    }),
  );

  it.effect("ignores unsigned manifest references outside SignedInfo", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const publicKeyDer = yield* signatures.certificate().pipe(
        Effect.map((certificate) => certificate.publicKeyDer),
        Effect.provide(layer),
      );
      const signed = yield* signXml({
        xml: '<root><witness Id="witness"><value>signed</value></witness><required Id="required"><value>unsigned</value></required></root>',
        referenceId: "witness",
      }).pipe(Effect.provide(layer), Effect.provide(xmlRuntimeLayer));
      const manifestInjected = signed.replace(
        "</ds:Signature>",
        '<ds:Object><ds:Manifest><ds:Reference URI="#required"/></ds:Manifest></ds:Object></ds:Signature>',
      );
      const result = yield* verifyXml({
        xml: manifestInjected,
        publicKeyDer,
        requiredReference: {
          uri: "#required",
          path: [
            { localName: "root", namespaceUri: null },
            { localName: "required", namespaceUri: null },
          ],
        },
      }).pipe(Effect.provide(xmlRuntimeLayer));

      expect(manifestInjected).not.toBe(signed);
      expect(result.referenceUris).toEqual(["#witness"]);
      expect(result.valid).toBe(false);
    }),
  );

  it.effect("returns an XmlError instead of a defect for a backend algorithm rejection", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const publicKeyDer = yield* signatures.certificate().pipe(
        Effect.map((certificate) => certificate.publicKeyDer),
        Effect.provide(layer),
      );
      const signed = yield* signXml({
        xml: '<root Id="target"><value>signed</value></root>',
        referenceId: "target",
      }).pipe(Effect.provide(layer), Effect.provide(xmlRuntimeLayer));
      const mismatchedAlgorithm = signed.replace("rsa-sha256", "ecdsa-sha256");
      const exit = yield* Effect.exit(
        verifyXml({
          xml: mismatchedAlgorithm,
          publicKeyDer,
          requiredReference: {
            uri: "#target",
            path: [{ localName: "root", namespaceUri: null }],
          },
        }).pipe(Effect.provide(xmlRuntimeLayer)),
      );

      expect(mismatchedAlgorithm).not.toBe(signed);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(Exit.hasDies(exit)).toBe(false);
      if (Exit.isFailure(exit)) {
        const typedFailure = exit.cause.reasons.find(Cause.isFailReason);
        expect(typedFailure).toBeDefined();
        if (typedFailure !== undefined) {
          expect(typedFailure.error.code).toBe("xml.VERIFY_FAILED");
        }
      }
    }),
  );

  it.effect("accepts repeated Id aliases on the signed element", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const publicKeyDer = yield* signatures.certificate().pipe(
        Effect.map((certificate) => certificate.publicKeyDer),
        Effect.provide(layer),
      );
      const signed = yield* signXml({
        xml: '<root Id="same-id" id="same-id" ID="same-id"><value>signed</value></root>',
        referenceId: "same-id",
      }).pipe(Effect.provide(layer), Effect.provide(xmlRuntimeLayer));
      const result = yield* verifyXml({
        xml: signed,
        publicKeyDer,
        requiredReference: {
          uri: "#same-id",
          path: [{ localName: "root", namespaceUri: null }],
        },
      }).pipe(Effect.provide(xmlRuntimeLayer));

      expect(result.valid).toBe(true);
      expect(result.referenceUris).toEqual(["#same-id"]);
    }),
  );

  it.effect("rejects competing verification key sources", () =>
    Effect.gen(function* () {
      const attackerPfx = yield* readA1Fixture("ecpf");
      const pinnedPfx = yield* readA1Fixture("ecnpj");
      const attackerLayer = a1SignaturesLayer({ pfx: attackerPfx, password: PASSWORD });
      const pinnedLayer = a1SignaturesLayer({ pfx: pinnedPfx, password: PASSWORD });
      const attackerPublicKeyDer = yield* signatures.certificate().pipe(
        Effect.map((certificate) => certificate.publicKeyDer),
        Effect.provide(attackerLayer),
      );
      const trustedCertificateDer = yield* signatures.certificate().pipe(
        Effect.map((certificate) => certificate.certificateDer),
        Effect.provide(pinnedLayer),
      );
      const signed = yield* signXml({
        xml: '<root Id="target"><value>attacker-signed</value></root>',
        referenceId: "target",
      }).pipe(Effect.provide(attackerLayer), Effect.provide(xmlRuntimeLayer));
      const result = yield* Effect.result(
        verifyXml({
          xml: signed,
          publicKeyDer: attackerPublicKeyDer,
          trustedCertificateDer,
        }).pipe(Effect.provide(xmlRuntimeLayer)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("xml.INVALID_INPUT");
      }
    }),
  );

  it.effect(
    "bounds signature, reference, and transform metadata before cryptographic verification",
    () =>
      Effect.gen(function* () {
        const pfx = yield* readA1Fixture("ecpf");
        const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
        const publicKeyDer = yield* signatures.certificate().pipe(
          Effect.map((certificate) => certificate.publicKeyDer),
          Effect.provide(layer),
        );
        const namespace = "http://www.w3.org/2000/09/xmldsig#";
        const signatureMethod = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
        const emptyReference = '<ds:Reference URI=""/>';
        const transform = `<ds:Transform Algorithm="${namespace}enveloped-signature"/>`;
        const referenceWithTransforms = `<ds:Reference URI=""><ds:Transforms>${transform.repeat(3)}</ds:Transforms></ds:Reference>`;
        const fourReferenceSignature = `<ds:Signature><ds:SignedInfo><ds:SignatureMethod Algorithm="${signatureMethod}"/>${emptyReference.repeat(4)}</ds:SignedInfo></ds:Signature>`;
        const oneReferenceSignature = `<ds:Signature><ds:SignedInfo><ds:SignatureMethod Algorithm="${signatureMethod}"/>${emptyReference}</ds:SignedInfo></ds:Signature>`;
        const exclusiveCanonicalization = "http://www.w3.org/2001/10/xml-exc-c14n#";
        const canonicalizationTransform = `<ds:Transform Algorithm="${exclusiveCanonicalization}"/>`;
        const signaturesExceeded = yield* verifyXml({
          xml: `<root xmlns:ds="${namespace}">${"<ds:Signature/>".repeat(5)}</root>`,
          publicKeyDer,
        }).pipe(Effect.provide(xmlRuntimeLayer));
        const referencesExceeded = yield* verifyXml({
          xml: `<root xmlns:ds="${namespace}"><ds:Signature><ds:SignedInfo><ds:SignatureMethod Algorithm="${signatureMethod}"/>${emptyReference.repeat(5)}</ds:SignedInfo></ds:Signature></root>`,
          publicKeyDer,
        }).pipe(Effect.provide(xmlRuntimeLayer));
        const totalReferencesExceeded = yield* verifyXml({
          xml: `<root xmlns:ds="${namespace}">${fourReferenceSignature.repeat(2)}${oneReferenceSignature}</root>`,
          publicKeyDer,
        }).pipe(Effect.provide(xmlRuntimeLayer));
        const transformsExceeded = yield* verifyXml({
          xml: `<root xmlns:ds="${namespace}"><ds:Signature><ds:SignedInfo><ds:SignatureMethod Algorithm="${signatureMethod}"/><ds:Reference URI=""><ds:Transforms>${transform.repeat(4)}</ds:Transforms></ds:Reference></ds:SignedInfo></ds:Signature></root>`,
          publicKeyDer,
        }).pipe(Effect.provide(xmlRuntimeLayer));
        const totalTransformsExceeded = yield* verifyXml({
          xml: `<root xmlns:ds="${namespace}"><ds:Signature><ds:SignedInfo><ds:SignatureMethod Algorithm="${signatureMethod}"/>${referenceWithTransforms.repeat(3)}</ds:SignedInfo></ds:Signature></root>`,
          publicKeyDer,
        }).pipe(Effect.provide(xmlRuntimeLayer));
        const repeatedCanonicalizations = yield* verifyXml({
          xml: `<root xmlns:ds="${namespace}"><ds:Signature><ds:SignedInfo><ds:SignatureMethod Algorithm="${signatureMethod}"/><ds:Reference URI=""><ds:Transforms>${canonicalizationTransform.repeat(2)}</ds:Transforms></ds:Reference></ds:SignedInfo></ds:Signature></root>`,
          publicKeyDer,
        }).pipe(Effect.provide(xmlRuntimeLayer));

        expect(signaturesExceeded.valid).toBe(false);
        expect(signaturesExceeded.signatureCount).toBe(5);
        expect(signaturesExceeded.referenceUris).toEqual([]);
        expect(referencesExceeded.valid).toBe(false);
        expect(referencesExceeded.signatureCount).toBe(1);
        expect(referencesExceeded.referenceUris).toEqual([]);
        expect(totalReferencesExceeded.valid).toBe(false);
        expect(totalReferencesExceeded.signatureCount).toBe(3);
        expect(totalReferencesExceeded.referenceUris).toHaveLength(8);
        expect(transformsExceeded.valid).toBe(false);
        expect(transformsExceeded.signatureCount).toBe(1);
        expect(transformsExceeded.referenceUris).toEqual([""]);
        expect(totalTransformsExceeded.valid).toBe(false);
        expect(totalTransformsExceeded.signatureCount).toBe(1);
        expect(totalTransformsExceeded.referenceUris).toHaveLength(3);
        expect(repeatedCanonicalizations.valid).toBe(false);
        expect(repeatedCanonicalizations.signatureCount).toBe(1);
        expect(repeatedCanonicalizations.referenceUris).toEqual([""]);
      }),
  );

  it.effect("rejects an altered declared transform order", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const publicKeyDer = yield* signatures.certificate().pipe(
        Effect.map((certificate) => certificate.publicKeyDer),
        Effect.provide(layer),
      );
      const signed = yield* signXml({
        xml: '<root Id="target"><value>signed</value></root>',
        referenceId: "target",
      }).pipe(Effect.provide(layer), Effect.provide(xmlRuntimeLayer));
      const reorderedTransforms = signed.replace(
        /(<ds:Transform Algorithm="[^"]*enveloped-signature"\/>)(<ds:Transform Algorithm="[^"]*c14n[^"]*"\/>)/,
        "$2$1",
      );
      const result = yield* verifyXml({
        xml: reorderedTransforms,
        publicKeyDer,
      }).pipe(Effect.provide(xmlRuntimeLayer));

      expect(reorderedTransforms).not.toBe(signed);
      expect(result.valid).toBe(false);
    }),
  );

  it.effect("rejects an empty referenceId before signing", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const result = yield* Effect.result(
        signXml({ xml: "<root/>", referenceId: "" }).pipe(
          Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
          Effect.provide(xmlRuntimeLayer),
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("xml.INVALID_INPUT");
      }
    }),
  );

  it.effect("fails before appending a fifth XML signature", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const certificate = yield* signatures.certificate().pipe(Effect.provide(layer));
      const source =
        '<root><target Id="one">one</target><target Id="two">two</target><target Id="three">three</target><target Id="four">four</target><target Id="five">five</target></root>';
      let signed = source;

      for (const referenceId of ["one", "two", "three", "four"]) {
        signed = yield* signXml({ xml: signed, referenceId }).pipe(
          Effect.provide(layer),
          Effect.provide(xmlRuntimeLayer),
        );
      }

      const verified = yield* verifyXml({
        xml: signed,
        publicKeyDer: certificate.publicKeyDer,
      }).pipe(Effect.provide(xmlRuntimeLayer));
      const fifthSignature = yield* Effect.result(
        signXml({ xml: signed, referenceId: "five" }).pipe(
          Effect.provide(layer),
          Effect.provide(xmlRuntimeLayer),
        ),
      );

      expect(verified.valid).toBe(true);
      expect(verified.signatureCount).toBe(4);
      expect(Result.isFailure(fifthSignature)).toBe(true);
      if (Result.isFailure(fifthSignature)) {
        expect(fifthSignature.failure.code).toBe("xml.SIGN_FAILED");
        expect(fifthSignature.failure.operation).toBe("xml.sign");
      }
    }),
  );
});
