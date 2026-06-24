import { Schema } from "effect";
import {
  CmsHashAlgorithmSchema,
  IcpBrasilPolicySchema,
  TimestampOptionsSchema,
} from "@signature-kit/cms/config";

export const PdfErrorCodeSchema = Schema.Literals([
  "pdf.INVALID_PDF",
  "pdf.PLACEHOLDER_NOT_FOUND",
  "pdf.SIGNATURE_TOO_LARGE",
  "pdf.SIGN_FAILED",
  "pdf.VERIFY_FAILED",
]);
export type PdfErrorCode = (typeof PdfErrorCodeSchema)["Type"];

export const PdfErrorCodeValue = {
  invalidPdf: "pdf.INVALID_PDF",
  placeholderNotFound: "pdf.PLACEHOLDER_NOT_FOUND",
  signatureTooLarge: "pdf.SIGNATURE_TOO_LARGE",
  signFailed: "pdf.SIGN_FAILED",
  verifyFailed: "pdf.VERIFY_FAILED",
} satisfies Record<string, PdfErrorCode>;

export const PdfOperationSchema = Schema.Literals([
  "pdf.parse",
  "pdf.placeholder",
  "pdf.sign",
  "pdf.verify",
]);
export type PdfOperation = (typeof PdfOperationSchema)["Type"];

export const PdfOperationValue = {
  parse: "pdf.parse",
  placeholder: "pdf.placeholder",
  sign: "pdf.sign",
  verify: "pdf.verify",
} satisfies Record<string, PdfOperation>;

const PdfCoordinateTupleSchema = Schema.Tuple([
  Schema.Number,
  Schema.Number,
  Schema.Number,
  Schema.Number,
]);

export const PdfSignatureAppearanceSchema = Schema.Struct({
  pageIndex: Schema.optional(Schema.Number),
  widgetRect: Schema.optional(PdfCoordinateTupleSchema),
});
export type PdfSignatureAppearance = (typeof PdfSignatureAppearanceSchema)["Type"];

export const PdfSignaturePolicySchema = Schema.Literals(["pades-ades", "pades-icp-brasil"]);
export type PdfSignaturePolicy = (typeof PdfSignaturePolicySchema)["Type"];

export const PdfSigningRequestSchema = Schema.Struct({
  pdf: Schema.Uint8Array,
  reason: Schema.optional(Schema.String),
  contactInfo: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  location: Schema.optional(Schema.String),
  signingTime: Schema.optional(Schema.Date),
  signatureLength: Schema.optional(Schema.Number),
  hashAlgorithm: Schema.optional(CmsHashAlgorithmSchema),
  policy: Schema.optional(PdfSignaturePolicySchema),
  icpBrasil: Schema.optional(IcpBrasilPolicySchema),
  policyTimeoutMillis: Schema.optional(Schema.Number),
  timestamp: Schema.optional(TimestampOptionsSchema),
  appearance: Schema.optional(PdfSignatureAppearanceSchema),
});
export type PdfSigningRequest = (typeof PdfSigningRequestSchema)["Type"];

export const PdfVerificationRequestSchema = Schema.Struct({
  pdf: Schema.Uint8Array,
  trustedRoots: Schema.optional(Schema.Array(Schema.Uint8Array)),
});
export type PdfVerificationRequest = (typeof PdfVerificationRequestSchema)["Type"];

export const PdfVerificationResultSchema = Schema.Struct({
  valid: Schema.Boolean,
  chainValid: Schema.Boolean,
  signatureCount: Schema.Number,
  byteRange: PdfCoordinateTupleSchema,
  signerSerialNumber: Schema.NullOr(Schema.String),
});
export type PdfVerificationResult = (typeof PdfVerificationResultSchema)["Type"];

export class PdfError extends Schema.TaggedErrorClass<PdfError>()("PdfError", {
  code: PdfErrorCodeSchema,
  retryable: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  operation: Schema.optional(PdfOperationSchema),
}) {
  get message(): string {
    return this.reason ?? this.code;
  }
}
