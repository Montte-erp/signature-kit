import { CmsError } from "@signature-kit/cms/config";
import {
  PdfError,
  PdfPrepareAndSignAnchorsSchema,
  PdfPrepareAndSignRubricSchema,
  PdfSignatureBadgeSchema,
  PdfSignaturePageSchema,
  PdfSignatureRectSchema,
  PdfSigningBatchSigningOptionsSchema,
  PdfStampSizeSchema,
  PdfTextBoxSchema,
  PdfVisibleStampQrSchema,
} from "@signature-kit/pdf/config";
import { A1CertificateProfileSchema } from "@signature-kit/a1/config";
import { SignatureKitError } from "@signature-kit/signatures";
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
}).check(
  Schema.makeFilter((input) => {
    if (input.documents.length === 0) {
      return { path: ["documents"], issue: "A1 signer requires at least one document." };
    }

    const ids = new Set<string>();
    for (const document of input.documents) {
      if (ids.has(document.id)) {
        return { path: ["documents"], issue: "A1 signer document ids must be unique." };
      }
      ids.add(document.id);
    }
    return undefined;
  }),
);
export type A1SignerInput = (typeof A1SignerInputSchema)["Type"];

export const A1CertificateStatusSchema = Schema.Literals(["idle", "loading", "ready", "error"]);
export type A1CertificateStatus = (typeof A1CertificateStatusSchema)["Type"];

export const A1SignerRowStatusSchema = Schema.Literals(["pending", "signing", "signed", "failed"]);
export type A1SignerRowStatus = (typeof A1SignerRowStatusSchema)["Type"];

export const A1SigningProblemSchema = Schema.Union([PdfError, CmsError, SignatureKitError]);
export type A1SigningProblem = (typeof A1SigningProblemSchema)["Type"];

export const A1CertificateSnapshotSchema = Schema.Struct({
  status: A1CertificateStatusSchema,
  profile: Schema.NullOr(A1CertificateProfileSchema),
  error: Schema.NullOr(SignatureKitError),
});
export type A1CertificateSnapshot = (typeof A1CertificateSnapshotSchema)["Type"];

export const A1CertificateLoadOutcomeSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literals([true]),
    profile: A1CertificateProfileSchema,
  }),
  Schema.Struct({
    ok: Schema.Literals([false]),
    error: SignatureKitError,
  }),
]);
export type A1CertificateLoadOutcome = (typeof A1CertificateLoadOutcomeSchema)["Type"];

export const A1SignerPendingRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["pending"]),
});
export type A1SignerPendingRow = (typeof A1SignerPendingRowSchema)["Type"];

export const A1SignerSigningRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["signing"]),
});
export type A1SignerSigningRow = (typeof A1SignerSigningRowSchema)["Type"];

export const A1SignerSignedRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["signed"]),
  signedPdf: Schema.Uint8Array,
});
export type A1SignerSignedRow = (typeof A1SignerSignedRowSchema)["Type"];

export const A1SignerFailedRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["failed"]),
  error: A1SigningProblemSchema,
});
export type A1SignerFailedRow = (typeof A1SignerFailedRowSchema)["Type"];

export const A1SignerRowSchema = Schema.Union([
  A1SignerPendingRowSchema,
  A1SignerSigningRowSchema,
  A1SignerSignedRowSchema,
  A1SignerFailedRowSchema,
]);
export type A1SignerRow = (typeof A1SignerRowSchema)["Type"];

export const A1SignerSnapshotSchema = Schema.Struct({
  busy: Schema.Boolean,
  rows: Schema.Array(A1SignerRowSchema),
  error: Schema.NullOr(SignatureKitError),
});
export type A1SignerSnapshot = (typeof A1SignerSnapshotSchema)["Type"];

export const A1SignerRunOutcomeSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literals([true]),
    rows: Schema.Array(A1SignerRowSchema),
  }),
  Schema.Struct({
    ok: Schema.Literals([false]),
    error: SignatureKitError,
  }),
]);
export type A1SignerRunOutcome = (typeof A1SignerRunOutcomeSchema)["Type"];
