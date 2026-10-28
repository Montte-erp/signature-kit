import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect";
import type { Redacted } from "effect";

import {
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfSignatureRectSchema,
  PdfSignatureFieldDraftSchema,
  PdfSignaturePageSchema,
  PdfSignatureTemplateSchema,
} from "@signature-kit/pdf/config";
import { bestGuessPdfSignatureFieldPlacement } from "@signature-kit/pdf/builder-store";
import { placePdfSignatureField, removePdfSignatureField } from "@signature-kit/pdf/builder";
import type {
  PdfSignaturePlacementInput,
  PdfSigningBatchSigningOptions,
  PdfSigningBatchVisibleStamp,
  PdfSigningInput,
} from "@signature-kit/pdf/config";
import {
  createPdfSignatureBuilderStateFromBytes,
  readPdfBlobBytes,
  signPdfSignatureField,
  preparePdfSigningBatch,
} from "@signature-kit/pdf/workflow";

import type { CmsError } from "@signature-kit/cms/config";
import type { SignatureKitError, Signatures } from "@signature-kit/signatures";

export const SigningDocument = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  pages: Schema.Array(PdfSignaturePageSchema),
  rect: Schema.optional(PdfSignatureRectSchema),
  signed: Schema.Boolean,
});
export type SigningDocument = typeof SigningDocument.Type;

const SessionDocument = Schema.Struct({
  ...SigningDocument.fields,
  pdf: Schema.Uint8Array,
  signedPdf: Schema.optional(Schema.Uint8Array),
  template: PdfSignatureTemplateSchema,
});
type SessionDocument = typeof SessionDocument.Type;

const signatureDraft = PdfSignatureFieldDraftSchema.make({
  id: "a1-signature",
  type: "signature",
  roleId: "signer",
  width: 320,
  height: 128,
  label: "A1 signature",
  required: true,
});

export class SigningSession extends Context.Service<
  SigningSession,
  {
    readonly certificate: Effect.Effect<Option.Option<Redacted.Redacted<Uint8Array>>>;
    readonly setCertificate: (bytes: Redacted.Redacted<Uint8Array>) => Effect.Effect<void>;
    readonly clear: Effect.Effect<void>;
    readonly documents: Effect.Effect<readonly SigningDocument[]>;
    readonly addDocument: (file: Blob, name: string) => Effect.Effect<SigningDocument, PdfError>;
    readonly placeDocument: (
      id: string,
      placement?: PdfSignaturePlacementInput,
    ) => Effect.Effect<SigningDocument, PdfError>;
    readonly signDocument: (
      id: string,
      options?: PdfSigningBatchSigningOptions,
      stamp?: PdfSigningBatchVisibleStamp,
    ) => Effect.Effect<SigningDocument, PdfError | CmsError | SignatureKitError, Signatures>;
    readonly sourceDocument: (id: string) => Effect.Effect<Uint8Array, PdfError>;
    readonly exportDocument: (id: string) => Effect.Effect<Blob, PdfError>;
    readonly removeDocument: (id: string) => Effect.Effect<void>;
  }
>()("@signature-kit/docs/SigningSession") {}

export const signingSessionLayer = Layer.effect(
  SigningSession,
  Effect.gen(function* () {
    const documents = yield* Effect.acquireRelease(
      Ref.make<readonly SessionDocument[]>([]),
      (state) => Ref.set(state, []),
    );
    const certificate = yield* Effect.acquireRelease(
      Ref.make(Option.none<Redacted.Redacted<Uint8Array>>()),
      (state) => Ref.set(state, Option.none()),
    );
    const mutations = yield* Semaphore.make(1);
    return SigningSession.of({
      certificate: Ref.get(certificate),
      setCertificate: (bytes) => mutations.withPermit(Ref.set(certificate, Option.some(bytes))),
      clear: mutations.withPermit(
        Effect.all([Ref.set(documents, []), Ref.set(certificate, Option.none())], {
          discard: true,
        }),
      ),
      documents: Ref.get(documents).pipe(
        Effect.map((entries) =>
          entries.map(({ id, name, pages, rect, signed }) => ({ id, name, pages, rect, signed })),
        ),
      ),
      addDocument: Effect.fn(function* (file, name) {
        return yield* mutations.withPermit(
          Effect.gen(function* () {
            const pdf = yield* readPdfBlobBytes(file);
            const id = crypto.randomUUID();
            const state = yield* createPdfSignatureBuilderStateFromBytes({
              id: "browser-signing-session",
              name,
              documentId: id,
              documentName: name,
              pdf,
              role: { id: "signer", label: "Signer", required: true },
              draft: signatureDraft,
            });
            const document = state.template.documents[0];
            const entry = { id, name, pages: document.pages, signed: false };
            yield* Ref.update(documents, (current) => [
              ...current,
              { ...entry, pdf, template: state.template },
            ]);
            return entry;
          }),
        );
      }),
      placeDocument: Effect.fn(function* (id, requested) {
        return yield* mutations.withPermit(
          Effect.gen(function* () {
            const entries = yield* Ref.get(documents);
            const entry = entries.find((document) => document.id === id);
            if (entry === undefined)
              return yield* new PdfError({
                code: PdfErrorCodeValue.unknownDocument,
                retryable: false,
                operation: PdfOperationValue.addField,
                reason: "The selected signing document is no longer available.",
              });
            const template =
              entry.rect === undefined
                ? entry.template
                : yield* removePdfSignatureField(entry.template, signatureDraft.id);
            const placement =
              requested === undefined
                ? yield* bestGuessPdfSignatureFieldPlacement({
                    template,
                    documentId: id,
                    draft: signatureDraft,
                  })
                : { ...requested, documentId: id, draft: signatureDraft };
            const placed = yield* placePdfSignatureField(template, placement);
            const field = placed.fields.find((candidate) => candidate.id === signatureDraft.id);
            if (field === undefined)
              return yield* Effect.die("The PDF builder must return its placed signature field");
            const updated = {
              ...entry,
              template: placed,
              rect: field.rect,
              signed: false,
              signedPdf: undefined,
            };
            yield* Ref.set(
              documents,
              entries.map((document) => (document.id === id ? updated : document)),
            );
            return {
              id: updated.id,
              name: updated.name,
              pages: updated.pages,
              rect: updated.rect,
              signed: updated.signed,
            };
          }),
        );
      }),
      signDocument: Effect.fn(function* (id, options, stamp) {
        return yield* mutations.withPermit(
          Effect.gen(function* () {
            const entries = yield* Ref.get(documents);
            const entry = entries.find((document) => document.id === id);
            if (entry === undefined)
              return yield* new PdfError({
                code: PdfErrorCodeValue.unknownDocument,
                retryable: false,
                operation: PdfOperationValue.signField,
                reason: "The selected signing document is no longer available.",
              });
            let input: PdfSigningInput = {
              ...options,
              pdf: entry.pdf,
              template: entry.template,
              fieldId: signatureDraft.id,
            };
            if (stamp !== undefined) {
              if (entry.rect === undefined)
                return yield* new PdfError({
                  code: PdfErrorCodeValue.unknownField,
                  retryable: false,
                  operation: PdfOperationValue.signField,
                  reason: "A visible signature requires a placed signature field.",
                });
              const results = yield* preparePdfSigningBatch({
                documents: [
                  {
                    id,
                    pdf: entry.pdf,
                    template: entry.template,
                    fieldId: signatureDraft.id,
                    rect: entry.rect,
                    pageDimensions: entry.pages,
                  },
                ],
                signing: options ?? {},
                stamp,
              });
              const prepared = results[0];
              if (prepared === undefined)
                return yield* Effect.die("PDF batch preparation must return its selected document");
              if (!prepared.ok) return yield* prepared.error;
              input = prepared.item.input;
            }
            const signedPdf = yield* signPdfSignatureField(input);
            const updated = { ...entry, signedPdf, signed: true };
            yield* Ref.set(
              documents,
              entries.map((document) => (document.id === id ? updated : document)),
            );
            return {
              id: updated.id,
              name: updated.name,
              pages: updated.pages,
              rect: updated.rect,
              signed: true,
            };
          }),
        );
      }),
      sourceDocument: Effect.fn(function* (id) {
        const entries = yield* Ref.get(documents);
        const entry = entries.find((document) => document.id === id);
        if (entry === undefined)
          return yield* new PdfError({
            code: PdfErrorCodeValue.unknownDocument,
            retryable: false,
            operation: PdfOperationValue.loadDocument,
            reason: "The selected signing document is no longer available.",
          });
        return new Uint8Array(entry.pdf);
      }),
      exportDocument: Effect.fn(function* (id) {
        const entries = yield* Ref.get(documents);
        const entry = entries.find((document) => document.id === id);
        if (entry === undefined || entry.signedPdf === undefined)
          return yield* new PdfError({
            code: PdfErrorCodeValue.invalidBuilderInput,
            retryable: false,
            operation: PdfOperationValue.signField,
            reason: "The selected document has no signed PDF to download.",
          });
        return new Blob([new Uint8Array(entry.signedPdf)], { type: "application/pdf" });
      }),
      removeDocument: Effect.fn(function* (id) {
        yield* mutations.withPermit(
          Ref.update(documents, (current) => current.filter((document) => document.id !== id)),
        );
      }),
    });
  }),
);
