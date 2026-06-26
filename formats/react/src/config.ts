import {
  CmsError,
  CmsHashAlgorithmSchema,
  IcpBrasilPolicySchema,
  TimestampOptionsSchema,
} from "@signature-kit/cms/config";
import { SignatureKitError } from "@signature-kit/core/config";
import { PdfError, PdfSignaturePolicySchema } from "@signature-kit/pdf/config";
import { Schema } from "effect";

const nonEmptyString: Schema.ConstraintDecoder<string> = Schema.NonEmptyString;
const imageDataUrl: Schema.ConstraintDecoder<string> = Schema.String.check(
  Schema.isPattern(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
);

export const ReactSignatureFieldTypeSchema = Schema.Literals([
  "signature",
  "initials",
  "text",
  "date",
  "checkbox",
]);
export type ReactSignatureFieldType = (typeof ReactSignatureFieldTypeSchema)["Type"];
export const ReactSignatureFieldTypeValue = {
  signature: "signature",
  initials: "initials",
  text: "text",
  date: "date",
  checkbox: "checkbox",
} satisfies Record<string, ReactSignatureFieldType>;

export const ReactDocumentSourceTypeSchema = Schema.Literals(["url", "uploaded", "generated"]);
export type ReactDocumentSourceType = (typeof ReactDocumentSourceTypeSchema)["Type"];
export const ReactDocumentSourceTypeValue = {
  url: "url",
  uploaded: "uploaded",
  generated: "generated",
} satisfies Record<string, ReactDocumentSourceType>;

export const ReactSignaturePlacementAnchorSchema = Schema.Literals(["top-left", "center"]);
export type ReactSignaturePlacementAnchor = (typeof ReactSignaturePlacementAnchorSchema)["Type"];
export const ReactSignaturePlacementAnchorValue = {
  topLeft: "top-left",
  center: "center",
} satisfies Record<string, ReactSignaturePlacementAnchor>;

export const ReactSignatureAutoPlacementPageSchema = Schema.Literals(["first", "last"]);
export type ReactSignatureAutoPlacementPage =
  (typeof ReactSignatureAutoPlacementPageSchema)["Type"];
export const ReactSignatureAutoPlacementPageValue = {
  first: "first",
  last: "last",
} satisfies Record<string, ReactSignatureAutoPlacementPage>;

export const ReactSignatureAutoPlacementSlotSchema = Schema.Literals([
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
export type ReactSignatureAutoPlacementSlot =
  (typeof ReactSignatureAutoPlacementSlotSchema)["Type"];
export const ReactSignatureAutoPlacementSlotValue = {
  topLeft: "top-left",
  topCenter: "top-center",
  topRight: "top-right",
  middleLeft: "middle-left",
  center: "center",
  middleRight: "middle-right",
  bottomLeft: "bottom-left",
  bottomCenter: "bottom-center",
  bottomRight: "bottom-right",
} satisfies Record<string, ReactSignatureAutoPlacementSlot>;

export const ReactSignatureAutoPlacementCollisionSchema = Schema.Literals(["fail", "stack"]);
export type ReactSignatureAutoPlacementCollision =
  (typeof ReactSignatureAutoPlacementCollisionSchema)["Type"];
export const ReactSignatureAutoPlacementCollisionValue = {
  fail: "fail",
  stack: "stack",
} satisfies Record<string, ReactSignatureAutoPlacementCollision>;

export const ReactSignatureAutoPlacementStackDirectionSchema = Schema.Literals([
  "up",
  "down",
  "left",
  "right",
]);
export type ReactSignatureAutoPlacementStackDirection =
  (typeof ReactSignatureAutoPlacementStackDirectionSchema)["Type"];
export const ReactSignatureAutoPlacementStackDirectionValue = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
} satisfies Record<string, ReactSignatureAutoPlacementStackDirection>;

export const ReactSignatureRectSchema = Schema.Struct({
  pageIndex: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type ReactSignatureRect = (typeof ReactSignatureRectSchema)["Type"];

export const ReactSignaturePageSchema = Schema.Struct({
  index: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  label: Schema.optional(Schema.String),
});
export type ReactSignaturePage = (typeof ReactSignaturePageSchema)["Type"];

export const ReactDocumentSourceSchema = Schema.Struct({
  type: ReactDocumentSourceTypeSchema,
  url: Schema.optional(Schema.String),
  bytes: Schema.optional(Schema.Uint8Array),
});
export type ReactDocumentSource = (typeof ReactDocumentSourceSchema)["Type"];

export const ReactSignatureDocumentSchema = Schema.Struct({
  id: nonEmptyString,
  name: nonEmptyString,
  source: ReactDocumentSourceSchema,
  pages: Schema.Array(ReactSignaturePageSchema),
});
export type ReactSignatureDocument = (typeof ReactSignatureDocumentSchema)["Type"];

export const ReactSignerRoleSchema = Schema.Struct({
  id: nonEmptyString,
  label: nonEmptyString,
  email: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Boolean),
});
export type ReactSignerRole = (typeof ReactSignerRoleSchema)["Type"];

export const ReactSignatureFieldValueSchema = Schema.Struct({
  text: Schema.optional(Schema.String),
  imageDataUrl: Schema.optional(imageDataUrl),
  checked: Schema.optional(Schema.Boolean),
  signedAt: Schema.optional(Schema.Date),
});
export type ReactSignatureFieldValue = (typeof ReactSignatureFieldValueSchema)["Type"];

export const ReactSignatureFieldSchema = Schema.Struct({
  id: nonEmptyString,
  type: ReactSignatureFieldTypeSchema,
  documentId: nonEmptyString,
  roleId: nonEmptyString,
  rect: ReactSignatureRectSchema,
  label: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Boolean),
  value: Schema.optional(ReactSignatureFieldValueSchema),
});
export type ReactSignatureField = (typeof ReactSignatureFieldSchema)["Type"];

export const ReactSignatureFieldDraftSchema = Schema.Struct({
  id: nonEmptyString,
  type: ReactSignatureFieldTypeSchema,
  roleId: nonEmptyString,
  width: Schema.Number,
  height: Schema.Number,
  label: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Boolean),
});
export type ReactSignatureFieldDraft = (typeof ReactSignatureFieldDraftSchema)["Type"];

export const ReactSignatureTemplateSchema = Schema.Struct({
  id: nonEmptyString,
  name: nonEmptyString,
  documents: Schema.Array(ReactSignatureDocumentSchema),
  roles: Schema.Array(ReactSignerRoleSchema),
  fields: Schema.Array(ReactSignatureFieldSchema),
});
export type ReactSignatureTemplate = (typeof ReactSignatureTemplateSchema)["Type"];

export const ReactSignatureTemplateInputSchema = Schema.Struct({
  id: nonEmptyString,
  name: nonEmptyString,
  documents: Schema.Array(ReactSignatureDocumentSchema),
  roles: Schema.Array(ReactSignerRoleSchema),
  fields: Schema.optional(Schema.Array(ReactSignatureFieldSchema)),
});
export type ReactSignatureTemplateInput = (typeof ReactSignatureTemplateInputSchema)["Type"];

export const ReactSignatureFieldPlacementSchema = Schema.Struct({
  documentId: nonEmptyString,
  pageIndex: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
  draft: ReactSignatureFieldDraftSchema,
  anchor: Schema.optional(ReactSignaturePlacementAnchorSchema),
});
export type ReactSignatureFieldPlacement = (typeof ReactSignatureFieldPlacementSchema)["Type"];

export const ReactSignatureAutoPlacementInputSchema = Schema.Struct({
  documentId: nonEmptyString,
  draft: ReactSignatureFieldDraftSchema,
  page: Schema.optional(ReactSignatureAutoPlacementPageSchema),
  pageIndex: Schema.optional(Schema.Number),
  slot: ReactSignatureAutoPlacementSlotSchema,
  margin: Schema.optional(Schema.Number),
  gap: Schema.optional(Schema.Number),
  collision: Schema.optional(ReactSignatureAutoPlacementCollisionSchema),
  stackDirection: Schema.optional(ReactSignatureAutoPlacementStackDirectionSchema),
});
export type ReactSignatureAutoPlacementInput =
  (typeof ReactSignatureAutoPlacementInputSchema)["Type"];

export const ReactSignatureBuilderStateSchema = Schema.Struct({
  template: ReactSignatureTemplateSchema,
  selectedFieldId: Schema.optional(nonEmptyString),
  draft: Schema.optional(ReactSignatureFieldDraftSchema),
});
export type ReactSignatureBuilderState = (typeof ReactSignatureBuilderStateSchema)["Type"];

export const ReactSignatureBuilderStateInputSchema = Schema.Struct({
  template: ReactSignatureTemplateInputSchema,
  selectedFieldId: Schema.optional(nonEmptyString),
  draft: Schema.optional(ReactSignatureFieldDraftSchema),
});
export type ReactSignatureBuilderStateInput =
  (typeof ReactSignatureBuilderStateInputSchema)["Type"];

export const DocuSealBuilderInputSchema = Schema.Struct({
  userEmail: nonEmptyString,
  integrationEmail: Schema.optional(Schema.String),
  templateId: Schema.optional(Schema.Number),
  externalId: Schema.optional(Schema.String),
  folderName: Schema.optional(Schema.String),
  documentUrls: Schema.optional(Schema.Array(Schema.String)),
  name: Schema.optional(Schema.String),
  extractFields: Schema.optional(Schema.Boolean),
});
export type DocuSealBuilderInput = (typeof DocuSealBuilderInputSchema)["Type"];

export const DocuSealBuilderTokenPayloadSchema = Schema.Struct({
  user_email: nonEmptyString,
  integration_email: Schema.optional(Schema.String),
  template_id: Schema.optional(Schema.Number),
  external_id: Schema.optional(Schema.String),
  folder_name: Schema.optional(Schema.String),
  document_urls: Schema.optional(Schema.Array(Schema.String)),
  name: Schema.optional(Schema.String),
  extract_fields: Schema.optional(Schema.Boolean),
});
export type DocuSealBuilderTokenPayload = (typeof DocuSealBuilderTokenPayloadSchema)["Type"];

export const BrowserPdfDocumentInputSchema = Schema.Struct({
  id: nonEmptyString,
  name: nonEmptyString,
  pdf: Schema.Uint8Array,
  source: Schema.optional(ReactDocumentSourceSchema),
});
export type BrowserPdfDocumentInput = (typeof BrowserPdfDocumentInputSchema)["Type"];

export const BrowserPdfTemplateInputSchema = Schema.Struct({
  id: nonEmptyString,
  name: nonEmptyString,
  documentId: nonEmptyString,
  documentName: nonEmptyString,
  pdf: Schema.Uint8Array,
  role: ReactSignerRoleSchema,
});
export type BrowserPdfTemplateInput = (typeof BrowserPdfTemplateInputSchema)["Type"];

export const BrowserPdfSignaturePlacementInputSchema = Schema.Struct({
  pageIndex: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
  anchor: Schema.optional(ReactSignaturePlacementAnchorSchema),
});
export type BrowserPdfSignaturePlacementInput =
  (typeof BrowserPdfSignaturePlacementInputSchema)["Type"];

export const BrowserPdfSignatureAutoPlacementInputSchema = Schema.Struct({
  page: Schema.optional(ReactSignatureAutoPlacementPageSchema),
  pageIndex: Schema.optional(Schema.Number),
  slot: ReactSignatureAutoPlacementSlotSchema,
  margin: Schema.optional(Schema.Number),
  gap: Schema.optional(Schema.Number),
  collision: Schema.optional(ReactSignatureAutoPlacementCollisionSchema),
  stackDirection: Schema.optional(ReactSignatureAutoPlacementStackDirectionSchema),
});
export type BrowserPdfSignatureAutoPlacementInput =
  (typeof BrowserPdfSignatureAutoPlacementInputSchema)["Type"];

export const BrowserPdfSignatureBuilderInputSchema = Schema.Struct({
  id: nonEmptyString,
  name: nonEmptyString,
  documentId: nonEmptyString,
  documentName: nonEmptyString,
  pdf: Schema.Uint8Array,
  role: ReactSignerRoleSchema,
  draft: ReactSignatureFieldDraftSchema,
  selectedFieldId: Schema.optional(nonEmptyString),
  placement: Schema.optional(BrowserPdfSignaturePlacementInputSchema),
  autoPlacement: Schema.optional(BrowserPdfSignatureAutoPlacementInputSchema),
});
export type BrowserPdfSignatureBuilderInput =
  (typeof BrowserPdfSignatureBuilderInputSchema)["Type"];

export const BrowserPdfSigningInputSchema = Schema.Struct({
  pdf: Schema.Uint8Array,
  template: ReactSignatureTemplateSchema,
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
export type BrowserPdfSigningInput = (typeof BrowserPdfSigningInputSchema)["Type"];

export const BrowserPdfSigningQueueItemSchema = Schema.Struct({
  id: nonEmptyString,
  input: BrowserPdfSigningInputSchema,
});
export type BrowserPdfSigningQueueItem = (typeof BrowserPdfSigningQueueItemSchema)["Type"];

export const BrowserPdfSigningQueueOptionsSchema = Schema.Struct({
  concurrency: Schema.optional(Schema.Number),
  waitMillis: Schema.optional(Schema.Number),
  maxSize: Schema.optional(Schema.Number),
  started: Schema.optional(Schema.Boolean),
});
export type BrowserPdfSigningQueueOptions = (typeof BrowserPdfSigningQueueOptionsSchema)["Type"];

export const BrowserPdfSigningQueueSuccessSchema = Schema.Struct({
  id: nonEmptyString,
  signedPdf: Schema.Uint8Array,
});
export type BrowserPdfSigningQueueSuccess = (typeof BrowserPdfSigningQueueSuccessSchema)["Type"];
export const browserPdfSigningQueueSuccessSchema = BrowserPdfSigningQueueSuccessSchema;

export const BrowserPdfSigningQueueSnapshotSchema = Schema.Struct({
  status: Schema.Literals(["idle", "running", "stopped"]),
  pendingCount: Schema.Number,
  activeCount: Schema.Number,
  successCount: Schema.Number,
  errorCount: Schema.Number,
  settledCount: Schema.Number,
  rejectionCount: Schema.Number,
});
export type BrowserPdfSigningQueueSnapshot = (typeof BrowserPdfSigningQueueSnapshotSchema)["Type"];
export const browserPdfSigningQueueSnapshotSchema = BrowserPdfSigningQueueSnapshotSchema;

export const ReactPdfRenderOptionsSchema = Schema.Struct({
  title: Schema.optional(nonEmptyString),
  author: Schema.optional(Schema.String),
  subject: Schema.optional(Schema.String),
  keywords: Schema.optional(Schema.String),
  language: Schema.optional(Schema.String),
  creator: Schema.optional(Schema.String),
  producer: Schema.optional(Schema.String),
});
export type ReactPdfRenderOptions = (typeof ReactPdfRenderOptionsSchema)["Type"];
export const reactPdfRenderOptionsSchema = ReactPdfRenderOptionsSchema;

export const ReactIntegrationErrorCodeSchema = Schema.Literals([
  "react.INVALID_BUILDER_INPUT",
  "react.EMPTY_TEMPLATE",
  "react.DUPLICATE_ID",
  "react.UNKNOWN_DOCUMENT",
  "react.UNKNOWN_ROLE",
  "react.UNKNOWN_FIELD",
  "react.FIELD_OUT_OF_BOUNDS",
  "react.NO_AVAILABLE_PLACEMENT",
  "react.INVALID_SIGNATURE_IMAGE",
  "react.FILE_READ_FAILED",
  "react.PDF_LOAD_FAILED",
  "react.RENDER_FAILED",
  "react.QUEUE_REJECTED",
]);
export type ReactIntegrationErrorCode = (typeof ReactIntegrationErrorCodeSchema)["Type"];
export const ReactIntegrationErrorCodeValue = {
  invalidBuilderInput: "react.INVALID_BUILDER_INPUT",
  emptyTemplate: "react.EMPTY_TEMPLATE",
  duplicateId: "react.DUPLICATE_ID",
  unknownDocument: "react.UNKNOWN_DOCUMENT",
  unknownRole: "react.UNKNOWN_ROLE",
  unknownField: "react.UNKNOWN_FIELD",
  fieldOutOfBounds: "react.FIELD_OUT_OF_BOUNDS",
  noAvailablePlacement: "react.NO_AVAILABLE_PLACEMENT",
  invalidSignatureImage: "react.INVALID_SIGNATURE_IMAGE",
  fileReadFailed: "react.FILE_READ_FAILED",
  pdfLoadFailed: "react.PDF_LOAD_FAILED",
  renderFailed: "react.RENDER_FAILED",
  queueRejected: "react.QUEUE_REJECTED",
} satisfies Record<string, ReactIntegrationErrorCode>;

export const ReactIntegrationOperationSchema = Schema.Literals([
  "react.builder.create",
  "react.builder.validate",
  "react.builder.create-state",
  "react.builder.add-field",
  "react.builder.replace-field",
  "react.builder.remove-field",
  "react.builder.move-field",
  "react.builder.assign-value",
  "react.builder.auto-place-field",
  "react.docuseal.payload",
  "react.pdf.appearance",
  "react.pdf.render",
  "react.browser.file.read",
  "react.browser.pdf.load",
  "react.browser.pdf.sign",
  "react.browser.pdf.create-builder-state",
  "react.browser.pdf.queue-add",
]);
export type ReactIntegrationOperation = (typeof ReactIntegrationOperationSchema)["Type"];
export const ReactIntegrationOperationValue = {
  createTemplate: "react.builder.create",
  validateTemplate: "react.builder.validate",
  createBuilderState: "react.builder.create-state",
  addField: "react.builder.add-field",
  replaceField: "react.builder.replace-field",
  removeField: "react.builder.remove-field",
  moveField: "react.builder.move-field",
  autoPlaceField: "react.builder.auto-place-field",
  assignValue: "react.builder.assign-value",
  docuSealPayload: "react.docuseal.payload",
  pdfAppearance: "react.pdf.appearance",
  renderPdf: "react.pdf.render",
  readBrowserFile: "react.browser.file.read",
  loadBrowserPdf: "react.browser.pdf.load",
  signBrowserPdf: "react.browser.pdf.sign",
  createBrowserPdfBuilderState: "react.browser.pdf.create-builder-state",
  addBrowserPdfSigningQueueItem: "react.browser.pdf.queue-add",
} satisfies Record<string, ReactIntegrationOperation>;

export const ReactIntegrationSchemaNameSchema = Schema.Literals([
  "ReactSignatureTemplate",
  "ReactSignatureTemplateInput",
  "ReactSignatureField",
  "ReactSignatureBuilderStateInput",
  "ReactSignatureRect",
  "ReactSignatureFieldPlacement",
  "ReactSignatureAutoPlacementInput",
  "ReactPdfRenderOptions",
  "DocuSealBuilderInput",
  "BrowserPdfDocumentInput",
  "BrowserPdfTemplateInput",
  "BrowserPdfSigningInput",
  "BrowserPdfSignatureBuilderInput",
  "BrowserPdfSigningQueueItem",
  "BrowserPdfSigningQueueOptions",
]);
export type ReactIntegrationSchemaName = (typeof ReactIntegrationSchemaNameSchema)["Type"];
export const ReactIntegrationSchemaNameValue = {
  reactSignatureTemplate: "ReactSignatureTemplate",
  reactSignatureTemplateInput: "ReactSignatureTemplateInput",
  reactSignatureField: "ReactSignatureField",
  reactSignatureBuilderStateInput: "ReactSignatureBuilderStateInput",
  reactSignatureRect: "ReactSignatureRect",
  reactSignatureAutoPlacementInput: "ReactSignatureAutoPlacementInput",
  reactSignatureFieldPlacement: "ReactSignatureFieldPlacement",
  reactPdfRenderOptions: "ReactPdfRenderOptions",
  docuSealBuilderInput: "DocuSealBuilderInput",
  browserPdfDocumentInput: "BrowserPdfDocumentInput",
  browserPdfTemplateInput: "BrowserPdfTemplateInput",
  browserPdfSigningInput: "BrowserPdfSigningInput",
  browserPdfSignatureBuilderInput: "BrowserPdfSignatureBuilderInput",
  browserPdfSigningQueueItem: "BrowserPdfSigningQueueItem",
  browserPdfSigningQueueOptions: "BrowserPdfSigningQueueOptions",
} satisfies Record<string, ReactIntegrationSchemaName>;

export class ReactIntegrationError extends Schema.TaggedErrorClass<ReactIntegrationError>()(
  "ReactIntegrationError",
  {
    code: ReactIntegrationErrorCodeSchema,
    retryable: Schema.Boolean,
    reason: Schema.optional(Schema.String),
    operation: Schema.optional(ReactIntegrationOperationSchema),
    schemaName: Schema.optional(ReactIntegrationSchemaNameSchema),
    issuePath: Schema.optional(Schema.String),
    issueMessage: Schema.optional(Schema.String),
  },
) {
  get message(): string {
    return this.reason ?? this.code;
  }
}

export const BrowserPdfBatchSuccessSchema = Schema.Struct({
  id: nonEmptyString,
  ok: Schema.Literals([true]),
  signedPdf: Schema.Uint8Array,
});
export type BrowserPdfBatchSuccess = (typeof BrowserPdfBatchSuccessSchema)["Type"];

export const BrowserPdfBatchFailureSchema = Schema.Struct({
  id: nonEmptyString,
  ok: Schema.Literals([false]),
  error: Schema.Union([ReactIntegrationError, PdfError, CmsError, SignatureKitError]),
});
export type BrowserPdfBatchFailure = (typeof BrowserPdfBatchFailureSchema)["Type"];

export const BrowserPdfBatchResultSchema = Schema.Union([
  BrowserPdfBatchSuccessSchema,
  BrowserPdfBatchFailureSchema,
]);
export type BrowserPdfBatchResult = (typeof BrowserPdfBatchResultSchema)["Type"];
