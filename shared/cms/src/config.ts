/**
 * @signature-kit/cms — typed error catalog and the CMS/PKCS#7 input contracts.
 *
 * The detached SignedData builder, verifier, and RFC 3161 timestamp client all
 * construct `CmsError` at the exact decision point (bad DER, digest mismatch,
 * TSA failure). Secrets never reach this layer: signing happens with a WebCrypto
 * `CryptoKey` that was already imported (the Redacted unwrap is upstream).
 */

import { Schema } from "effect";

// =============================================================================
// Error code catalog
// =============================================================================

export const CmsErrorCodeSchema = Schema.Literals([
  "cms.ENCODE_ERROR",
  "cms.DECODE_ERROR",
  "cms.SIGN_ERROR",
  "cms.VERIFY_ERROR",
  "cms.DIGEST_MISMATCH",
  "cms.CHAIN_ERROR",
  "cms.UNSUPPORTED_ALGORITHM",
  "cms.TIMESTAMP_ERROR",
  "cms.POLICY_ERROR",
  "cms.UNKNOWN",
]);
export type CmsErrorCode = (typeof CmsErrorCodeSchema)["Type"];
export const CmsErrorCodeValue = {
  encodeError: "cms.ENCODE_ERROR",
  decodeError: "cms.DECODE_ERROR",
  signError: "cms.SIGN_ERROR",
  verifyError: "cms.VERIFY_ERROR",
  digestMismatch: "cms.DIGEST_MISMATCH",
  chainError: "cms.CHAIN_ERROR",
  unsupportedAlgorithm: "cms.UNSUPPORTED_ALGORITHM",
  timestampError: "cms.TIMESTAMP_ERROR",
  policyError: "cms.POLICY_ERROR",
  unknown: "cms.UNKNOWN",
} satisfies Record<string, CmsErrorCode>;

export const CmsOperationSchema = Schema.Literals([
  "cms.parse",
  "cms.attributes",
  "cms.sign",
  "cms.verify",
  "cms.encode",
  "cms.timestamp",
  "cms.policy",
]);
export type CmsOperation = (typeof CmsOperationSchema)["Type"];
export const CmsOperationValue = {
  parse: "cms.parse",
  attributes: "cms.attributes",
  sign: "cms.sign",
  verify: "cms.verify",
  encode: "cms.encode",
  timestamp: "cms.timestamp",
  policy: "cms.policy",
} satisfies Record<string, CmsOperation>;

// =============================================================================
// Hash algorithm catalog
// =============================================================================

export const CmsHashAlgorithmSchema = Schema.Literals(["sha256", "sha1", "sha384", "sha512"]);
export type CmsHashAlgorithm = (typeof CmsHashAlgorithmSchema)["Type"];
export const CmsHashAlgorithmValue = {
  sha256: "sha256",
  sha1: "sha1",
  sha384: "sha384",
  sha512: "sha512",
} satisfies Record<string, CmsHashAlgorithm>;

/** Web Crypto / pkijs digest name for a catalog algorithm. */
export const webCryptoHashName = (algorithm: CmsHashAlgorithm): string => {
  switch (algorithm) {
    case "sha256":
      return "SHA-256";
    case "sha1":
      return "SHA-1";
    case "sha384":
      return "SHA-384";
    case "sha512":
      return "SHA-512";
  }
};

/** X.690 OID of the digest algorithm (for AlgorithmIdentifier in attrs/TSP). */
export const hashAlgorithmOid = (algorithm: CmsHashAlgorithm): string => {
  switch (algorithm) {
    case "sha256":
      return "2.16.840.1.101.3.4.2.1";
    case "sha1":
      return "1.3.14.3.2.26";
    case "sha384":
      return "2.16.840.1.101.3.4.2.2";
    case "sha512":
      return "2.16.840.1.101.3.4.2.3";
  }
};

// =============================================================================
// Well-known OIDs (RFC 5652 / 5035 / 5126 / 3161)
// =============================================================================

export const CmsOid = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  signaturePolicy: "1.2.840.113549.1.9.16.2.15",
  timeStampToken: "1.2.840.113549.1.9.16.2.14",
};

// =============================================================================
// Input / output contracts
// =============================================================================

const isCryptoKey = (value: unknown): value is CryptoKey =>
  value !== null &&
  typeof value === "object" &&
  typeof Reflect.get(value, "type") === "string" &&
  typeof Reflect.get(value, "extractable") === "boolean" &&
  Array.isArray(Reflect.get(value, "usages"));

const CryptoKeySchema = Schema.declare<CryptoKey>(isCryptoKey, {
  identifier: "CryptoKey",
});

/**
 * ICP-Brasil signature-policy-identifier inputs. The policy hash and OID come
 * from the relevant Política de Assinatura (e.g. AD-RB / AD-RT) document.
 */
export const IcpBrasilPolicySchema = Schema.Struct({
  policyOid: Schema.NonEmptyString,
  policyHash: Schema.Uint8Array,
  policyHashAlgorithm: CmsHashAlgorithmSchema,
  policyUri: Schema.NonEmptyString,
});
export type IcpBrasilPolicy = (typeof IcpBrasilPolicySchema)["Type"];

/** RFC 3161 timestamp request inputs for PAdES-T / CAdES-T (ICP-Brasil AD-RT). */
export const TimestampOptionsSchema = Schema.Struct({
  tsaUrl: Schema.NonEmptyString,
  hashAlgorithm: Schema.optional(CmsHashAlgorithmSchema),
  timeoutMillis: Schema.optional(Schema.Number),
});
export type TimestampOptions = (typeof TimestampOptionsSchema)["Type"];

export const CreateDetachedSignedDataInputSchema = Schema.Struct({
  content: Schema.Uint8Array,
  signingKey: CryptoKeySchema,
  certificateDer: Schema.Uint8Array,
  chainDer: Schema.optional(Schema.Array(Schema.Uint8Array)),
  hashAlgorithm: Schema.optional(CmsHashAlgorithmSchema),
  signingTime: Schema.optional(Schema.Date),
  icpBrasil: Schema.optional(IcpBrasilPolicySchema),
  timestamp: Schema.optional(TimestampOptionsSchema),
});
export type CreateDetachedSignedDataInput = (typeof CreateDetachedSignedDataInputSchema)["Type"];

export const VerifyDetachedSignedDataInputSchema = Schema.Struct({
  cms: Schema.Uint8Array,
  content: Schema.Uint8Array,
  trustedRoots: Schema.optional(Schema.Array(Schema.Uint8Array)),
});
export type VerifyDetachedSignedDataInput = (typeof VerifyDetachedSignedDataInputSchema)["Type"];

export const CmsVerifyResultSchema = Schema.Struct({
  valid: Schema.Boolean,
  chainValid: Schema.Boolean,
  signerSerialNumber: Schema.NullOr(Schema.String),
});
export type CmsVerifyResult = (typeof CmsVerifyResultSchema)["Type"];

// =============================================================================
// Tagged error
// =============================================================================

export class CmsError extends Schema.TaggedErrorClass<CmsError>()("CmsError", {
  code: CmsErrorCodeSchema,
  reason: Schema.optional(Schema.String),
  operation: Schema.optional(CmsOperationSchema),
  upstreamTag: Schema.optional(Schema.String),
  upstreamCode: Schema.optional(Schema.String),
}) {
  get message(): string {
    switch (this.code) {
      case "cms.ENCODE_ERROR":
        return this.reason ?? "Failed to encode CMS SignedData.";
      case "cms.DECODE_ERROR":
        return this.reason ?? "Failed to decode CMS/DER input.";
      case "cms.SIGN_ERROR":
        return this.reason ?? "Failed to produce the CMS signature.";
      case "cms.VERIFY_ERROR":
        return this.reason ?? "Failed to verify the CMS SignedData.";
      case "cms.DIGEST_MISMATCH":
        return "CMS message digest does not match the content.";
      case "cms.CHAIN_ERROR":
        return this.reason ?? "Certificate chain validation failed.";
      case "cms.UNSUPPORTED_ALGORITHM":
        return this.reason ?? "Unsupported CMS algorithm.";
      case "cms.TIMESTAMP_ERROR":
        return this.reason ?? "RFC 3161 timestamp request failed.";
      case "cms.POLICY_ERROR":
        return this.reason ?? "ICP-Brasil policy resolution failed.";
      case "cms.UNKNOWN":
        return this.reason ?? "Unknown CMS failure.";
    }
  }
}
