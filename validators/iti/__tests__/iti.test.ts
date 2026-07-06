import { describe, expect, it } from "@effect/vitest";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { readFile } from "node:fs/promises";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { vi } from "vitest";
import { CmsOid } from "@signature-kit/cms/config";
import { SignatureKitErrorCodeValue } from "@signature-kit/signatures";
import { signatureHttpClientLive } from "@signature-kit/http";
import { extractPdfSignature } from "@signature-kit/pdf/byte-range";
import { Effect, Result, Schema } from "effect";
import { localHttpServer } from "../../../tooling/testing/local-http";
import { validatePdfConformance } from "../src/conformance";
import { validatePdfWithIti } from "../src/remote";

const ITI_ENDPOINT = "https://validar.iti.gov.br/arquivo";
const POLICY_OID = "2.16.76.1.7.1.11.1.1";
const NON_AD_RB_POLICY_OID = "2.16.76.1.7.1.11.1.2";

const Asn1SequenceShapeSchema = Schema.Struct({
  idBlock: Schema.Struct({
    tagClass: Schema.Number,
    tagNumber: Schema.Number,
  }),
  valueBlock: Schema.Struct({
    value: Schema.Array(Schema.Any),
  }),
});

const Asn1ObjectIdentifierShapeSchema = Schema.Struct({
  idBlock: Schema.Struct({
    tagClass: Schema.Number,
    tagNumber: Schema.Number,
  }),
});

const isAsn1Sequence = (value: unknown): value is asn1js.Sequence =>
  Schema.is(Asn1SequenceShapeSchema)(value) &&
  value.idBlock.tagClass === 1 &&
  value.idBlock.tagNumber === 16;

const isAsn1ObjectIdentifier = (value: unknown): value is asn1js.ObjectIdentifier =>
  Schema.is(Asn1ObjectIdentifierShapeSchema)(value) &&
  value.idBlock.tagClass === 1 &&
  value.idBlock.tagNumber === 6;

const readItiFixture = (name: string): Effect.Effect<Uint8Array> =>
  Effect.promise(
    async () => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url))),
  );

const mutatePolicyToNonAdRbWithAdRbQualifierOnly = (pdf: Uint8Array) =>
  Effect.gen(function* () {
    const extracted = yield* extractPdfSignature(pdf);
    const parsed = asn1js.fromBER(extracted.signature);
    const contentInfo = new pkijs.ContentInfo({ schema: parsed.result });
    const signedData = new pkijs.SignedData({ schema: contentInfo.content });
    const signerInfo = signedData.signerInfos[0];
    const signedAttributes = signerInfo?.signedAttrs;
    if (signerInfo === undefined || signedAttributes === undefined) {
      return yield* Effect.die("CMS has no signer info or signed attributes.");
    }

    const signaturePolicy = signedAttributes.attributes.find(
      (attribute) => attribute.type === CmsOid.signaturePolicy,
    );
    const signaturePolicySource = signaturePolicy?.values[0];
    if (signaturePolicy === undefined || signaturePolicySource === undefined) {
      return yield* Effect.die("CMS signature policy attribute is missing.");
    }

    const signaturePolicyValue = asn1js.fromBER(signaturePolicySource.toBER(false));
    const signaturePolicySequence = signaturePolicyValue.result;
    if (!isAsn1Sequence(signaturePolicySequence)) {
      return yield* Effect.die("Malformed signaturePolicy attribute.");
    }

    const policyFields = signaturePolicySequence.valueBlock.value;
    const sigPolicyId = policyFields[0];
    if (isAsn1ObjectIdentifier(sigPolicyId)) {
      sigPolicyId.valueBlock.fromString(NON_AD_RB_POLICY_OID);
    }
    const qualifiers = policyFields[2];
    if (isAsn1Sequence(qualifiers)) {
      qualifiers.valueBlock.value.push(
        new asn1js.Sequence({
          value: [
            new asn1js.ObjectIdentifier({ value: POLICY_OID }),
            new asn1js.IA5String({ value: "urn:signature-kit/item-8-seam" }),
          ],
        }),
      );
    }

    signaturePolicy.values[0] = signaturePolicySequence;
    contentInfo.content = signedData.toSchema(true);
    const replacement = new Uint8Array(contentInfo.toSchema().toBER(false));
    return replaceCmsContents(pdf, extracted.signature, replacement);
  });

const mutatePolicyPdfWithQualifierOnly = (pdf: Uint8Array) =>
  mutatePolicyToNonAdRbWithAdRbQualifierOnly(pdf);

const appendSigningTimeAttribute = (cms: Uint8Array): Uint8Array => {
  const parsed = asn1js.fromBER(cms);
  const contentInfo = new pkijs.ContentInfo({ schema: parsed.result });
  const signedData = new pkijs.SignedData({ schema: contentInfo.content });
  const signerInfo = signedData.signerInfos[0];
  if (signerInfo === undefined || signerInfo.signedAttrs === undefined) return cms;

  signerInfo.signedAttrs.attributes.push(
    new pkijs.Attribute({
      type: CmsOid.signingTime,
      values: [new asn1js.UTCTime({ valueDate: new Date("2026-01-02T03:04:05Z") })],
    }),
  );
  contentInfo.content = signedData.toSchema(true);
  return new Uint8Array(contentInfo.toSchema().toBER(false));
};

const replaceCmsContents = (
  pdf: Uint8Array,
  original: Uint8Array,
  replacement: Uint8Array,
): Uint8Array => {
  const text = Buffer.from(pdf).toString("latin1");
  const originalHex = Buffer.from(original).toString("hex");
  const replacementHex = Buffer.from(replacement).toString("hex");
  const marker = `<${originalHex}`;
  const markerStart = text.indexOf(marker);
  expect(markerStart).toBeGreaterThanOrEqual(0);
  const payloadStart = markerStart + 1;
  const payloadEnd = text.indexOf(">", payloadStart);
  expect(payloadEnd).toBeGreaterThan(payloadStart);
  const payloadLength = payloadEnd - payloadStart;
  expect(replacementHex.length).toBeLessThanOrEqual(payloadLength);
  const paddedReplacement = `${replacementHex}${"0".repeat(payloadLength - replacementHex.length)}`;
  return new Uint8Array(
    Buffer.from(
      `${text.slice(0, payloadStart)}${paddedReplacement}${text.slice(payloadEnd)}`,
      "latin1",
    ),
  );
};

const installItiFetchRedirect = (baseUrl: string): Effect.Effect<void> =>
  Effect.sync(() => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      if (input === ITI_ENDPOINT) return originalFetch(`${baseUrl}/arquivo`, init);
      return originalFetch(input, init);
    });
  });

const restoreFetch = Effect.sync(() => {
  vi.unstubAllGlobals();
});

const createPdf = Effect.promise(async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("SignatureKit ITI validation fixture", { x: 24, y: 140, size: 12, font });
  return new Uint8Array(await document.save());
});

const expectedAdRbPolicyOid = POLICY_OID;

describe("ITI local conformance", () => {
  it.effect("approves an ICP-Brasil PAdES AD-RB signed PDF", () =>
    Effect.gen(function* () {
      const signed = yield* readItiFixture("icp-brasil-ad-rb-signed.pdf");
      const report = yield* validatePdfConformance({ pdf: signed });
      const signature = report.signatures[0];

      expect(report.validator).toBe("iti.conformance");
      expect(report.approved).toBe(true);
      expect(report.outcome).toBe("approved");
      expect(report.signatureCount).toBe(1);
      expect(signature).toBeDefined();
      if (signature === undefined) return;
      expect(signature.signatureType).toBe("PA_PAdES_AD_RB_v1_1");
      expect(signature.policyOid).toBe(expectedAdRbPolicyOid);
      expect(signature.certificationPath).toBe("not_checked");
      expect(signature.structure.status).toBe("Valid");
      expect(signature.cipher.status).toBe("Valid");
      expect(signature.digest.status).toBe("Valid");
      expect(signature.attributes.map((attribute) => [attribute.name, attribute.status])).toEqual([
        ["IdMessageDigest", "Valid"],
        ["IdContentType", "Valid"],
        ["IdAaEtsSigPolicyId", "Valid"],
        ["IdAaSigningCertificateV2", "Valid"],
        ["SignatureDictionary", "Valid"],
        ["signingTime", "Valid"],
      ]);
    }),
  );

  it.effect("rejects a signature policy with AD-RB in a qualifier but not in SigPolicyId", () =>
    Effect.gen(function* () {
      const signed = yield* readItiFixture("icp-brasil-ad-rb-signed.pdf");
      const forgedPdf = yield* mutatePolicyPdfWithQualifierOnly(signed);
      const report = yield* validatePdfConformance({ pdf: forgedPdf });
      const signature = report.signatures[0];

      expect(report.approved).toBe(false);
      expect(report.outcome).toBe("rejected");
      expect(signature).toBeDefined();
      if (signature === undefined) return;
      expect(signature.attributes).toContainEqual({
        name: "IdAaEtsSigPolicyId",
        status: "Invalid",
        message: "A assinatura não contém a política ICP-Brasil PAdES AD-RB 2.16.76.1.7.1.11.1.1.",
      });
    }),
  );

  it.effect("rejects a signed PDF containing prohibited CMS signingTime", () =>
    Effect.gen(function* () {
      const signed = yield* readItiFixture("icp-brasil-ad-rb-signed.pdf");
      const extracted = yield* extractPdfSignature(signed);
      const forgedCms = appendSigningTimeAttribute(extracted.signature);
      expect(forgedCms.byteLength).toBeGreaterThan(extracted.signature.byteLength);
      const forgedPdf = replaceCmsContents(signed, extracted.signature, forgedCms);
      const report = yield* validatePdfConformance({ pdf: forgedPdf });
      const signature = report.signatures[0];

      expect(report.approved).toBe(false);
      expect(report.outcome).toBe("rejected");
      expect(signature).toBeDefined();
      if (signature === undefined) return;
      expect(signature.attributes).toContainEqual({
        name: "signingTime",
        status: "Invalid",
        message: "A política PA_PAdES_AD_RB_v1_1 proíbe o atributo CMS signingTime.",
      });
    }),
  );

  it.effect("returns a rejected report for an unsigned PDF", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf;
      const report = yield* validatePdfConformance({ pdf });

      expect(report.approved).toBe(false);
      expect(report.outcome).toBe("rejected");
      expect(report.signatureCount).toBe(0);
      expect(report.signatures).toEqual([]);
    }),
  );
});

describe("ITI remote client", () => {
  it.effect("submits the PDF as the ITI multipart field", () =>
    Effect.gen(function* () {
      const signed = yield* readItiFixture("icp-brasil-ad-rb-signed.pdf");
      const local = yield* localHttpServer(async () => ({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifierReport: { aprovado: true } }),
      }));
      yield* installItiFetchRedirect(local.baseUrl);
      const report = yield* validatePdfWithIti({
        source: { pdf: signed },
        fileName: "fixture.pdf",
      }).pipe(Effect.provide(signatureHttpClientLive));
      const request = local.requests[0];

      expect(report.validator).toBe("iti.remote");
      expect(report.outcome).toBe("approved");
      expect(request).toBeDefined();
      if (request === undefined) return;
      expect(request.method).toBe("POST");
      expect(request.pathname).toBe("/arquivo");
      expect(request.headers["origin"]).toBe("https://validar.iti.gov.br");
      expect(request.headers["referer"]).toBe("https://validar.iti.gov.br/");
      expect(request.headers["content-type"]).toContain("multipart/form-data");
      expect(request.body).toContain('name="signature_files[]"');
      expect(request.body).toContain('filename="fixture.pdf"');
      expect(request.body).toContain("Content-Type: application/pdf");
      expect(request.body).toContain("%PDF");
    }).pipe(Effect.ensuring(restoreFetch)),
  );

  it.effect("maps a decoded 200 verifierReport into the remote report", () =>
    Effect.gen(function* () {
      const signed = yield* readItiFixture("icp-brasil-ad-rb-signed.pdf");
      const local = yield* localHttpServer(async () => ({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifierReport: { status: "Aprovado", signatures: 1 } }),
      }));
      yield* installItiFetchRedirect(local.baseUrl);
      const report = yield* validatePdfWithIti({ source: { pdf: signed } }).pipe(
        Effect.provide(signatureHttpClientLive),
      );

      expect(report.validator).toBe("iti.remote");
      expect(report.approved).toBe(true);
      expect(report.outcome).toBe("approved");
      expect(report.conformance.approved).toBe(true);
      expect("rawVerifierReport" in report ? report.rawVerifierReport : undefined).toEqual({
        status: "Aprovado",
        signatures: 1,
      });
    }).pipe(Effect.ensuring(restoreFetch)),
  );

  it.effect(
    "derives approved/outcome from remote verifierReport while keeping local conformance",
    () =>
      Effect.gen(function* () {
        const signed = yield* readItiFixture("icp-brasil-ad-rb-signed.pdf");
        const local = yield* localHttpServer(async () => ({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verifierReport: { status: "Reprovado", signatures: 0 } }),
        }));
        yield* installItiFetchRedirect(local.baseUrl);
        const report = yield* validatePdfWithIti({ source: { pdf: signed } }).pipe(
          Effect.provide(signatureHttpClientLive),
        );

        expect(report.validator).toBe("iti.remote");
        expect(report.approved).toBe(false);
        expect(report.outcome).toBe("rejected");
        expect(report.conformance).toBeDefined();
        expect("localConformance" in report ? report.localConformance : undefined).toBeDefined();
        expect(report.conformance.approved).toBe(true);
        expect(report.conformance.outcome).toBe("approved");
        expect(report.conformance.signatureCount).toBe(1);
        expect("rawVerifierReport" in report ? report.rawVerifierReport : undefined).toEqual({
          status: "Reprovado",
          signatures: 0,
        });
      }).pipe(Effect.ensuring(restoreFetch)),
  );

  it.effect("maps unknown remote verdicts to unknown outcome while keeping local conformance", () =>
    Effect.gen(function* () {
      const signed = yield* readItiFixture("icp-brasil-ad-rb-signed.pdf");
      const local = yield* localHttpServer(async () => ({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifierReport: { status: "Em Revisão" } }),
      }));
      yield* installItiFetchRedirect(local.baseUrl);
      const report = yield* validatePdfWithIti({ source: { pdf: signed } }).pipe(
        Effect.provide(signatureHttpClientLive),
      );

      expect(report.validator).toBe("iti.remote");
      expect(report.approved).toBe(false);
      expect(report.outcome).toBe("unknown");
      expect(report.conformance).toBeDefined();
      expect("localConformance" in report ? report.localConformance : undefined).toBeDefined();
      expect("remoteOutcome" in report ? report.remoteOutcome : undefined).toBeUndefined();
      expect("remoteApproved" in report ? report.remoteApproved : undefined).toBeUndefined();
      expect(report.conformance.approved).toBe(true);
      expect(report.conformance.outcome).toBe("approved");
      expect("rawVerifierReport" in report ? report.rawVerifierReport : undefined).toEqual({
        status: "Em Revisão",
      });
    }).pipe(Effect.ensuring(restoreFetch)),
  );

  it.effect("models a 406 untrusted certificate response as a report", () =>
    Effect.gen(function* () {
      const signed = yield* readItiFixture("icp-brasil-ad-rb-signed.pdf");
      const local = yield* localHttpServer(async () => ({
        status: 406,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          errorCode: 406,
          hash: "abc123",
          nome: "Verificador de Conformidade",
        }),
      }));
      yield* installItiFetchRedirect(local.baseUrl);
      const report = yield* validatePdfWithIti({ source: { pdf: signed } }).pipe(
        Effect.provide(signatureHttpClientLive),
      );

      expect(report.validator).toBe("iti.remote");
      expect(report.approved).toBe(false);
      expect(report.outcome).toBe("untrusted_certificate");
      expect("errorCode" in report ? report.errorCode : undefined).toBe(406);
      expect("hash" in report ? report.hash : undefined).toBe("abc123");
      expect("name" in report ? report.name : undefined).toBe("Verificador de Conformidade");
    }).pipe(Effect.ensuring(restoreFetch)),
  );

  it.effect("fails malformed remote JSON with a typed response-shape error", () =>
    Effect.gen(function* () {
      const signed = yield* readItiFixture("icp-brasil-ad-rb-signed.pdf");
      const local = yield* localHttpServer(async () => ({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: "{",
      }));
      yield* installItiFetchRedirect(local.baseUrl);
      const result = yield* Effect.result(
        validatePdfWithIti({ source: { pdf: signed } }).pipe(
          Effect.provide(signatureHttpClientLive),
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(SignatureKitErrorCodeValue.responseShape);
        expect(result.failure.schemaName).toBe("ItiRemoteResponse");
      }
    }).pipe(Effect.ensuring(restoreFetch)),
  );

  it.effect("downloads URL sources before submitting them", () =>
    Effect.gen(function* () {
      const signed = yield* readItiFixture("icp-brasil-ad-rb-signed.pdf");
      const local = yield* localHttpServer(async (request) => {
        if (request.pathname === "/source.pdf") {
          return { status: 200, headers: { "Content-Type": "application/pdf" }, body: signed };
        }
        return {
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verifierReport: { status: "Aprovado" } }),
        };
      });
      yield* installItiFetchRedirect(local.baseUrl);
      const report = yield* validatePdfWithIti({
        source: { url: `${local.baseUrl}/source.pdf` },
        fileName: "from-url.pdf",
      }).pipe(Effect.provide(signatureHttpClientLive));
      const getRequest = local.requests.find((request) => request.pathname === "/source.pdf");
      const postRequest = local.requests.find((request) => request.pathname === "/arquivo");

      expect(report.outcome).toBe("approved");
      expect(getRequest).toBeDefined();
      expect(postRequest).toBeDefined();
      if (postRequest === undefined) return;
      expect(postRequest.body).toContain('filename="from-url.pdf"');
      expect(postRequest.body).toContain("%PDF");
    }).pipe(Effect.ensuring(restoreFetch)),
  );
});
