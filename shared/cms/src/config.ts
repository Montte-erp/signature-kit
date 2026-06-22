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

export type CmsErrorCode =
  | "cms.ENCODE_ERROR"
  | "cms.DECODE_ERROR"
  | "cms.SIGN_ERROR"
  | "cms.VERIFY_ERROR"
  | "cms.DIGEST_MISMATCH"
  | "cms.CHAIN_ERROR"
  | "cms.UNSUPPORTED_ALGORITHM"
  | "cms.TIMESTAMP_ERROR"
  | "cms.POLICY_ERROR"
  | "cms.UNKNOWN";
const CmsErrorCodeSchema: Schema.Decoder<CmsErrorCode> = Schema.Literals([
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

export type CmsOperation =
  | "cms.parse"
  | "cms.attributes"
  | "cms.sign"
  | "cms.verify"
  | "cms.encode"
  | "cms.timestamp"
  | "cms.policy";
const CmsOperationSchema: Schema.Decoder<CmsOperation> = Schema.Literals([
  "cms.parse",
  "cms.attributes",
  "cms.sign",
  "cms.verify",
  "cms.encode",
  "cms.timestamp",
  "cms.policy",
]);
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

export type CmsHashAlgorithm = "sha256" | "sha1" | "sha384" | "sha512";
const CmsHashAlgorithmSchema: Schema.Decoder<CmsHashAlgorithm> = Schema.Literals([
  "sha256",
  "sha1",
  "sha384",
  "sha512",
]);
export const cmsHashAlgorithmSchema: Schema.Decoder<CmsHashAlgorithm> = CmsHashAlgorithmSchema;
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
// Input / output contracts (plain types — a CryptoKey is not Schema-decodable)
// =============================================================================

/**
 * ICP-Brasil signature-policy-identifier inputs. The policy hash and OID come
 * from the relevant Política de Assinatura (e.g. AD-RB / AD-RT) document.
 */
export type IcpBrasilPolicy = {
  readonly policyOid: string;
  readonly policyHash: Uint8Array;
  readonly policyHashAlgorithm: CmsHashAlgorithm;
  readonly policyUri: string;
};

/** RFC 3161 timestamp request inputs for PAdES-T / CAdES-T (ICP-Brasil AD-RT). */
export type TimestampOptions = {
  readonly tsaUrl: string;
  readonly hashAlgorithm?: CmsHashAlgorithm | undefined;
  readonly timeoutMillis?: number | undefined;
};

export type CreateDetachedSignedDataInput = {
  readonly content: Uint8Array;
  readonly signingKey: CryptoKey;
  readonly certificateDer: Uint8Array;
  readonly chainDer?: readonly Uint8Array[] | undefined;
  readonly hashAlgorithm?: CmsHashAlgorithm | undefined;
  readonly signingTime?: Date | undefined;
  readonly icpBrasil?: IcpBrasilPolicy | undefined;
  readonly timestamp?: TimestampOptions | undefined;
};

export type VerifyDetachedSignedDataInput = {
  readonly cms: Uint8Array;
  readonly content: Uint8Array;
  readonly trustedRoots?: readonly Uint8Array[] | undefined;
};

export type CmsVerifyResult = {
  readonly valid: boolean;
  readonly chainValid: boolean;
  readonly signerSerialNumber: string | null;
};

// =============================================================================
// Tagged error
// =============================================================================

type CmsErrorFields = {
  readonly _tag: "CmsError";
  readonly code: CmsErrorCode;
  readonly reason?: string | undefined;
  readonly operation?: CmsOperation | undefined;
  readonly upstreamTag?: string | undefined;
  readonly upstreamCode?: string | undefined;
};
type CmsErrorInput = {
  readonly code: CmsErrorCode;
  readonly reason?: string | undefined;
  readonly operation?: CmsOperation | undefined;
  readonly upstreamTag?: string | undefined;
  readonly upstreamCode?: string | undefined;
};
type CmsErrorConstructor = new (input: CmsErrorInput) => CmsErrorFields;

const CmsErrorBase: CmsErrorConstructor = Schema.TaggedErrorClass<CmsErrorFields>()("CmsError", {
  code: CmsErrorCodeSchema,
  reason: Schema.optional(Schema.String),
  operation: Schema.optional(CmsOperationSchema),
  upstreamTag: Schema.optional(Schema.String),
  upstreamCode: Schema.optional(Schema.String),
});

export class CmsError extends CmsErrorBase {
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

// =============================================================================
// Boundary metadata (preserve a wrapped cause's tag/code without branching)
// =============================================================================

const firstStringField = (input: unknown, field: string): string | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  const value = Reflect.get(input, field);
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return value.toString();
  return undefined;
};

export type CmsCauseMetadata = {
  readonly upstreamTag?: string | undefined;
  readonly upstreamCode?: string | undefined;
};

export const safeCauseMetadata = (cause: unknown): CmsCauseMetadata => ({
  upstreamTag: firstStringField(cause, "_tag") ?? firstStringField(cause, "name"),
  upstreamCode: firstStringField(cause, "code"),
});
