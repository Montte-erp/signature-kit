import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFPage,
} from "@cantoo/pdf-lib";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { PdfCoordinateTupleSchema, PdfErrorCodeValue, PdfOperationValue } from "../src/config";
import type { PdfCoordinateTuple, PdfSignatureAppearance } from "../src/config";
import { addSignaturePlaceholder } from "../src/placeholder";
import { resolveSignatureWidgetPlacement } from "../src/placement";

const coordinateArray = (
  pdfDoc: PDFDocument,
  [left, bottom, right, top]: readonly [number, number, number, number],
) => {
  const rect = PDFArray.withContext(pdfDoc.context);
  rect.push(PDFNumber.of(left));
  rect.push(PDFNumber.of(bottom));
  rect.push(PDFNumber.of(right));
  rect.push(PDFNumber.of(top));
  return rect;
};

const addObstacle = (
  pdfDoc: PDFDocument,
  page: PDFPage,
  rect: readonly [number, number, number, number],
) => {
  const annotations = PDFArray.withContext(pdfDoc.context);
  const obstacle = pdfDoc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: coordinateArray(pdfDoc, rect),
    P: page.ref,
  });
  annotations.push(pdfDoc.context.register(obstacle));
  page.node.set(PDFName.of("Annots"), annotations);
};

const createHierarchicalSignatureSlots: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([320, 180]);
  const annotations = PDFArray.withContext(pdfDoc.context);
  const fields = PDFArray.withContext(pdfDoc.context);

  for (const rect of [
    [20, 20, 140, 60],
    [180, 20, 300, 60],
  ] satisfies ReadonlyArray<readonly [number, number, number, number]>) {
    const widget = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "Widget",
      Rect: coordinateArray(pdfDoc, rect),
      F: 1,
      P: page.ref,
    });
    const widgetRef = pdfDoc.context.register(widget);
    const kids = PDFArray.withContext(pdfDoc.context);
    kids.push(widgetRef);
    const signatureField = pdfDoc.context.obj({
      FT: "Sig",
      T: PDFString.of("DuplicateSignatureName"),
      Kids: kids,
    });
    const signatureFieldRef = pdfDoc.context.register(signatureField);
    widget.set(PDFName.of("Parent"), signatureFieldRef);
    annotations.push(widgetRef);
    fields.push(signatureFieldRef);
  }

  page.node.set(PDFName.of("Annots"), annotations);
  const acroForm = pdfDoc.context.obj({ Fields: fields });
  pdfDoc.catalog.set(PDFName.of("AcroForm"), pdfDoc.context.register(acroForm));
  return pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
});

const createInheritedSignatureSlot: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([320, 180]);
  const widget = pdfDoc.context.obj({
    Type: "Annot",
    Subtype: "Widget",
    Rect: coordinateArray(pdfDoc, [180, 20, 300, 60]),
    P: page.ref,
  });
  const widgetRef = pdfDoc.context.register(widget);
  const intermediateKids = PDFArray.withContext(pdfDoc.context);
  intermediateKids.push(widgetRef);
  const intermediateField = pdfDoc.context.obj({ Kids: intermediateKids });
  const intermediateFieldRef = pdfDoc.context.register(intermediateField);
  const rootKids = PDFArray.withContext(pdfDoc.context);
  rootKids.push(intermediateFieldRef);
  const rootField = pdfDoc.context.obj({
    FT: "Sig",
    T: PDFString.of("InheritedSignature"),
    Kids: rootKids,
  });
  const rootFieldRef = pdfDoc.context.register(rootField);
  widget.set(PDFName.of("Parent"), intermediateFieldRef);
  intermediateField.set(PDFName.of("Parent"), rootFieldRef);
  const annotations = PDFArray.withContext(pdfDoc.context);
  annotations.push(widgetRef);
  page.node.set(PDFName.of("Annots"), annotations);
  const fields = PDFArray.withContext(pdfDoc.context);
  fields.push(rootFieldRef);
  const acroForm = pdfDoc.context.obj({ Fields: fields });
  pdfDoc.catalog.set(PDFName.of("AcroForm"), pdfDoc.context.register(acroForm));
  return pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
});

const createCyclicSignatureSlot: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([320, 180]);
  const widget = pdfDoc.context.obj({
    Type: "Annot",
    Subtype: "Widget",
    Rect: coordinateArray(pdfDoc, [180, 20, 300, 60]),
    P: page.ref,
  });
  const widgetRef = pdfDoc.context.register(widget);
  const intermediateKids = PDFArray.withContext(pdfDoc.context);
  intermediateKids.push(widgetRef);
  const intermediateField = pdfDoc.context.obj({ Kids: intermediateKids });
  const intermediateFieldRef = pdfDoc.context.register(intermediateField);
  const rootKids = PDFArray.withContext(pdfDoc.context);
  rootKids.push(intermediateFieldRef);
  const rootField = pdfDoc.context.obj({ FT: "Sig", Kids: rootKids });
  const rootFieldRef = pdfDoc.context.register(rootField);
  widget.set(PDFName.of("Parent"), intermediateFieldRef);
  intermediateField.set(PDFName.of("Parent"), rootFieldRef);
  rootField.set(PDFName.of("Parent"), intermediateFieldRef);
  const annotations = PDFArray.withContext(pdfDoc.context);
  annotations.push(widgetRef);
  page.node.set(PDFName.of("Annots"), annotations);
  const fields = PDFArray.withContext(pdfDoc.context);
  fields.push(rootFieldRef);
  const acroForm = pdfDoc.context.obj({ Fields: fields });
  pdfDoc.catalog.set(PDFName.of("AcroForm"), pdfDoc.context.register(acroForm));
  return pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
});

const createMergedSiblingSignatureSlots: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([320, 180]);
  const annotations = PDFArray.withContext(pdfDoc.context);
  const kids = PDFArray.withContext(pdfDoc.context);
  const widgets: PDFDict[] = [];

  for (const rect of [
    [20, 20, 140, 60],
    [180, 20, 300, 60],
  ] satisfies ReadonlyArray<readonly [number, number, number, number]>) {
    const widget = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Sig",
      T: PDFString.of("MergedSignature"),
      Rect: coordinateArray(pdfDoc, rect),
      P: page.ref,
    });
    const widgetRef = pdfDoc.context.register(widget);
    widgets.push(widget);
    annotations.push(widgetRef);
    kids.push(widgetRef);
  }
  const rootField = pdfDoc.context.obj({ Kids: kids });
  const rootFieldRef = pdfDoc.context.register(rootField);
  for (const widget of widgets) widget.set(PDFName.of("Parent"), rootFieldRef);
  page.node.set(PDFName.of("Annots"), annotations);
  const fields = PDFArray.withContext(pdfDoc.context);
  fields.push(rootFieldRef);
  const acroForm = pdfDoc.context.obj({ Fields: fields });
  pdfDoc.catalog.set(PDFName.of("AcroForm"), pdfDoc.context.register(acroForm));
  return pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
});

const hierarchyPlacement = {
  placement: {
    kind: "auto",
    pageIndex: 0,
    width: 120,
    height: 40,
    margin: 20,
    gap: 8,
    anchor: "bottom-right",
  },
} satisfies PdfSignatureAppearance;
describe("PDF auto-placement geometry", () => {
  it.effect("uses CropBox-relative rotated coordinates for obstacles", () =>
    Effect.gen(function* () {
      const cases = [
        {
          rotation: 90,
          empty: [260, 210, 290, 250],
          blocked: [230, 210, 260, 250],
        },
        {
          rotation: 270,
          empty: [110, 110, 140, 150],
          blocked: [140, 110, 170, 150],
        },
      ] satisfies ReadonlyArray<{
        readonly rotation: number;
        readonly empty: PdfCoordinateTuple;
        readonly blocked: PdfCoordinateTuple;
      }>;

      for (const placementCase of cases) {
        const pdfDoc = yield* Effect.promise(() => PDFDocument.create());
        const page = pdfDoc.addPage([400, 400]);
        page.setCropBox(100, 100, 200, 160);
        page.setRotation(degrees(placementCase.rotation));

        const empty = yield* resolveSignatureWidgetPlacement(pdfDoc, {
          placement: {
            kind: "auto",
            pageIndex: 0,
            width: 40,
            height: 30,
            margin: 10,
            gap: 0,
            anchor: "bottom-right",
          },
        });
        expect(empty.widgetRect).toEqual(placementCase.empty);

        addObstacle(pdfDoc, page, placementCase.empty);
        const blocked = yield* resolveSignatureWidgetPlacement(pdfDoc, {
          placement: {
            kind: "auto",
            pageIndex: 0,
            width: 40,
            height: 30,
            margin: 10,
            gap: 0,
            anchor: "bottom-right",
          },
        });
        expect(blocked.widgetRect).toEqual(placementCase.blocked);
      }
    }),
  );
  it.effect("skips blank signature widgets outside the rotated CropBox", () =>
    Effect.gen(function* () {
      const pdfDoc = yield* Effect.promise(() => PDFDocument.create());
      const page = pdfDoc.addPage([400, 400]);
      page.setCropBox(100, 100, 200, 160);
      page.setRotation(degrees(90));
      const annotations = PDFArray.withContext(pdfDoc.context);
      const widget = pdfDoc.context.obj({
        Type: "Annot",
        Subtype: "Widget",
        FT: "Sig",
        Rect: coordinateArray(pdfDoc, [10, 10, 80, 50]),
        P: page.ref,
      });
      annotations.push(pdfDoc.context.register(widget));
      page.node.set(PDFName.of("Annots"), annotations);

      const resolved = yield* resolveSignatureWidgetPlacement(pdfDoc, {
        placement: {
          kind: "auto",
          pageIndex: 0,
          width: 40,
          height: 30,
          margin: 10,
          gap: 0,
          anchor: "bottom-right",
        },
      });

      expect(resolved.widgetRect).toEqual([260, 210, 290, 250]);
      expect(resolved.existingWidgetObject).toBeUndefined();
    }),
  );
  it.effect("preserves manual widget rectangles in raw PDF coordinates", () =>
    Effect.gen(function* () {
      const pdfDoc = yield* Effect.promise(() => PDFDocument.create());
      const page = pdfDoc.addPage([400, 400]);
      page.setCropBox(100, 100, 200, 160);
      page.setRotation(degrees(90));

      const resolved = yield* resolveSignatureWidgetPlacement(pdfDoc, {
        placement: { kind: "manual", pageIndex: 0, widgetRect: [10, 10, 80, 50] },
      });

      expect(resolved.widgetRect).toEqual([10, 10, 80, 50]);
    }),
  );

  it.effect("binds hierarchical signature widgets through their selected parent field", () =>
    Effect.gen(function* () {
      const source = yield* createHierarchicalSignatureSlots;
      const sourceDocument = yield* Effect.promise(() => PDFDocument.load(source));
      const resolved = yield* resolveSignatureWidgetPlacement(sourceDocument, hierarchyPlacement);
      expect(resolved.widgetRect).toEqual([180, 20, 300, 60]);
      expect(resolved.existingWidgetObject).not.toBeUndefined();
      expect(resolved.existingSignatureFieldObject).not.toBeUndefined();
      expect(resolved.existingWidgetObject).not.toEqual(resolved.existingSignatureFieldObject);

      const prepared = yield* addSignaturePlaceholder({
        pdf: source,
        signatureLength: 128,
        appearance: hierarchyPlacement,
      });
      const preparedDocument = yield* Effect.promise(() => PDFDocument.load(prepared));
      const acroForm = preparedDocument.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
      const fields = acroForm?.lookupMaybe(PDFName.of("Fields"), PDFArray);
      const firstField =
        fields === undefined
          ? undefined
          : preparedDocument.context.lookupMaybe(fields.get(0), PDFDict);
      const secondField =
        fields === undefined
          ? undefined
          : preparedDocument.context.lookupMaybe(fields.get(1), PDFDict);
      const secondKids = secondField?.lookupMaybe(PDFName.of("Kids"), PDFArray);
      const secondWidget =
        secondKids === undefined
          ? undefined
          : preparedDocument.context.lookupMaybe(secondKids.get(0), PDFDict);

      expect(firstField?.get(PDFName.of("V"))).toBeUndefined();
      expect(secondField?.get(PDFName.of("V"))).not.toBeUndefined();
      expect(secondWidget?.get(PDFName.of("V"))).toBeUndefined();
      expect(secondWidget?.get(PDFName.of("T"))).toBeUndefined();
      expect(secondWidget?.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber()).toBe(5);
      expect(secondWidget?.get(PDFName.of("Parent"))?.toString()).toBe(fields?.get(1)?.toString());
    }),
  );

  it.effect("binds an inherited signature type to its terminal child field", () =>
    Effect.gen(function* () {
      const source = yield* createInheritedSignatureSlot;
      const sourceDocument = yield* Effect.promise(() => PDFDocument.load(source));
      const resolved = yield* resolveSignatureWidgetPlacement(sourceDocument, hierarchyPlacement);
      const sourceAcroForm = sourceDocument.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
      const sourceFields = sourceAcroForm?.lookupMaybe(PDFName.of("Fields"), PDFArray);
      const sourceRoot =
        sourceFields === undefined
          ? undefined
          : sourceDocument.context.lookupMaybe(sourceFields.get(0), PDFDict);
      const sourceRootKids = sourceRoot?.lookupMaybe(PDFName.of("Kids"), PDFArray);

      expect(resolved.widgetRect).toEqual([180, 20, 300, 60]);
      expect(resolved.existingSignatureFieldObject?.toString()).toBe(
        sourceRootKids?.get(0)?.toString(),
      );

      const prepared = yield* addSignaturePlaceholder({
        pdf: source,
        signatureLength: 128,
        appearance: hierarchyPlacement,
      });
      const preparedDocument = yield* Effect.promise(() => PDFDocument.load(prepared));
      const acroForm = preparedDocument.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
      const fields = acroForm?.lookupMaybe(PDFName.of("Fields"), PDFArray);
      const root =
        fields === undefined
          ? undefined
          : preparedDocument.context.lookupMaybe(fields.get(0), PDFDict);
      const rootKids = root?.lookupMaybe(PDFName.of("Kids"), PDFArray);
      const terminal =
        rootKids === undefined
          ? undefined
          : preparedDocument.context.lookupMaybe(rootKids.get(0), PDFDict);
      const terminalKids = terminal?.lookupMaybe(PDFName.of("Kids"), PDFArray);
      const widget =
        terminalKids === undefined
          ? undefined
          : preparedDocument.context.lookupMaybe(terminalKids.get(0), PDFDict);

      expect(root?.get(PDFName.of("V"))).toBeUndefined();
      expect(terminal?.get(PDFName.of("V"))).not.toBeUndefined();
      expect(widget?.get(PDFName.of("V"))).toBeUndefined();
    }),
  );

  it.effect("fails typed when the selected signature hierarchy is cyclic", () =>
    Effect.gen(function* () {
      const source = yield* createCyclicSignatureSlot;
      const sourceDocument = yield* Effect.promise(() => PDFDocument.load(source));
      const result = yield* Effect.result(
        resolveSignatureWidgetPlacement(sourceDocument, hierarchyPlacement),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("pdf.SIGNATURE_PLACEMENT_FAILED");
      }
    }),
  );

  it.effect("keeps a merged signature widget as its own value owner", () =>
    Effect.gen(function* () {
      const source = yield* createMergedSiblingSignatureSlots;
      const prepared = yield* addSignaturePlaceholder({
        pdf: source,
        signatureLength: 128,
        appearance: hierarchyPlacement,
      });
      const preparedDocument = yield* Effect.promise(() => PDFDocument.load(prepared));
      const acroForm = preparedDocument.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
      const fields = acroForm?.lookupMaybe(PDFName.of("Fields"), PDFArray);
      const root =
        fields === undefined
          ? undefined
          : preparedDocument.context.lookupMaybe(fields.get(0), PDFDict);
      const kids = root?.lookupMaybe(PDFName.of("Kids"), PDFArray);
      const firstWidget =
        kids === undefined ? undefined : preparedDocument.context.lookupMaybe(kids.get(0), PDFDict);
      const secondWidget =
        kids === undefined ? undefined : preparedDocument.context.lookupMaybe(kids.get(1), PDFDict);

      expect(root?.get(PDFName.of("V"))).toBeUndefined();
      expect(firstWidget?.get(PDFName.of("V"))).toBeUndefined();
      expect(secondWidget?.get(PDFName.of("V"))).not.toBeUndefined();
    }),
  );

  it.effect("rejects non-finite, zero-area, and inverted widget rectangles", () =>
    Effect.gen(function* () {
      const invalidTuple = yield* Effect.result(
        Schema.decodeUnknownEffect(PdfCoordinateTupleSchema)([Number.NaN, 0, 10, 10]),
      );
      expect(Result.isFailure(invalidTuple)).toBe(true);

      const pdfDoc = yield* Effect.promise(() => PDFDocument.create());
      pdfDoc.addPage([320, 180]);
      const pdf = yield* Effect.promise(() => pdfDoc.save({ useObjectStreams: false }));
      const invisible = yield* addSignaturePlaceholder({ pdf, signatureLength: 128 });
      expect(invisible.byteLength).toBeGreaterThan(pdf.byteLength);
      const invalidRects: ReadonlyArray<PdfCoordinateTuple> = [
        [Number.NaN, 0, 10, 10],
        [0, 0, Number.POSITIVE_INFINITY, 10],
        [0, 0, 0, 10],
        [10, 0, 0, 10],
        [0, 10, 10, 0],
      ];

      for (const widgetRect of invalidRects) {
        const result = yield* Effect.result(
          addSignaturePlaceholder({
            pdf,
            signatureLength: 128,
            appearance: { pageIndex: 0, widgetRect },
          }),
        );
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.operation).toBe("pdf.placeholder");
        }
      }
    }),
  );

  it.effect("bounds auto-placement comparisons without rejecting the exact budget boundary", () =>
    Effect.gen(function* () {
      for (const placementCase of [
        { obstacleCount: 1_000, expectedFailure: false },
        { obstacleCount: 1_001, expectedFailure: true },
      ] satisfies ReadonlyArray<{ obstacleCount: number; expectedFailure: boolean }>) {
        const pdfDoc = yield* Effect.promise(() => PDFDocument.create());
        const page = pdfDoc.addPage([1_000, 1]);
        const annotations = PDFArray.withContext(pdfDoc.context);
        for (let index = 0; index < placementCase.obstacleCount; index += 1) {
          const obstacle = pdfDoc.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: coordinateArray(pdfDoc, [2_000 + index * 2, 0, 2_001 + index * 2, 1]),
            P: page.ref,
          });
          annotations.push(pdfDoc.context.register(obstacle));
        }
        page.node.set(PDFName.of("Annots"), annotations);
        const result = yield* Effect.result(
          resolveSignatureWidgetPlacement(pdfDoc, {
            placement: {
              kind: "auto",
              pageIndex: 0,
              width: 1,
              height: 1,
              margin: 0,
              gap: 0,
              anchor: "bottom-right",
            },
          }),
        );

        expect(Result.isFailure(result)).toBe(placementCase.expectedFailure);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("pdf.SIGNATURE_PLACEMENT_FAILED");
          expect(result.failure.code).toBe(PdfErrorCodeValue.signaturePlacementFailed);
          expect(result.failure.operation).toBe(PdfOperationValue.placeholder);
          expect(result.failure.reason).toBe(
            "Automatic signature placement scan exceeds the supported comparison budget.",
          );
        } else {
          expect(result.success.widgetRect).toEqual([999, 0, 1000, 1]);
        }
      }
    }),
  );
  it.effect("rejects annotation arrays over the obstacle cap before materializing obstacles", () =>
    Effect.gen(function* () {
      const pdfDoc = yield* Effect.promise(() => PDFDocument.create());
      const page = pdfDoc.addPage([320, 180]);
      const annotations = PDFArray.withContext(pdfDoc.context);
      const annotation = pdfDoc.context.register(pdfDoc.context.obj({ Type: "Annot" }));
      for (let index = 0; index <= 10_000; index += 1) annotations.push(annotation);
      page.node.set(PDFName.of("Annots"), annotations);

      const result = yield* Effect.result(
        resolveSignatureWidgetPlacement(pdfDoc, {
          placement: {
            kind: "auto",
            pageIndex: 0,
            width: 120,
            height: 40,
            margin: 20,
            gap: 8,
            anchor: "bottom-right",
          },
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("pdf.SIGNATURE_PLACEMENT_FAILED");
        expect(result.failure.code).toBe(PdfErrorCodeValue.signaturePlacementFailed);
        expect(result.failure.operation).toBe(PdfOperationValue.placeholder);
        expect(result.failure.reason).toBe(
          "Automatic signature placement scan exceeds the supported comparison budget.",
        );
      }
    }),
  );
});
