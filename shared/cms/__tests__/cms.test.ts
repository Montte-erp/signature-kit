import { describe, expect, it } from "@effect/vitest";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { vi } from "vitest";
import { buildSignedAttributes } from "../src/attributes";
import {
  CmsHashAlgorithmValue,
  CmsOid,
  CmsVerifyResultSchema,
  TimestampOptionsSchema,
  hashAlgorithmOid,
  webCryptoHashName,
} from "../src/config";
import { toArrayBuffer } from "../src/engine";
import { requestTimestamp } from "../src/timestamp";
import { Effect, Result, Schema } from "effect";

const containsBytes = (haystack: Uint8Array, needle: Uint8Array): boolean => {
  if (needle.length === 0) return true;
  const lastStart = haystack.length - needle.length;
  for (let start = 0; start <= lastStart; start++) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[start + offset] !== needle[offset]) matched = false;
    }
    if (matched) return true;
  }
  return false;
};

const timestampResponse = (
  requestDer: Uint8Array,
  overrideImprint: Uint8Array | null,
): Uint8Array => {
  const requestSchema = asn1js.fromBER(toArrayBuffer(requestDer));
  const request = new pkijs.TimeStampReq({ schema: requestSchema.result });
  const hashedMessage =
    overrideImprint === null
      ? request.messageImprint.hashedMessage
      : new asn1js.OctetString({ valueHex: toArrayBuffer(overrideImprint) });
  const tstInfoBase = {
    version: 1,
    policy: "1.2.3.4",
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: request.messageImprint.hashAlgorithm,
      hashedMessage,
    }),
    serialNumber: new asn1js.Integer({ value: 1 }),
    genTime: new Date("2026-01-02T03:04:05Z"),
  };
  const tstInfo = new pkijs.TSTInfo(
    request.nonce === undefined ? tstInfoBase : { ...tstInfoBase, nonce: request.nonce },
  );
  const signed = new pkijs.SignedData({
    version: 3,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: "1.2.840.113549.1.9.16.1.4",
      eContent: new asn1js.OctetString({ valueHex: tstInfo.toSchema().toBER(false) }),
    }),
    signerInfos: [],
  });
  const token = new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signed.toSchema(true),
  });
  return new Uint8Array(
    new pkijs.TimeStampResp({
      status: new pkijs.PKIStatusInfo({ status: pkijs.PKIStatus.granted }),
      timeStampToken: token,
    })
      .toSchema()
      .toBER(false),
  );
};

describe("CMS contracts", () => {
  it("maps digest catalogs to WebCrypto and ASN.1 OIDs", () => {
    expect(CmsHashAlgorithmValue.sha1).toBe("sha1");
    expect(webCryptoHashName("sha1")).toBe("SHA-1");
    expect(webCryptoHashName("sha256")).toBe("SHA-256");
    expect(webCryptoHashName("sha384")).toBe("SHA-384");
    expect(webCryptoHashName("sha512")).toBe("SHA-512");
    expect(hashAlgorithmOid("sha1")).toBe("1.3.14.3.2.26");
    expect(hashAlgorithmOid("sha256")).toBe("2.16.840.1.101.3.4.2.1");
    expect(CmsOid.timeStampToken).toBe("1.2.840.113549.1.9.16.2.14");
  });

  it("builds mandatory signed attributes including SigningCertificateV2", () => {
    const messageDigest = new Uint8Array(32).fill(0x11);
    const certificateSha256 = new Uint8Array(32).fill(0x22);
    const attributes = buildSignedAttributes({
      messageDigest,
      certificateSha256,
      signingTime: new Date("2026-01-02T03:04:05Z"),
    });

    // Emitted in DER SET OF order (X.690 §11.6, ascending octet comparison of
    // each member's encoding), NOT construction order. signingTime (shorter
    // SEQUENCE) sorts before messageDigest. Strict ICP-Brasil/BouncyCastle
    // validators re-canonicalize to this order before checking the RSA cipher.
    expect(attributes.map((attribute) => attribute.type)).toEqual([
      CmsOid.contentType,
      CmsOid.signingTime,
      CmsOid.messageDigest,
      CmsOid.signingCertificateV2,
    ]);
    const signingCertificate = attributes.find(
      (attribute) => attribute.type === CmsOid.signingCertificateV2,
    );
    expect(signingCertificate).toBeDefined();
    const encoded = new Uint8Array(
      signingCertificate?.values[0]?.toBER(false) ?? new ArrayBuffer(0),
    );
    expect(encoded.byteLength).toBeGreaterThan(0);
    expect(containsBytes(encoded, certificateSha256)).toBe(true);
  });

  it("uses GeneralizedTime for signingTime values from 2050 onward", () => {
    const before2050 = buildSignedAttributes({
      messageDigest: new Uint8Array(32).fill(0x11),
      certificateSha256: new Uint8Array(32).fill(0x22),
      signingTime: new Date("2049-12-31T23:59:59Z"),
    }).find((attribute) => attribute.type === CmsOid.signingTime);
    const from2050 = buildSignedAttributes({
      messageDigest: new Uint8Array(32).fill(0x11),
      certificateSha256: new Uint8Array(32).fill(0x22),
      signingTime: new Date("2050-01-01T00:00:00Z"),
    }).find((attribute) => attribute.type === CmsOid.signingTime);

    expect(before2050?.values[0]?.idBlock.tagNumber).toBe(23);
    expect(from2050?.values[0]?.idBlock.tagNumber).toBe(24);
  });

  it("adds ICP-Brasil signature policy attribute when policy metadata is present", () => {
    const policyHash = new Uint8Array(32).fill(0x33);
    const attributes = buildSignedAttributes({
      messageDigest: new Uint8Array(32).fill(0x11),
      certificateSha256: new Uint8Array(32).fill(0x22),
      signingTime: new Date("2026-01-02T03:04:05Z"),
      icpBrasil: {
        policyOid: "2.16.76.1.7.1.11.1.1",
        policyHash,
        policyHashAlgorithm: "sha256",
        policyUri: "http://politicas.icpbrasil.gov.br/PA_PAdES_AD_RB_v1_1.der",
      },
    });

    const policy = attributes.find((attribute) => attribute.type === CmsOid.signaturePolicy);
    expect(policy).toBeDefined();
    const encoded = new Uint8Array(policy?.values[0]?.toBER(false) ?? new ArrayBuffer(0));
    expect(containsBytes(encoded, policyHash)).toBe(true);
  });

  it.effect("validates RFC 3161 timestamp options with the Effect Schema", () =>
    Schema.decodeUnknownEffect(TimestampOptionsSchema)({
      tsaUrl: "https://timestamp.valid.com.br",
      hashAlgorithm: "sha256",
      timeoutMillis: 5000,
    }).pipe(
      Effect.map((options) => {
        expect(options.tsaUrl).toContain("timestamp.valid.com.br");
        expect(options.hashAlgorithm).toBe("sha256");
      }),
    ),
  );

  it.effect("binds RFC 3161 timestamp responses to the request imprint and nonce", () =>
    Effect.gen(function* () {
      vi.stubGlobal("fetch", (_request: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body;
        if (body instanceof Uint8Array) {
          return Promise.resolve(
            new Response(toArrayBuffer(timestampResponse(body, null)), {
              status: 200,
              headers: { "content-type": "application/timestamp-reply" },
            }),
          );
        }
        return Promise.resolve(new Response(new Uint8Array(), { status: 400 }));
      });

      const token = yield* requestTimestamp({
        data: new Uint8Array([1, 2, 3]),
        tsaUrl: "https://tsa.example.test",
        hashAlgorithm: "sha256",
      });

      expect(token.byteLength).toBeGreaterThan(0);
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("rejects RFC 3161 timestamp responses with a different imprint", () =>
    Effect.gen(function* () {
      vi.stubGlobal("fetch", (_request: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body;
        if (body instanceof Uint8Array) {
          return Promise.resolve(
            new Response(toArrayBuffer(timestampResponse(body, new Uint8Array(32).fill(0xff))), {
              status: 200,
              headers: { "content-type": "application/timestamp-reply" },
            }),
          );
        }
        return Promise.resolve(new Response(new Uint8Array(), { status: 400 }));
      });

      const result = yield* Effect.result(
        requestTimestamp({
          data: new Uint8Array([1, 2, 3]),
          tsaUrl: "https://tsa.example.test",
          hashAlgorithm: "sha256",
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("cms.TIMESTAMP_ERROR");
        expect(result.failure.reason).toContain("message imprint");
      }
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("makes revocation verification state explicit in CMS verify results", () =>
    Schema.decodeUnknownEffect(CmsVerifyResultSchema)({
      valid: true,
      chainValid: false,
      revocationStatus: "not_checked",
      signerSerialNumber: null,
    }).pipe(
      Effect.map((result) => {
        expect(result.chainValid).toBe(false);
        expect(result.revocationStatus).toBe("not_checked");
      }),
    ),
  );
});
