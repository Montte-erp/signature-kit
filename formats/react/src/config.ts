import type { CmsError } from "@signature-kit/cms/config";
import {
  PdfPrepareAndSignAnchorsSchema,
  PdfPrepareAndSignRubricSchema,
  PdfSignatureBadgeSchema,
  PdfSignaturePageSchema,
  PdfSignatureRectSchema,
  PdfSigningBatchSigningOptionsSchema,
  PdfStampSizeSchema,
  PdfTextBoxSchema,
  PdfVisibleStampQrSchema,
  type PdfError,
} from "@signature-kit/pdf/config";
import { A1CertificateProfileSchema, type A1CertificateProfile } from "@signature-kit/a1/config";
import type { SignatureKitError } from "@signature-kit/signatures";
import { Schema } from "effect";

const nonEmptyString: Schema.ConstraintDecoder<string> = Schema.NonEmptyString;

export const A1CertificateLoadInputSchema = Schema.Struct({
  pfx: Schema.Uint8Array,
  // secret-boundary: React hook action accepts a UI password and immediately wraps it in Redacted [allow-string-secret: hook event-action boundary]
  password: Schema.String,
});
export type A1CertificateLoadInput = (typeof A1CertificateLoadInputSchema)["Type"];

export const A1SignerPasswordCredentialsSchema = Schema.Struct({
  pfx: Schema.Uint8Array,
  // secret-boundary: React hook action accepts a UI password and immediately wraps it in Redacted [allow-string-secret: hook event-action boundary]
  password: Schema.String,
});
export type A1SignerPasswordCredentials = (typeof A1SignerPasswordCredentialsSchema)["Type"];

export const A1SignerLoadedProfileCredentialsSchema = Schema.Struct({
  profile: A1CertificateProfileSchema,
});
export type A1SignerLoadedProfileCredentials =
  (typeof A1SignerLoadedProfileCredentialsSchema)["Type"];

export const A1SignerCredentialsSchema = Schema.Union([
  A1SignerPasswordCredentialsSchema,
  A1SignerLoadedProfileCredentialsSchema,
]);
export type A1SignerCredentials = (typeof A1SignerCredentialsSchema)["Type"];

export const A1SignerDocumentSchema = Schema.Struct({
  id: nonEmptyString,
  name: Schema.optional(nonEmptyString),
  pdf: Schema.Uint8Array,
  pages: Schema.optional(Schema.Array(PdfSignaturePageSchema)),
  pageTextBoxes: Schema.optional(Schema.Array(Schema.Array(PdfTextBoxSchema))),
  stampRects: Schema.optional(Schema.Array(PdfSignatureRectSchema)),
  anchors: Schema.optional(PdfPrepareAndSignAnchorsSchema),
  stampSize: Schema.optional(PdfStampSizeSchema),
});
export type A1SignerDocument = (typeof A1SignerDocumentSchema)["Type"];

export const A1SignerStampSchema = Schema.Struct({
  stampSize: Schema.optional(PdfStampSizeSchema),
  badge: Schema.optional(PdfSignatureBadgeSchema),
  lines: Schema.optional(Schema.Array(Schema.String)),
  inkPng: Schema.optional(Schema.Uint8Array),
  border: Schema.optional(Schema.Boolean),
  qr: Schema.optional(PdfVisibleStampQrSchema),
  rubric: Schema.optional(PdfPrepareAndSignRubricSchema),
}).check(
  Schema.makeFilter((input) =>
    input.badge !== undefined && input.lines !== undefined
      ? { path: ["badge"], issue: "Visible stamp badge and lines are mutually exclusive." }
      : undefined,
  ),
);
export type A1SignerStamp = (typeof A1SignerStampSchema)["Type"];

export const A1SignerInputSchema = Schema.Struct({
  documents: Schema.Array(A1SignerDocumentSchema),
  credentials: Schema.optional(A1SignerCredentialsSchema),
  signing: PdfSigningBatchSigningOptionsSchema,
  stamp: Schema.optional(A1SignerStampSchema),
});
export type A1SignerInput = (typeof A1SignerInputSchema)["Type"];

export const A1CertificateStatusSchema = Schema.Literals(["idle", "loading", "ready", "error"]);
export type A1CertificateStatus = (typeof A1CertificateStatusSchema)["Type"];

export const A1SignerRowStatusSchema = Schema.Literals(["pending", "signing", "signed", "failed"]);
export type A1SignerRowStatus = (typeof A1SignerRowStatusSchema)["Type"];

export type A1SigningProblem = PdfError | CmsError | SignatureKitError;

export type A1CertificateSnapshot = {
  readonly status: A1CertificateStatus;
  readonly profile: A1CertificateProfile | null;
  readonly error: SignatureKitError | null;
};

export type A1CertificateLoadOutcome =
  | { readonly ok: true; readonly profile: A1CertificateProfile }
  | { readonly ok: false; readonly error: SignatureKitError };

export type A1SignerPendingRow = {
  readonly id: string;
  readonly name: string;
  readonly status: "pending";
};

export type A1SignerSigningRow = {
  readonly id: string;
  readonly name: string;
  readonly status: "signing";
};

export type A1SignerSignedRow = {
  readonly id: string;
  readonly name: string;
  readonly status: "signed";
  readonly signedPdf: Uint8Array;
};

export type A1SignerFailedRow = {
  readonly id: string;
  readonly name: string;
  readonly status: "failed";
  readonly error: A1SigningProblem;
};

export type A1SignerRow =
  | A1SignerPendingRow
  | A1SignerSigningRow
  | A1SignerSignedRow
  | A1SignerFailedRow;

export type A1SignerSnapshot = {
  readonly busy: boolean;
  readonly rows: ReadonlyArray<A1SignerRow>;
  readonly error: SignatureKitError | null;
};

export type A1SignerRunOutcome =
  | { readonly ok: true; readonly rows: ReadonlyArray<A1SignerRow> }
  | { readonly ok: false; readonly error: SignatureKitError };
