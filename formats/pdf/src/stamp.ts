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
  type PdfRubricStamp,
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfRubricStampSchema,
} from "./config";

const PAD = 3;
const FRAME = rgb(0.45, 0.45, 0.45);
const INK = rgb(0.1, 0.1, 0.1);

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
