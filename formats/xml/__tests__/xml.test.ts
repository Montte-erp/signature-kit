import { SignedXml } from "xmldsigjs";
import { describe, expect, it } from "@effect/vitest";
import { signatures } from "@signature-kit/core/signatures";
import { Effect, Redacted, Result } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signXml } from "@signature-kit/xml/sign";
import { verifyXml } from "@signature-kit/xml/verify";
import { XmlRuntime, xmlRuntimeLayer } from "@signature-kit/xml/runtime";

const PASSWORD = Redacted.make("changeit");

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

const XML_INCLUSIVE_C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";

const sampleNfse = `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse>
    <InfNfse Id="nfse_123">
      <Numero>123</Numero>
      <CodigoVerificacao>ABC123</CodigoVerificacao>
      <Competencia>2024-01</Competencia>
      <Servico>
        <Valores>
          <ValorServicos>1000.00</ValorServicos>
        </Valores>
        <Discriminacao>Consultoria em TI</Discriminacao>
      </Servico>
    </InfNfse>
  </Nfse>
</CompNfse>`;

describe("XML-DSig", () => {
  it.effect("signs and verifies enveloped XML with an A1 certificate", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const xml = '<invoice Id="invoice-1"><amount>100.00</amount></invoice>';

      const signed = yield* signXml({ xml, referenceId: "invoice-1" }).pipe(
        Effect.provide(layer),
        Effect.provide(xmlRuntimeLayer),
      );
      const publicKeyDer = yield* signatures.certificate().pipe(
        Effect.map((certificate) => certificate.publicKeyDer),
        Effect.provide(layer),
      );
      const trusted = yield* verifyXml({
        xml: signed,
        publicKeyDer,
        requireReferenceUri: "#invoice-1",
      }).pipe(Effect.provide(xmlRuntimeLayer));
      const untrusted = yield* verifyXml({
        xml: signed,
        requireReferenceUri: "#invoice-1",
      }).pipe(Effect.provide(xmlRuntimeLayer));
      const tampered = yield* verifyXml({
        xml: signed.replace("100.00", "999.00"),
        publicKeyDer,
        requireReferenceUri: "#invoice-1",
      }).pipe(Effect.provide(xmlRuntimeLayer));

      expect(signed).toContain("<ds:Signature");
      expect(trusted.valid).toBe(true);
      expect(trusted.referenceUris).toEqual(["#invoice-1"]);
      expect(untrusted.valid).toBe(false);
      expect(tampered.valid).toBe(false);
    }),
  );

  it.effect("includes algorithm URIs transforms KeyInfo and reference URI", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });

      const signed = yield* signXml({
        xml: sampleNfse,
        referenceId: "nfse_123",
        algorithm: "rsa-sha512",
        signatureId: "signature-1",
      }).pipe(Effect.provide(layer), Effect.provide(xmlRuntimeLayer));

      expect(signed).toContain("<ds:Signature");
      expect(signed).toContain('Id="signature-1"');
      expect(signed).toContain("rsa-sha512");
      expect(signed).toContain("sha512");
      expect(signed).toContain("enveloped-signature");
      expect(signed).toContain("xml-exc-c14n");
      expect(signed).toContain("<ds:KeyInfo>");
      expect(signed).toContain("<ds:X509Data>");
      expect(signed).toContain("<ds:X509Certificate>");
      expect(signed).toContain('URI="#nfse_123"');
      const sha1 = yield* signXml({
        xml: sampleNfse,
        referenceId: "nfse_123",
        algorithm: "rsa-sha1",
      }).pipe(Effect.provide(layer), Effect.provide(xmlRuntimeLayer));
      expect(sha1).toContain("rsa-sha1");
      expect(sha1).toContain("xmldsig#sha1");
    }),
  );

  it.effect("infers the signature hash algorithm from SignatureMethod", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const publicKeyDer = yield* signatures.certificate().pipe(
        Effect.map((certificate) => certificate.publicKeyDer),
        Effect.provide(layer),
      );
      const signed = yield* signXml({
        xml: sampleNfse,
        referenceId: "nfse_123",
        algorithm: "rsa-sha1",
      }).pipe(Effect.provide(layer), Effect.provide(xmlRuntimeLayer));

      const inferred = yield* verifyXml({
        xml: signed,
        publicKeyDer,
      }).pipe(Effect.provide(xmlRuntimeLayer));

      expect(inferred.valid).toBe(true);
      expect(inferred.signatureCount).toBe(1);
    }),
  );

  it.effect("verifies every Signature and rejects a prepended masking signature", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const certificate = yield* signatures.certificate().pipe(Effect.provide(layer));
      const baseXml =
        '<document><trusted Id="trusted-part"><amount>100.00</amount></trusted><witness Id="witness-part"><note>accepted</note></witness></document>';

      const leadingSignature = yield* signXml({
        xml: baseXml,
        referenceId: "witness-part",
      }).pipe(Effect.provide(layer), Effect.provide(xmlRuntimeLayer));
      const maskedSignature = yield* signXml({
        xml: baseXml,
        referenceId: "trusted-part",
      }).pipe(Effect.provide(layer), Effect.provide(xmlRuntimeLayer));

      const tamperedMasked = maskedSignature.replace("100.00", "999.00");
      const prepended = tamperedMasked.replace(
        "<ds:Signature",
        `${leadingSignature}\n<ds:Signature`,
      );

      const result = yield* verifyXml({
        xml: prepended,
        publicKeyDer: certificate.publicKeyDer,
      }).pipe(Effect.provide(xmlRuntimeLayer));

      expect(result.valid).toBe(false);
      expect(result.signatureCount).toBe(2);
    }),
  );

  it.effect("rejects documents with duplicate/wrapped signed IDs", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const publicKeyDer = yield* signatures.certificate().pipe(
        Effect.map((certificate) => certificate.publicKeyDer),
        Effect.provide(layer),
      );
      const xml = '<root><item Id="wrapped-id"><value>trusted</value></item></root>';

      const signed = yield* signXml({
        xml,
        referenceId: "wrapped-id",
      }).pipe(Effect.provide(layer), Effect.provide(xmlRuntimeLayer));
      const duplicateIdXml = signed.replace(
        "</root>",
        '<wrapper><item Id="wrapped-id"><value>attacker</value></item></wrapper></root>',
      );

      const result = yield* verifyXml({
        xml: duplicateIdXml,
        publicKeyDer,
      }).pipe(Effect.provide(xmlRuntimeLayer));

      expect(result.valid).toBe(false);
    }),
  );

  it.effect("verifies inclusive C14N signatures", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const certXml =
        '<document><amount Id="amount-1">10</amount><meta Id="meta-1"><value>keep</value></meta></document>';

      const cert = yield* signatures.certificate().pipe(Effect.provide(layer));
      const signingKey = yield* signatures
        .importSigningKey("rsa-sha256")
        .pipe(Effect.provide(layer));
      const xmlRuntime = yield* XmlRuntime;
      const document = yield* xmlRuntime.parse(certXml);
      const signedXml = new SignedXml();

      yield* Effect.promise(() =>
        signedXml.Sign(
          {
            name: "RSASSA-PKCS1-v1_5",
            hash: "SHA-256",
          },
          signingKey,
          document,
          {
            x509: [toBase64(cert.certificateDer)],
            references: [
              {
                hash: "SHA-256",
                transforms: ["enveloped", XML_INCLUSIVE_C14N],
                uri: "#amount-1",
              },
            ],
          },
        ),
      );

      const signed = signedXml.toString();
      const verified = yield* verifyXml({
        xml: signed,
        publicKeyDer: cert.publicKeyDer,
      }).pipe(Effect.provide(xmlRuntimeLayer));

      expect(signed).toContain(XML_INCLUSIVE_C14N);
      expect(verified.valid).toBe(true);
      expect(verified.signatureCount).toBe(1);
    }).pipe(Effect.provide(xmlRuntimeLayer)),
  );

  it.effect("preserves XML content and changes digest when referenced content changes", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const firstXml = '<root Id="a"><data>value1</data></root>';
      const secondXml = '<root Id="a"><data>value2</data></root>';

      const signedNfse = yield* signXml({ xml: sampleNfse, referenceId: "nfse_123" }).pipe(
        Effect.provide(layer),
        Effect.provide(xmlRuntimeLayer),
      );
      const signedFirst = yield* signXml({ xml: firstXml, referenceId: "a" }).pipe(
        Effect.provide(layer),
        Effect.provide(xmlRuntimeLayer),
      );
      const signedSecond = yield* signXml({ xml: secondXml, referenceId: "a" }).pipe(
        Effect.provide(layer),
        Effect.provide(xmlRuntimeLayer),
      );
      const firstDigest = signedFirst.match(/<ds:DigestValue>([^<]+)<\/ds:DigestValue>/)?.[1];
      const secondDigest = signedSecond.match(/<ds:DigestValue>([^<]+)<\/ds:DigestValue>/)?.[1];

      expect(signedNfse).toContain("<Numero>123</Numero>");
      expect(signedNfse).toContain("<CodigoVerificacao>ABC123</CodigoVerificacao>");
      expect(signedNfse).toContain("Consultoria em TI");
      expect(firstDigest).toBeDefined();
      expect(secondDigest).toBeDefined();
      expect(firstDigest).not.toBe(secondDigest);
    }),
  );

  it.effect("fails in the typed error channel for a missing reference URI", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const result = yield* Effect.result(
        signXml({ xml: sampleNfse, referenceId: "nonexistent" }).pipe(
          Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
          Effect.provide(xmlRuntimeLayer),
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("xml.SIGN_FAILED");
      }
    }),
  );
});
