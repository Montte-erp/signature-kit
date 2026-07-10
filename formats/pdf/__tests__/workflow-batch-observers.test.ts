import { PDFDocument } from "@cantoo/pdf-lib";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import type { PdfSignaturePage, PdfSignatureRect, PdfSignatureTemplate } from "../src/config";
import { PdfErrorCodeValue } from "../src/config";
import { preparePdfSigningBatch, signPdfSignatureBatch } from "../src/workflow";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import type { Signatures } from "@signature-kit/signatures";
import { readA1Fixture } from "../../../tooling/testing/fixtures";

const createPdf = (): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const document = await PDFDocument.create();
    document.addPage([320, 180]);
    return new Uint8Array(await document.save({ useObjectStreams: false }));
  });

const PASSWORD = Redacted.make("changeit");

const withTestSignatures = <A, E>(effect: Effect.Effect<A, E, Signatures>) =>
  readA1Fixture("ecnpj").pipe(
    Effect.flatMap((pfx) =>
      effect.pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD }))),
    ),
  );

const templateFor = (
  documentId: string,
  pages: ReadonlyArray<PdfSignaturePage>,
  rect: PdfSignatureRect,
): PdfSignatureTemplate => ({
  id: `template-${documentId}`,
  name: `${documentId}.pdf`,
  documents: [
    {
      id: documentId,
      name: `${documentId}.pdf`,
      source: { type: "uploaded" },
      pages,
    },
  ],
  roles: [{ id: "signer", label: "Signer" }],
  fields: [
    {
      id: "signature",
      type: "signature",
      documentId,
      roleId: "signer",
      rect,
    },
  ],
});

describe("PDF batch observer isolation", () => {
  it.effect("continues preparing every item when observers throw, fail, or die", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf();
      const pages: PdfSignaturePage[] = [{ index: 0, width: 320, height: 180 }];
      const rect: PdfSignatureRect = { pageIndex: 0, x: 20, y: 20, width: 100, height: 40 };
      const settled: number[] = [];
      const yielded: number[] = [];

      const results = yield* preparePdfSigningBatch(
        {
          documents: ["a", "b", "c"].map((id) => ({
            id,
            pdf,
            template: templateFor(id, pages, rect),
            fieldId: "signature",
            rect,
            pageDimensions: pages,
          })),
          signing: {},
        },
        {
          onItemSettled: (_result, index) => {
            settled.push(index);
            throw new Error("observer throw");
          },
          yieldAfterItem: (_result, index) => {
            yielded.push(index);
            if (index === 0) return Effect.die("observer failure");
            if (index === 1) return Effect.die("observer defect");
            throw new Error("observer throw");
          },
        },
      );

      expect(results.map((result) => result.id)).toEqual(["a", "b", "c"]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(settled).toEqual([0, 1, 2]);
      expect(yielded).toEqual([0, 1, 2]);
    }),
  );

  it.effect("continues signing every item when its observer throws", () =>
    withTestSignatures(
      Effect.gen(function* () {
        const pdf = yield* createPdf();
        const pages: PdfSignaturePage[] = [{ index: 0, width: 320, height: 180 }];
        const rect: PdfSignatureRect = { pageIndex: 0, x: 20, y: 20, width: 100, height: 40 };
        const template = templateFor("document", pages, rect);
        const settled: number[] = [];

        const results = yield* signPdfSignatureBatch(
          ["a", "b", "c"].map((id) => ({
            id,
            input: {
              pdf,
              template,
              fieldId: "missing-field",
            },
          })),
          {
            onItemSettled: (_result, index) => {
              settled.push(index);
              throw new Error("observer throw");
            },
          },
        );

        expect(results.map((result) => result.id)).toEqual(["a", "b", "c"]);
        expect(results.every((result) => !result.ok)).toBe(true);
        expect(settled).toEqual([0, 1, 2]);
        for (const result of results) {
          if (!result.ok) {
            expect(result.error.code).toBe(PdfErrorCodeValue.unknownField);
          }
        }
      }),
    ),
  );
});
