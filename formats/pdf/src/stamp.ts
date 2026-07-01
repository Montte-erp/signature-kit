/**
 * Visible rubric stamping. A PAdES signature is a single CMS over the whole
 * document and its widget carries no /AP appearance, so a *visible* mark — the
 * Brazilian "rubrica em todas as páginas" — is drawn as ordinary page content
 * BEFORE signing. Run `stampPdfRubric` first, then `signPdf` the result: the
 * signature's byte range covers the rubric, so one signature backs the same
 * rubric repeated on every page (not N signatures).
 *
 * Coordinates follow the rest of formats/pdf: `rect` is [left, bottom, right,
 * top] in PDF points (bottom-left origin), applied at the same geometry on each
 * target page.
 */

import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { Effect, Schema } from "effect";
import {
  type PdfCoordinateTuple,
  type PdfLiteParseResult,
  type PdfRubricPageStampInput,
  type PdfRubricStamp,
  type PdfSignaturePage,
  type PdfSignatureRect,
  type PdfTextBox,
  type PdfVisibleStampInput,
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfRubricPageStampInputSchema,
  PdfRubricStampSchema,
  PdfSchemaNameValue,
  PdfVisibleStampInputSchema,
} from "./config";
const PAD = 3;
const FRAME = rgb(0.45, 0.45, 0.45);
const INK = rgb(0.1, 0.1, 0.1);
const RUBRIC_RIGHT_MARGIN_PT = 18;
const RUBRIC_WIDTH_PT = 72;
const RUBRIC_HEIGHT_PT = 32;
const RUBRIC_COLLISION_PADDING_PT = 4;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const pdfCoordinateTupleFromTopLeftRect = (
  rect: PdfSignatureRect,
  pageHeight: number,
): PdfCoordinateTuple => {
  const bottom = pageHeight - rect.y - rect.height;
  return [rect.x, bottom, rect.x + rect.width, bottom + rect.height];
};

export const rubricRectForPage = (
  targetPage: PdfSignaturePage,
  textBoxes: ReadonlyArray<PdfTextBox> = [],
): PdfSignatureRect => {
  const width = Math.min(RUBRIC_WIDTH_PT, targetPage.width);
  const height = Math.min(RUBRIC_HEIGHT_PT, targetPage.height);
  const maxX = Math.max(0, targetPage.width - width);
  const maxY = Math.max(0, targetPage.height - height);
  const x = clamp(targetPage.width - RUBRIC_RIGHT_MARGIN_PT - width, 0, maxX);
  const preferredY = clamp((targetPage.height - height) / 2, 0, maxY);
  const left = x - RUBRIC_COLLISION_PADDING_PT;
  const right = x + width + RUBRIC_COLLISION_PADDING_PT;

  const overlapsAt = (y: number): boolean => {
    const top = y - RUBRIC_COLLISION_PADDING_PT;
    const bottom = y + height + RUBRIC_COLLISION_PADDING_PT;
    return textBoxes.some(
      (box) =>
        box.width > 0 &&
        box.height > 0 &&
        box.x < right &&
        box.x + box.width > left &&
        box.y < bottom &&
        box.y + box.height > top,
    );
  };

  const candidates = [
    preferredY,
    0,
    maxY,
    ...textBoxes.flatMap((box) => [
      box.y - RUBRIC_COLLISION_PADDING_PT - height,
      box.y + box.height + RUBRIC_COLLISION_PADDING_PT,
    ]),
  ]
    .map((y) => clamp(y, 0, maxY))
    .sort((a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY));

  const y = candidates.find((candidate) => !overlapsAt(candidate)) ?? preferredY;

  return {
    pageIndex: targetPage.index,
    x,
    y,
    width,
    height,
  };
};

export const rubricPageIndexesExcludingSignature = (
  pageDimensions: ReadonlyArray<PdfSignaturePage>,
  signaturePageIndex: number,
): ReadonlyArray<number> =>
  pageDimensions.flatMap((_page, index) => (index === signaturePageIndex ? [] : [index]));

export const textBoxesFromLiteParseResult = (
  parsed: PdfLiteParseResult,
  pageCount: number,
): ReadonlyArray<ReadonlyArray<PdfTextBox>> => {
  const pages: PdfTextBox[][] = Array.from({ length: pageCount }, () => []);
  for (const page of parsed.pages) {
    const target = pages[Math.trunc(page.pageNum) - 1];
    if (target === undefined) continue;
    for (const item of page.textItems) {
      if (
        item.text.trim().length > 0 &&
        Number.isFinite(item.x) &&
        Number.isFinite(item.y) &&
        Number.isFinite(item.width) &&
        Number.isFinite(item.height)
      ) {
        target.push({ x: item.x, y: item.y, width: item.width, height: item.height });
      }
    }
  }
  return pages;
};

export const stampPdfRubric = (
  pdf: Uint8Array,
  stamp: PdfRubricStamp,
): Effect.Effect<Uint8Array, PdfError> =>
  Schema.decodeUnknownEffect(PdfRubricStampSchema)(stamp).pipe(
    Effect.mapError(
      () =>
        new PdfError({
          code: PdfErrorCodeValue.stampFailed,
          retryable: false,
          operation: PdfOperationValue.stamp,
          reason: "Rubric stamp input failed schema validation.",
        }),
    ),
    Effect.flatMap((valid) => {
      const [left, bottom, right, top] = valid.rect;
      const width = right - left;
      const height = top - bottom;
      if (!(width > 0) || !(height > 0)) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.stampFailed,
            retryable: false,
            operation: PdfOperationValue.stamp,
            reason: "Rubric stamp rect must have positive width and height.",
          }),
        );
      }
      const lines = valid.lines ?? [];
      const border = valid.border ?? true;

      return Effect.tryPromise({
        try: () => PDFDocument.load(pdf),
        catch: () =>
          new PdfError({
            code: PdfErrorCodeValue.stampFailed,
            retryable: false,
            operation: PdfOperationValue.stamp,
            reason: "Failed to load the PDF for rubric stamping.",
          }),
      }).pipe(
        Effect.flatMap((pdfDoc) => {
          const pages = pdfDoc.getPages();
          const targets =
            valid.pages === undefined || valid.pages === "all"
              ? pages.map((_page, index) => index)
              : valid.pages;
          const invalidPage = targets.find(
            (index) => !Number.isInteger(index) || index < 0 || index >= pages.length,
          );
          if (invalidPage !== undefined) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.stampFailed,
                retryable: false,
                operation: PdfOperationValue.stamp,
                reason: `Rubric page index ${invalidPage} is out of range (document has ${pages.length} pages).`,
              }),
            );
          }

          return Effect.tryPromise({
            try: async () => {
              const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
              const image =
                valid.imagePng === undefined ? undefined : await pdfDoc.embedPng(valid.imagePng);

              for (const index of targets) {
                const page = pages[index];
                if (page === undefined) continue;

                if (border) {
                  page.drawRectangle({
                    x: left,
                    y: bottom,
                    width,
                    height,
                    borderColor: FRAME,
                    borderWidth: 0.6,
                  });
                }

                let textTop = top - PAD;
                if (image !== undefined) {
                  const maxH = height * (lines.length > 0 ? 0.58 : 0.92) - PAD;
                  const maxW = width - PAD * 2;
                  const scale = Math.min(maxW / image.width, maxH / image.height);
                  const drawW = image.width * scale;
                  const drawH = image.height * scale;
                  page.drawImage(image, {
                    x: left + (width - drawW) / 2,
                    y: top - drawH - PAD,
                    width: drawW,
                    height: drawH,
                  });
                  textTop = top - drawH - PAD - 1;
                }

                if (lines.length > 0) {
                  const size = Math.max(
                    4.5,
                    Math.min(7, (textTop - bottom - PAD) / lines.length - 1),
                  );
                  let ty = textTop - size;
                  for (const line of lines) {
                    page.drawText(line, {
                      x: left + PAD,
                      y: ty,
                      size,
                      font,
                      color: INK,
                      maxWidth: width - PAD * 2,
                    });
                    ty -= size + 1.5;
                  }
                }
              }

              const saved = await pdfDoc.save({ useObjectStreams: false });
              return new Uint8Array(saved);
            },
            catch: () =>
              new PdfError({
                code: PdfErrorCodeValue.stampFailed,
                retryable: false,
                operation: PdfOperationValue.stamp,
                reason: "Failed to draw the rubric stamp.",
              }),
          });
        }),
      );
    }),
  );

export const stampPdfVisibleSignature = (
  input: PdfVisibleStampInput,
): Effect.Effect<Uint8Array, PdfError> =>
  Schema.decodeUnknownEffect(PdfVisibleStampInputSchema)(input).pipe(
    Effect.mapError(
      () =>
        new PdfError({
          code: PdfErrorCodeValue.stampFailed,
          retryable: false,
          operation: PdfOperationValue.stamp,
          schemaName: PdfSchemaNameValue.pdfVisibleStampInput,
          reason: "Visible PDF stamp input failed schema validation.",
        }),
    ),
    Effect.flatMap((valid) =>
      Effect.tryPromise({
        try: () => PDFDocument.load(valid.pdf),
        catch: () =>
          new PdfError({
            code: PdfErrorCodeValue.stampFailed,
            retryable: false,
            operation: PdfOperationValue.stamp,
            reason: "Failed to load the PDF for visible signature stamping.",
          }),
      }).pipe(
        Effect.flatMap((pdfDoc) => {
          const page = pdfDoc.getPages()[valid.pageIndex];
          if (page === undefined) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.stampFailed,
                retryable: false,
                operation: PdfOperationValue.stamp,
                reason: `Visible stamp page index ${valid.pageIndex} is out of range.`,
              }),
            );
          }

          return Effect.tryPromise({
            try: async () => {
              const pageHeight = page.getSize().height;
              const { x, y, width, height } = valid.rect;
              const bottom = pageHeight - y - height;
              const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
              const border = valid.border ?? true;

              if (border) {
                page.drawRectangle({
                  x,
                  y: bottom,
                  width,
                  height,
                  borderColor: FRAME,
                  borderWidth: 0.6,
                });
              }

              let textTop = bottom + height - PAD;
              if (valid.inkPng !== undefined) {
                const png = await pdfDoc.embedPng(valid.inkPng);
                const maxH = height * (valid.lines.length > 0 ? 0.58 : 0.92) - PAD;
                const maxW = width - PAD * 2;
                const scale = Math.min(maxW / png.width, maxH / png.height);
                const drawW = png.width * scale;
                const drawH = png.height * scale;
                page.drawImage(png, {
                  x: x + (width - drawW) / 2,
                  y: bottom + height - drawH - PAD,
                  width: drawW,
                  height: drawH,
                });
                textTop = bottom + height - drawH - PAD - 1;
              }

              if (border === false && valid.inkPng !== undefined && valid.lines.length > 0) {
                page.drawLine({
                  start: { x: x + PAD, y: textTop },
                  end: { x: x + width - PAD, y: textTop },
                  thickness: 0.5,
                  color: rgb(0.55, 0.55, 0.55),
                });
              }

              if (valid.lines.length > 0) {
                const size = Math.max(
                  4.5,
                  Math.min(7, (textTop - bottom - PAD) / valid.lines.length - 1),
                );
                let ty = textTop - size;
                for (const line of valid.lines) {
                  page.drawText(line, {
                    x: x + PAD,
                    y: ty,
                    size,
                    font,
                    color: border === false ? rgb(0.25, 0.25, 0.25) : INK,
                    maxWidth: width - PAD * 2,
                  });
                  ty -= size + 1.5;
                }
              }

              const saved = await pdfDoc.save();
              return new Uint8Array(saved);
            },
            catch: () =>
              new PdfError({
                code: PdfErrorCodeValue.stampFailed,
                retryable: false,
                operation: PdfOperationValue.stamp,
                reason: "Failed to draw the visible signature stamp.",
              }),
          });
        }),
      ),
    ),
  );

export const stampPdfRubricOnPages = (
  input: PdfRubricPageStampInput,
): Effect.Effect<Uint8Array, PdfError> =>
  Schema.decodeUnknownEffect(PdfRubricPageStampInputSchema)(input).pipe(
    Effect.mapError(
      () =>
        new PdfError({
          code: PdfErrorCodeValue.stampFailed,
          retryable: false,
          operation: PdfOperationValue.stamp,
          schemaName: PdfSchemaNameValue.pdfRubricPageStampInput,
          reason: "Rubric page stamp input failed schema validation.",
        }),
    ),
    Effect.flatMap((valid) =>
      Effect.gen(function* () {
        const groups = new Map<string, { rect: PdfCoordinateTuple; pages: number[] }>();
        for (const pageIndex of valid.pages) {
          const page = valid.pageDimensions[pageIndex];
          if (page === undefined) {
            return yield* Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.stampFailed,
                retryable: false,
                operation: PdfOperationValue.stamp,
                reason: `Rubric page index ${pageIndex} has no page dimensions.`,
              }),
            );
          }
          const textBoxes = valid.pageTextBoxes?.[pageIndex] ?? [];
          const rect = pdfCoordinateTupleFromTopLeftRect(
            rubricRectForPage(page, textBoxes),
            page.height,
          );
          const key = rect.join(":");
          const group = groups.get(key) ?? { rect, pages: [] };
          group.pages.push(pageIndex);
          groups.set(key, group);
        }

        const initial: Effect.Effect<Uint8Array, PdfError> = Effect.succeed(valid.pdf);
        return yield* Array.from(groups.values()).reduce<Effect.Effect<Uint8Array, PdfError>>(
          (effect, group) =>
            effect.pipe(
              Effect.flatMap((pdf) =>
                stampPdfRubric(pdf, {
                  rect: group.rect,
                  pages: group.pages,
                  ...(valid.lines === undefined ? {} : { lines: valid.lines }),
                  ...(valid.imagePng === undefined ? {} : { imagePng: valid.imagePng }),
                  ...(valid.border === undefined ? {} : { border: valid.border }),
                }),
              ),
            ),
          initial,
        );
      }),
    ),
  );
