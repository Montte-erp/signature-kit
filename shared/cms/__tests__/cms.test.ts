import { describe, expect, it } from "@effect/vitest";
import { buildSignedAttributes } from "../src/attributes";
import {
  CmsHashAlgorithmValue,
  CmsOid,
  TimestampOptionsSchema,
  hashAlgorithmOid,
  webCryptoHashName,
} from "../src/config";
import { Effect, Schema } from "effect";

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
});
