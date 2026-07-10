import { ErrorMessageLocaleSchema } from "@signature-kit/i18n";
import type { ErrorMessageLocale } from "@signature-kit/i18n";
import type { SignatureAlgorithm } from "@signature-kit/signatures";
import { SignatureAlgorithmSchema } from "@signature-kit/signatures";
import { Match, Schema } from "effect";

export const XmlErrorCodeSchema = Schema.Literals([
  "xml.INVALID_INPUT",
  "xml.RUNTIME_UNAVAILABLE",
  "xml.INVALID_XML",
  "xml.SIGNATURE_NOT_FOUND",
  "xml.UNSUPPORTED_ALGORITHM",
  "xml.KEY_IMPORT_FAILED",
  "xml.SIGN_FAILED",
  "xml.VERIFY_FAILED",
]);
export type XmlErrorCode = (typeof XmlErrorCodeSchema)["Type"];

export const XmlErrorCodeValue = {
  invalidInput: "xml.INVALID_INPUT",
  runtimeUnavailable: "xml.RUNTIME_UNAVAILABLE",
  invalidXml: "xml.INVALID_XML",
  signatureNotFound: "xml.SIGNATURE_NOT_FOUND",
  unsupportedAlgorithm: "xml.UNSUPPORTED_ALGORITHM",
  keyImportFailed: "xml.KEY_IMPORT_FAILED",
  signFailed: "xml.SIGN_FAILED",
  verifyFailed: "xml.VERIFY_FAILED",
} satisfies Record<string, XmlErrorCode>;

export type XmlErrorMessageLocale = ErrorMessageLocale;
export const XmlErrorMessagesSchema = Schema.Record(
  ErrorMessageLocaleSchema,
  Schema.Record(XmlErrorCodeSchema, Schema.String),
);
export type XmlErrorMessages = (typeof XmlErrorMessagesSchema)["Type"];

export const xmlErrorMessages = {
  "en-US": {
    "xml.INVALID_INPUT": "Invalid XML signing input.",
    "xml.RUNTIME_UNAVAILABLE": "XML runtime is unavailable.",
    "xml.INVALID_XML": "Invalid XML document.",
    "xml.SIGNATURE_NOT_FOUND": "XML signature was not found.",
    "xml.UNSUPPORTED_ALGORITHM": "Unsupported XML signature algorithm.",
    "xml.KEY_IMPORT_FAILED": "Failed to import the XML verification key.",
    "xml.SIGN_FAILED": "Failed to sign the XML document.",
    "xml.VERIFY_FAILED": "Failed to verify the XML signature.",
  },
  "pt-BR": {
    "xml.INVALID_INPUT": "Entrada inválida para assinatura XML.",
    "xml.RUNTIME_UNAVAILABLE": "Runtime XML indisponível.",
    "xml.INVALID_XML": "Documento XML inválido.",
    "xml.SIGNATURE_NOT_FOUND": "Assinatura XML não encontrada.",
    "xml.UNSUPPORTED_ALGORITHM": "Algoritmo de assinatura XML não suportado.",
    "xml.KEY_IMPORT_FAILED": "Não foi possível importar a chave de verificação XML.",
    "xml.SIGN_FAILED": "Não foi possível assinar o documento XML.",
    "xml.VERIFY_FAILED": "Não foi possível verificar a assinatura XML.",
  },
} satisfies Record<XmlErrorMessageLocale, Record<XmlErrorCode, string>>;

export const XmlOperationSchema = Schema.Literals([
  "xml.runtime",
  "xml.parse",
  "xml.key-import",
  "xml.sign",
  "xml.verify",
]);
export type XmlOperation = (typeof XmlOperationSchema)["Type"];

export const XmlOperationValue = {
  runtime: "xml.runtime",
  parse: "xml.parse",
  keyImport: "xml.key-import",
  sign: "xml.sign",
  verify: "xml.verify",
} satisfies Record<string, XmlOperation>;

export const XmlSchemaNameSchema = Schema.Literals(["XmlSigningRequest", "XmlVerificationRequest"]);
export type XmlSchemaName = (typeof XmlSchemaNameSchema)["Type"];

export const XmlSchemaNameValue = {
  signingRequest: "XmlSigningRequest",
  verificationRequest: "XmlVerificationRequest",
} satisfies Record<string, XmlSchemaName>;

export const XmlCanonicalizationSchema = Schema.Literals(["exclusive", "inclusive"]);
export type XmlCanonicalization = (typeof XmlCanonicalizationSchema)["Type"];
export const XmlCanonicalizationValue = {
  exclusive: "exclusive",
  inclusive: "inclusive",
} satisfies Record<string, XmlCanonicalization>;

export const XmlHashAlgorithmSchema = Schema.Literals(["SHA-1", "SHA-256", "SHA-512"]);
export type XmlHashAlgorithm = (typeof XmlHashAlgorithmSchema)["Type"];

export const XmlVerificationKeySourceSchema = Schema.Literals(["certificate", "spki"]);
export type XmlVerificationKeySource = (typeof XmlVerificationKeySourceSchema)["Type"];

export const xmlHashAlgorithmFromSignatureAlgorithm = (
  algorithm: SignatureAlgorithm,
): XmlHashAlgorithm =>
  Match.value(algorithm).pipe(
    Match.when("rsa-sha1", (): XmlHashAlgorithm => "SHA-1"),
    Match.when("rsa-sha256", (): XmlHashAlgorithm => "SHA-256"),
    Match.when("rsa-sha512", (): XmlHashAlgorithm => "SHA-512"),
    Match.exhaustive,
  );

export const XmlReferencePathSegmentSchema = Schema.Struct({
  localName: Schema.NonEmptyString,
  namespaceUri: Schema.NullOr(Schema.String),
});
export type XmlReferencePathSegment = (typeof XmlReferencePathSegmentSchema)["Type"];

export const XmlRequiredReferenceSchema = Schema.Struct({
  uri: Schema.NonEmptyString,
  path: Schema.NonEmptyArray(XmlReferencePathSegmentSchema),
});
export type XmlRequiredReference = (typeof XmlRequiredReferenceSchema)["Type"];

export const XmlSigningRequestSchema = Schema.Struct({
  xml: Schema.String,
  algorithm: Schema.optional(SignatureAlgorithmSchema),
  referenceId: Schema.optional(Schema.NonEmptyString),
  signatureId: Schema.optional(Schema.String),
  signingTime: Schema.optional(Schema.Date),
  canonicalization: Schema.optional(XmlCanonicalizationSchema),
});
export const XmlVerificationRequestSchema = Schema.Struct({
  xml: Schema.String,
  algorithm: Schema.optional(SignatureAlgorithmSchema),
  publicKeyDer: Schema.optional(Schema.Uint8Array),
  trustedCertificateDer: Schema.optional(Schema.Uint8Array),
  requiredReference: Schema.optional(XmlRequiredReferenceSchema),
}).check(
  Schema.makeFilter((request) => {
    const hasPublicKey = request.publicKeyDer !== undefined;
    const hasTrustedCertificate = request.trustedCertificateDer !== undefined;
    return hasPublicKey === hasTrustedCertificate
      ? "Provide exactly one verification key source."
      : undefined;
  }),
);
export type XmlSigningRequest = (typeof XmlSigningRequestSchema)["Type"];

export type XmlVerificationRequest = (typeof XmlVerificationRequestSchema)["Type"];

export const XmlVerificationResultSchema = Schema.Struct({
  valid: Schema.Boolean,
  signatureCount: Schema.Number,
  referenceUris: Schema.Array(Schema.String),
});
export type XmlVerificationResult = (typeof XmlVerificationResultSchema)["Type"];

export class XmlError extends Schema.TaggedErrorClass<XmlError>()("XmlError", {
  code: XmlErrorCodeSchema,
  retryable: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  operation: Schema.optional(XmlOperationSchema),
  schemaName: Schema.optional(XmlSchemaNameSchema),
  issueMessage: Schema.optional(Schema.String),
}) {
  get message(): string {
    return this.reason ?? xmlErrorMessages["en-US"][this.code];
  }
}
