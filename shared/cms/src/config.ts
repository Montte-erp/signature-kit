import { Match, Schema } from "effect";

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

export const CmsErrorMessageLocaleSchema = Schema.Literals(["en-US", "pt-BR"]);
export type CmsErrorMessageLocale = (typeof CmsErrorMessageLocaleSchema)["Type"];
export const CmsErrorMessagesSchema = Schema.Record(
  CmsErrorMessageLocaleSchema,
  Schema.Record(CmsErrorCodeSchema, Schema.String),
);
export type CmsErrorMessages = (typeof CmsErrorMessagesSchema)["Type"];

export const cmsErrorMessages = {
  "en-US": {
    "cms.ENCODE_ERROR": "Failed to encode CMS SignedData.",
    "cms.DECODE_ERROR": "Failed to decode CMS/DER input.",
    "cms.SIGN_ERROR": "Failed to produce the CMS signature.",
    "cms.VERIFY_ERROR": "Failed to verify the CMS SignedData.",
    "cms.DIGEST_MISMATCH": "CMS message digest does not match the content.",
    "cms.CHAIN_ERROR": "Certificate chain validation failed.",
    "cms.UNSUPPORTED_ALGORITHM": "Unsupported CMS algorithm.",
    "cms.TIMESTAMP_ERROR": "RFC 3161 timestamp request failed.",
    "cms.POLICY_ERROR": "ICP-Brasil policy resolution failed.",
    "cms.UNKNOWN": "Unknown CMS failure.",
  },
  "pt-BR": {
    "cms.ENCODE_ERROR": "Não foi possível codificar o CMS SignedData.",
    "cms.DECODE_ERROR": "Não foi possível decodificar a entrada CMS/DER.",
    "cms.SIGN_ERROR": "Não foi possível produzir a assinatura CMS.",
    "cms.VERIFY_ERROR": "Não foi possível verificar o CMS SignedData.",
    "cms.DIGEST_MISMATCH": "O digest da mensagem CMS não corresponde ao conteúdo.",
    "cms.CHAIN_ERROR": "A validação da cadeia de certificados falhou.",
    "cms.UNSUPPORTED_ALGORITHM": "Algoritmo CMS não suportado.",
    "cms.TIMESTAMP_ERROR": "A requisição de carimbo do tempo RFC 3161 falhou.",
    "cms.POLICY_ERROR": "Não foi possível resolver a política ICP-Brasil.",
    "cms.UNKNOWN": "Falha desconhecida de CMS.",
  },
} satisfies Record<CmsErrorMessageLocale, Record<CmsErrorCode, string>>;

const cmsErrorReasonOverridableByCode = {
  "cms.ENCODE_ERROR": true,
  "cms.DECODE_ERROR": true,
  "cms.SIGN_ERROR": true,
  "cms.VERIFY_ERROR": true,
  "cms.DIGEST_MISMATCH": false,
  "cms.CHAIN_ERROR": true,
  "cms.UNSUPPORTED_ALGORITHM": true,
  "cms.TIMESTAMP_ERROR": true,
  "cms.POLICY_ERROR": true,
  "cms.UNKNOWN": true,
} satisfies Record<CmsErrorCode, boolean>;

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

export const CmsHashAlgorithmSchema = Schema.Literals(["sha256", "sha1", "sha384", "sha512"]);
export type CmsHashAlgorithm = (typeof CmsHashAlgorithmSchema)["Type"];
export const CmsHashAlgorithmValue = {
  sha256: "sha256",
  sha1: "sha1",
  sha384: "sha384",
  sha512: "sha512",
} satisfies Record<string, CmsHashAlgorithm>;

export const webCryptoHashName = (algorithm: CmsHashAlgorithm): string =>
  Match.value(algorithm).pipe(
    Match.when("sha256", () => "SHA-256"),
    Match.when("sha1", () => "SHA-1"),
    Match.when("sha384", () => "SHA-384"),
    Match.when("sha512", () => "SHA-512"),
    Match.exhaustive,
  );

export const hashAlgorithmOid = (algorithm: CmsHashAlgorithm): string =>
  Match.value(algorithm).pipe(
    Match.when("sha256", () => "2.16.840.1.101.3.4.2.1"),
    Match.when("sha1", () => "1.3.14.3.2.26"),
    Match.when("sha384", () => "2.16.840.1.101.3.4.2.2"),
    Match.when("sha512", () => "2.16.840.1.101.3.4.2.3"),
    Match.exhaustive,
  );

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

const isCryptoKey = (value: unknown): value is CryptoKey =>
  value !== null &&
  typeof value === "object" &&
  typeof Reflect.get(value, "type") === "string" &&
  typeof Reflect.get(value, "extractable") === "boolean" &&
  Array.isArray(Reflect.get(value, "usages"));

const CryptoKeySchema = Schema.declare<CryptoKey>(isCryptoKey, {
  identifier: "CryptoKey",
});

export const IcpBrasilPolicySchema = Schema.Struct({
  policyOid: Schema.NonEmptyString,
  policyHash: Schema.Uint8Array,
  policyHashAlgorithm: CmsHashAlgorithmSchema,
  policyUri: Schema.NonEmptyString,
});
export type IcpBrasilPolicy = (typeof IcpBrasilPolicySchema)["Type"];

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

export const CmsRevocationStatusSchema = Schema.Literals(["checked", "not_checked"]);
export type CmsRevocationStatus = (typeof CmsRevocationStatusSchema)["Type"];

export const CmsVerifyResultSchema = Schema.Struct({
  valid: Schema.Boolean,
  chainValid: Schema.Boolean,
  revocationStatus: CmsRevocationStatusSchema,
  signerSerialNumber: Schema.NullOr(Schema.String),
});
export type CmsVerifyResult = (typeof CmsVerifyResultSchema)["Type"];

export class CmsError extends Schema.TaggedErrorClass<CmsError>()("CmsError", {
  code: CmsErrorCodeSchema,
  reason: Schema.optional(Schema.String),
  operation: Schema.optional(CmsOperationSchema),
}) {
  get message(): string {
    const defaultMessage = cmsErrorMessages["en-US"][this.code];
    return cmsErrorReasonOverridableByCode[this.code]
      ? (this.reason ?? defaultMessage)
      : defaultMessage;
  }
}
