import { describe, expect, it } from "@effect/vitest";
import { signatures } from "@signature-kit/core/signatures";
import { Effect, Redacted, Result } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signXml } from "@signature-kit/xml/sign";
import { verifyXml } from "@signature-kit/xml/verify";

const PASSWORD = Redacted.make("changeit");

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
      const xml = '<invoice Id="invoice-1"><amount>100.00</amount></invoice>';
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });

      const signed = yield* signXml({ xml, referenceId: "invoice-1" }).pipe(Effect.provide(layer));
      const publicKeyDer = yield* signatures.certificate().pipe(
        Effect.map((certificate) => certificate.publicKeyDer),
        Effect.provide(layer),
      );
      const embeddedKey = yield* verifyXml({ xml: signed, requireReferenceUri: "#invoice-1" });
      const explicitKey = yield* verifyXml({
        xml: signed,
        publicKeyDer,
        requireReferenceUri: "#invoice-1",
      });
      const tampered = yield* verifyXml({
        xml: signed.replace("100.00", "999.00"),
        publicKeyDer,
        requireReferenceUri: "#invoice-1",
      });

      expect(signed).toContain("<ds:Signature");
      expect(signed).toContain("<ds:X509Certificate>");
      expect(embeddedKey.valid).toBe(true);
      expect(explicitKey.valid).toBe(true);
      expect(explicitKey.referenceUris).toEqual(["#invoice-1"]);
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
      }).pipe(Effect.provide(layer));

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
      }).pipe(Effect.provide(layer));
      expect(sha1).toContain("rsa-sha1");
      expect(sha1).toContain("xmldsig#sha1");
    }),
  );

  it.effect("preserves XML content and changes digest when referenced content changes", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const firstXml = '<root Id="a"><data>value1</data></root>';
      const secondXml = '<root Id="a"><data>value2</data></root>';

      const signedNfse = yield* signXml({ xml: sampleNfse, referenceId: "nfse_123" }).pipe(
        Effect.provide(layer),
      );
      const signedFirst = yield* signXml({ xml: firstXml, referenceId: "a" }).pipe(
        Effect.provide(layer),
      );
      const signedSecond = yield* signXml({ xml: secondXml, referenceId: "a" }).pipe(
        Effect.provide(layer),
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
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("xml.SIGN_FAILED");
      }
    }),
  );
});
