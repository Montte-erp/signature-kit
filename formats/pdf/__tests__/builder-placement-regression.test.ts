import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import {
  autoPlacePdfSignatureField,
  createPdfSignatureTemplate,
  validatePdfSignatureTemplate,
} from "../src/builder";
import { PdfErrorCodeValue, PdfOperationValue } from "../src/config";

describe("stacked PDF signature auto-placement", () => {
  it.effect("fails typed instead of recursing when a tiny horizontal step cannot advance", () =>
    Effect.gen(function* () {
      const template = yield* createPdfSignatureTemplate({
        id: "stacked-placement-template",
        name: "Stacked placement",
        documents: [
          {
            id: "document-1",
            name: "document.pdf",
            source: { type: "uploaded" },
            pages: [{ index: 0, width: 320, height: 180 }],
          },
        ],
        roles: [{ id: "signer-1", label: "Signer" }],
        fields: [
          {
            id: "occupied",
            type: "signature",
            documentId: "document-1",
            roleId: "signer-1",
            rect: { pageIndex: 0, x: 19, y: 20, width: 2, height: 40 },
          },
        ],
      });
      const startedAt = performance.now();
      const result = yield* Effect.result(
        autoPlacePdfSignatureField(template, {
          documentId: "document-1",
          pageIndex: 0,
          slot: "top-left",
          margin: 20,
          gap: 0,
          collision: "stack",
          stackDirection: "right",
          draft: {
            id: "candidate",
            type: "signature",
            roleId: "signer-1",
            width: Number.MIN_VALUE,
            height: 40,
          },
        }),
      );

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.noAvailablePlacement);
        expect(result.failure.operation).toBe(PdfOperationValue.autoPlaceField);
      }
      expect(performance.now() - startedAt).toBeLessThan(1000);
    }),
  );

  it.effect("rejects duplicate page indexes within one document", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        validatePdfSignatureTemplate({
          id: "duplicate-page-index-template",
          name: "Duplicate page index",
          documents: [
            {
              id: "document-1",
              name: "document.pdf",
              source: { type: "uploaded" },
              pages: [
                { index: 0, width: 320, height: 180 },
                { index: 0, width: 640, height: 360 },
              ],
            },
          ],
          roles: [{ id: "signer-1", label: "Signer" }],
          fields: [],
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.duplicateId);
        expect(result.failure.operation).toBe(PdfOperationValue.validateTemplate);
      }
    }),
  );
});
