import { Schema } from "effect";
import { SignatureAlgorithmSchema } from "@signature-kit/core/config";

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

export const XmlSigningRequestSchema = Schema.Struct({
  xml: Schema.String,
  algorithm: Schema.optional(SignatureAlgorithmSchema),
  referenceId: Schema.optional(Schema.String),
  signatureId: Schema.optional(Schema.String),
  signingTime: Schema.optional(Schema.Date),
});
export type XmlSigningRequest = (typeof XmlSigningRequestSchema)["Type"];

export const XmlVerificationRequestSchema = Schema.Struct({
  xml: Schema.String,
  algorithm: Schema.optional(SignatureAlgorithmSchema),
  publicKeyDer: Schema.optional(Schema.Uint8Array),
  requireReferenceUri: Schema.optional(Schema.String),
});
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
    return this.reason ?? this.code;
  }
}
