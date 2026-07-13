import { PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "@effect/vitest";
import { readFile } from "node:fs/promises";
import { a1SignaturesLayer, loadA1SignerAdapter } from "@signature-kit/a1/signer";
import { CmsOid } from "@signature-kit/cms/config";
import { IcpBrasilPadesPolicy } from "@signature-kit/cms/icp-brasil";
import { verifyDetachedSignedData } from "@signature-kit/cms/verify";
import { extractPdfSignature } from "@signature-kit/pdf/byte-range";
import { signPdf } from "@signature-kit/pdf/sign";
import { SignatureKitErrorCodeValue } from "@signature-kit/signatures";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import * as asn1js from "asn1js";
import { Effect, Redacted, Result } from "effect";
import * as pkijs from "pkijs";
import { validatePdfConformance } from "../src/conformance";

const PFX_PASSWORD = Redacted.make("changeit");
const FIXED_DATE = new Date("2026-01-02T03:04:05Z");
const SHA256_OID = "2.16.840.1.101.3.4.2.1";

type CmsMutation = (signedData: pkijs.SignedData, signerInfo: pkijs.SignerInfo) => void;

const fixturePdf = Effect.promise(
  async () =>
    new Uint8Array(
      await readFile(new URL("./fixtures/icp-brasil-ad-rb-signed.pdf", import.meta.url)),
    ),
);

const toBufferSource = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => toBufferSource(bytes).buffer;

const createPdf = Effect.promise(async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("SignatureKit ITI hardening fixture", { x: 24, y: 140, size: 12, font });
  document.setCreationDate(FIXED_DATE);
  document.setModificationDate(FIXED_DATE);
  return new Uint8Array(await document.save({ useObjectStreams: false }));
});

const createSignedPades = () =>
  Effect.gen(function* () {
    const pfx = yield* readA1Fixture("ecnpj");
    const adapter = yield* loadA1SignerAdapter({ pfx, password: PFX_PASSWORD });
    const signingKey = yield* adapter.importSigningKey("rsa-sha256");
    const pdf = yield* signPdf({
      pdf: yield* createPdf,
      policy: "pades-icp-brasil",
      signatureLength: 32768,
      signingTime: FIXED_DATE,
      reason: "SignatureKit ITI hardening fixture",
      name: "SignatureKit ITI",
      location: "BR",
    }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PFX_PASSWORD })));
    return { pdf, pfx, signingKey };
  });

const parseCms = (cms: Uint8Array) => {
  const parsed = asn1js.fromBER(toArrayBuffer(cms));
  const contentInfo = new pkijs.ContentInfo({ schema: parsed.result });
  return {
    contentInfo,
    signedData: new pkijs.SignedData({ schema: contentInfo.content }),
  };
};

const signedAttribute = (signerInfo: pkijs.SignerInfo, type: string): pkijs.Attribute => {
  const attribute = signerInfo.signedAttrs?.attributes.find((candidate) => candidate.type === type);
  if (attribute === undefined) throw new Error(`Missing CMS signed attribute ${type}.`);
  return attribute;
};

const replaceCmsContents = (
  pdf: Uint8Array,
  original: Uint8Array,
  replacement: Uint8Array,
): Uint8Array => {
  const text = Buffer.from(pdf).toString("latin1");
  const originalHex = Buffer.from(original).toString("hex");
  const replacementHex = Buffer.from(replacement).toString("hex");
  const markerStart = text.indexOf(`<${originalHex}`);
  if (markerStart === -1) throw new Error("Failed to locate original CMS contents.");
  const payloadStart = markerStart + 1;
  const payloadEnd = text.indexOf(">", payloadStart);
  if (payloadEnd <= payloadStart) throw new Error("Failed to locate CMS contents terminator.");
  const payloadLength = payloadEnd - payloadStart;
  if (replacementHex.length > payloadLength)
    throw new Error("Replacement CMS exceeds PDF contents.");
  const paddedReplacement = `${replacementHex}${"0".repeat(payloadLength - replacementHex.length)}`;
  return new Uint8Array(
    Buffer.from(
      `${text.slice(0, payloadStart)}${paddedReplacement}${text.slice(payloadEnd)}`,
      "latin1",
    ),
  );
};

const resignCms = (
  cms: Uint8Array,
  content: Uint8Array,
  signingKey: CryptoKey,
  mutation: CmsMutation,
): Effect.Effect<Uint8Array> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.sync(() => parseCms(cms));
    const signerInfo = parsed.signedData.signerInfos[0];
    if (signerInfo === undefined) {
      return yield* Effect.die("CMS fixture does not contain a first SignerInfo.");
    }
    yield* Effect.promise(async () => {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", toBufferSource(content)));
      const messageDigest = signedAttribute(signerInfo, CmsOid.messageDigest);
      messageDigest.values = [new asn1js.OctetString({ valueHex: toArrayBuffer(digest) })];
      mutation(parsed.signedData, signerInfo);
      if (signerInfo.signedAttrs !== undefined)
        signerInfo.signedAttrs.encodedValue = new ArrayBuffer(0);
      await parsed.signedData.sign(signingKey, 0, "SHA-256", toBufferSource(content));
    });
    return yield* Effect.sync(() => {
      parsed.contentInfo.content = parsed.signedData.toSchema(true);
      return new Uint8Array(parsed.contentInfo.toSchema().toBER(false));
    });
  });

const signingCertificateV2Value = (signerInfo: pkijs.SignerInfo): asn1js.Sequence => {
  const value = signedAttribute(signerInfo, CmsOid.signingCertificateV2).values[0];
  if (!(value instanceof asn1js.Sequence)) {
    throw new Error("SigningCertificateV2 attribute is not a sequence.");
  }
  return value;
};

const signingCertificateV2Certificates = (signerInfo: pkijs.SignerInfo): asn1js.Sequence => {
  const certificates = signingCertificateV2Value(signerInfo).valueBlock.value[0];
  if (!(certificates instanceof asn1js.Sequence)) {
    throw new Error("SigningCertificateV2 certificate list is not a sequence.");
  }
  return certificates;
};

const firstEssCertIdV2 = (signerInfo: pkijs.SignerInfo): asn1js.Sequence => {
  const entry = signingCertificateV2Certificates(signerInfo).valueBlock.value[0];
  if (!(entry instanceof asn1js.Sequence)) {
    throw new Error("SigningCertificateV2 certificate entry is not a sequence.");
  }
  return entry;
};

const issuerSerialForSigner = (signerInfo: pkijs.SignerInfo): asn1js.Sequence => {
  const signerIdentifier = signerInfo.sid;
  if (!(signerIdentifier instanceof pkijs.IssuerAndSerialNumber)) {
    throw new Error("CMS signer does not use issuer and serial number.");
  }
  return new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [
          new asn1js.Constructed({
            idBlock: { tagClass: 3, tagNumber: 4 },
            value: [signerIdentifier.issuer.toSchema()],
          }),
        ],
      }),
      signerIdentifier.serialNumber,
    ],
  });
};

const assertCmsValid = (pdf: Uint8Array) =>
  Effect.gen(function* () {
    const extracted = yield* extractPdfSignature(pdf);
    const verified = yield* verifyDetachedSignedData({
      cms: extracted.signature,
      content: extracted.signedData,
    });
    expect(verified.valid).toBe(true);
    return extracted;
  });

const shortenFirstByteRange = (pdf: Uint8Array, amount: number): Uint8Array => {
  const text = Buffer.from(pdf).toString("latin1");
  const match = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);
  const rangeEnd = match?.[4];
  if (match === null || rangeEnd === undefined || Number(rangeEnd) <= amount) {
    throw new Error("Failed to locate a reducible PDF ByteRange.");
  }
  const replacement = String(Number(rangeEnd) - amount).padStart(rangeEnd.length, "0");
  const tokenStart = match.index + match[0].lastIndexOf(rangeEnd);
  return new Uint8Array(
    Buffer.from(
      `${text.slice(0, tokenStart)}${replacement}${text.slice(tokenStart + rangeEnd.length)}`,
      "latin1",
    ),
  );
};

const outOfBoundsFirstByteRange = (pdf: Uint8Array): Uint8Array => {
  const text = Buffer.from(pdf).toString("latin1");
  const match = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);
  const rangeEnd = match?.[4];
  if (match === null || rangeEnd === undefined)
    throw new Error("Failed to locate a PDF ByteRange.");
  const replacement = "9".repeat(rangeEnd.length);
  const tokenStart = match.index + match[0].lastIndexOf(rangeEnd);
  return new Uint8Array(
    Buffer.from(
      `${text.slice(0, tokenStart)}${replacement}${text.slice(tokenStart + rangeEnd.length)}`,
      "latin1",
    ),
  );
};

const removeFirstByteRangeKey = (pdf: Uint8Array): Uint8Array => {
  const text = Buffer.from(pdf).toString("latin1");
  const offset = text.indexOf("/ByteRange");
  if (offset === -1) throw new Error("Failed to locate a PDF ByteRange key.");
  return new Uint8Array(
    Buffer.from(
      `${text.slice(0, offset)}/NoRange__${text.slice(offset + "/ByteRange".length)}`,
      "latin1",
    ),
  );
};

const createNonPdfEnvelope = (
  cms: Uint8Array,
  signingKey: CryptoKey,
): Effect.Effect<{
  readonly pdf: Uint8Array;
  readonly cms: Uint8Array;
  readonly content: Uint8Array;
}> =>
  Effect.gen(function* () {
    const contentsLength = cms.byteLength * 2 + 512;
    const placeholderRange = "/ByteRange [0000000000 0000000000 0000000000 0000000000]";
    const template =
      `Not a PDF envelope\n1 0 obj << /Type /Sig ${placeholderRange} /Contents <` +
      `${"0".repeat(contentsLength)}> >>\nendobj\n`;
    const contentsStart = template.indexOf("<", template.indexOf("/Contents"));
    const contentsEnd = template.indexOf(">", contentsStart);
    if (contentsStart === -1 || contentsEnd === -1) {
      return yield* Effect.die("Failed to construct non-PDF contents range.");
    }
    const byteRange = [0, contentsStart, contentsEnd + 1, template.length - (contentsEnd + 1)];
    const [firstOffset, firstLength, secondOffset, secondLength] = byteRange;
    if (
      firstOffset === undefined ||
      firstLength === undefined ||
      secondOffset === undefined ||
      secondLength === undefined
    ) {
      return yield* Effect.die("Failed to construct non-PDF contents range.");
    }
    const renderedRange = `/ByteRange [${byteRange.map((value) => String(value).padStart(10, "0")).join(" ")}]`;
    const ranged = template.replace(placeholderRange, renderedRange);
    const rangedBytes = new Uint8Array(Buffer.from(ranged, "latin1"));
    const content = new Uint8Array(firstLength + secondLength);
    content.set(rangedBytes.subarray(firstOffset, firstOffset + firstLength));
    content.set(rangedBytes.subarray(secondOffset, secondOffset + secondLength), firstLength);
    const resigned = yield* resignCms(cms, content, signingKey, () => undefined);
    const resignedHex = Buffer.from(resigned).toString("hex");
    if (resignedHex.length > contentsLength) {
      return yield* Effect.die("Re-signed CMS exceeded the non-PDF contents range.");
    }
    const payloadStart = contentsStart + 1;
    const pdf = new Uint8Array(
      Buffer.from(
        `${ranged.slice(0, payloadStart)}${resignedHex}${"0".repeat(contentsLength - resignedHex.length)}${ranged.slice(contentsEnd)}`,
        "latin1",
      ),
    );
    return { pdf, cms: resigned, content };
  });

const setFirstByteRangeEnd = (pdf: Uint8Array, rangeEnd: number): Uint8Array => {
  const text = Buffer.from(pdf).toString("latin1");
  const match = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);
  const third = match?.[3];
  const fourth = match?.[4];
  if (match === null || third === undefined || fourth === undefined || rangeEnd <= Number(third)) {
    throw new Error("Failed to locate a mutable PDF ByteRange.");
  }
  const replacement = String(rangeEnd - Number(third)).padStart(fourth.length, "0");
  const tokenStart = match.index + match[0].lastIndexOf(fourth);
  return new Uint8Array(
    Buffer.from(
      `${text.slice(0, tokenStart)}${replacement}${text.slice(tokenStart + fourth.length)}`,
      "latin1",
    ),
  );
};

const appendFakeRevisionMarkerInsideStream = (pdf: Uint8Array) =>
  Effect.promise(async () => {
    const filler = "x".repeat(1024);
    const document = await PDFDocument.load(pdf, {
      forIncrementalUpdate: true,
      updateMetadata: false,
    });
    document.context.register(document.context.stream(filler));
    const revised = new Uint8Array(
      await document.save({ useObjectStreams: false, updateFieldAppearances: false }),
    );
    const text = Buffer.from(revised).toString("latin1");
    const xrefOffset = text.lastIndexOf(filler);
    if (xrefOffset === -1) throw new Error("Failed to locate appended raw PDF stream.");
    const marker = `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 >>\nstartxref\n${xrefOffset}\n%%EOF`;
    if (marker.length > filler.length) throw new Error("Fake revision marker exceeds raw stream.");
    return {
      pdf: new Uint8Array(
        Buffer.from(
          `${text.slice(0, xrefOffset)}${marker}${"x".repeat(filler.length - marker.length)}${text.slice(xrefOffset + filler.length)}`,
          "latin1",
        ),
      ),
      rangeEnd: xrefOffset + marker.length,
    };
  });

const signedDataForByteRange = (
  pdf: Uint8Array,
  byteRange: readonly [number, number, number, number],
): Uint8Array => {
  const signedData = new Uint8Array(byteRange[1] + byteRange[3]);
  signedData.set(pdf.subarray(byteRange[0], byteRange[0] + byteRange[1]));
  signedData.set(pdf.subarray(byteRange[2], byteRange[2] + byteRange[3]), byteRange[1]);
  return signedData;
};

const removeFirstSignatureFieldValue = (pdf: Uint8Array): Uint8Array => {
  const text = Buffer.from(pdf).toString("latin1");
  const value = /\/V\s+\d+\s+\d+\s+R/.exec(text);
  if (value === null) throw new Error("Failed to locate a signature field value.");
  return new Uint8Array(
    Buffer.from(`${text.slice(0, value.index)}/X${text.slice(value.index + 2)}`, "latin1"),
  );
};

const restoreSignatureFieldValue = (pdf: Uint8Array) =>
  Effect.promise(async () => {
    const text = Buffer.from(pdf).toString("latin1");
    const value = /\/X\s+(\d+)\s+(\d+)\s+R/.exec(text);
    const objectNumber = value?.[1];
    const generationNumber = value?.[2];
    if (objectNumber === undefined || generationNumber === undefined) {
      throw new Error("Failed to locate an orphaned signature field reference.");
    }
    const reference = PDFRef.of(Number(objectNumber), Number(generationNumber));
    const document = await PDFDocument.load(pdf, {
      forIncrementalUpdate: true,
      updateMetadata: false,
    });
    let field: PDFDict | undefined;
    for (const [objectRef, object] of document.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict)) continue;
      const candidateField = document.context.lookup(objectRef, PDFDict);
      const candidate = candidateField.get(PDFName.of("X"));
      if (!(candidate instanceof PDFRef) || candidate.tag !== reference.tag) continue;
      field = candidateField;
      break;
    }
    if (field === undefined) throw new Error("Failed to locate the orphaned signature field.");
    field.set(PDFName.of("V"), reference);
    field.delete(PDFName.of("X"));
    return new Uint8Array(
      await document.save({ useObjectStreams: false, updateFieldAppearances: false }),
    );
  });

describe("ITI local conformance hardening", () => {
  it.effect("approves the committed AD-RB fixture with the pinned policy encoding", () =>
    Effect.gen(function* () {
      const pdf = yield* fixturePdf;
      const report = yield* validatePdfConformance({ pdf });
      const extracted = yield* extractPdfSignature(pdf);
      const parsed = parseCms(extracted.signature);
      const signerInfo = parsed.signedData.signerInfos[0];
      if (signerInfo === undefined) return yield* Effect.die("Fixture has no SignerInfo.");
      const policy = signedAttribute(signerInfo, CmsOid.signaturePolicy).values[0];
      if (!(policy instanceof asn1js.Sequence)) {
        return yield* Effect.die("Fixture policy is not a SignaturePolicyId sequence.");
      }
      const hash = policy.valueBlock.value[1];
      if (!(hash instanceof asn1js.Sequence)) {
        return yield* Effect.die("Fixture policy hash is not an OtherHashAlgAndValue sequence.");
      }
      const algorithm = hash.valueBlock.value[0];
      const digest = hash.valueBlock.value[1];
      if (!(algorithm instanceof asn1js.Sequence) || !(digest instanceof asn1js.OctetString)) {
        return yield* Effect.die("Fixture policy hash is malformed.");
      }
      const algorithmOid = algorithm.valueBlock.value[0];
      if (!(algorithmOid instanceof asn1js.ObjectIdentifier)) {
        return yield* Effect.die("Fixture policy hash has no algorithm OID.");
      }

      expect(report.approved).toBe(true);
      expect(report.outcome).toBe("approved");
      expect(
        report.signatures[0]?.attributes.map((attribute) => [attribute.name, attribute.status]),
      ).toEqual([
        ["IdMessageDigest", "Valid"],
        ["IdContentType", "Valid"],
        ["IdAaEtsSigPolicyId", "Valid"],
        ["IdAaSigningCertificateV2", "Valid"],
        ["SignatureDictionary", "Valid"],
        ["signingTime", "Valid"],
      ]);
      expect(algorithmOid.valueBlock.toString()).toBe(SHA256_OID);
      expect(Buffer.from(digest.valueBlock.valueHexView)).toEqual(
        Buffer.from(IcpBrasilPadesPolicy.adRbV11.policyHash),
      );
    }),
  );

  it.effect("rejects a non-PDF envelope even when its detached CMS is valid", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const envelope = yield* createNonPdfEnvelope(extracted.signature, signed.signingKey);
      const cmsVerification = yield* verifyDetachedSignedData({
        cms: envelope.cms,
        content: envelope.content,
      });
      const result = yield* Effect.result(validatePdfConformance({ pdf: envelope.pdf }));

      expect(cmsVerification.valid).toBe(true);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(SignatureKitErrorCodeValue.verifyFailed);
        expect(result.failure.operation).toBe("iti.conformance");
      }
    }),
  );

  it.effect("keeps a structurally valid unsigned PDF distinct from a malformed signed PDF", () =>
    Effect.gen(function* () {
      const unsigned = yield* createPdf;
      const unsignedReport = yield* validatePdfConformance({ pdf: unsigned });
      const signed = yield* createSignedPades();
      const malformedResult = yield* Effect.result(
        validatePdfConformance({ pdf: outOfBoundsFirstByteRange(signed.pdf) }),
      );

      expect(unsignedReport.approved).toBe(false);
      expect(unsignedReport.signatureCount).toBe(0);
      expect(unsignedReport.signatures).toEqual([]);
      expect(Result.isFailure(malformedResult)).toBe(true);
      if (Result.isFailure(malformedResult)) {
        expect(malformedResult.failure.code).toBe(SignatureKitErrorCodeValue.verifyFailed);
        expect(malformedResult.failure.operation).toBe("iti.conformance");
      }
    }),
  );

  it.effect("rejects a parsed signature dictionary missing its ByteRange", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const result = yield* Effect.result(
        validatePdfConformance({ pdf: removeFirstByteRangeKey(signed.pdf) }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(SignatureKitErrorCodeValue.verifyFailed);
        expect(result.failure.operation).toBe("iti.conformance");
      }
    }),
  );

  it.effect("rejects a prior signature whose ByteRange ends before its complete revision", () =>
    Effect.gen(function* () {
      const first = yield* createSignedPades();
      const shortened = shortenFirstByteRange(first.pdf, 8);
      const result = yield* Effect.result(validatePdfConformance({ pdf: shortened }));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(SignatureKitErrorCodeValue.verifyFailed);
        expect(result.failure.operation).toBe("iti.conformance");
      }
    }),
  );

  it.effect("rejects a ByteRange ending at fake revision markers inside a stream", () =>
    Effect.gen(function* () {
      const first = yield* createSignedPades();
      const fakeRevision = yield* appendFakeRevisionMarkerInsideStream(first.pdf);
      const adjusted = setFirstByteRangeEnd(fakeRevision.pdf, fakeRevision.rangeEnd);
      const result = yield* Effect.result(validatePdfConformance({ pdf: adjusted }));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(SignatureKitErrorCodeValue.verifyFailed);
        expect(result.failure.operation).toBe("iti.conformance");
      }
    }),
  );

  it.effect("rejects an orphan signature dictionary with a valid detached CMS", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const orphaned = removeFirstSignatureFieldValue(signed.pdf);
      const content = signedDataForByteRange(orphaned, extracted.byteRange);
      const repairedCms = yield* resignCms(
        extracted.signature,
        content,
        signed.signingKey,
        () => undefined,
      );
      const forgedPdf = replaceCmsContents(orphaned, extracted.signature, repairedCms);
      const cmsVerification = yield* verifyDetachedSignedData({
        cms: repairedCms,
        content,
      });
      const result = yield* Effect.result(validatePdfConformance({ pdf: forgedPdf }));

      expect(cmsVerification.valid).toBe(true);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(SignatureKitErrorCodeValue.verifyFailed);
        expect(result.failure.operation).toBe("iti.conformance");
      }
    }),
  );

  it.effect("excludes a signature attached only in a later revision", () =>
    Effect.gen(function* () {
      const first = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(first.pdf);
      const orphaned = removeFirstSignatureFieldValue(first.pdf);
      const content = signedDataForByteRange(orphaned, extracted.byteRange);
      const repairedCms = yield* resignCms(
        extracted.signature,
        content,
        first.signingKey,
        () => undefined,
      );
      const orphanedFirst = replaceCmsContents(orphaned, extracted.signature, repairedCms);
      const lateAttachment = yield* restoreSignatureFieldValue(orphanedFirst);
      const second = yield* signPdf({
        pdf: lateAttachment,
        policy: "pades-icp-brasil",
        signatureLength: 32768,
        signingTime: FIXED_DATE,
        reason: "Revision-aware reachability fixture",
        name: "SignatureKit ITI",
        location: "BR",
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx: first.pfx, password: PFX_PASSWORD })));
      const firstVerification = yield* verifyDetachedSignedData({
        cms: repairedCms,
        content,
      });
      const report = yield* validatePdfConformance({ pdf: second });

      expect(firstVerification.valid).toBe(true);
      expect(report.approved).toBe(true);
      expect(report.signatureCount).toBe(1);
      expect(report.signatures).toHaveLength(1);
      expect(report.signatures[0]?.structure.status).toBe("Valid");
    }),
  );

  it.effect("rejects a CMS signature dictionary containing more than one SignerInfo", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const forgedCms = yield* resignCms(
        extracted.signature,
        extracted.signedData,
        signed.signingKey,
        (signedData, signerInfo) => {
          const forgedSigner = new pkijs.SignerInfo({ schema: signerInfo.toSchema() });
          forgedSigner.signature = new asn1js.OctetString({
            valueHex: toArrayBuffer(
              new Uint8Array(forgedSigner.signature.valueBlock.valueHexView.byteLength),
            ),
          });
          signedData.signerInfos.push(forgedSigner);
        },
      );
      const forgedPdf = replaceCmsContents(signed.pdf, extracted.signature, forgedCms);
      const report = yield* validatePdfConformance({ pdf: forgedPdf });

      expect(report.approved).toBe(false);
      expect(report.signatureCount).toBe(1);
      expect(report.signatures[0]?.structure).toEqual({
        status: "Invalid",
        message: "O CMS deve conter exatamente um SignerInfo por dicionário de assinatura PDF.",
      });
      expect(report.signatures[0]?.cipher.status).toBe("Invalid");
    }),
  );

  it.effect("rejects a re-signed content-type attribute with extra or wrong values", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const forgedCms = yield* resignCms(
        extracted.signature,
        extracted.signedData,
        signed.signingKey,
        (_signedData, signerInfo) => {
          const contentType = signedAttribute(signerInfo, CmsOid.contentType);
          contentType.values = [
            new asn1js.ObjectIdentifier({ value: "1.2.3" }),
            new asn1js.ObjectIdentifier({ value: CmsOid.data }),
          ];
        },
      );
      const forgedPdf = replaceCmsContents(signed.pdf, extracted.signature, forgedCms);
      yield* assertCmsValid(forgedPdf);
      const report = yield* validatePdfConformance({ pdf: forgedPdf });

      expect(report.approved).toBe(false);
      expect(report.signatures[0]?.cipher.status).toBe("Valid");
      expect(report.signatures[0]?.attributes).toContainEqual({
        name: "IdContentType",
        status: "Invalid",
        message: "A assinatura não contém IdContentType apontando para id-data.",
      });
    }),
  );

  it.effect("rejects a re-signed duplicate messageDigest attribute", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const forgedCms = yield* resignCms(
        extracted.signature,
        extracted.signedData,
        signed.signingKey,
        (_signedData, signerInfo) => {
          const attributes = signerInfo.signedAttrs?.attributes;
          if (attributes === undefined) throw new Error("Missing CMS signed attributes.");
          attributes.push(
            new pkijs.Attribute({
              type: CmsOid.messageDigest,
              values: [new asn1js.OctetString({ valueHex: toArrayBuffer(new Uint8Array(32)) })],
            }),
          );
        },
      );
      const forgedPdf = replaceCmsContents(signed.pdf, extracted.signature, forgedCms);
      yield* assertCmsValid(forgedPdf);
      const report = yield* validatePdfConformance({ pdf: forgedPdf });

      expect(report.approved).toBe(false);
      expect(report.signatures[0]?.cipher.status).toBe("Valid");
      expect(report.signatures[0]?.attributes).toContainEqual({
        name: "IdMessageDigest",
        status: "Invalid",
        message:
          "A assinatura não contém exatamente um atributo IdMessageDigest codificado como OCTET STRING.",
      });
    }),
  );

  it.effect("rejects a re-signed AD-RB policy with an unpinned digest", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const forgedCms = yield* resignCms(
        extracted.signature,
        extracted.signedData,
        signed.signingKey,
        (_signedData, signerInfo) => {
          const policy = signedAttribute(signerInfo, CmsOid.signaturePolicy).values[0];
          if (!(policy instanceof asn1js.Sequence)) {
            throw new Error("Policy attribute is not a sequence.");
          }
          const policyHash = policy.valueBlock.value[1];
          if (!(policyHash instanceof asn1js.Sequence)) {
            throw new Error("Policy hash is not a sequence.");
          }
          policyHash.valueBlock.value[1] = new asn1js.OctetString({
            valueHex: toArrayBuffer(new Uint8Array(32)),
          });
        },
      );
      const forgedPdf = replaceCmsContents(signed.pdf, extracted.signature, forgedCms);
      yield* assertCmsValid(forgedPdf);
      const report = yield* validatePdfConformance({ pdf: forgedPdf });

      expect(report.approved).toBe(false);
      expect(report.signatures[0]?.policyOid).toBeNull();
      expect(report.signatures[0]?.attributes).toContainEqual({
        name: "IdAaEtsSigPolicyId",
        status: "Invalid",
        message: "A assinatura não contém a política ICP-Brasil PAdES AD-RB 2.16.76.1.7.1.11.1.1.",
      });
    }),
  );

  it.effect("rejects a re-signed AD-RB policy with malformed qualifier encoding", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const forgedCms = yield* resignCms(
        extracted.signature,
        extracted.signedData,
        signed.signingKey,
        (_signedData, signerInfo) => {
          const policy = signedAttribute(signerInfo, CmsOid.signaturePolicy).values[0];
          if (!(policy instanceof asn1js.Sequence)) {
            throw new Error("Policy attribute is not a sequence.");
          }
          const qualifiers = policy.valueBlock.value[2];
          if (!(qualifiers instanceof asn1js.Sequence)) {
            throw new Error("Policy qualifiers are not a sequence.");
          }
          const qualifier = qualifiers.valueBlock.value[0];
          if (!(qualifier instanceof asn1js.Sequence)) {
            throw new Error("Policy qualifier is not a sequence.");
          }
          qualifier.valueBlock.value[1] = new asn1js.Utf8String({
            value: IcpBrasilPadesPolicy.adRbV11.policyUri,
          });
        },
      );
      const forgedPdf = replaceCmsContents(signed.pdf, extracted.signature, forgedCms);
      yield* assertCmsValid(forgedPdf);
      const report = yield* validatePdfConformance({ pdf: forgedPdf });

      expect(report.approved).toBe(false);
      expect(report.signatures[0]?.attributes).toContainEqual({
        name: "IdAaEtsSigPolicyId",
        status: "Invalid",
        message: "A assinatura não contém a política ICP-Brasil PAdES AD-RB 2.16.76.1.7.1.11.1.1.",
      });
    }),
  );

  it.effect("approves a re-signed AD-RB policy without optional qualifiers", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const resignedCms = yield* resignCms(
        extracted.signature,
        extracted.signedData,
        signed.signingKey,
        (_signedData, signerInfo) => {
          const policyAttribute = signedAttribute(signerInfo, CmsOid.signaturePolicy);
          const policy = policyAttribute.values[0];
          if (!(policy instanceof asn1js.Sequence)) {
            throw new Error("Policy attribute is not a sequence.");
          }
          const policyAttributeLength = policyAttribute.toSchema().toBER(false).byteLength;
          policy.valueBlock.value.pop();
          policy.lenBlock.longFormUsed = false;
          const removedLength =
            policyAttributeLength - policyAttribute.toSchema().toBER(false).byteLength;
          let paddingAttribute: pkijs.Attribute | undefined;
          for (let length = 0; length <= removedLength; length += 1) {
            const candidate = new pkijs.Attribute({
              type: "1.3.6.1.4.1.99999.1",
              values: [
                new asn1js.OctetString({
                  valueHex: toArrayBuffer(new Uint8Array(length)),
                }),
              ],
            });
            if (candidate.toSchema().toBER(false).byteLength === removedLength) {
              paddingAttribute = candidate;
              break;
            }
          }
          if (paddingAttribute === undefined || signerInfo.signedAttrs === undefined) {
            throw new Error("Failed to preserve the re-signed CMS length.");
          }
          signerInfo.signedAttrs.attributes.push(paddingAttribute);
        },
      );
      const resignedPdf = replaceCmsContents(signed.pdf, extracted.signature, resignedCms);
      yield* assertCmsValid(resignedPdf);
      const report = yield* validatePdfConformance({ pdf: resignedPdf });

      expect(report.approved).toBe(true);
      expect(report.signatures[0]?.attributes).toContainEqual({
        name: "IdAaEtsSigPolicyId",
        status: "Valid",
      });
    }),
  );

  it.effect("rejects a re-signed AD-RB policy with duplicate qualifiers", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const forgedCms = yield* resignCms(
        extracted.signature,
        extracted.signedData,
        signed.signingKey,
        (_signedData, signerInfo) => {
          const policy = signedAttribute(signerInfo, CmsOid.signaturePolicy).values[0];
          if (!(policy instanceof asn1js.Sequence)) {
            throw new Error("Policy attribute is not a sequence.");
          }
          const qualifiers = policy.valueBlock.value[2];
          if (!(qualifiers instanceof asn1js.Sequence)) {
            throw new Error("Policy qualifiers are not a sequence.");
          }
          const qualifier = qualifiers.valueBlock.value[0];
          if (!(qualifier instanceof asn1js.Sequence)) {
            throw new Error("Policy qualifier is not a sequence.");
          }
          const copied = asn1js.fromBER(
            toArrayBuffer(new Uint8Array(qualifier.toBER(false))),
          ).result;
          if (!(copied instanceof asn1js.Sequence)) {
            throw new Error("Failed to copy policy qualifier.");
          }
          qualifiers.valueBlock.value.push(copied);
        },
      );
      const forgedPdf = replaceCmsContents(signed.pdf, extracted.signature, forgedCms);
      yield* assertCmsValid(forgedPdf);
      const report = yield* validatePdfConformance({ pdf: forgedPdf });

      expect(report.approved).toBe(false);
      expect(report.signatures[0]?.attributes).toContainEqual({
        name: "IdAaEtsSigPolicyId",
        status: "Invalid",
        message: "A assinatura não contém a política ICP-Brasil PAdES AD-RB 2.16.76.1.7.1.11.1.1.",
      });
    }),
  );

  it.effect("rejects a re-signed SigningCertificateV2 hash that does not bind the signer", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const forgedCms = yield* resignCms(
        extracted.signature,
        extracted.signedData,
        signed.signingKey,
        (_signedData, signerInfo) => {
          const signingCertificate = signedAttribute(signerInfo, CmsOid.signingCertificateV2)
            .values[0];
          if (!(signingCertificate instanceof asn1js.Sequence)) {
            throw new Error("SigningCertificateV2 attribute is not a sequence.");
          }
          const certificates = signingCertificate.valueBlock.value[0];
          if (!(certificates instanceof asn1js.Sequence)) {
            throw new Error("SigningCertificateV2 certificate list is not a sequence.");
          }
          const essCertId = certificates.valueBlock.value[0];
          if (!(essCertId instanceof asn1js.Sequence)) {
            throw new Error("SigningCertificateV2 certificate entry is not a sequence.");
          }
          const hashIndex = essCertId.valueBlock.value[0] instanceof asn1js.OctetString ? 0 : 1;
          essCertId.valueBlock.value[hashIndex] = new asn1js.OctetString({
            valueHex: toArrayBuffer(new Uint8Array(32)),
          });
        },
      );
      const forgedPdf = replaceCmsContents(signed.pdf, extracted.signature, forgedCms);
      yield* assertCmsValid(forgedPdf);
      const report = yield* validatePdfConformance({ pdf: forgedPdf });

      expect(report.approved).toBe(false);
      expect(report.signatures[0]?.attributes).toContainEqual({
        name: "IdAaSigningCertificateV2",
        status: "Invalid",
        message:
          "A assinatura não contém IdAaSigningCertificateV2 vinculado ao certificado do signatário.",
      });
    }),
  );

  it.effect("rejects a correct first ESSCertIDv2 followed by an extra entry", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const forgedCms = yield* resignCms(
        extracted.signature,
        extracted.signedData,
        signed.signingKey,
        (_signedData, signerInfo) => {
          const first = firstEssCertIdV2(signerInfo);
          const copied = asn1js.fromBER(toArrayBuffer(new Uint8Array(first.toBER(false)))).result;
          if (!(copied instanceof asn1js.Sequence)) {
            throw new Error("Failed to copy SigningCertificateV2 certificate entry.");
          }
          signingCertificateV2Certificates(signerInfo).valueBlock.value.push(copied);
        },
      );
      const forgedPdf = replaceCmsContents(signed.pdf, extracted.signature, forgedCms);
      yield* assertCmsValid(forgedPdf);
      const report = yield* validatePdfConformance({ pdf: forgedPdf });

      expect(report.approved).toBe(false);
      expect(report.signatures[0]?.attributes).toContainEqual({
        name: "IdAaSigningCertificateV2",
        status: "Invalid",
        message:
          "A assinatura não contém IdAaSigningCertificateV2 vinculado ao certificado do signatário.",
      });
    }),
  );

  it.effect("approves a re-signed SigningCertificateV2 with omitted issuerSerial", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const resignedCms = yield* resignCms(
        extracted.signature,
        extracted.signedData,
        signed.signingKey,
        () => undefined,
      );
      const resignedPdf = replaceCmsContents(signed.pdf, extracted.signature, resignedCms);
      yield* assertCmsValid(resignedPdf);
      const report = yield* validatePdfConformance({ pdf: resignedPdf });

      expect(
        report.signatures[0]?.attributes.map((attribute) => [attribute.name, attribute.status]),
      ).toEqual([
        ["IdMessageDigest", "Valid"],
        ["IdContentType", "Valid"],
        ["IdAaEtsSigPolicyId", "Valid"],
        ["IdAaSigningCertificateV2", "Valid"],
        ["SignatureDictionary", "Valid"],
        ["signingTime", "Valid"],
      ]);
      expect(report.approved).toBe(true);
    }),
  );

  it.effect("approves a re-signed SigningCertificateV2 with matching issuerSerial", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const resignedCms = yield* resignCms(
        extracted.signature,
        extracted.signedData,
        signed.signingKey,
        (_signedData, signerInfo) => {
          firstEssCertIdV2(signerInfo).valueBlock.value.push(issuerSerialForSigner(signerInfo));
        },
      );
      const resignedPdf = replaceCmsContents(signed.pdf, extracted.signature, resignedCms);
      yield* assertCmsValid(resignedPdf);
      const report = yield* validatePdfConformance({ pdf: resignedPdf });

      expect(report.approved).toBe(true);
      expect(report.signatures[0]?.attributes).toContainEqual({
        name: "IdAaSigningCertificateV2",
        status: "Valid",
      });
    }),
  );

  it.effect("rejects a re-signed SigningCertificateV2 with a mismatched issuerSerial serial", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const forgedCms = yield* resignCms(
        extracted.signature,
        extracted.signedData,
        signed.signingKey,
        (_signedData, signerInfo) => {
          const issuerSerial = issuerSerialForSigner(signerInfo);
          const serial = issuerSerial.valueBlock.value[1];
          if (!(serial instanceof asn1js.Integer)) {
            throw new Error("IssuerSerial serial number is not an INTEGER.");
          }
          const serialBytes = new Uint8Array(serial.valueBlock.valueHexView);
          const lastByte = serialBytes.length - 1;
          if (lastByte < 0) throw new Error("IssuerSerial serial number is empty.");
          serialBytes[lastByte] = serialBytes[lastByte]! ^ 1;
          issuerSerial.valueBlock.value[1] = new asn1js.Integer({
            valueHex: toArrayBuffer(serialBytes),
          });
          firstEssCertIdV2(signerInfo).valueBlock.value.push(issuerSerial);
        },
      );
      const forgedPdf = replaceCmsContents(signed.pdf, extracted.signature, forgedCms);
      yield* assertCmsValid(forgedPdf);
      const report = yield* validatePdfConformance({ pdf: forgedPdf });

      expect(report.approved).toBe(false);
      expect(report.signatures[0]?.attributes).toContainEqual({
        name: "IdAaSigningCertificateV2",
        status: "Invalid",
        message:
          "A assinatura não contém IdAaSigningCertificateV2 vinculado ao certificado do signatário.",
      });
    }),
  );

  it.effect("rejects a re-signed SigningCertificateV2 with a mismatched issuerSerial issuer", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const forgedCms = yield* resignCms(
        extracted.signature,
        extracted.signedData,
        signed.signingKey,
        (_signedData, signerInfo) => {
          const issuerSerial = issuerSerialForSigner(signerInfo);
          const issuers = issuerSerial.valueBlock.value[0];
          if (!(issuers instanceof asn1js.Sequence)) {
            throw new Error("IssuerSerial issuer names are not a sequence.");
          }
          const issuer = issuers.valueBlock.value[0];
          if (!(issuer instanceof asn1js.Constructed)) {
            throw new Error("IssuerSerial issuer is not a GeneralName.");
          }
          issuer.valueBlock.value = [
            new asn1js.Sequence({
              value: [
                new asn1js.Set({
                  value: [
                    new asn1js.Sequence({
                      value: [
                        new asn1js.ObjectIdentifier({ value: "2.5.4.3" }),
                        new asn1js.Utf8String({ value: "Unrelated issuer" }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ];
          firstEssCertIdV2(signerInfo).valueBlock.value.push(issuerSerial);
        },
      );
      const forgedPdf = replaceCmsContents(signed.pdf, extracted.signature, forgedCms);
      yield* assertCmsValid(forgedPdf);
      const report = yield* validatePdfConformance({ pdf: forgedPdf });

      expect(report.approved).toBe(false);
      expect(report.signatures[0]?.attributes).toContainEqual({
        name: "IdAaSigningCertificateV2",
        status: "Invalid",
        message:
          "A assinatura não contém IdAaSigningCertificateV2 vinculado ao certificado do signatário.",
      });
    }),
  );

  it.effect("rejects a re-signed SigningCertificateV2 with malformed issuerSerial", () =>
    Effect.gen(function* () {
      const signed = yield* createSignedPades();
      const extracted = yield* extractPdfSignature(signed.pdf);
      const forgedCms = yield* resignCms(
        extracted.signature,
        extracted.signedData,
        signed.signingKey,
        (_signedData, signerInfo) => {
          const issuerSerial = issuerSerialForSigner(signerInfo);
          issuerSerial.valueBlock.value[1] = new asn1js.OctetString({
            valueHex: toArrayBuffer(new Uint8Array([1])),
          });
          firstEssCertIdV2(signerInfo).valueBlock.value.push(issuerSerial);
        },
      );
      const forgedPdf = replaceCmsContents(signed.pdf, extracted.signature, forgedCms);
      yield* assertCmsValid(forgedPdf);
      const report = yield* validatePdfConformance({ pdf: forgedPdf });

      expect(report.approved).toBe(false);
      expect(report.signatures[0]?.attributes).toContainEqual({
        name: "IdAaSigningCertificateV2",
        status: "Invalid",
        message:
          "A assinatura não contém IdAaSigningCertificateV2 vinculado ao certificado do signatário.",
      });
    }),
  );
});
