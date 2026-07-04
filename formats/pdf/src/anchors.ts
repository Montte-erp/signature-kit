import { PDFDocument } from "@cantoo/pdf-lib";
import { Effect, Schema } from "effect";
import { parsePdfTextBoxesBrowser } from "./liteparse-browser";
import { clampCoordinate } from "./placement";
import {
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfSchemaNameValue,
  PdfTextAnchorSearchInputSchema,
} from "./config";
import type {
  PdfSignaturePage,
  PdfSignatureRect,
  PdfTextAnchorMatcher,
  PdfTextAnchorSearchInput,
  PdfTextBox,
} from "./config";

const DEFAULT_ANCHOR_OFFSET = 4;

const CPF_CNPJ_DIGIT_SEPARATORS = /[./-]/gu;
const MAXIMAL_DIGIT_RUN_PATTERN = /\d+/gu;

const digitRunsFromText = (value: string): ReadonlyArray<string> =>
  value
    .split(/\s+/gu)
    .flatMap(
      (part) => part.replace(CPF_CNPJ_DIGIT_SEPARATORS, "").match(MAXIMAL_DIGIT_RUN_PATTERN) ?? [],
    );

const matcherMatches = (
  text: string,
  digitRuns: ReadonlyArray<string>,
  matcher: PdfTextAnchorMatcher,
): boolean => {
  if ("text" in matcher) {
    return text.includes(matcher.text);
  }
  const normalizedMatcherDigits = matcher.digits.replace(/\D/gu, "");
  return digitRuns.some((run) => run === normalizedMatcherDigits);
};

const boxMatches = (box: PdfTextBox, matchers: ReadonlyArray<PdfTextAnchorMatcher>): boolean => {
  const text = box.text ?? "";
  if (text.length === 0) return false;
  const digitRuns = digitRunsFromText(text);
  return matchers.some((matcher) => matcherMatches(text, digitRuns, matcher));
};

const rectForAnchorBox = (
  page: PdfSignaturePage,
  box: PdfTextBox,
  input: PdfTextAnchorSearchInput,
): PdfSignatureRect => {
  const width = Math.min(input.stampSize.width, page.width);
  const height = Math.min(input.stampSize.height, page.height);
  const maxX = Math.max(0, page.width - width);
  const maxY = Math.max(0, page.height - height);
  const offset = input.offset ?? DEFAULT_ANCHOR_OFFSET;
  const preferredY =
    input.placement === "above" ? box.y - offset - height : box.y + box.height + offset;

  return {
    pageIndex: page.index,
    x: clampCoordinate(box.x, 0, maxX),
    y: clampCoordinate(preferredY, 0, maxY),
    width,
    height,
  };
};

const pdfPagesFromBytes = (
  pdf: Uint8Array,
): Effect.Effect<ReadonlyArray<PdfSignaturePage>, PdfError> =>
  Effect.tryPromise({
    try: async () => {
      const pdfDoc = await PDFDocument.load(pdf);
      return pdfDoc.getPages().map((page, index) => {
        const size = page.getSize();
        return { index, width: size.width, height: size.height };
      });
    },
    catch: () =>
      new PdfError({
        code: PdfErrorCodeValue.invalidPdf,
        retryable: false,
        operation: PdfOperationValue.findTextAnchors,
        reason: "Failed to load PDF pages for text-anchor placement.",
      }),
  });

type ResolvedAnchorGeometry = {
  readonly pages: ReadonlyArray<PdfSignaturePage>;
  readonly textBoxes: ReadonlyArray<ReadonlyArray<PdfTextBox>>;
};

const resolveAnchorGeometry = (
  input: PdfTextAnchorSearchInput,
): Effect.Effect<ResolvedAnchorGeometry, PdfError> => {
  const resolveTextBoxes = (
    pages: ReadonlyArray<PdfSignaturePage>,
  ): Effect.Effect<ResolvedAnchorGeometry, PdfError> => {
    if (input.textBoxes !== undefined) {
      return Effect.succeed({ pages, textBoxes: input.textBoxes });
    }
    if (input.pdf !== undefined) {
      return parsePdfTextBoxesBrowser(input.pdf, pages.length).pipe(
        Effect.map((textBoxes) => ({ pages, textBoxes })),
      );
    }
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: PdfOperationValue.findTextAnchors,
        reason:
          "Text-anchor search requires either textBoxes or pdf bytes that LiteParse can read.",
      }),
    );
  };

  if (input.pages !== undefined) return resolveTextBoxes(input.pages);
  if (input.pdf !== undefined)
    return pdfPagesFromBytes(input.pdf).pipe(Effect.flatMap(resolveTextBoxes));
  return Effect.fail(
    new PdfError({
      code: PdfErrorCodeValue.invalidBuilderInput,
      retryable: false,
      operation: PdfOperationValue.findTextAnchors,
      reason: "Text-anchor search requires either pages or pdf bytes.",
    }),
  );
};

export const findPdfTextAnchors = (
  input: PdfTextAnchorSearchInput,
): Effect.Effect<ReadonlyArray<PdfSignatureRect>, PdfError> =>
  Schema.decodeUnknownEffect(PdfTextAnchorSearchInputSchema)(input).pipe(
    Effect.mapError(
      (issue) =>
        new PdfError({
          code: PdfErrorCodeValue.invalidBuilderInput,
          retryable: false,
          operation: PdfOperationValue.findTextAnchors,
          schemaName: PdfSchemaNameValue.pdfTextAnchorSearchInput,
          reason: "PDF text-anchor search input failed schema validation.",
          issueMessage: String(issue),
        }),
    ),
    Effect.flatMap((valid) =>
      resolveAnchorGeometry(valid).pipe(
        Effect.map(({ pages, textBoxes }) =>
          pages.flatMap((page, pageIndex) => {
            const boxes = textBoxes[pageIndex] ?? [];
            return boxes.flatMap((box) =>
              boxMatches(box, valid.matchers) ? [rectForAnchorBox(page, box, valid)] : [],
            );
          }),
        ),
      ),
    ),
  );
