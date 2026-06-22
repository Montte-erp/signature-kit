import { describe, expect, it } from "@effect/vitest";
import { signatures } from "@signature-kit/core";
import { Effect, Redacted } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { a1SignaturesLayer } from "@signature-kit/a1";
import { signXml, verifyXml } from "@signature-kit/xml";

const PASSWORD = Redacted.make("changeit");

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
});
