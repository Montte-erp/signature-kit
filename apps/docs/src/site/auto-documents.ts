import { Context, Effect, Layer, Redacted, Ref } from "effect";
import { PdfError, PdfErrorCodeValue, PdfOperationValue } from "@signature-kit/pdf/config";
import type { FormalContractOptions } from "../../lib/formal-contract.ts";
import type { PdfPreview } from "./pdf-preview.ts";

export class AutoDocuments extends Context.Service<
  AutoDocuments,
  {
    readonly generate: (id: string, options: FormalContractOptions) => Effect.Effect<void>;
    readonly sourceDocument: (id: string) => Effect.Effect<Uint8Array, PdfError>;
  }
>()("@signature-kit/docs/AutoDocuments") {}

export class AutoPreview extends Context.Service<
  AutoPreview,
  Context.Service.Shape<typeof PdfPreview>
>()("@signature-kit/docs/AutoPreview") {}

export const autoDocumentsLayer = Layer.effect(
  AutoDocuments,
  Effect.gen(function* () {
    const documents = yield* Effect.acquireRelease(
      Ref.make<ReadonlyMap<string, Redacted.Redacted<Uint8Array>>>(new Map()),
      (state) => Ref.set(state, new Map()),
    );
    const generator = yield* Effect.cached(
      Effect.promise(() => import("../../components/formal-contract-pdf.tsx")),
    );
    return AutoDocuments.of({
      generate: Effect.fn(function* (id, options) {
        const sdk = yield* generator;
        const bytes = yield* Effect.promise(() => sdk.generateFormalContractPdf(options));
        yield* Ref.update(documents, (current) => new Map(current).set(id, Redacted.make(bytes)));
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
        return Redacted.value(bytes).slice();
      }),
    });
  }),
);
