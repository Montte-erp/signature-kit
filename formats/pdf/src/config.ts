import { Schema } from "effect";
import {
  CmsHashAlgorithmSchema,
  IcpBrasilPolicySchema,
  TimestampOptionsSchema,
} from "@signature-kit/cms/config";

export const PdfErrorCodeSchema = Schema.Literals([
  "pdf.INVALID_PDF",
  "pdf.PLACEHOLDER_NOT_FOUND",
  "pdf.SIGNATURE_PLACEMENT_FAILED",
  "pdf.SIGNATURE_TOO_LARGE",
  "pdf.SIGN_FAILED",
  "pdf.STAMP_FAILED",
  "pdf.VERIFY_FAILED",
]);
export type PdfErrorCode = (typeof PdfErrorCodeSchema)["Type"];

export const PdfErrorCodeValue = {
  invalidPdf: "pdf.INVALID_PDF",
  placeholderNotFound: "pdf.PLACEHOLDER_NOT_FOUND",
  signaturePlacementFailed: "pdf.SIGNATURE_PLACEMENT_FAILED",
  signatureTooLarge: "pdf.SIGNATURE_TOO_LARGE",
  signFailed: "pdf.SIGN_FAILED",
  stampFailed: "pdf.STAMP_FAILED",
  verifyFailed: "pdf.VERIFY_FAILED",
} satisfies Record<string, PdfErrorCode>;

export const PdfOperationSchema = Schema.Literals([
  "pdf.parse",
  "pdf.placeholder",
  "pdf.sign",
  "pdf.stamp",
  "pdf.verify",
]);
export type PdfOperation = (typeof PdfOperationSchema)["Type"];

export const PdfOperationValue = {
  parse: "pdf.parse",
  placeholder: "pdf.placeholder",
  sign: "pdf.sign",
  stamp: "pdf.stamp",
  verify: "pdf.verify",
} satisfies Record<string, PdfOperation>;

export const PdfCoordinateTupleSchema = Schema.Tuple([
  Schema.Number,
  Schema.Number,
  Schema.Number,
  Schema.Number,
]);
export type PdfCoordinateTuple = (typeof PdfCoordinateTupleSchema)["Type"];

/**
 * A visible rubric stamp drawn onto one or more pages BEFORE signing. The PAdES
 * signature is a single CMS over the whole document; the rubric is page content
 * the byte range then covers — so "sign every page" means one signature plus the
 * same rubric repeated on each page, not N signatures. `rect` is
 * [left, bottom, right, top] in PDF points (bottom-left origin) and is applied
 * at the same geometry on every target page. `pages` defaults to "all".
 */
export const PdfRubricPagesSchema = Schema.Union([
  Schema.Literals(["all"]),
  Schema.Array(Schema.Number),
]);
export type PdfRubricPages = (typeof PdfRubricPagesSchema)["Type"];

export const PdfRubricStampSchema = Schema.Struct({
  rect: PdfCoordinateTupleSchema,
  pages: Schema.optional(PdfRubricPagesSchema),
  lines: Schema.optional(Schema.Array(Schema.String)),
  imagePng: Schema.optional(Schema.Uint8Array),
  border: Schema.optional(Schema.Boolean),
});
export type PdfRubricStamp = (typeof PdfRubricStampSchema)["Type"];

export const PdfSignatureAnchorSchema = Schema.Literals([
  "bottom-left",
  "bottom-center",
  "bottom-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "top-left",
  "top-center",
  "top-right",
]);
export type PdfSignatureAnchor = (typeof PdfSignatureAnchorSchema)["Type"];

export const PdfSignaturePlacementPageSchema = Schema.Literals(["first", "last"]);
export type PdfSignaturePlacementPage = (typeof PdfSignaturePlacementPageSchema)["Type"];

export const PdfInvisibleSignaturePlacementSchema = Schema.Struct({
  kind: Schema.Literals(["invisible"]),
  pageIndex: Schema.optional(Schema.Number),
});

export const PdfManualSignaturePlacementSchema = Schema.Struct({
  kind: Schema.Literals(["manual"]),
  pageIndex: Schema.optional(Schema.Number),
  widgetRect: PdfCoordinateTupleSchema,
});

export const PdfAutoSignaturePlacementSchema = Schema.Struct({
  kind: Schema.Literals(["auto"]),
  page: Schema.optional(PdfSignaturePlacementPageSchema),
  pageIndex: Schema.optional(Schema.Number),
  anchor: Schema.optional(PdfSignatureAnchorSchema),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
  margin: Schema.optional(Schema.Number),
  gap: Schema.optional(Schema.Number),
});

export const PdfSignaturePlacementSchema = Schema.Union([
  PdfInvisibleSignaturePlacementSchema,
  PdfManualSignaturePlacementSchema,
  PdfAutoSignaturePlacementSchema,
]);
export type PdfSignaturePlacement = (typeof PdfSignaturePlacementSchema)["Type"];

export const PdfSignatureAppearanceSchema = Schema.Struct({
  pageIndex: Schema.optional(Schema.Number),
  widgetRect: Schema.optional(PdfCoordinateTupleSchema),
  placement: Schema.optional(PdfSignaturePlacementSchema),
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
