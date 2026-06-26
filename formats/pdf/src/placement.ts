import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  type PDFObject,
} from "@cantoo/pdf-lib";
import { Effect } from "effect";
import {
  type PdfCoordinateTuple,
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  type PdfSignatureAnchor,
  type PdfSignatureAppearance,
} from "./config";

const DEFAULT_AUTO_WIDTH = 180;
const DEFAULT_AUTO_HEIGHT = 54;
const DEFAULT_AUTO_MARGIN = 36;
const DEFAULT_AUTO_GAP = 8;
const DEFAULT_AUTO_ANCHOR: PdfSignatureAnchor = "bottom-right";

type PdfRectangle = {
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
};

type ExistingSignatureSlot = {
  readonly object: PDFObject;
  readonly rect: PdfRectangle;
};

export type ResolvedPdfSignaturePlacement = {
  readonly pageIndex: number;
  readonly widgetRect: PdfCoordinateTuple;
  readonly existingWidgetObject?: PDFObject;
};

const tupleFromRectangle = (rect: PdfRectangle): PdfCoordinateTuple => [
  rect.left,
  rect.bottom,
  rect.right,
  rect.top,
];

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

const rectangleFromArray = (array: PDFArray): PdfRectangle | undefined => {
  if (array.size() !== 4) return undefined;
  const left = array.lookupMaybe(0, PDFNumber)?.asNumber();
  const bottom = array.lookupMaybe(1, PDFNumber)?.asNumber();
  const right = array.lookupMaybe(2, PDFNumber)?.asNumber();
  const top = array.lookupMaybe(3, PDFNumber)?.asNumber();
  if (left === undefined || bottom === undefined || right === undefined || top === undefined) {
    return undefined;
  }
  return rectangleFromCoordinates(left, bottom, right, top);
};

const pageAnnotationRectangles = (
  pdfDoc: PDFDocument,
  annotations: PDFArray | undefined,
): ReadonlyArray<PdfRectangle> => {
  const rectangles: Array<PdfRectangle> = [];
  if (annotations === undefined) return rectangles;

  for (let index = 0; index < annotations.size(); index++) {
    const annotation = pdfDoc.context.lookupMaybe(annotations.get(index), PDFDict);
    const rectArray = annotation?.lookupMaybe(PDFName.of("Rect"), PDFArray);
    const rect = rectArray === undefined ? undefined : rectangleFromArray(rectArray);
    if (rect !== undefined) rectangles.push(rect);
  }

  return rectangles;
};

const pageSignatureSlots = (
  pdfDoc: PDFDocument,
  annotations: PDFArray | undefined,
): ReadonlyArray<ExistingSignatureSlot> => {
  const slots: Array<ExistingSignatureSlot> = [];
  if (annotations === undefined) return slots;

  for (let index = 0; index < annotations.size(); index++) {
    const object = annotations.get(index);
    const annotation = pdfDoc.context.lookupMaybe(object, PDFDict);
    const subtype = annotation?.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString();
    const fieldType = annotation?.lookupMaybe(PDFName.of("FT"), PDFName)?.asString();
    const rectArray = annotation?.lookupMaybe(PDFName.of("Rect"), PDFArray);
    const rect = rectArray === undefined ? undefined : rectangleFromArray(rectArray);
    if (
      object !== undefined &&
      subtype === "/Widget" &&
      fieldType === "/Sig" &&
      annotation?.get(PDFName.of("V")) === undefined &&
      rect !== undefined
    ) {
      slots.push({ object, rect });
    }
  }

  return slots;
};

const anchorPoint = (rect: PdfRectangle, anchor: PdfSignatureAnchor): readonly [number, number] => {
  const centerX = (rect.left + rect.right) / 2;
  const centerY = (rect.bottom + rect.top) / 2;

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
  candidate: PdfRectangle,
  bounds: PdfRectangle,
  anchor: PdfSignatureAnchor,
): number => {
  const target = anchorPoint(bounds, anchor);
  const candidatePoint = anchorPoint(candidate, anchor);
  const deltaX = target[0] - candidatePoint[0];
  const deltaY = target[1] - candidatePoint[1];
  return deltaX * deltaX + deltaY * deltaY;
};

const positionsBetween = (start: number, end: number, step: number): ReadonlyArray<number> => {
  const positions: Array<number> = [];
  for (let position = start; position <= end; position += step) {
    positions.push(position);
  }

  const lastPosition = positions[positions.length - 1];
  if (lastPosition === undefined || lastPosition !== end) positions.push(end);
  return positions;
};

const rectanglesOverlap = (left: PdfRectangle, right: PdfRectangle, gap: number): boolean =>
  left.left < right.right + gap &&
  left.right > right.left - gap &&
  left.bottom < right.top + gap &&
  left.top > right.bottom - gap;

const hasCollision = (
  candidate: PdfRectangle,
  obstacles: ReadonlyArray<PdfRectangle>,
  gap: number,
): boolean => {
  for (const obstacle of obstacles) {
    if (rectanglesOverlap(candidate, obstacle, gap)) return true;
  }
  return false;
};

const chooseAutoRect = (
  bounds: PdfRectangle,
  obstacles: ReadonlyArray<PdfRectangle>,
  width: number,
  height: number,
  gap: number,
  anchor: PdfSignatureAnchor,
): PdfRectangle | undefined => {
  const maxLeft = bounds.right - width;
  const maxBottom = bounds.top - height;
  const leftPositions = positionsBetween(bounds.left, maxLeft, width + gap);
  const bottomPositions = positionsBetween(bounds.bottom, maxBottom, height + gap);
  let bestRect: PdfRectangle | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const left of leftPositions) {
    for (const bottom of bottomPositions) {
      const candidate = rectangleFromCoordinates(left, bottom, left + width, bottom + height);
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
};

const chooseExistingSignatureSlot = (
  bounds: PdfRectangle,
  slots: ReadonlyArray<ExistingSignatureSlot>,
  anchor: PdfSignatureAnchor,
): ExistingSignatureSlot | undefined => {
  let bestSlot: ExistingSignatureSlot | undefined;
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

  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const bounds = rectangleFromCoordinates(margin, margin, pageWidth - margin, pageHeight - margin);
  const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  const existingSlot = chooseExistingSignatureSlot(
    bounds,
    pageSignatureSlots(pdfDoc, annotations),
    anchor,
  );
  if (existingSlot !== undefined) {
    return Effect.succeed({
      pageIndex,
      widgetRect: tupleFromRectangle(existingSlot.rect),
      existingWidgetObject: existingSlot.object,
    });
  }

  if (width > bounds.right - bounds.left || height > bounds.top - bounds.bottom) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.signaturePlacementFailed,
        retryable: false,
        reason: "Automatic signature placement does not fit inside the selected page margins.",
        operation: PdfOperationValue.placeholder,
      }),
    );
  }
  const obstacles = pageAnnotationRectangles(pdfDoc, annotations);
  const chosen = chooseAutoRect(bounds, obstacles, width, height, gap, anchor);
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

  return Effect.succeed({ pageIndex, widgetRect: tupleFromRectangle(chosen) });
};

export const resolveSignatureWidgetPlacement = (
  pdfDoc: PDFDocument,
  appearance: PdfSignatureAppearance,
): Effect.Effect<ResolvedPdfSignaturePlacement, PdfError> => {
  const placement = appearance.placement;
  const placementPage = placement?.kind === "auto" ? (placement.page ?? "last") : undefined;
  const requestedPageIndex = placement?.pageIndex ?? appearance.pageIndex;
  const pages = pdfDoc.getPages();

  return resolvedPageIndex(pages.length, requestedPageIndex, placementPage).pipe(
    Effect.flatMap((pageIndex) => {
      if (placement?.kind === "manual") {
        return Effect.succeed({ pageIndex, widgetRect: placement.widgetRect });
      }
      if (placement?.kind === "invisible") {
        return Effect.succeed({ pageIndex, widgetRect: [0, 0, 0, 0] });
      }
      if (placement?.kind === "auto") {
        return resolveAutoPlacement(pdfDoc, pageIndex, appearance);
      }

      return Effect.succeed({ pageIndex, widgetRect: appearance.widgetRect ?? [0, 0, 0, 0] });
    }),
  );
};
