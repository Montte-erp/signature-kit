import { Schema } from "effect";
import {
  CmsError,
  CmsHashAlgorithmSchema,
  IcpBrasilPolicySchema,
  TimestampOptionsSchema,
} from "@signature-kit/cms/config";
import { SignatureKitError } from "@signature-kit/core/config";

const nonEmptyString: Schema.ConstraintDecoder<string> = Schema.NonEmptyString;

export const PdfErrorCodeSchema = Schema.Literals([
  "pdf.INVALID_PDF",
  "pdf.INVALID_BUILDER_INPUT",
  "pdf.PLACEHOLDER_NOT_FOUND",
  "pdf.SIGNATURE_PLACEMENT_FAILED",
  "pdf.SIGNATURE_TOO_LARGE",
  "pdf.SIGN_FAILED",
  "pdf.STAMP_FAILED",
  "pdf.VERIFY_FAILED",
  "pdf.EMPTY_TEMPLATE",
  "pdf.DUPLICATE_ID",
  "pdf.UNKNOWN_DOCUMENT",
  "pdf.UNKNOWN_ROLE",
  "pdf.UNKNOWN_FIELD",
  "pdf.FIELD_OUT_OF_BOUNDS",
  "pdf.NO_AVAILABLE_PLACEMENT",
  "pdf.FILE_READ_FAILED",
  "pdf.PDF_LOAD_FAILED",
]);
export type PdfErrorCode = (typeof PdfErrorCodeSchema)["Type"];

export const PdfErrorCodeValue = {
  invalidPdf: "pdf.INVALID_PDF",
  invalidBuilderInput: "pdf.INVALID_BUILDER_INPUT",
  placeholderNotFound: "pdf.PLACEHOLDER_NOT_FOUND",
  signaturePlacementFailed: "pdf.SIGNATURE_PLACEMENT_FAILED",
  signatureTooLarge: "pdf.SIGNATURE_TOO_LARGE",
  signFailed: "pdf.SIGN_FAILED",
  stampFailed: "pdf.STAMP_FAILED",
  verifyFailed: "pdf.VERIFY_FAILED",
  emptyTemplate: "pdf.EMPTY_TEMPLATE",
  duplicateId: "pdf.DUPLICATE_ID",
  unknownDocument: "pdf.UNKNOWN_DOCUMENT",
  unknownRole: "pdf.UNKNOWN_ROLE",
  unknownField: "pdf.UNKNOWN_FIELD",
  fieldOutOfBounds: "pdf.FIELD_OUT_OF_BOUNDS",
  noAvailablePlacement: "pdf.NO_AVAILABLE_PLACEMENT",
  fileReadFailed: "pdf.FILE_READ_FAILED",
  pdfLoadFailed: "pdf.PDF_LOAD_FAILED",
} satisfies Record<string, PdfErrorCode>;

export const PdfOperationSchema = Schema.Literals([
  "pdf.parse",
  "pdf.placeholder",
  "pdf.sign",
  "pdf.stamp",
  "pdf.verify",
  "pdf.builder.create",
  "pdf.builder.validate",
  "pdf.builder.create-state",
  "pdf.builder.add-field",
  "pdf.builder.replace-field",
  "pdf.builder.remove-field",
  "pdf.builder.move-field",
  "pdf.builder.auto-place-field",
  "pdf.appearance",
  "pdf.blob.read",
  "pdf.document.load",
  "pdf.builder.create-template-from-bytes",
  "pdf.builder.create-state-from-bytes",
  "pdf.sign.field",
]);
export type PdfOperation = (typeof PdfOperationSchema)["Type"];

export const PdfOperationValue = {
  parse: "pdf.parse",
  placeholder: "pdf.placeholder",
  sign: "pdf.sign",
  stamp: "pdf.stamp",
  verify: "pdf.verify",
  createTemplate: "pdf.builder.create",
  validateTemplate: "pdf.builder.validate",
  createBuilderState: "pdf.builder.create-state",
  addField: "pdf.builder.add-field",
  replaceField: "pdf.builder.replace-field",
  removeField: "pdf.builder.remove-field",
  moveField: "pdf.builder.move-field",
  autoPlaceField: "pdf.builder.auto-place-field",
  pdfAppearance: "pdf.appearance",
  readBlobBytes: "pdf.blob.read",
  loadDocument: "pdf.document.load",
  createTemplateFromBytes: "pdf.builder.create-template-from-bytes",
  createBuilderStateFromBytes: "pdf.builder.create-state-from-bytes",
  signField: "pdf.sign.field",
} satisfies Record<string, PdfOperation>;

export const PdfSchemaNameSchema = Schema.Literals([
  "PdfSignatureTemplate",
  "PdfSignatureTemplateInput",
  "PdfSignatureField",
  "PdfSignatureBuilderStateInput",
  "PdfSignatureRect",
  "PdfSignatureFieldPlacement",
  "PdfSignatureAutoPlacementInput",
  "PdfDocumentInput",
  "PdfTemplateInput",
  "PdfSigningInput",
  "PdfSignatureBuilderInput",
  "PdfLiteParseResult",
  "PdfRubricPageStampInput",
  "PdfVisibleStampInput",
  "PdfSigningBatchPreparationInput",
]);
export type PdfSchemaName = (typeof PdfSchemaNameSchema)["Type"];
export const PdfSchemaNameValue = {
  pdfSignatureTemplate: "PdfSignatureTemplate",
  pdfSignatureTemplateInput: "PdfSignatureTemplateInput",
  pdfSignatureField: "PdfSignatureField",
  pdfSignatureBuilderStateInput: "PdfSignatureBuilderStateInput",
  pdfSignatureRect: "PdfSignatureRect",
  pdfSignatureAutoPlacementInput: "PdfSignatureAutoPlacementInput",
  pdfSignatureFieldPlacement: "PdfSignatureFieldPlacement",
  pdfDocumentInput: "PdfDocumentInput",
  pdfTemplateInput: "PdfTemplateInput",
  pdfSigningInput: "PdfSigningInput",
  pdfSignatureBuilderInput: "PdfSignatureBuilderInput",
  pdfLiteParseResult: "PdfLiteParseResult",
  pdfRubricPageStampInput: "PdfRubricPageStampInput",
  pdfVisibleStampInput: "PdfVisibleStampInput",
  pdfSigningBatchPreparationInput: "PdfSigningBatchPreparationInput",
} satisfies Record<string, PdfSchemaName>;

export class PdfError extends Schema.TaggedErrorClass<PdfError>()("PdfError", {
  code: PdfErrorCodeSchema,
  retryable: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  operation: Schema.optional(PdfOperationSchema),
  schemaName: Schema.optional(PdfSchemaNameSchema),
}) {
  get message(): string {
    return this.reason ?? this.code;
  }
}

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

export const PdfTextBoxSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type PdfTextBox = (typeof PdfTextBoxSchema)["Type"];

export const PdfLiteParseTextItemSchema = Schema.Struct({
  text: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type PdfLiteParseTextItem = (typeof PdfLiteParseTextItemSchema)["Type"];

export const PdfLiteParsePageSchema = Schema.Struct({
  pageNum: Schema.Number,
  textItems: Schema.Array(PdfLiteParseTextItemSchema),
});
export type PdfLiteParsePage = (typeof PdfLiteParsePageSchema)["Type"];

export const PdfLiteParseResultSchema = Schema.Struct({
  pages: Schema.Array(PdfLiteParsePageSchema),
});
export type PdfLiteParseResult = (typeof PdfLiteParseResultSchema)["Type"];

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

export const PdfSignatureFieldTypeSchema = Schema.Literals(["signature"]);
export type PdfSignatureFieldType = (typeof PdfSignatureFieldTypeSchema)["Type"];
export const PdfSignatureFieldTypeValue = {
  signature: "signature",
} satisfies Record<string, PdfSignatureFieldType>;

export const PdfDocumentSourceTypeSchema = Schema.Literals(["uploaded"]);
export type PdfDocumentSourceType = (typeof PdfDocumentSourceTypeSchema)["Type"];
export const PdfDocumentSourceTypeValue = {
  uploaded: "uploaded",
} satisfies Record<string, PdfDocumentSourceType>;

export const PdfSignaturePlacementAnchorSchema = Schema.Literals(["top-left", "center"]);
export type PdfSignaturePlacementAnchor = (typeof PdfSignaturePlacementAnchorSchema)["Type"];
export const PdfSignaturePlacementAnchorValue = {
  topLeft: "top-left",
  center: "center",
} satisfies Record<string, PdfSignaturePlacementAnchor>;

export const PdfSignatureAutoPlacementPageSchema = Schema.Literals(["first", "last"]);
export type PdfSignatureAutoPlacementPage = (typeof PdfSignatureAutoPlacementPageSchema)["Type"];
export const PdfSignatureAutoPlacementPageValue = {
  first: "first",
  last: "last",
} satisfies Record<string, PdfSignatureAutoPlacementPage>;

export const PdfSignatureAutoPlacementSlotSchema = Schema.Literals([
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
]);
export type PdfSignatureAutoPlacementSlot = (typeof PdfSignatureAutoPlacementSlotSchema)["Type"];
export const PdfSignatureAutoPlacementSlotValue = {
  topLeft: "top-left",
  topCenter: "top-center",
  topRight: "top-right",
  middleLeft: "middle-left",
  center: "center",
  middleRight: "middle-right",
  bottomLeft: "bottom-left",
  bottomCenter: "bottom-center",
  bottomRight: "bottom-right",
} satisfies Record<string, PdfSignatureAutoPlacementSlot>;

export const PdfSignatureAutoPlacementCollisionSchema = Schema.Literals(["fail", "stack"]);
export type PdfSignatureAutoPlacementCollision =
  (typeof PdfSignatureAutoPlacementCollisionSchema)["Type"];
export const PdfSignatureAutoPlacementCollisionValue = {
  fail: "fail",
  stack: "stack",
} satisfies Record<string, PdfSignatureAutoPlacementCollision>;

export const PdfSignatureAutoPlacementStackDirectionSchema = Schema.Literals([
  "up",
  "down",
  "left",
  "right",
]);
export type PdfSignatureAutoPlacementStackDirection =
  (typeof PdfSignatureAutoPlacementStackDirectionSchema)["Type"];
export const PdfSignatureAutoPlacementStackDirectionValue = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
} satisfies Record<string, PdfSignatureAutoPlacementStackDirection>;

export const PdfSignatureRectSchema = Schema.Struct({
  pageIndex: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type PdfSignatureRect = (typeof PdfSignatureRectSchema)["Type"];

export const PdfSignaturePageSchema = Schema.Struct({
  index: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  label: Schema.optional(Schema.String),
});
export type PdfSignaturePage = (typeof PdfSignaturePageSchema)["Type"];

export const PdfVisibleStampInputSchema = Schema.Struct({
  pdf: Schema.Uint8Array,
  pageIndex: Schema.Number,
  rect: PdfSignatureRectSchema,
  inkPng: Schema.optional(Schema.Uint8Array),
  lines: Schema.Array(Schema.String),
  border: Schema.optional(Schema.Boolean),
});
export type PdfVisibleStampInput = (typeof PdfVisibleStampInputSchema)["Type"];

export const PdfRubricPageStampInputSchema = Schema.Struct({
  pdf: Schema.Uint8Array,
  pageDimensions: Schema.Array(PdfSignaturePageSchema),
  pages: Schema.Array(Schema.Number),
  pageTextBoxes: Schema.optional(Schema.Array(Schema.Array(PdfTextBoxSchema))),
  lines: Schema.optional(Schema.Array(Schema.String)),
  imagePng: Schema.optional(Schema.Uint8Array),
  border: Schema.optional(Schema.Boolean),
});
export type PdfRubricPageStampInput = (typeof PdfRubricPageStampInputSchema)["Type"];

export const PdfDocumentSourceSchema = Schema.Struct({
  type: PdfDocumentSourceTypeSchema,
  bytes: Schema.optional(Schema.Uint8Array),
});
export type PdfDocumentSource = (typeof PdfDocumentSourceSchema)["Type"];

export const PdfSignatureDocumentSchema = Schema.Struct({
  id: nonEmptyString,
  name: nonEmptyString,
  source: PdfDocumentSourceSchema,
  pages: Schema.Array(PdfSignaturePageSchema),
});
export type PdfSignatureDocument = (typeof PdfSignatureDocumentSchema)["Type"];

export const PdfSignerRoleSchema = Schema.Struct({
  id: nonEmptyString,
  label: nonEmptyString,
  email: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Boolean),
});
export type PdfSignerRole = (typeof PdfSignerRoleSchema)["Type"];

export const PdfSignatureFieldSchema = Schema.Struct({
  id: nonEmptyString,
  type: PdfSignatureFieldTypeSchema,
  documentId: nonEmptyString,
  roleId: nonEmptyString,
  rect: PdfSignatureRectSchema,
  label: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Boolean),
});
export type PdfSignatureField = (typeof PdfSignatureFieldSchema)["Type"];

export const PdfSignatureFieldDraftSchema = Schema.Struct({
  id: nonEmptyString,
  type: PdfSignatureFieldTypeSchema,
  roleId: nonEmptyString,
  width: Schema.Number,
  height: Schema.Number,
  label: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Boolean),
});
export type PdfSignatureFieldDraft = (typeof PdfSignatureFieldDraftSchema)["Type"];

export const PdfSignatureTemplateSchema = Schema.Struct({
  id: nonEmptyString,
  name: nonEmptyString,
  documents: Schema.Array(PdfSignatureDocumentSchema),
  roles: Schema.Array(PdfSignerRoleSchema),
  fields: Schema.Array(PdfSignatureFieldSchema),
});
export type PdfSignatureTemplate = (typeof PdfSignatureTemplateSchema)["Type"];

export const PdfSignatureTemplateInputSchema = Schema.Struct({
  id: nonEmptyString,
  name: nonEmptyString,
  documents: Schema.Array(PdfSignatureDocumentSchema),
  roles: Schema.Array(PdfSignerRoleSchema),
  fields: Schema.optional(Schema.Array(PdfSignatureFieldSchema)),
});
export type PdfSignatureTemplateInput = (typeof PdfSignatureTemplateInputSchema)["Type"];

export const PdfSignatureFieldPlacementSchema = Schema.Struct({
  documentId: nonEmptyString,
  pageIndex: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
  draft: PdfSignatureFieldDraftSchema,
  anchor: Schema.optional(PdfSignaturePlacementAnchorSchema),
});
export type PdfSignatureFieldPlacement = (typeof PdfSignatureFieldPlacementSchema)["Type"];

export const PdfSignatureAutoPlacementInputSchema = Schema.Struct({
  documentId: nonEmptyString,
  draft: PdfSignatureFieldDraftSchema,
  page: Schema.optional(PdfSignatureAutoPlacementPageSchema),
  pageIndex: Schema.optional(Schema.Number),
  slot: PdfSignatureAutoPlacementSlotSchema,
  margin: Schema.optional(Schema.Number),
  gap: Schema.optional(Schema.Number),
  collision: Schema.optional(PdfSignatureAutoPlacementCollisionSchema),
  stackDirection: Schema.optional(PdfSignatureAutoPlacementStackDirectionSchema),
});
export type PdfSignatureAutoPlacementInput = (typeof PdfSignatureAutoPlacementInputSchema)["Type"];

export const PdfSignatureBuilderStateSchema = Schema.Struct({
  template: PdfSignatureTemplateSchema,
  selectedFieldId: Schema.optional(nonEmptyString),
  draft: Schema.optional(PdfSignatureFieldDraftSchema),
});
export type PdfSignatureBuilderState = (typeof PdfSignatureBuilderStateSchema)["Type"];

export const PdfSignatureBuilderStateInputSchema = Schema.Struct({
  template: PdfSignatureTemplateInputSchema,
  selectedFieldId: Schema.optional(nonEmptyString),
  draft: Schema.optional(PdfSignatureFieldDraftSchema),
});
export type PdfSignatureBuilderStateInput = (typeof PdfSignatureBuilderStateInputSchema)["Type"];

export const PdfDocumentInputSchema = Schema.Struct({
  id: nonEmptyString,
  name: nonEmptyString,
  pdf: Schema.Uint8Array,
  source: Schema.optional(PdfDocumentSourceSchema),
});
export type PdfDocumentInput = (typeof PdfDocumentInputSchema)["Type"];

export const PdfTemplateInputSchema = Schema.Struct({
  id: nonEmptyString,
  name: nonEmptyString,
  documentId: nonEmptyString,
  documentName: nonEmptyString,
  pdf: Schema.Uint8Array,
  role: PdfSignerRoleSchema,
});
export type PdfTemplateInput = (typeof PdfTemplateInputSchema)["Type"];

export const PdfSignaturePlacementInputSchema = Schema.Struct({
  pageIndex: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
  anchor: Schema.optional(PdfSignaturePlacementAnchorSchema),
});
export type PdfSignaturePlacementInput = (typeof PdfSignaturePlacementInputSchema)["Type"];

export const PdfSignatureAutoPlacementRequestSchema = Schema.Struct({
  page: Schema.optional(PdfSignatureAutoPlacementPageSchema),
  pageIndex: Schema.optional(Schema.Number),
  slot: PdfSignatureAutoPlacementSlotSchema,
  margin: Schema.optional(Schema.Number),
  gap: Schema.optional(Schema.Number),
  collision: Schema.optional(PdfSignatureAutoPlacementCollisionSchema),
  stackDirection: Schema.optional(PdfSignatureAutoPlacementStackDirectionSchema),
});
export type PdfSignatureAutoPlacementRequest =
  (typeof PdfSignatureAutoPlacementRequestSchema)["Type"];

export const PdfSignatureBestGuessPlacementInputSchema = Schema.Struct({
  template: PdfSignatureTemplateSchema,
  documentId: nonEmptyString,
  draft: PdfSignatureFieldDraftSchema,
  margin: Schema.optional(Schema.Number),
  page: Schema.optional(PdfSignatureAutoPlacementPageSchema),
  pageIndex: Schema.optional(Schema.Number),
});
export type PdfSignatureBestGuessPlacementInput =
  (typeof PdfSignatureBestGuessPlacementInputSchema)["Type"];

export const PdfSignaturePlacementBatchSuccessSchema = Schema.Struct({
  id: nonEmptyString,
  ok: Schema.Literals([true]),
  template: PdfSignatureTemplateSchema,
  field: PdfSignatureFieldSchema,
});
export type PdfSignaturePlacementBatchSuccess =
  (typeof PdfSignaturePlacementBatchSuccessSchema)["Type"];

export const PdfSignaturePlacementBatchFailureSchema = Schema.Struct({
  id: nonEmptyString,
  ok: Schema.Literals([false]),
  error: PdfError,
});
export type PdfSignaturePlacementBatchFailure =
  (typeof PdfSignaturePlacementBatchFailureSchema)["Type"];

export const PdfSignaturePlacementBatchResultSchema = Schema.Union([
  PdfSignaturePlacementBatchSuccessSchema,
  PdfSignaturePlacementBatchFailureSchema,
]);
export type PdfSignaturePlacementBatchResult =
  (typeof PdfSignaturePlacementBatchResultSchema)["Type"];

export const PdfSignatureBuilderInputSchema = Schema.Struct({
  id: nonEmptyString,
  name: nonEmptyString,
  documentId: nonEmptyString,
  documentName: nonEmptyString,
  pdf: Schema.Uint8Array,
  role: PdfSignerRoleSchema,
  draft: PdfSignatureFieldDraftSchema,
  selectedFieldId: Schema.optional(nonEmptyString),
  placement: Schema.optional(PdfSignaturePlacementInputSchema),
  autoPlacement: Schema.optional(PdfSignatureAutoPlacementRequestSchema),
});
export type PdfSignatureBuilderInput = (typeof PdfSignatureBuilderInputSchema)["Type"];

export const PdfSigningInputSchema = Schema.Struct({
  pdf: Schema.Uint8Array,
  template: PdfSignatureTemplateSchema,
  fieldId: nonEmptyString,
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
});
export type PdfSigningInput = (typeof PdfSigningInputSchema)["Type"];

export const PdfSigningBatchDocumentSchema = Schema.Struct({
  id: nonEmptyString,
  pdf: Schema.Uint8Array,
  template: PdfSignatureTemplateSchema,
  fieldId: nonEmptyString,
  rect: PdfSignatureRectSchema,
  pageDimensions: Schema.Array(PdfSignaturePageSchema),
  pageTextBoxes: Schema.optional(Schema.Array(Schema.Array(PdfTextBoxSchema))),
});
export type PdfSigningBatchDocument = (typeof PdfSigningBatchDocumentSchema)["Type"];

export const PdfSigningBatchSigningOptionsSchema = Schema.Struct({
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
});
export type PdfSigningBatchSigningOptions = (typeof PdfSigningBatchSigningOptionsSchema)["Type"];

export const PdfSigningBatchVisibleStampSchema = Schema.Struct({
  lines: Schema.Array(Schema.String),
  inkPng: Schema.optional(Schema.Uint8Array),
  rubricaPng: Schema.optional(Schema.Uint8Array),
  rubricLines: Schema.optional(Schema.Array(Schema.String)),
  rubricEveryPage: Schema.optional(Schema.Boolean),
  border: Schema.optional(Schema.Boolean),
});
export type PdfSigningBatchVisibleStamp = (typeof PdfSigningBatchVisibleStampSchema)["Type"];

export const PdfSigningBatchPreparationInputSchema = Schema.Struct({
  documents: Schema.Array(PdfSigningBatchDocumentSchema),
  signing: PdfSigningBatchSigningOptionsSchema,
  stamp: Schema.optional(PdfSigningBatchVisibleStampSchema),
});
export type PdfSigningBatchPreparationInput =
  (typeof PdfSigningBatchPreparationInputSchema)["Type"];

export const PdfSigningBatchItemSchema = Schema.Struct({
  id: nonEmptyString,
  input: PdfSigningInputSchema,
});
export type PdfSigningBatchItem = (typeof PdfSigningBatchItemSchema)["Type"];

export const PdfSigningBatchPreparationSuccessSchema = Schema.Struct({
  id: nonEmptyString,
  ok: Schema.Literals([true]),
  item: PdfSigningBatchItemSchema,
});
export type PdfSigningBatchPreparationSuccess =
  (typeof PdfSigningBatchPreparationSuccessSchema)["Type"];

export const PdfSigningBatchPreparationFailureSchema = Schema.Struct({
  id: nonEmptyString,
  ok: Schema.Literals([false]),
  error: PdfError,
});
export type PdfSigningBatchPreparationFailure =
  (typeof PdfSigningBatchPreparationFailureSchema)["Type"];

export const PdfSigningBatchPreparationResultSchema = Schema.Union([
  PdfSigningBatchPreparationSuccessSchema,
  PdfSigningBatchPreparationFailureSchema,
]);
export type PdfSigningBatchPreparationResult =
  (typeof PdfSigningBatchPreparationResultSchema)["Type"];

export const PdfBatchSuccessSchema = Schema.Struct({
  id: nonEmptyString,
  ok: Schema.Literals([true]),
  signedPdf: Schema.Uint8Array,
});
export type PdfBatchSuccess = (typeof PdfBatchSuccessSchema)["Type"];

export const PdfBatchFailureSchema = Schema.Struct({
  id: nonEmptyString,
  ok: Schema.Literals([false]),
  error: Schema.Union([PdfError, CmsError, SignatureKitError]),
});
export type PdfBatchFailure = (typeof PdfBatchFailureSchema)["Type"];

export const PdfBatchResultSchema = Schema.Union([PdfBatchSuccessSchema, PdfBatchFailureSchema]);
export type PdfBatchResult = (typeof PdfBatchResultSchema)["Type"];

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
