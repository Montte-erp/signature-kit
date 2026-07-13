import type { PDFDocument, PDFPage } from "@cantoo/pdf-lib";
import { PDFArray, PDFDict, PDFName, PDFNumber, type PDFObject } from "@cantoo/pdf-lib";
import { Effect } from "effect";
import { PdfError, PdfErrorCodeValue, PdfOperationValue } from "./config.js";
import type {
  PdfCoordinateTuple,
  PdfSignatureAnchor,
  PdfSignatureAppearance,
  PdfSignatureRect,
} from "./config.js";
import {
  pdfCoordinateTupleFromTopLeftRect,
  topLeftRectFromPdfCoordinateTuple,
  visiblePdfPageSize,
} from "./stamp.js";

const DEFAULT_AUTO_WIDTH = 180;
const DEFAULT_AUTO_HEIGHT = 54;
const DEFAULT_AUTO_MARGIN = 36;
const DEFAULT_AUTO_GAP = 8;
const DEFAULT_AUTO_ANCHOR: PdfSignatureAnchor = "bottom-right";

export const clampCoordinate = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

type PdfRectangle = {
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
};

type PlacementRectangle = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

type ExistingSignatureSlot = {
  readonly widgetObject: PDFObject;
  readonly signatureFieldObject: PDFObject;
  readonly widgetRect: PdfCoordinateTuple;
  readonly rect: PlacementRectangle;
};

export type ResolvedPdfSignaturePlacement = {
  readonly pageIndex: number;
  readonly widgetRect: PdfCoordinateTuple;
  readonly invisible?: true;
  readonly existingWidgetObject?: PDFObject;
  readonly existingSignatureFieldObject?: PDFObject;
};

const rectangleFromCoordinates = (
  left: number,
  bottom: number,
  right: number,
  top: number,
): PdfRectangle => ({
  left: Math.min(left, right),
  bottom: Math.min(bottom, top),
  right: Math.max(left, right),
  top: Math.max(bottom, top),
});

const coordinateTupleFromArray = (array: PDFArray): PdfCoordinateTuple | undefined => {
  if (array.size() !== 4) return undefined;
  const left = array.lookupMaybe(0, PDFNumber)?.asNumber();
  const bottom = array.lookupMaybe(1, PDFNumber)?.asNumber();
  const right = array.lookupMaybe(2, PDFNumber)?.asNumber();
  const top = array.lookupMaybe(3, PDFNumber)?.asNumber();
  if (
    left === undefined ||
    bottom === undefined ||
    right === undefined ||
    top === undefined ||
    !Number.isFinite(left) ||
    !Number.isFinite(bottom) ||
    !Number.isFinite(right) ||
    !Number.isFinite(top)
  ) {
    return undefined;
  }
  return [left, bottom, right, top];
};

const rectangleFromArray = (array: PDFArray): PdfRectangle | undefined => {
  const rect = coordinateTupleFromArray(array);
  return rect === undefined ? undefined : rectangleFromCoordinates(...rect);
};

const placementRectangleFromEdges = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): PlacementRectangle => ({ left, top, right, bottom });

const isVisibleWidgetRect = ([left, bottom, right, top]: PdfCoordinateTuple): boolean =>
  Number.isFinite(left) &&
  Number.isFinite(bottom) &&
  Number.isFinite(right) &&
  Number.isFinite(top) &&
  left < right &&
  bottom < top;

const placementRectangleFromPdfCoordinates = (
  rect: PdfRectangle,
  page: PDFPage,
): PlacementRectangle => {
  const visibleRect = topLeftRectFromPdfCoordinateTuple(
    [rect.left, rect.bottom, rect.right, rect.top],
    page,
  );
  return placementRectangleFromEdges(
    visibleRect.x,
    visibleRect.y,
    visibleRect.x + visibleRect.width,
    visibleRect.y + visibleRect.height,
  );
};

const placementRectangleFitsVisiblePage = (rect: PlacementRectangle, page: PDFPage): boolean => {
  const { width, height } = visiblePdfPageSize(page);
  return rect.left >= 0 && rect.top >= 0 && rect.right <= width && rect.bottom <= height;
};

const MAX_AUTO_PLACEMENT_CANDIDATES = 100_000;
const MAX_AUTO_PLACEMENT_OBSTACLES = 10_000;
const MAX_AUTO_PLACEMENT_COMPARISONS = 1_000_000;

const pageAnnotationRectangles = (
  pdfDoc: PDFDocument,
  page: PDFPage,
  annotations: PDFArray | undefined,
): Effect.Effect<ReadonlyArray<PlacementRectangle>, PdfError> => {
  if (annotations !== undefined && annotations.size() > MAX_AUTO_PLACEMENT_OBSTACLES) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.signaturePlacementFailed,
        retryable: false,
        reason: "Automatic signature placement scan exceeds the supported comparison budget.",
        operation: PdfOperationValue.placeholder,
      }),
    );
  }
  const rectangles: Array<PlacementRectangle> = [];
  if (annotations === undefined) return Effect.succeed(rectangles);

  for (let index = 0; index < annotations.size(); index++) {
    const annotation = pdfDoc.context.lookupMaybe(annotations.get(index), PDFDict);
    const rectArray = annotation?.lookupMaybe(PDFName.of("Rect"), PDFArray);
    const rect = rectArray === undefined ? undefined : rectangleFromArray(rectArray);
    if (rect !== undefined) rectangles.push(placementRectangleFromPdfCoordinates(rect, page));
  }

  return Effect.succeed(rectangles);
};

const MAX_ACROFORM_PARENT_DEPTH = 100;

type SignatureSlotCandidate =
  | ExistingSignatureSlot
  | {
      readonly malformed: true;
      readonly rect: PlacementRectangle;
      readonly reason: string;
    };

const signatureSlotCandidate = (
  pdfDoc: PDFDocument,
  widgetObject: PDFObject,
  widget: PDFDict,
  widgetRect: PdfCoordinateTuple,
  rect: PlacementRectangle,
): SignatureSlotCandidate | undefined => {
  let currentObject = widgetObject;
  let current = widget;
  let inheritedFieldType: string | undefined;
  let signatureFieldObject = widgetObject;
  let hasValue = false;
  const seenObjects = new Set<PDFObject>();
  const seenFields = new Set<PDFDict>();

  for (let depth = 0; depth < MAX_ACROFORM_PARENT_DEPTH; depth += 1) {
    if (seenObjects.has(currentObject) || seenFields.has(current)) {
      return inheritedFieldType === "/Sig"
        ? { malformed: true, rect, reason: "Signature widget field hierarchy is cyclic." }
        : undefined;
    }
    seenObjects.add(currentObject);
    seenFields.add(current);

    const fieldType = current.lookupMaybe(PDFName.of("FT"), PDFName)?.asString();
    if (inheritedFieldType === undefined && fieldType !== undefined) {
      inheritedFieldType = fieldType;
    }
    if (current.get(PDFName.of("V")) !== undefined) hasValue = true;

    const parentObject = current.get(PDFName.of("Parent"));
    if (parentObject === undefined) {
      if (inheritedFieldType !== "/Sig" || hasValue) return undefined;
      return { widgetObject, signatureFieldObject, widgetRect, rect };
    }

    const parent = pdfDoc.context.lookupMaybe(parentObject, PDFDict);
    if (parent === undefined) {
      return inheritedFieldType === "/Sig"
        ? {
            malformed: true,
            rect,
            reason: "Signature widget field hierarchy has an invalid parent.",
          }
        : undefined;
    }
    if (
      current === widget &&
      fieldType === undefined &&
      current.get(PDFName.of("T")) === undefined
    ) {
      signatureFieldObject = parentObject;
    }
    currentObject = parentObject;
    current = parent;
  }

  return inheritedFieldType === "/Sig"
    ? {
        malformed: true,
        rect,
        reason: "Signature widget field hierarchy exceeds the supported depth.",
      }
    : undefined;
};

const pageSignatureSlots = (
  pdfDoc: PDFDocument,
  page: PDFPage,
  annotations: PDFArray | undefined,
): ReadonlyArray<SignatureSlotCandidate> => {
  const slots: Array<SignatureSlotCandidate> = [];
  if (annotations === undefined) return slots;

  for (let index = 0; index < annotations.size(); index++) {
    const widgetObject = annotations.get(index);
    const widget = pdfDoc.context.lookupMaybe(widgetObject, PDFDict);
    const subtype = widget?.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString();
    const rectArray = widget?.lookupMaybe(PDFName.of("Rect"), PDFArray);
    const widgetRect = rectArray === undefined ? undefined : coordinateTupleFromArray(rectArray);
    if (
      widgetObject !== undefined &&
      widget !== undefined &&
      subtype === "/Widget" &&
      widgetRect !== undefined &&
      isVisibleWidgetRect(widgetRect)
    ) {
      const rect = placementRectangleFromPdfCoordinates(
        rectangleFromCoordinates(...widgetRect),
        page,
      );
      if (!placementRectangleFitsVisiblePage(rect, page)) continue;
      const candidate = signatureSlotCandidate(pdfDoc, widgetObject, widget, widgetRect, rect);
      if (candidate !== undefined) slots.push(candidate);
    }
  }

  return slots;
};

const anchorPoint = (
  rect: PlacementRectangle,
  anchor: PdfSignatureAnchor,
): readonly [number, number] => {
  const centerX = (rect.left + rect.right) / 2;
  const centerY = (rect.top + rect.bottom) / 2;

  switch (anchor) {
    case "bottom-left":
      return [rect.left, rect.bottom];
    case "bottom-center":
      return [centerX, rect.bottom];
    case "bottom-right":
      return [rect.right, rect.bottom];
    case "middle-left":
      return [rect.left, centerY];
    case "middle-center":
      return [centerX, centerY];
    case "middle-right":
      return [rect.right, centerY];
    case "top-left":
      return [rect.left, rect.top];
    case "top-center":
      return [centerX, rect.top];
    case "top-right":
      return [rect.right, rect.top];
  }
};

const squaredAnchorDistance = (
  candidate: PlacementRectangle,
  bounds: PlacementRectangle,
  anchor: PdfSignatureAnchor,
): number => {
  const target = anchorPoint(bounds, anchor);
  const candidatePoint = anchorPoint(candidate, anchor);
  const deltaX = target[0] - candidatePoint[0];
  const deltaY = target[1] - candidatePoint[1];
  return deltaX * deltaX + deltaY * deltaY;
};

type PlacementAxis = {
  readonly start: number;
  readonly end: number;
  readonly step: number;
  readonly regularPositions: number;
  readonly positions: number;
};

const resolvedVisibleWidgetPlacement = (
  pageIndex: number,
  widgetRect: PdfCoordinateTuple,
): Effect.Effect<ResolvedPdfSignaturePlacement, PdfError> =>
  isVisibleWidgetRect(widgetRect)
    ? Effect.succeed({ pageIndex, widgetRect })
    : Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.signaturePlacementFailed,
          retryable: false,
          reason: "Signature widget coordinates must form a finite non-empty rectangle.",
          operation: PdfOperationValue.placeholder,
        }),
      );

const placementAxis = (
  start: number,
  end: number,
  step: number,
): Effect.Effect<PlacementAxis, PdfError> => {
  if (start === end) {
    return Effect.succeed({ start, end, step, regularPositions: 1, positions: 1 });
  }

  if (start + step <= start) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.signaturePlacementFailed,
        retryable: false,
        reason: "Automatic signature placement grid cannot advance at the selected precision.",
        operation: PdfOperationValue.placeholder,
      }),
    );
  }

  let regularPositions = Math.floor((end - start) / step) + 1;
  if (!Number.isSafeInteger(regularPositions) || regularPositions > MAX_AUTO_PLACEMENT_CANDIDATES) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.signaturePlacementFailed,
        retryable: false,
        reason: "Automatic signature placement grid is too dense.",
        operation: PdfOperationValue.placeholder,
      }),
    );
  }

  let lastPosition = start + (regularPositions - 1) * step;
  if (lastPosition > end) {
    regularPositions -= 1;
    lastPosition = start + (regularPositions - 1) * step;
  }
  const positions = regularPositions + (lastPosition === end ? 0 : 1);
  if (!Number.isSafeInteger(positions) || positions > MAX_AUTO_PLACEMENT_CANDIDATES) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.signaturePlacementFailed,
        retryable: false,
        reason: "Automatic signature placement grid is too dense.",
        operation: PdfOperationValue.placeholder,
      }),
    );
  }

  return Effect.succeed({ start, end, step, regularPositions, positions });
};

const rectanglesOverlap = (
  left: PlacementRectangle,
  right: PlacementRectangle,
  gap: number,
): boolean =>
  left.left < right.right + gap &&
  left.right > right.left - gap &&
  left.top < right.bottom + gap &&
  left.bottom > right.top - gap;

const hasCollision = (
  candidate: PlacementRectangle,
  obstacles: ReadonlyArray<PlacementRectangle>,
  gap: number,
): boolean => {
  for (const obstacle of obstacles) {
    if (rectanglesOverlap(candidate, obstacle, gap)) return true;
  }
  return false;
};

const chooseAutoRect = (
  bounds: PlacementRectangle,
  obstacles: ReadonlyArray<PlacementRectangle>,
  width: number,
  height: number,
  gap: number,
  anchor: PdfSignatureAnchor,
): Effect.Effect<PlacementRectangle | undefined, PdfError> =>
  Effect.gen(function* () {
    const maxLeft = bounds.right - width;
    const maxTop = bounds.bottom - height;
    const horizontal = yield* placementAxis(bounds.left, maxLeft, width + gap);
    const vertical = yield* placementAxis(bounds.top, maxTop, height + gap);
    if (horizontal.positions > Math.floor(MAX_AUTO_PLACEMENT_CANDIDATES / vertical.positions)) {
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.signaturePlacementFailed,
          retryable: false,
          reason: "Automatic signature placement grid is too dense.",
          operation: PdfOperationValue.placeholder,
        }),
      );
    }
    const candidateCount = horizontal.positions * vertical.positions;
    if (
      obstacles.length > MAX_AUTO_PLACEMENT_OBSTACLES ||
      (obstacles.length > 0 &&
        candidateCount > Math.floor(MAX_AUTO_PLACEMENT_COMPARISONS / obstacles.length))
    ) {
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.signaturePlacementFailed,
          retryable: false,
          reason: "Automatic signature placement scan exceeds the supported comparison budget.",
          operation: PdfOperationValue.placeholder,
        }),
      );
    }

    let bestRect: PlacementRectangle | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    let previousLeft: number | undefined;

    for (let column = 0; column < horizontal.positions; column += 1) {
      const left =
        column < horizontal.regularPositions
          ? horizontal.start + column * horizontal.step
          : horizontal.end;
      if (previousLeft !== undefined && left <= previousLeft) {
        return yield* Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.signaturePlacementFailed,
            retryable: false,
            reason: "Automatic signature placement grid cannot advance at the selected precision.",
            operation: PdfOperationValue.placeholder,
          }),
        );
      }
      previousLeft = left;

      let previousTop: number | undefined;
      for (let row = 0; row < vertical.positions; row += 1) {
        const top =
          row < vertical.regularPositions ? vertical.start + row * vertical.step : vertical.end;
        if (previousTop !== undefined && top <= previousTop) {
          return yield* Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.signaturePlacementFailed,
              retryable: false,
              reason:
                "Automatic signature placement grid cannot advance at the selected precision.",
              operation: PdfOperationValue.placeholder,
            }),
          );
        }
        previousTop = top;

        const candidate = placementRectangleFromEdges(left, top, left + width, top + height);
        if (!hasCollision(candidate, obstacles, gap)) {
          const score = squaredAnchorDistance(candidate, bounds, anchor);
          if (score < bestScore) {
            bestScore = score;
            bestRect = candidate;
          }
        }
      }
    }

    return bestRect;
  });

const chooseExistingSignatureSlot = (
  bounds: PlacementRectangle,
  slots: ReadonlyArray<SignatureSlotCandidate>,
  anchor: PdfSignatureAnchor,
): SignatureSlotCandidate | undefined => {
  let bestSlot: SignatureSlotCandidate | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const slot of slots) {
    const score = squaredAnchorDistance(slot.rect, bounds, anchor);
    if (score < bestScore) {
      bestScore = score;
      bestSlot = slot;
    }
  }

  return bestSlot;
};

const resolvedPageIndex = (
  pageCount: number,
  requestedPageIndex: number | undefined,
  placementPage: "first" | "last" | undefined,
): Effect.Effect<number, PdfError> => {
  const pageIndex = requestedPageIndex ?? (placementPage === "last" ? pageCount - 1 : 0);

  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.invalidPdf,
        retryable: false,
        reason: "The selected PDF page does not exist.",
        operation: PdfOperationValue.placeholder,
      }),
    );
  }

  return Effect.succeed(pageIndex);
};

const resolveAutoPlacement = (
  pdfDoc: PDFDocument,
  pageIndex: number,
  appearance: PdfSignatureAppearance,
): Effect.Effect<ResolvedPdfSignaturePlacement, PdfError> => {
  const placement = appearance.placement;
  const page = pdfDoc.getPages()[pageIndex];
  if (page === undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.invalidPdf,
        retryable: false,
        reason: "The selected PDF page does not exist.",
        operation: PdfOperationValue.placeholder,
      }),
    );
  }

  const width =
    placement?.kind === "auto" ? (placement.width ?? DEFAULT_AUTO_WIDTH) : DEFAULT_AUTO_WIDTH;
  const height =
    placement?.kind === "auto" ? (placement.height ?? DEFAULT_AUTO_HEIGHT) : DEFAULT_AUTO_HEIGHT;
  const margin =
    placement?.kind === "auto" ? (placement.margin ?? DEFAULT_AUTO_MARGIN) : DEFAULT_AUTO_MARGIN;
  const gap = placement?.kind === "auto" ? (placement.gap ?? DEFAULT_AUTO_GAP) : DEFAULT_AUTO_GAP;
  const anchor =
    placement?.kind === "auto" ? (placement.anchor ?? DEFAULT_AUTO_ANCHOR) : DEFAULT_AUTO_ANCHOR;

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(margin) ||
    !Number.isFinite(gap) ||
    width <= 0 ||
    height <= 0 ||
    margin < 0 ||
    gap < 0
  ) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.signaturePlacementFailed,
        retryable: false,
        reason: "Automatic signature placement dimensions must be finite positive numbers.",
        operation: PdfOperationValue.placeholder,
      }),
    );
  }

  const { width: pageWidth, height: pageHeight } = visiblePdfPageSize(page);
  const availableWidth = pageWidth - margin * 2;
  const availableHeight = pageHeight - margin * 2;
  if (width > availableWidth || height > availableHeight) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.signaturePlacementFailed,
        retryable: false,
        reason: "Automatic signature placement does not fit inside the selected page margins.",
        operation: PdfOperationValue.placeholder,
      }),
    );
  }
  const bounds = placementRectangleFromEdges(
    margin,
    margin,
    pageWidth - margin,
    pageHeight - margin,
  );
  const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annotations !== undefined && annotations.size() > MAX_AUTO_PLACEMENT_OBSTACLES) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.signaturePlacementFailed,
        retryable: false,
        reason: "Automatic signature placement scan exceeds the supported comparison budget.",
        operation: PdfOperationValue.placeholder,
      }),
    );
  }
  const existingSlot = chooseExistingSignatureSlot(
    bounds,
    pageSignatureSlots(pdfDoc, page, annotations),
    anchor,
  );
  if (existingSlot !== undefined) {
    if ("malformed" in existingSlot) {
      return Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.signaturePlacementFailed,
          retryable: false,
          reason: existingSlot.reason,
          operation: PdfOperationValue.placeholder,
        }),
      );
    }
    return Effect.succeed({
      pageIndex,
      widgetRect: existingSlot.widgetRect,
      existingWidgetObject: existingSlot.widgetObject,
      existingSignatureFieldObject: existingSlot.signatureFieldObject,
    });
  }

  return pageAnnotationRectangles(pdfDoc, page, annotations).pipe(
    Effect.flatMap((obstacles) =>
      chooseAutoRect(bounds, obstacles, width, height, gap, anchor).pipe(
        Effect.flatMap((chosen) => {
          if (chosen === undefined) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.signaturePlacementFailed,
                retryable: false,
                reason: "No empty signature placement slot was found on the selected page.",
                operation: PdfOperationValue.placeholder,
              }),
            );
          }

          const widgetRect = pdfCoordinateTupleFromTopLeftRect(
            {
              pageIndex,
              x: chosen.left,
              y: chosen.top,
              width: chosen.right - chosen.left,
              height: chosen.bottom - chosen.top,
            } satisfies PdfSignatureRect,
            page,
          );
          return Effect.succeed({ pageIndex, widgetRect });
        }),
      ),
    ),
  );
};

export const resolveSignatureWidgetPlacement = (
  pdfDoc: PDFDocument,
  appearance: PdfSignatureAppearance,
): Effect.Effect<ResolvedPdfSignaturePlacement, PdfError> => {
  const placement = appearance.placement;
  if (appearance.widgetRect !== undefined && placement !== undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: PdfOperationValue.placeholder,
        reason: "Signature appearance accepts either widgetRect or placement, not both.",
      }),
    );
  }
  const hasPlacementPageSelector =
    placement?.pageIndex !== undefined ||
    (placement?.kind === "auto" && placement.page !== undefined);
  if (appearance.pageIndex !== undefined && hasPlacementPageSelector) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: PdfOperationValue.placeholder,
        reason: "Signature appearance accepts exactly one page selector.",
      }),
    );
  }
  if (
    placement?.kind === "auto" &&
    placement.page !== undefined &&
    placement.pageIndex !== undefined
  ) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: PdfOperationValue.placeholder,
        reason: "Automatic signature placement accepts either page or pageIndex, not both.",
      }),
    );
  }
  const placementPage = placement?.kind === "auto" ? (placement.page ?? "last") : undefined;
  const requestedPageIndex = placement?.pageIndex ?? appearance.pageIndex;
  const pages = pdfDoc.getPages();

  return resolvedPageIndex(pages.length, requestedPageIndex, placementPage).pipe(
    Effect.flatMap((pageIndex) => {
      if (placement?.kind === "manual") {
        return resolvedVisibleWidgetPlacement(pageIndex, placement.widgetRect);
      }
      if (placement?.kind === "invisible") {
        return Effect.succeed({ pageIndex, widgetRect: [0, 0, 0, 0], invisible: true });
      }
      if (placement?.kind === "auto") {
        return resolveAutoPlacement(pdfDoc, pageIndex, appearance);
      }
      if (appearance.widgetRect === undefined) {
        return Effect.succeed({ pageIndex, widgetRect: [0, 0, 0, 0], invisible: true });
      }

      return resolvedVisibleWidgetPlacement(pageIndex, appearance.widgetRect);
    }),
  );
};
