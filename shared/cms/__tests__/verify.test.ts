import { describe, expect, it } from "@effect/vitest";
import * as asn1js from "asn1js";
import { Effect, Result } from "effect";
import * as pkijs from "pkijs";
import { CmsOid } from "../src/config";
import { toArrayBuffer, toBufferSource } from "../src/engine";
import { inspectDetachedSignedData } from "../src/inspect";
import { createDetachedSignedData } from "../src/sign";
import { verifyDetachedSignedData } from "../src/verify";

type CertificateFixture = {
  readonly certificate: pkijs.Certificate;
  readonly certificateDer: Uint8Array;
  readonly subjectKeyIdentifier: Uint8Array;
  readonly signingKey: CryptoKey;
};

type CertificateFixtureOptions = {
  readonly subjectKeyIdentifier?: Uint8Array;
  readonly subjectKeyIdentifierExtensionDer?: ArrayBuffer;
  readonly includeSubjectKeyIdentifierExtension?: boolean;
};

const createCertificateFixture = async (
  commonName: string,
  serialNumber: number,
  options: CertificateFixtureOptions = {},
): Promise<CertificateFixture> => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 1024,
      publicExponent: toBufferSource(Uint8Array.of(1, 0, 1)),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: serialNumber });
  certificate.issuer.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({
      type: "2.5.4.3",
      value: new asn1js.Utf8String({ value: commonName }),
    }),
  );
  certificate.subject.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({
      type: "2.5.4.3",
      value: new asn1js.Utf8String({ value: commonName }),
    }),
  );
  certificate.notBefore.value = new Date("2020-01-01T00:00:00.000Z");
  certificate.notAfter.value = new Date("2040-01-01T00:00:00.000Z");
  await certificate.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  const subjectKeyIdentifier =
    options.subjectKeyIdentifier ??
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-1",
        toBufferSource(certificate.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView),
      ),
    );
  const subjectKeyIdentifierExtensionDer =
    options.subjectKeyIdentifierExtensionDer ??
    new asn1js.OctetString({ valueHex: toArrayBuffer(subjectKeyIdentifier) }).toBER(false);
  const basicConstraints = new pkijs.BasicConstraints({ cA: true });
  const extensions = [
    new pkijs.Extension({
      extnID: "2.5.29.19",
      critical: true,
      extnValue: basicConstraints.toSchema().toBER(false),
      parsedValue: basicConstraints,
    }),
  ];
  if (options.includeSubjectKeyIdentifierExtension !== false) {
    extensions.push(
      new pkijs.Extension({
        extnID: "2.5.29.14",
        extnValue: subjectKeyIdentifierExtensionDer,
      }),
    );
  }
  certificate.extensions = extensions;
  await certificate.sign(keyPair.privateKey, "SHA-256");

  return {
    certificate,
    certificateDer: new Uint8Array(certificate.toSchema().toBER(false)),
    subjectKeyIdentifier,
    signingKey: keyPair.privateKey,
  };
};

const createCmsFixture = (commonName = "CMS signer") =>
  Effect.gen(function* () {
    const certificate = yield* Effect.promise(() => createCertificateFixture(commonName, 1));
    const content = new TextEncoder().encode("detached CMS content");
    const cms = yield* createDetachedSignedData({
      content,
      signingKey: certificate.signingKey,
      certificateDer: certificate.certificateDer,
    });
    return { ...certificate, cms, content };
  });

const parseCms = (
  cms: Uint8Array,
): { contentInfo: pkijs.ContentInfo; signed: pkijs.SignedData } => {
  const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(cms));
  return { contentInfo, signed: new pkijs.SignedData({ schema: contentInfo.content }) };
};

const encodeCms = (contentInfo: pkijs.ContentInfo, signed: pkijs.SignedData): Uint8Array => {
  contentInfo.content = signed.toSchema(true);
  return new Uint8Array(contentInfo.toSchema().toBER(false));
};

const replaceSignerIdentifierWithSubjectKeyIdentifier = (
  signed: pkijs.SignedData,
  subjectKeyIdentifier: Uint8Array,
): boolean => {
  const signerInfo = signed.signerInfos[0];
  if (signerInfo === undefined) return false;
  signerInfo.version = 3;
  signerInfo.sid = new asn1js.Primitive({
    idBlock: { tagClass: 3, tagNumber: 0 },
    valueHex: toArrayBuffer(subjectKeyIdentifier),
  });
  return true;
};

describe("CMS detached verification", () => {
  it.effect("keeps a valid detached id-data CMS valid", () =>
    Effect.gen(function* () {
      const fixture = yield* createCmsFixture();

      const verification = yield* verifyDetachedSignedData({
        cms: fixture.cms,
        content: fixture.content,
      });

      expect(verification.valid).toBe(true);
      expect(verification.chainValid).toBe(false);
      expect(verification.revocationStatus).toBe("not_checked");
    }),
  );

  it.effect("rejects attached content instead of accepting bytes supplied by the CMS", () =>
    Effect.gen(function* () {
      const fixture = yield* createCmsFixture();
      const { contentInfo, signed } = parseCms(fixture.cms);
      signed.encapContentInfo.eContent = new asn1js.OctetString({
        valueHex: toArrayBuffer(fixture.content),
      });
      const tamperedContent = new Uint8Array(fixture.content);
      tamperedContent[0] = (tamperedContent[0] ?? 0) ^ 0xff;

      const verification = yield* verifyDetachedSignedData({
        cms: encodeCms(contentInfo, signed),
        content: tamperedContent,
      });

      expect(verification.valid).toBe(false);
      expect(verification.chainValid).toBe(false);
      expect(verification.revocationStatus).toBe("not_checked");
    }),
  );

  it.effect("rejects a ContentInfo whose outer OID is not signedData", () =>
    Effect.gen(function* () {
      const fixture = yield* createCmsFixture();
      const { contentInfo } = parseCms(fixture.cms);
      contentInfo.contentType = CmsOid.data;

      const verification = yield* Effect.result(
        verifyDetachedSignedData({
          cms: new Uint8Array(contentInfo.toSchema().toBER(false)),
          content: fixture.content,
        }),
      );

      expect(Result.isFailure(verification)).toBe(true);
      if (Result.isFailure(verification)) {
        expect(verification.failure.code).toBe("cms.DECODE_ERROR");
        expect(verification.failure.operation).toBe("cms.verify");
      }
    }),
  );

  it.effect("rejects a non-signedData ContentInfo during inspection", () =>
    Effect.gen(function* () {
      const fixture = yield* createCmsFixture();
      const { contentInfo } = parseCms(fixture.cms);
      contentInfo.contentType = CmsOid.data;

      const inspection = yield* Effect.result(
        inspectDetachedSignedData({
          cms: new Uint8Array(contentInfo.toSchema().toBER(false)),
        }),
      );

      expect(Result.isFailure(inspection)).toBe(true);
      if (Result.isFailure(inspection)) {
        expect(inspection.failure.code).toBe("cms.DECODE_ERROR");
        expect(inspection.failure.operation).toBe("cms.parse");
      }
    }),
  );

  it.effect("rejects trailing bytes after CMS ContentInfo", () =>
    Effect.gen(function* () {
      const fixture = yield* createCmsFixture();
      const cms = new Uint8Array(fixture.cms.byteLength + 1);
      cms.set(fixture.cms);

      const inspection = yield* Effect.result(inspectDetachedSignedData({ cms }));

      expect(Result.isFailure(inspection)).toBe(true);
      if (Result.isFailure(inspection)) {
        expect(inspection.failure.code).toBe("cms.DECODE_ERROR");
        expect(inspection.failure.reason).toContain("trailing bytes");
      }
    }),
  );

  it.effect("rejects a SignedData whose eContentType is not id-data", () =>
    Effect.gen(function* () {
      const fixture = yield* createCmsFixture();
      const { contentInfo, signed } = parseCms(fixture.cms);
      signed.encapContentInfo.eContentType = "1.2.3.4";

      const verification = yield* Effect.result(
        verifyDetachedSignedData({
          cms: encodeCms(contentInfo, signed),
          content: fixture.content,
        }),
      );

      expect(Result.isFailure(verification)).toBe(true);
      if (Result.isFailure(verification)) {
        expect(verification.failure.code).toBe("cms.DECODE_ERROR");
        expect(verification.failure.operation).toBe("cms.verify");
      }
    }),
  );

  it.effect("uses a subjectKeyIdentifier SID to inspect the matching certificate", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() => createCertificateFixture("Actual signer", 1));
      const decoy = yield* Effect.promise(() => createCertificateFixture("Decoy signer", 2));
      const content = new TextEncoder().encode("subject key identifier CMS content");
      const cms = yield* createDetachedSignedData({
        content,
        signingKey: signer.signingKey,
        certificateDer: signer.certificateDer,
      });
      const { contentInfo, signed } = parseCms(cms);
      const signerInfo = signed.signerInfos[0];
      expect(signerInfo).toBeDefined();
      if (signerInfo === undefined) return;
      const subjectKeyIdentifier = yield* Effect.promise(() =>
        crypto.subtle.digest(
          "SHA-1",
          toBufferSource(
            signer.certificate.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView,
          ),
        ),
      );
      signerInfo.version = 3;
      signerInfo.sid = new asn1js.Primitive({
        idBlock: { tagClass: 3, tagNumber: 0 },
        valueHex: subjectKeyIdentifier,
      });
      signed.certificates = [decoy.certificate, signer.certificate];

      const mutatedCms = encodeCms(contentInfo, signed);
      const firstCertificate = parseCms(mutatedCms).signed.certificates?.find(
        (entry): entry is pkijs.Certificate => entry instanceof pkijs.Certificate,
      );
      expect(firstCertificate).toBeDefined();
      if (firstCertificate === undefined) return;
      expect(new Uint8Array(firstCertificate.toSchema(true).toBER(false))).toEqual(
        new Uint8Array(decoy.certificate.toSchema(true).toBER(false)),
      );

      const verification = yield* verifyDetachedSignedData({ cms: mutatedCms, content });
      expect(verification.valid).toBe(true);

      const inspection = yield* inspectDetachedSignedData({ cms: mutatedCms });

      expect(inspection.signerCommonName).toBe("Actual signer");
      expect(inspection.signerCertificateDer).toEqual(
        new Uint8Array(signer.certificate.toSchema(true).toBER(false)),
      );
    }),
  );

  it.effect("uses a method-1 fallback when the certificate omits SubjectKeyIdentifier", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() =>
        createCertificateFixture("Fallback signer", 3, {
          includeSubjectKeyIdentifierExtension: false,
        }),
      );
      const content = new TextEncoder().encode("method-1 fallback CMS content");
      const cms = yield* createDetachedSignedData({
        content,
        signingKey: signer.signingKey,
        certificateDer: signer.certificateDer,
      });
      const { contentInfo, signed } = parseCms(cms);
      expect(
        replaceSignerIdentifierWithSubjectKeyIdentifier(signed, signer.subjectKeyIdentifier),
      ).toBe(true);
      signed.certificates = [signer.certificate];

      const inspection = yield* inspectDetachedSignedData({
        cms: encodeCms(contentInfo, signed),
      });

      expect(inspection.signerCommonName).toBe("Fallback signer");
      expect(inspection.signerCertificateDer).toEqual(
        new Uint8Array(signer.certificate.toSchema(true).toBER(false)),
      );
    }),
  );

  it.effect("uses a non-method-1 SubjectKeyIdentifier extension to inspect the signer", () =>
    Effect.gen(function* () {
      const subjectKeyIdentifier = new Uint8Array([0x8e, 0x2a, 0x7c, 0x11]);
      const signer = yield* Effect.promise(() =>
        createCertificateFixture("Extension signer", 3, { subjectKeyIdentifier }),
      );
      const decoy = yield* Effect.promise(() => createCertificateFixture("Decoy signer", 4));
      const content = new TextEncoder().encode("non-method-1 subject key identifier CMS content");
      const cms = yield* createDetachedSignedData({
        content,
        signingKey: signer.signingKey,
        certificateDer: signer.certificateDer,
      });
      const { contentInfo, signed } = parseCms(cms);
      expect(replaceSignerIdentifierWithSubjectKeyIdentifier(signed, subjectKeyIdentifier)).toBe(
        true,
      );
      signed.certificates = [decoy.certificate, signer.certificate];

      const inspection = yield* inspectDetachedSignedData({
        cms: encodeCms(contentInfo, signed),
      });

      expect(inspection.signerCommonName).toBe("Extension signer");
      expect(inspection.signerCertificateDer).toEqual(
        new Uint8Array(signer.certificate.toSchema(true).toBER(false)),
      );
    }),
  );

  it.effect("does not select a certificate with a mismatched SubjectKeyIdentifier extension", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() =>
        createCertificateFixture("Mismatched extension signer", 5, {
          subjectKeyIdentifier: new Uint8Array([0x01, 0x02, 0x03, 0x04]),
        }),
      );
      const content = new TextEncoder().encode("mismatched subject key identifier CMS content");
      const cms = yield* createDetachedSignedData({
        content,
        signingKey: signer.signingKey,
        certificateDer: signer.certificateDer,
      });
      const methodOneSubjectKeyIdentifier = yield* Effect.promise(
        async () =>
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-1",
              toBufferSource(
                signer.certificate.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView,
              ),
            ),
          ),
      );
      const { contentInfo, signed } = parseCms(cms);
      expect(
        replaceSignerIdentifierWithSubjectKeyIdentifier(signed, methodOneSubjectKeyIdentifier),
      ).toBe(true);
      signed.certificates = [signer.certificate];

      const inspection = yield* inspectDetachedSignedData({
        cms: encodeCms(contentInfo, signed),
      });

      expect(inspection.signerCommonName).toBeNull();
      expect(inspection.signerCertificateDer).toBeNull();
    }),
  );

  it.effect("does not select a certificate with a malformed SubjectKeyIdentifier extension", () =>
    Effect.gen(function* () {
      const signer = yield* Effect.promise(() =>
        createCertificateFixture("Malformed extension signer", 6, {
          subjectKeyIdentifierExtensionDer: new asn1js.Null().toBER(false),
        }),
      );
      const content = new TextEncoder().encode("malformed subject key identifier CMS content");
      const cms = yield* createDetachedSignedData({
        content,
        signingKey: signer.signingKey,
        certificateDer: signer.certificateDer,
      });
      const { contentInfo, signed } = parseCms(cms);
      expect(
        replaceSignerIdentifierWithSubjectKeyIdentifier(signed, signer.subjectKeyIdentifier),
      ).toBe(true);
      signed.certificates = [signer.certificate];

      const inspection = yield* inspectDetachedSignedData({
        cms: encodeCms(contentInfo, signed),
      });

      expect(inspection.signerCommonName).toBeNull();
      expect(inspection.signerCertificateDer).toBeNull();
    }),
  );
  it.effect("does not report ignored other revocation information as checked", () =>
    Effect.gen(function* () {
      const fixture = yield* createCmsFixture();
      const { contentInfo, signed } = parseCms(fixture.cms);
      signed.crls = [
        new pkijs.OtherRevocationInfoFormat({
          otherRevInfoFormat: "1.2.3.4",
          otherRevInfo: new asn1js.Null(),
        }),
      ];

      const verification = yield* verifyDetachedSignedData({
        cms: encodeCms(contentInfo, signed),
        content: fixture.content,
        trustedRoots: [fixture.certificateDer],
      });

      expect(verification.valid).toBe(true);
      expect(verification.chainValid).toBe(true);
      expect(verification.revocationStatus).toBe("not_checked");
    }),
  );

  it.effect("preserves a successful chain result when the detached content mismatches", () =>
    Effect.gen(function* () {
      const fixture = yield* createCmsFixture();
      const verified = yield* verifyDetachedSignedData({
        cms: fixture.cms,
        content: fixture.content,
        trustedRoots: [fixture.certificateDer],
      });
      const tamperedContent = new Uint8Array(fixture.content);
      tamperedContent[0] = (tamperedContent[0] ?? 0) ^ 0xff;

      const verification = yield* verifyDetachedSignedData({
        cms: fixture.cms,
        content: tamperedContent,
        trustedRoots: [fixture.certificateDer],
      });

      expect(verified.valid).toBe(true);
      expect(verified.chainValid).toBe(true);
      expect(verification.valid).toBe(false);
      expect(verification.chainValid).toBe(true);
    }),
  );

  it.effect("hashes the embedded certificate, not ignored trailing input bytes", () =>
    Effect.gen(function* () {
      const certificate = yield* Effect.promise(() => createCertificateFixture("ESS signer", 1));
      const certificateWithTrailingByte = new Uint8Array(certificate.certificateDer.byteLength + 1);
      certificateWithTrailingByte.set(certificate.certificateDer);
      const content = new TextEncoder().encode("ESS certificate hash CMS content");
      const cms = yield* createDetachedSignedData({
        content,
        signingKey: certificate.signingKey,
        certificateDer: certificateWithTrailingByte,
      });
      const { signed } = parseCms(cms);
      const embeddedCertificate = signed.certificates?.find(
        (entry): entry is pkijs.Certificate => entry instanceof pkijs.Certificate,
      );
      const signerInfo = signed.signerInfos[0];
      const signingCertificateAttribute = signerInfo?.signedAttrs?.attributes.find(
        (attribute) => attribute.type === CmsOid.signingCertificateV2,
      );
      const signingCertificateValue = signingCertificateAttribute?.values[0];
      expect(embeddedCertificate).toBeDefined();
      expect(signingCertificateValue).toBeDefined();
      if (embeddedCertificate === undefined || signingCertificateValue === undefined) return;
      const signingCertificateSchema = asn1js.fromBER(signingCertificateValue.toBER(false)).result;
      expect(signingCertificateSchema).toBeInstanceOf(asn1js.Sequence);
      if (!(signingCertificateSchema instanceof asn1js.Sequence)) return;
      const certificateList = signingCertificateSchema.valueBlock.value[0];
      expect(certificateList).toBeInstanceOf(asn1js.Sequence);
      if (!(certificateList instanceof asn1js.Sequence)) return;
      const certificateIdentifier = certificateList.valueBlock.value[0];
      expect(certificateIdentifier).toBeInstanceOf(asn1js.Sequence);
      if (!(certificateIdentifier instanceof asn1js.Sequence)) return;
      const certificateHash = certificateIdentifier.valueBlock.value[0];
      expect(certificateHash).toBeInstanceOf(asn1js.OctetString);
      if (!(certificateHash instanceof asn1js.OctetString)) return;
      const expectedHash = new Uint8Array(
        yield* Effect.promise(() =>
          crypto.subtle.digest(
            "SHA-256",
            toBufferSource(new Uint8Array(embeddedCertificate.toSchema().toBER(false))),
          ),
        ),
      );

      expect(toBufferSource(certificateHash.valueBlock.valueHexView)).toEqual(expectedHash);
    }),
  );
});
