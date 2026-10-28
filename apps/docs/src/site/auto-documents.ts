import { Context, Effect, Layer, Redacted, Ref, Schema, Semaphore } from "effect";
import { PdfError, PdfErrorCodeValue, PdfOperationValue } from "@signature-kit/pdf/config";
import { stampPdfVisibleSignature } from "@signature-kit/pdf/stamp";
import { formalContractSignatureRect, SignatureVariant } from "../../lib/formal-contract.ts";
import type { FormalContractOptions } from "../../lib/formal-contract.ts";
import type { PdfPreview } from "./pdf-preview.ts";

export class AutoDocuments extends Context.Service<
  AutoDocuments,
  {
    readonly generate: (id: string, options: FormalContractOptions) => Effect.Effect<void>;
    readonly stamp: (id: string, lines: readonly string[]) => Effect.Effect<void, PdfError>;
    readonly reset: Effect.Effect<void>;
    readonly sourceDocument: (id: string) => Effect.Effect<Uint8Array, PdfError>;
  }
>()("@signature-kit/docs/AutoDocuments") {}

export class AutoPreview extends Context.Service<
  AutoPreview,
  Context.Service.Shape<typeof PdfPreview>
>()("@signature-kit/docs/AutoPreview") {}

const StoredDocument = Schema.Struct({
  original: Schema.Redacted(Schema.Uint8Array, { disallowJsonEncode: true }),
  current: Schema.Redacted(Schema.Uint8Array, { disallowJsonEncode: true }),
  variant: SignatureVariant,
});
type StoredDocument = typeof StoredDocument.Type;

export const autoDocumentsLayer = Layer.effect(
  AutoDocuments,
  Effect.gen(function* () {
    const documents = yield* Effect.acquireRelease(
      Ref.make<ReadonlyMap<string, StoredDocument>>(new Map()),
      (state) => Ref.set(state, new Map()),
    );
    const mutations = yield* Semaphore.make(1);
    const generator = yield* Effect.cached(
      Effect.promise(() => import("../../components/formal-contract-pdf.tsx")),
    );
    return AutoDocuments.of({
      generate: Effect.fn(function* (id, options) {
        const sdk = yield* generator;
        const bytes = yield* Effect.promise(() => sdk.generateFormalContractPdf(options));
        yield* Ref.update(documents, (current) =>
          new Map(current).set(id, {
            original: Redacted.make(bytes),
            current: Redacted.make(bytes),
            variant: options.variant,
          }),
        );
      }),
      reset: mutations.withPermit(
        Ref.update(
          documents,
          (current) =>
            new Map(
              [...current].map(([id, stored]) => [id, { ...stored, current: stored.original }]),
            ),
        ),
      ),
      stamp: Effect.fn(function* (id, lines) {
        yield* mutations.withPermit(
          Effect.gen(function* () {
            const stored = (yield* Ref.get(documents)).get(id);
            if (stored === undefined)
              return yield* Effect.die("Only prepared examples can be stamped.");
            const bytes = yield* stampPdfVisibleSignature({
              pdf: Redacted.value(stored.original),
              pageIndex: 0,
              rect: formalContractSignatureRect(stored.variant),
              lines,
              border: false,
            });
            yield* Ref.update(documents, (current) =>
              new Map(current).set(id, { ...stored, current: Redacted.make(bytes) }),
            );
          }),
        );
      }),
      sourceDocument: Effect.fn(function* (id) {
        const bytes = (yield* Ref.get(documents)).get(id);
        if (bytes === undefined)
          return yield* new PdfError({
            code: PdfErrorCodeValue.pdfLoadFailed,
            operation: PdfOperationValue.loadDocument,
            retryable: false,
            reason: "The demonstration PDF has not been prepared.",
          });
        return Redacted.value(bytes.current).slice();
      }),
    });
  }),
);
