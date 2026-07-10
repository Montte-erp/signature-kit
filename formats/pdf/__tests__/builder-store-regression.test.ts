import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import {
  createPdfSignatureBuilderStateFromTemplate,
  createPdfSignatureTemplate,
} from "../src/builder";
import {
  bestGuessPdfSignatureFieldPlacement,
  createPdfSignatureBuilderStore,
  placePdfSignatureFieldsBatch,
} from "../src/builder-store";
import {
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfSignatureTemplateInputSchema,
  PdfSignatureTemplateSchema,
} from "../src/config";
import type { PdfSignatureFieldDraft, PdfSignerRole } from "../src/config";

const templateFixture = (roles: ReadonlyArray<PdfSignerRole>) => ({
  id: "builder-store-template",
  name: "Builder store template",
  documents: [
    {
      id: "document-1",
      name: "document.pdf",
      source: { type: "uploaded" },
      pages: [{ index: 0, width: 320, height: 180 }],
    },
  ],
  roles,
  fields: [],
});
const templateInput = (roles: ReadonlyArray<PdfSignerRole>) =>
  Schema.decodeUnknownEffect(PdfSignatureTemplateInputSchema)(templateFixture(roles));
const template = (roles: ReadonlyArray<PdfSignerRole>) =>
  Schema.decodeUnknownEffect(PdfSignatureTemplateSchema)(templateFixture(roles));
const draftFor = (id: string, roleId: string): PdfSignatureFieldDraft => ({
  id,
  type: "signature",
  roleId,
  width: 120,
  height: 40,
});

describe("PDF signature builder store invariants", () => {
  it.effect("rejects an initial draft whose role is absent from the template", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        createPdfSignatureBuilderStateFromTemplate({
          template: yield* templateInput([{ id: "signer-1", label: "Signer" }]),
          draft: draftFor("draft-1", "missing-role"),
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.unknownRole);
        expect(result.failure.operation).toBe(PdfOperationValue.createBuilderState);
      }
    }),
  );

  it.effect("clears a draft when setTemplate removes its role", () =>
    Effect.gen(function* () {
      const initial = yield* createPdfSignatureBuilderStateFromTemplate({
        template: yield* templateInput([{ id: "signer-1", label: "Signer" }]),
        draft: draftFor("draft-1", "signer-1"),
      });
      const store = createPdfSignatureBuilderStore(initial);
      yield* store.setTemplate(yield* template([{ id: "signer-2", label: "Replacement" }]));

      expect(store.getSnapshot().draft).toBeUndefined();
    }),
  );

  it.effect("rejects invalid draft setter input without mutating builder state", () =>
    Effect.gen(function* () {
      const template = yield* createPdfSignatureTemplate(
        yield* templateInput([{ id: "signer-1", label: "Signer" }]),
      );
      const store = createPdfSignatureBuilderStore({ template });
      const unknownRole = yield* Effect.result(
        store.setDraft(draftFor("unknown-role", "missing-role")),
      );
      const invalidDimensions = yield* Effect.result(
        store.setDraft({
          ...draftFor("invalid-dimensions", "signer-1"),
          width: Number.POSITIVE_INFINITY,
        }),
      );

      expect(Result.isFailure(unknownRole)).toBe(true);
      if (Result.isFailure(unknownRole)) {
        expect(unknownRole.failure.code).toBe(PdfErrorCodeValue.unknownRole);
      }
      expect(Result.isFailure(invalidDimensions)).toBe(true);
      if (Result.isFailure(invalidDimensions)) {
        expect(invalidDimensions.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
      }
      expect(store.getSnapshot().draft).toBeUndefined();
    }),
  );

  it.effect("evaluates deferred draft updates against the current template", () =>
    Effect.gen(function* () {
      const initial = yield* createPdfSignatureBuilderStateFromTemplate({
        template: yield* templateInput([{ id: "signer-1", label: "Signer" }]),
      });
      const store = createPdfSignatureBuilderStore(initial);
      const deferredDraft = store.setDraft(draftFor("deferred-draft", "signer-2"));

      yield* store.setTemplate(yield* template([{ id: "signer-2", label: "Replacement" }]));
      const state = yield* deferredDraft;

      expect(state.template.roles[0]?.id).toBe("signer-2");
      expect(state.draft?.roleId).toBe("signer-2");
      expect(store.getSnapshot()).toEqual(state);
    }),
  );

  it.effect("continues every placement across observer hooks and item failures", () =>
    Effect.gen(function* () {
      const template = yield* createPdfSignatureTemplate(
        yield* templateInput([{ id: "signer-1", label: "Signer" }]),
      );
      const stores = [
        createPdfSignatureBuilderStore({ template }),
        createPdfSignatureBuilderStore({ template }),
        createPdfSignatureBuilderStore({ template }),
      ];
      const started: number[] = [];
      const settled: number[] = [];
      const yielded: number[] = [];

      const results = yield* placePdfSignatureFieldsBatch(
        stores.map((store, index) => ({
          id: `item-${index}`,
          store,
          documentId: "document-1",
          draft: draftFor(`field-${index}`, "signer-1"),
          ...(index === 1 ? { pageIndex: 1 } : {}),
        })),
        {
          onItemStarted: (_item, index) => {
            started.push(index);
          },
          onItemSettled: (_result, index) => {
            settled.push(index);
          },
          yieldAfterItem: (_result, index) =>
            Effect.sync(() => {
              yielded.push(index);
            }),
        },
      );

      expect(results.map((result) => result.id)).toEqual(["item-0", "item-1", "item-2"]);
      expect(results.map((result) => result.ok)).toEqual([true, false, true]);
      const failedResult = results[1];
      if (failedResult !== undefined && !failedResult.ok) {
        expect(failedResult.error.code).toBe(PdfErrorCodeValue.noAvailablePlacement);
      }
      expect(started).toEqual([0, 1, 2]);
      expect(settled).toEqual([0, 1, 2]);
      expect(yielded).toEqual([0, 1, 2]);
    }),
  );

  it.effect("uses template order for first and last pages with noncanonical indexes", () =>
    Effect.gen(function* () {
      const singlePageTemplate = yield* createPdfSignatureTemplate({
        id: "single-noncanonical-page",
        name: "Single noncanonical page",
        documents: [
          {
            id: "document-1",
            name: "document.pdf",
            source: { type: "uploaded" },
            pages: [{ index: 5, width: 320, height: 180 }],
          },
        ],
        roles: [{ id: "signer-1", label: "Signer" }],
        fields: [],
      });
      const reorderedTemplate = yield* createPdfSignatureTemplate({
        id: "reordered-noncanonical-pages",
        name: "Reordered noncanonical pages",
        documents: [
          {
            id: "document-1",
            name: "document.pdf",
            source: { type: "uploaded" },
            pages: [
              { index: 17, width: 320, height: 180 },
              { index: 5, width: 320, height: 180 },
              { index: 42, width: 320, height: 180 },
            ],
          },
        ],
        roles: [{ id: "signer-1", label: "Signer" }],
        fields: [],
      });

      const singleFirst = yield* bestGuessPdfSignatureFieldPlacement({
        template: singlePageTemplate,
        documentId: "document-1",
        page: "first",
        draft: draftFor("single-first", "signer-1"),
      });
      const singleLast = yield* bestGuessPdfSignatureFieldPlacement({
        template: singlePageTemplate,
        documentId: "document-1",
        page: "last",
        draft: draftFor("single-last", "signer-1"),
      });
      const reorderedFirst = yield* bestGuessPdfSignatureFieldPlacement({
        template: reorderedTemplate,
        documentId: "document-1",
        page: "first",
        draft: draftFor("reordered-first", "signer-1"),
      });
      const reorderedLast = yield* bestGuessPdfSignatureFieldPlacement({
        template: reorderedTemplate,
        documentId: "document-1",
        page: "last",
        draft: draftFor("reordered-last", "signer-1"),
      });
      const explicit = yield* bestGuessPdfSignatureFieldPlacement({
        template: reorderedTemplate,
        documentId: "document-1",
        pageIndex: 5,
        draft: draftFor("explicit", "signer-1"),
      });

      expect(singleFirst.pageIndex).toBe(5);
      expect(singleLast.pageIndex).toBe(5);
      expect(reorderedFirst.pageIndex).toBe(17);
      expect(reorderedLast.pageIndex).toBe(42);
      expect(explicit.pageIndex).toBe(5);
    }),
  );
  it.effect("decodes and validates best-guess public input", () =>
    Effect.gen(function* () {
      const template = yield* createPdfSignatureTemplate(
        yield* templateInput([{ id: "signer-1", label: "Signer" }]),
      );
      const invalidInputs = [
        {
          template,
          documentId: "document-1",
          draft: draftFor("negative-page", "signer-1"),
          pageIndex: -1,
        },
        {
          template,
          documentId: "document-1",
          draft: draftFor("fractional-page", "signer-1"),
          pageIndex: 0.5,
        },
        {
          template,
          documentId: "document-1",
          draft: draftFor("infinite-margin", "signer-1"),
          margin: Number.POSITIVE_INFINITY,
        },
        {
          template,
          documentId: "document-1",
          draft: { ...draftFor("invalid-draft", "signer-1"), height: Number.NaN },
        },
      ];
      for (const input of invalidInputs) {
        const result = yield* Effect.result(bestGuessPdfSignatureFieldPlacement(input));
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
        }
      }

      const duplicatePageTemplate = yield* Schema.decodeUnknownEffect(PdfSignatureTemplateSchema)({
        id: "duplicate-best-guess-template",
        name: "Duplicate best-guess template",
        documents: [
          {
            id: "document-1",
            name: "document.pdf",
            source: { type: "uploaded" },
            pages: [
              { index: 0, width: 320, height: 180 },
              { index: 0, width: 320, height: 180 },
            ],
          },
        ],
        roles: [{ id: "signer-1", label: "Signer" }],
        fields: [],
      });
      const duplicateResult = yield* Effect.result(
        bestGuessPdfSignatureFieldPlacement({
          template: duplicatePageTemplate,
          documentId: "document-1",
          draft: draftFor("duplicate-page", "signer-1"),
        }),
      );

      expect(Result.isFailure(duplicateResult)).toBe(true);
      if (Result.isFailure(duplicateResult)) {
        expect(duplicateResult.failure.code).toBe(PdfErrorCodeValue.duplicateId);
      }
    }),
  );
});
