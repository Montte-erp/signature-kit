import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  StandardFonts,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from "@cantoo/pdf-lib";
import type { PDFFont, PDFPage, PDFImage, RGB } from "@cantoo/pdf-lib";
import qrcode from "qrcode-generator";
import { Effect, Schema } from "effect";
import { inflateZlibBounded } from "./byte-range.js";
import {
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfRubricPageStampInputSchema,
  PdfRubricStampSchema,
  PdfSchemaNameValue,
  PdfSignatureBadgeSchema,
  PdfVisibleStampQrSchema,
  PdfSignatureRectSchema,
} from "./config.js";
import type {
  PdfCoordinateTuple,
  PdfLiteParseResult,
  PdfRubricInitialsTheme,
  PdfRubricPageStampInput,
  PdfRubricStamp,
  PdfSignatureBadge,
  PdfSignatureBadgeFooterSegment,
  PdfSignatureBadgeRowItem,
  PdfSignatureBadgeTheme,
  PdfSignaturePage,
  PdfSignatureRect,
  PdfStampSize,
  PdfTextBox,
  PdfVisibleStampQr,
  PdfVisibleStampInput,
} from "./config.js";
import { hasPdfByteRange } from "./byte-range.js";
import { clampCoordinate } from "./placement.js";
const PAD = 3;
const FRAME = rgb(0.45, 0.45, 0.45);
const INK = rgb(0.1, 0.1, 0.1);
const WHITE = rgb(1, 1, 1);
const RUBRIC_RIGHT_MARGIN_PT = 18;
const RUBRIC_WIDTH_PT = 72;
const RUBRIC_HEIGHT_PT = 32;
const RUBRIC_COLLISION_PADDING_PT = 4;
const RUBRIC_INITIALS_DEFAULT_INK = "#1D4ED8";
const PORTUGUESE_NAME_CONNECTORS = ["de", "da", "do", "dos", "das", "e"];
const QR_QUIET_ZONE_MODULES = 4;
const QR_TEXT_GAP_PT = 6;
const MAX_PNG_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_PNG_PIXELS = 16 * 1024 * 1024;
const MAX_PNG_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_PNG_CHUNKS = 4096;
type PngSignature = readonly [number, number, number, number, number, number, number, number];
type PngChunkType = readonly [number, number, number, number];
type PngAdam7Pass = readonly [startX: number, startY: number, stepX: number, stepY: number];

const PNG_SIGNATURE: PngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_IHDR_END = 33;
const PNG_IHDR_TYPE: PngChunkType = [73, 72, 68, 82];
const PNG_IDAT_TYPE: PngChunkType = [73, 68, 65, 84];
const PNG_IEND_TYPE: PngChunkType = [73, 69, 78, 68];
const PNG_ACTL_TYPE: PngChunkType = [97, 99, 84, 76];
const PNG_FCTL_TYPE: PngChunkType = [102, 99, 84, 76];
const PNG_FDAT_TYPE: PngChunkType = [102, 100, 65, 84];
const PNG_ADAM7_PASSES: readonly PngAdam7Pass[] = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

type QrMatrix = {
  readonly moduleCount: number;
  readonly darkModules: ReadonlyArray<readonly [row: number, column: number]>;
};

const encodeVisibleStampQr = (qr: PdfVisibleStampQr): Effect.Effect<QrMatrix, PdfError> =>
  Effect.try({
    try: () => {
      const code = qrcode(0, "M");
      code.addData(qr.text);
      code.make();
      const moduleCount = code.getModuleCount();
      const darkModules: Array<readonly [row: number, column: number]> = [];
      for (let row = 0; row < moduleCount; row += 1) {
        for (let column = 0; column < moduleCount; column += 1) {
          if (code.isDark(row, column)) {
            darkModules.push([row, column]);
          }
        }
      }
      return { moduleCount, darkModules };
    },
    catch: () =>
      new PdfError({
        code: PdfErrorCodeValue.stampFailed,
        retryable: false,
        operation: PdfOperationValue.stamp,
        reason: "Failed to encode the visible signature QR code.",
      }),
  });

type BadgeThemeHex = { readonly [Key in keyof PdfSignatureBadgeTheme]-?: string };

const BADGE_DEFAULT_THEME: BadgeThemeHex = {
  borderColor: "#3B5BDB",
  backgroundColor: "#F0F4FF",
  headerColor: "#2F9E44",
  labelColor: "#1F2937",
  valueColor: "#111827",
  footerColor: "#6B7280",
  linkColor: "#2563EB",
  separatorColor: "#CBD5E1",
};

const BADGE_FOOTER_SEPARATOR = " | ";
const BADGE_LINK_ANNOTATION_FLAG_PRINT = 0x04;
const BADGE_HEADER_SIZE_CAP = 13.5;
const BADGE_ROW_SIZE_CAP = 10.5;
const BADGE_FOOTER_SIZE_CAP = 7.5;

type ResolvedBadgeTheme = {
  readonly borderColor: RGB;
  readonly backgroundColor: RGB;
  readonly headerColor: RGB;
  readonly labelColor: RGB;
  readonly valueColor: RGB;
  readonly footerColor: RGB;
  readonly linkColor: RGB;
  readonly separatorColor: RGB;
};

type FooterLineSegment = {
  readonly segment: PdfSignatureBadgeFooterSegment;
  readonly width: number;
};

type FooterLine = {
  readonly segments: ReadonlyArray<FooterLineSegment>;
  readonly width: number;
};

export type PdfSignatureBadgeLayoutRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type PdfSignatureBadgeTextRunLayout = {
  readonly text: string;
  readonly rect: PdfSignatureBadgeLayoutRect;
  readonly baseline: number;
};

export type PdfSignatureBadgeHeaderLayout = {
  readonly rect: PdfSignatureBadgeLayoutRect;
  readonly baseline: number;
  readonly padlock: PdfSignatureBadgeLayoutRect;
  readonly text: PdfSignatureBadgeTextRunLayout;
};

export type PdfSignatureBadgeRowItemLayout = {
  readonly separator: PdfSignatureBadgeTextRunLayout | undefined;
  readonly label: PdfSignatureBadgeTextRunLayout;
  readonly value: PdfSignatureBadgeTextRunLayout;
};

export type PdfSignatureBadgeRowLayout = {
  readonly rect: PdfSignatureBadgeLayoutRect;
  readonly baseline: number;
  readonly items: ReadonlyArray<PdfSignatureBadgeRowItemLayout>;
};

export type PdfSignatureBadgeFooterSegmentLayout = {
  readonly segment: PdfSignatureBadgeFooterSegment;
  readonly separator: PdfSignatureBadgeTextRunLayout | undefined;
  readonly text: PdfSignatureBadgeTextRunLayout;
  readonly underline: PdfSignatureBadgeLayoutRect | undefined;
  readonly annotation: PdfSignatureBadgeLayoutRect | undefined;
};

export type PdfSignatureBadgeFooterLineLayout = {
  readonly rect: PdfSignatureBadgeLayoutRect;
  readonly baseline: number;
  readonly segments: ReadonlyArray<PdfSignatureBadgeFooterSegmentLayout>;
};

export type PdfSignatureBadgeLayout = {
  readonly container: PdfSignatureBadgeLayoutRect;
  readonly padding: number;
  readonly gutter: number;
  readonly radius: number;
  readonly headerSize: number;
  readonly rowSize: number;
  readonly footerSize: number;
  readonly rowLeading: number;
  readonly headerGap: number;
  readonly footerLeading: number;
  readonly separatorGap: number;
  readonly footerGap: number;
  readonly textBlock: PdfSignatureBadgeLayoutRect;
  readonly qr: PdfSignatureBadgeLayoutRect | undefined;
  readonly header: PdfSignatureBadgeHeaderLayout;
  readonly rows: ReadonlyArray<PdfSignatureBadgeRowLayout>;
  readonly separator: PdfSignatureBadgeLayoutRect | undefined;
  readonly footer: {
    readonly rect: PdfSignatureBadgeLayoutRect | undefined;
    readonly lines: ReadonlyArray<PdfSignatureBadgeFooterLineLayout>;
  };
};

const hexToRgb = (hex: string): RGB =>
  rgb(
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  );

const normalizeInitialsSource = (name: string): string =>
  name.normalize("NFD").replace(/\p{Diacritic}/gu, "");

export const deriveSignerInitials = (name: string): string => {
  const normalized = normalizeInitialsSource(name);
  const words = normalized
    .split(/\s+/u)
    .map((word) => word.replace(/[^A-Za-z0-9]/gu, ""))
    .filter((word) => word.length > 0);
  const meaningful = words.filter(
    (word) => !PORTUGUESE_NAME_CONNECTORS.includes(word.toLocaleLowerCase("pt-BR")),
  );
  const source = meaningful.length > 0 ? meaningful : words;
  const initials = source
    .map((word) => word[0] ?? "")
    .filter((letter) => letter.length > 0)
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("pt-BR");

  if (initials.length >= 2) return initials;

  const latinFallback = normalized.replace(/[^A-Za-z0-9]/gu, "").slice(0, 2);
  if (latinFallback.length > 0) return latinFallback.toLocaleUpperCase("pt-BR");

  return Array.from(name.trim().replace(/\s+/gu, ""))
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("pt-BR");
};

const resolveRubricInitialsTheme = (
  theme: PdfRubricInitialsTheme | undefined,
): { readonly ink: RGB; readonly bracket: RGB; readonly background: RGB | undefined } => {
  const inkColor = theme?.inkColor ?? RUBRIC_INITIALS_DEFAULT_INK;
  return {
    ink: hexToRgb(inkColor),
    bracket: hexToRgb(theme?.bracketColor ?? inkColor),
    background: theme?.backgroundColor === undefined ? undefined : hexToRgb(theme.backgroundColor),
  };
};

const drawInitialsRubric = (
  page: PDFPage,
  font: PDFFont,
  left: number,
  bottom: number,
  width: number,
  height: number,
  initials: string,
  theme: PdfRubricInitialsTheme | undefined,
): void => {
  const colors = resolveRubricInitialsTheme(theme);
  if (colors.background !== undefined) {
    page.drawRectangle({ x: left, y: bottom, width, height, color: colors.background });
  }

  const inset = Math.max(2, Math.min(width, height) * 0.14);
  const corner = Math.max(6, Math.min(width, height) * 0.28);
  const thickness = Math.max(0.8, Math.min(width, height) * 0.035);
  const x1 = left + inset;
  const x2 = left + width - inset;
  const y1 = bottom + inset;
  const y2 = bottom + height - inset;
  const drawCorner = (
    horizontalStart: readonly [number, number],
    horizontalEnd: readonly [number, number],
    verticalStart: readonly [number, number],
    verticalEnd: readonly [number, number],
  ): void => {
    page.drawLine({
      start: { x: horizontalStart[0], y: horizontalStart[1] },
      end: { x: horizontalEnd[0], y: horizontalEnd[1] },
      thickness,
      color: colors.bracket,
    });
    page.drawLine({
      start: { x: verticalStart[0], y: verticalStart[1] },
      end: { x: verticalEnd[0], y: verticalEnd[1] },
      thickness,
      color: colors.bracket,
    });
  };

  drawCorner([x1, y2], [x1 + corner, y2], [x1, y2], [x1, y2 - corner]);
  drawCorner([x2, y2], [x2 - corner, y2], [x2, y2], [x2, y2 - corner]);
  drawCorner([x1, y1], [x1 + corner, y1], [x1, y1], [x1, y1 + corner]);
  drawCorner([x2, y1], [x2 - corner, y1], [x2, y1], [x2, y1 + corner]);

  const cleanInitials = deriveSignerInitials(initials);
  const textWidthAtOne = font.widthOfTextAtSize(cleanInitials, 1);
  const size = Math.max(
    6,
    Math.min(height * 0.48, textWidthAtOne > 0 ? (width - inset * 2) / textWidthAtOne : height),
  );
  const textWidth = font.widthOfTextAtSize(cleanInitials, size);
  page.drawText(cleanInitials, {
    x: left + (width - textWidth) / 2,
    y: bottom + (height - size) / 2 + size * 0.08,
    size,
    font,
    color: colors.ink,
  });
};

const resolveBadgeTheme = (theme: PdfSignatureBadgeTheme | undefined): ResolvedBadgeTheme => ({
  borderColor: hexToRgb(theme?.borderColor ?? BADGE_DEFAULT_THEME.borderColor),
  backgroundColor: hexToRgb(theme?.backgroundColor ?? BADGE_DEFAULT_THEME.backgroundColor),
  headerColor: hexToRgb(theme?.headerColor ?? BADGE_DEFAULT_THEME.headerColor),
  labelColor: hexToRgb(theme?.labelColor ?? BADGE_DEFAULT_THEME.labelColor),
  valueColor: hexToRgb(theme?.valueColor ?? BADGE_DEFAULT_THEME.valueColor),
  footerColor: hexToRgb(theme?.footerColor ?? BADGE_DEFAULT_THEME.footerColor),
  linkColor: hexToRgb(theme?.linkColor ?? BADGE_DEFAULT_THEME.linkColor),
  separatorColor: hexToRgb(theme?.separatorColor ?? BADGE_DEFAULT_THEME.separatorColor),
});

const roundedRectPath = (width: number, height: number, radius: number): string =>
  [
    `M ${radius} 0`,
    `H ${width - radius}`,
    `Q ${width} 0 ${width} ${-radius}`,
    `V ${radius - height}`,
    `Q ${width} ${-height} ${width - radius} ${-height}`,
    `H ${radius}`,
    `Q 0 ${-height} 0 ${radius - height}`,
    `V ${-radius}`,
    `Q 0 0 ${radius} 0`,
    "Z",
  ].join(" ");

const drawVisibleStampQrMatrix = (
  page: PDFPage,
  qr: QrMatrix,
  x: number,
  y: number,
  side: number,
): void => {
  const moduleSize = side / (qr.moduleCount + QR_QUIET_ZONE_MODULES * 2);
  page.drawRectangle({
    x,
    y,
    width: side,
    height: side,
    color: WHITE,
  });
  for (const [row, column] of qr.darkModules) {
    page.drawRectangle({
      x: x + (column + QR_QUIET_ZONE_MODULES) * moduleSize,
      y: y + side - (row + QR_QUIET_ZONE_MODULES + 1) * moduleSize,
      width: moduleSize,
      height: moduleSize,
      color: INK,
    });
  }
};

type InkPngTextColumnOptions = {
  readonly page: PDFPage;
  readonly font: PDFFont;
  readonly image: PDFImage | undefined;
  readonly lines: ReadonlyArray<string>;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly textColor: RGB;
  readonly imageHeightRatioWithLines: number;
  readonly minTextSize: number;
  readonly textSizeOffset: number;
  readonly textPadding: number;
  readonly leading: "fixed" | "proportional";
  readonly separator: boolean;
};

const drawInkPngTextColumn = ({
  page,
  font,
  image,
  lines,
  x,
  y,
  width,
  height,
  textColor,
  imageHeightRatioWithLines,
  minTextSize,
  textSizeOffset,
  textPadding,
  leading,
  separator,
}: InkPngTextColumnOptions): void => {
  let textTop = y + height - PAD;
  const textX = x + textPadding;
  const textWidth = Math.max(0, width - textPadding * 2);

  if (image !== undefined && width > 0) {
    const maxH = height * (lines.length > 0 ? imageHeightRatioWithLines : 0.92) - PAD;
    const maxW = textWidth;
    const scale = Math.min(maxW / image.width, maxH / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    page.drawImage(image, {
      x: x + (width - drawW) / 2,
      y: y + height - drawH - PAD,
      width: drawW,
      height: drawH,
    });
    textTop = y + height - drawH - PAD - 1;
  }

  if (separator && image !== undefined && lines.length > 0 && textWidth > 0) {
    page.drawLine({
      start: { x: textX, y: textTop },
      end: { x: textX + textWidth, y: textTop },
      thickness: 0.5,
      color: rgb(0.55, 0.55, 0.55),
    });
  }

  if (lines.length > 0 && textWidth > 0) {
    const size = Math.max(
      minTextSize,
      Math.min(7, (textTop - y - PAD) / lines.length - textSizeOffset),
    );
    const lineGap = leading === "fixed" ? 1.5 : Math.max(0.8, size * 0.25);
    let ty = textTop - size;
    for (const line of lines) {
      page.drawText(line, {
        x: textX,
        y: ty,
        size,
        font,
        color: textColor,
        maxWidth: textWidth,
      });
      ty -= size + lineGap;
    }
  }
};

const drawBadgePadlock = (page: PDFPage, rect: PdfSignatureBadgeLayoutRect, color: RGB): void => {
  const bodyWidth = rect.width * 0.68;
  const bodyHeight = rect.height * 0.44;
  const bodyX = rect.x + rect.width * 0.16;
  const bodyY = rect.y;
  const bodyTop = bodyY + bodyHeight;
  page.drawRectangle({
    x: bodyX,
    y: bodyY,
    width: bodyWidth,
    height: bodyHeight,
    color,
  });
  page.drawSvgPath(
    [
      `M ${rect.width * 0.28} ${-(bodyTop - rect.y)}`,
      `V ${-(rect.height * 0.64)}`,
      `Q ${rect.width * 0.28} ${-rect.height} ${rect.width * 0.5} ${-rect.height}`,
      `Q ${rect.width * 0.72} ${-rect.height} ${rect.width * 0.72} ${-(rect.height * 0.64)}`,
      `V ${-(bodyTop - rect.y)}`,
    ].join(" "),
    {
      x: rect.x,
      y: rect.y,
      borderColor: color,
      borderWidth: Math.max(0.6, rect.height * 0.09),
    },
  );
};

const truncateBadgeTextToWidth = (
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string => {
  if (maxWidth <= 0) return "";
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const suffix = "...";
  const suffixWidth = font.widthOfTextAtSize(suffix, size);
  if (suffixWidth > maxWidth) return "";
  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (
      font.widthOfTextAtSize(characters.slice(0, middle).join(""), size) <=
      maxWidth - suffixWidth
    ) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return `${characters.slice(0, low).join("")}${suffix}`;
};

const footerLineSegmentAtSize = (
  segment: PdfSignatureBadgeFooterSegment,
  font: PDFFont,
  size: number,
  maxWidth: number,
): FooterLineSegment => {
  const text = truncateBadgeTextToWidth(segment.text, font, size, maxWidth);
  return {
    segment: text === segment.text ? segment : { ...segment, text },
    width: font.widthOfTextAtSize(text, size),
  };
};

const footerLinesAtSize = (
  footer: ReadonlyArray<PdfSignatureBadgeFooterSegment>,
  font: PDFFont,
  size: number,
  maxWidth: number,
): ReadonlyArray<FooterLine> => {
  const separatorWidth = font.widthOfTextAtSize(BADGE_FOOTER_SEPARATOR, size);
  const lines: Array<ReadonlyArray<FooterLineSegment>> = [];
  let current: Array<FooterLineSegment> = [];
  let currentWidth = 0;
  for (const segment of footer) {
    const measured = footerLineSegmentAtSize(segment, font, size, maxWidth);
    const gap = current.length === 0 ? 0 : separatorWidth;
    const projected = currentWidth + gap + measured.width;
    if (current.length > 0 && projected > maxWidth) {
      lines.push(current);
      current = [measured];
      currentWidth = measured.width;
    } else {
      current.push(measured);
      currentWidth = projected;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.map((line) => {
    let width = 0;
    for (let index = 0; index < line.length; index += 1) {
      width += line[index]?.width ?? 0;
      if (index > 0) width += separatorWidth;
    }
    return { segments: line, width };
  });
};

const textRunLayout = (
  text: string,
  x: number,
  baseline: number,
  width: number,
  size: number,
): PdfSignatureBadgeTextRunLayout => ({
  text,
  rect: { x, y: baseline, width, height: size },
  baseline,
});

const badgeTextBlockHeight = (
  rows: ReadonlyArray<ReadonlyArray<PdfSignatureBadgeRowItem>>,
  headerSize: number,
  headerGap: number,
  rowSize: number,
  rowLeading: number,
): number =>
  headerSize + headerGap + rows.length * rowSize + Math.max(0, rows.length - 1) * rowLeading;

const badgeFooterHeight = (
  footerLines: ReadonlyArray<FooterLine>,
  footerSize: number,
  footerLeading: number,
): number =>
  footerLines.length === 0
    ? 0
    : footerLines.length * footerSize + Math.max(0, footerLines.length - 1) * footerLeading;

type BadgeMetrics = {
  readonly headerUnit: number;
  readonly rowUnit: number;
  readonly footerUnit: number;
  readonly headerSize: number;
  readonly rowSize: number;
  readonly footerSize: number;
  readonly rowLeading: number;
  readonly headerGap: number;
  readonly footerLeading: number;
  readonly separatorGap: number;
  readonly footerGap: number;
};

const badgeMetricsAtScale = (containerHeight: number, scale: number): BadgeMetrics => {
  const headerUnit = Math.min(10, containerHeight * 0.066);
  const rowUnit = Math.min(7.4, containerHeight * 0.049);
  const footerUnit = Math.min(5.6, containerHeight * 0.037);
  const headerSize = Math.min(BADGE_HEADER_SIZE_CAP, Math.max(5, headerUnit * scale));
  const rowSize = Math.min(BADGE_ROW_SIZE_CAP, Math.max(4.2, rowUnit * scale));
  const footerSize = Math.min(BADGE_FOOTER_SIZE_CAP, Math.max(3.4, footerUnit * scale));
  return {
    headerUnit,
    rowUnit,
    footerUnit,
    headerSize,
    rowSize,
    footerSize,
    rowLeading: Math.max(1, rowSize * 0.32),
    headerGap: Math.max(1.8, rowSize * 0.55),
    footerLeading: Math.max(0.5, footerSize * 0.22),
    separatorGap: Math.max(4, rowSize * 0.7),
    footerGap: Math.max(3, footerSize * 0.6),
  };
};

const badgeInitialScale = (
  rows: ReadonlyArray<ReadonlyArray<PdfSignatureBadgeRowItem>>,
  footer: ReadonlyArray<PdfSignatureBadgeFooterSegment>,
  containerHeight: number,
  padding: number,
  innerWidth: number,
  regularFont: PDFFont,
): number => {
  const innerHeight = Math.max(0, containerHeight - padding * 2);
  const metrics = badgeMetricsAtScale(containerHeight, 1);
  const footerLines = footerLinesAtSize(footer, regularFont, metrics.footerSize, innerWidth);
  const footerHeight = badgeFooterHeight(footerLines, metrics.footerSize, metrics.footerLeading);
  const separatorHeight = footerLines.length === 0 ? 0 : 0.6;
  const textBlockHeight = badgeTextBlockHeight(
    rows,
    metrics.headerSize,
    metrics.headerGap,
    metrics.rowSize,
    metrics.rowLeading,
  );
  const requiredHeight =
    textBlockHeight +
    (footerLines.length === 0
      ? 0
      : metrics.separatorGap + separatorHeight + metrics.footerGap + footerHeight);
  const headerCapScale = metrics.headerUnit > 0 ? BADGE_HEADER_SIZE_CAP / metrics.headerUnit : 1;
  const rowCapScale = metrics.rowUnit > 0 ? BADGE_ROW_SIZE_CAP / metrics.rowUnit : 1;
  const footerCapScale = metrics.footerUnit > 0 ? BADGE_FOOTER_SIZE_CAP / metrics.footerUnit : 1;
  const capScale = Math.min(headerCapScale, rowCapScale, footerCapScale);

  return requiredHeight > 0 ? Math.max(1, Math.min(innerHeight / requiredHeight, capScale)) : 1;
};
const badgeHeaderLayout = (
  badge: PdfSignatureBadge,
  baseline: number,
  headerSize: number,
  textLeft: number,
  textWidth: number,
  boldFont: PDFFont,
): PdfSignatureBadgeHeaderLayout => {
  const availableWidth = Math.max(0, textWidth);
  const lockSize = Math.min(headerSize * 0.86, availableWidth);
  const gap =
    lockSize === 0
      ? 0
      : Math.min(Math.max(1.8, headerSize * 0.22), Math.max(0, availableWidth - lockSize));
  const textX = textLeft + lockSize + gap;
  const text = truncateBadgeTextToWidth(
    badge.header.text,
    boldFont,
    headerSize,
    Math.max(0, availableWidth - lockSize - gap),
  );
  const textWidthAtSize = boldFont.widthOfTextAtSize(text, headerSize);
  const textRect = textRunLayout(text, textX, baseline, textWidthAtSize, headerSize);
  const padlock = {
    x: textLeft,
    y: baseline + headerSize * 0.05,
    width: lockSize,
    height: lockSize,
  };
  return {
    rect: {
      x: textLeft,
      y: baseline,
      width: lockSize + gap + textRect.rect.width,
      height: headerSize,
    },
    baseline,
    padlock,
    text: textRect,
  };
};

const badgeRowsLayout = (
  rows: ReadonlyArray<ReadonlyArray<PdfSignatureBadgeRowItem>>,
  firstBaseline: number,
  rowSize: number,
  rowLeading: number,
  textLeft: number,
  textWidth: number,
  boldFont: PDFFont,
  regularFont: PDFFont,
): ReadonlyArray<PdfSignatureBadgeRowLayout> => {
  const rowLayouts: Array<PdfSignatureBadgeRowLayout> = [];
  const textRight = textLeft + Math.max(0, textWidth);
  let baseline = firstBaseline;
  for (const row of rows) {
    let cursor = textLeft;
    const items: Array<PdfSignatureBadgeRowItemLayout> = [];
    for (let index = 0; index < row.length; index += 1) {
      const pair = row[index];
      if (pair !== undefined) {
        let separator: PdfSignatureBadgeTextRunLayout | undefined;
        if (index > 0) {
          const text = truncateBadgeTextToWidth(
            BADGE_FOOTER_SEPARATOR,
            regularFont,
            rowSize,
            Math.max(0, textRight - cursor),
          );
          const width = regularFont.widthOfTextAtSize(text, rowSize);
          separator =
            text.length === 0 ? undefined : textRunLayout(text, cursor, baseline, width, rowSize);
          cursor += width;
        }
        const label = truncateBadgeTextToWidth(
          `${pair.label}: `,
          boldFont,
          rowSize,
          Math.max(0, textRight - cursor),
        );
        const labelWidth = boldFont.widthOfTextAtSize(label, rowSize);
        const labelRun = textRunLayout(label, cursor, baseline, labelWidth, rowSize);
        cursor += labelWidth;
        const value = truncateBadgeTextToWidth(
          pair.value,
          regularFont,
          rowSize,
          Math.max(0, textRight - cursor),
        );
        const valueWidth = regularFont.widthOfTextAtSize(value, rowSize);
        const valueRun = textRunLayout(value, cursor, baseline, valueWidth, rowSize);
        cursor += valueWidth;
        items.push({ separator, label: labelRun, value: valueRun });
      }
    }
    rowLayouts.push({
      rect: {
        x: textLeft,
        y: baseline,
        width: Math.max(0, cursor - textLeft),
        height: rowSize,
      },
      baseline,
      items,
    });
    baseline -= rowSize + rowLeading;
  }
  return rowLayouts;
};

const badgeFooterLayout = (
  footerLines: ReadonlyArray<FooterLine>,
  footerBottom: number,
  footerSize: number,
  footerLeading: number,
  container: PdfSignatureBadgeLayoutRect,
  padding: number,
  regularFont: PDFFont,
): {
  readonly rect: PdfSignatureBadgeLayoutRect | undefined;
  readonly lines: ReadonlyArray<PdfSignatureBadgeFooterLineLayout>;
} => {
  if (footerLines.length === 0) return { rect: undefined, lines: [] };
  const separatorWidth = regularFont.widthOfTextAtSize(BADGE_FOOTER_SEPARATOR, footerSize);
  const footerHeight = badgeFooterHeight(footerLines, footerSize, footerLeading);
  const lineLayouts: Array<PdfSignatureBadgeFooterLineLayout> = [];
  let baseline = footerBottom + footerHeight - footerSize;
  for (const line of footerLines) {
    let cursor = container.x + (container.width - line.width) / 2;
    const segmentLayouts: Array<PdfSignatureBadgeFooterSegmentLayout> = [];
    for (let index = 0; index < line.segments.length; index += 1) {
      const item = line.segments[index];
      if (item !== undefined) {
        let separator: PdfSignatureBadgeTextRunLayout | undefined;
        if (index > 0) {
          separator = textRunLayout(
            BADGE_FOOTER_SEPARATOR,
            cursor,
            baseline,
            separatorWidth,
            footerSize,
          );
          cursor += separatorWidth;
        }
        const text = textRunLayout(item.segment.text, cursor, baseline, item.width, footerSize);
        const underline =
          item.segment.link === undefined
            ? undefined
            : {
                x: cursor,
                y: baseline - Math.max(0.6, footerSize * 0.12),
                width: item.width,
                height: Math.max(0.3, footerSize * 0.06),
              };
        const annotation =
          item.segment.link === undefined
            ? undefined
            : {
                x: cursor,
                y: baseline - Math.max(1, footerSize * 0.2),
                width: item.width,
                height: footerSize + Math.max(2, footerSize * 0.3),
              };
        segmentLayouts.push({
          segment: item.segment,
          separator,
          text,
          underline,
          annotation,
        });
        cursor += item.width;
      }
    }
    lineLayouts.push({
      rect: {
        x: container.x + padding,
        y: baseline,
        width: Math.max(0, container.width - padding * 2),
        height: footerSize,
      },
      baseline,
      segments: segmentLayouts,
    });
    baseline -= footerSize + footerLeading;
  }
  return {
    rect: {
      x: container.x + padding,
      y: footerBottom,
      width: Math.max(0, container.width - padding * 2),
      height: footerHeight,
    },
    lines: lineLayouts,
  };
};

export const layoutPdfSignatureBadge = (
  badge: PdfSignatureBadge,
  container: PdfSignatureBadgeLayoutRect,
  regularFont: PDFFont,
  boldFont: PDFFont,
): PdfSignatureBadgeLayout => {
  const padding = clampCoordinate(container.height * 0.075, 8, 12);
  const gutter = clampCoordinate(container.width * 0.028, 8, 14);
  const radius = clampCoordinate(container.height * 0.13, 4, 10);
  const innerWidth = Math.max(0, container.width - padding * 2);
  const innerHeight = Math.max(0, container.height - padding * 2);
  let scale = badgeInitialScale(
    badge.rows,
    badge.footer,
    container.height,
    padding,
    innerWidth,
    regularFont,
  );
  let layout: PdfSignatureBadgeLayout;
  let attempt = 0;
  do {
    const {
      headerSize,
      rowSize,
      footerSize,
      rowLeading,
      headerGap,
      footerLeading,
      separatorGap,
      footerGap,
    } = badgeMetricsAtScale(container.height, scale);
    const footerLines = footerLinesAtSize(badge.footer, regularFont, footerSize, innerWidth);
    const footerHeight = badgeFooterHeight(footerLines, footerSize, footerLeading);
    const separatorHeight = footerLines.length === 0 ? 0 : 0.6;
    const textBlockHeight = badgeTextBlockHeight(
      badge.rows,
      headerSize,
      headerGap,
      rowSize,
      rowLeading,
    );
    const requiredHeight =
      textBlockHeight +
      (footerLines.length === 0 ? 0 : separatorGap + separatorHeight + footerGap + footerHeight);
    const textBlockTop = container.y + container.height - padding;
    const textBlockBottom = textBlockTop - textBlockHeight;
    const qrSide =
      badge.qr === undefined
        ? 0
        : Math.max(0, Math.min(textBlockHeight, innerWidth * 0.32, innerHeight));
    const qr =
      badge.qr === undefined || qrSide <= 0
        ? undefined
        : {
            x: container.x + padding,
            y: textBlockBottom,
            width: qrSide,
            height: qrSide,
          };
    const textLeft = qr === undefined ? container.x + padding : qr.x + qr.width + gutter;
    const textWidth = Math.max(0, container.x + container.width - padding - textLeft);
    const headerBaseline = textBlockTop - headerSize;
    const header = badgeHeaderLayout(
      badge,
      headerBaseline,
      headerSize,
      textLeft,
      textWidth,
      boldFont,
    );
    const rows = badgeRowsLayout(
      badge.rows,
      headerBaseline - headerGap - rowSize,
      rowSize,
      rowLeading,
      textLeft,
      textWidth,
      boldFont,
      regularFont,
    );
    const footerBottom = container.y + padding;
    const footer = badgeFooterLayout(
      footerLines,
      footerBottom,
      footerSize,
      footerLeading,
      container,
      padding,
      regularFont,
    );
    const separator =
      footer.rect === undefined
        ? undefined
        : {
            x: container.x + padding,
            y: footer.rect.y + footer.rect.height + footerGap,
            width: innerWidth,
            height: separatorHeight,
          };
    layout = {
      container,
      padding,
      gutter,
      radius,
      headerSize,
      rowSize,
      footerSize,
      rowLeading,
      headerGap,
      footerLeading,
      separatorGap,
      footerGap,
      textBlock: {
        x: textLeft,
        y: textBlockBottom,
        width: textWidth,
        height: textBlockHeight,
      },
      qr,
      header,
      rows,
      separator,
      footer,
    };
    const footerFits = footerLines.every((line) => line.width <= innerWidth);
    const rowFits = rows.every((row) => row.rect.width <= textWidth);
    const separatorTop = separator === undefined ? undefined : separator.y + separator.height;
    if (
      textWidth > 0 &&
      requiredHeight <= innerHeight &&
      (separatorTop === undefined || textBlockBottom >= separatorTop + separatorGap) &&
      header.rect.width <= textWidth &&
      rowFits &&
      footerFits
    ) {
      return layout;
    }
    scale *= 0.92;
    attempt += 1;
  } while (attempt < 24);
  return layout;
};

const linkAnnotationRect = (
  pdfDoc: PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
): PDFArray => {
  const rect = PDFArray.withContext(pdfDoc.context);
  rect.push(PDFNumber.of(x));
  rect.push(PDFNumber.of(y));
  rect.push(PDFNumber.of(x + width));
  rect.push(PDFNumber.of(y + height));
  return rect;
};

const addUriLinkAnnotation = (
  pdfDoc: PDFDocument,
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  uri: string,
): void => {
  const annotation = pdfDoc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: linkAnnotationRect(pdfDoc, x, y, width, height),
    Border: [0, 0, 0],
    F: BADGE_LINK_ANNOTATION_FLAG_PRINT,
    A: {
      Type: "Action",
      S: "URI",
      URI: PDFHexString.fromText(uri),
    },
  });
  const annotationRef = pdfDoc.context.register(annotation);
  let annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annotations === undefined) annotations = pdfDoc.context.obj([]);
  annotations.push(annotationRef);
  page.node.set(PDFName.of("Annots"), annotations);
};

const drawBadgeTextRun = (
  page: PDFPage,
  run: PdfSignatureBadgeTextRunLayout,
  font: PDFFont,
  color: RGB,
): void => {
  page.drawText(run.text, {
    x: run.rect.x,
    y: run.baseline,
    size: run.rect.height,
    font,
    color,
    maxWidth: run.rect.width,
  });
};

export const defaultPdfSignatureRect = (
  page: PdfSignaturePage,
  stampSize: PdfStampSize,
  margin = 24,
): PdfSignatureRect => {
  const width = Math.min(stampSize.width, page.width);
  const height = Math.min(stampSize.height, page.height);
  const maxX = Math.max(0, page.width - width);
  const maxY = Math.max(0, page.height - height);

  return {
    pageIndex: page.index,
    x: clampCoordinate(page.width - margin - width, 0, maxX),
    y: clampCoordinate(page.height - margin - height, 0, maxY),
    width,
    height,
  };
};

const drawBadgeRows = (
  page: PDFPage,
  layout: PdfSignatureBadgeLayout,
  boldFont: PDFFont,
  regularFont: PDFFont,
  theme: ResolvedBadgeTheme,
): void => {
  for (const row of layout.rows) {
    for (const item of row.items) {
      if (item.separator !== undefined) {
        drawBadgeTextRun(page, item.separator, regularFont, theme.valueColor);
      }
      drawBadgeTextRun(page, item.label, boldFont, theme.labelColor);
      drawBadgeTextRun(page, item.value, regularFont, theme.valueColor);
    }
  }
};

const drawBadgeFooter = (
  pdfDoc: PDFDocument,
  page: PDFPage,
  layout: PdfSignatureBadgeLayout,
  regularFont: PDFFont,
  theme: ResolvedBadgeTheme,
  pageCoordinateSystem: PdfVisiblePageCoordinateSystem,
): void => {
  if (layout.separator !== undefined) {
    page.drawLine({
      start: { x: layout.separator.x, y: layout.separator.y + layout.separator.height / 2 },
      end: {
        x: layout.separator.x + layout.separator.width,
        y: layout.separator.y + layout.separator.height / 2,
      },
      thickness: layout.separator.height,
      color: theme.separatorColor,
      dashArray: [4, 4],
    });
  }
  for (const line of layout.footer.lines) {
    for (const item of line.segments) {
      if (item.separator !== undefined) {
        drawBadgeTextRun(page, item.separator, regularFont, theme.footerColor);
      }
      const color = item.segment.link === undefined ? theme.footerColor : theme.linkColor;
      drawBadgeTextRun(page, item.text, regularFont, color);
      if (item.underline !== undefined) {
        page.drawLine({
          start: { x: item.underline.x, y: item.underline.y },
          end: { x: item.underline.x + item.underline.width, y: item.underline.y },
          thickness: item.underline.height,
          color: theme.linkColor,
        });
      }
      if (item.annotation !== undefined && item.segment.link !== undefined) {
        const [left, bottom, right, top] = pdfCoordinateTupleFromVisibleBottomLeftRect(
          item.annotation,
          pageCoordinateSystem,
        );
        addUriLinkAnnotation(
          pdfDoc,
          page,
          left,
          bottom,
          right - left,
          top - bottom,
          item.segment.link,
        );
      }
    }
  }
};

const drawSignatureBadge = (
  pdfDoc: PDFDocument,
  page: PDFPage,
  badge: PdfSignatureBadge,
  layout: PdfSignatureBadgeLayout,
  regularFont: PDFFont,
  boldFont: PDFFont,
  qr: QrMatrix | undefined,
  pageCoordinateSystem: PdfVisiblePageCoordinateSystem,
): void => {
  const theme = resolveBadgeTheme(badge.theme);
  page.drawSvgPath(
    roundedRectPath(layout.container.width, layout.container.height, layout.radius),
    {
      x: layout.container.x,
      y: layout.container.y,
      color: theme.backgroundColor,
      borderColor: theme.borderColor,
      borderWidth: 1.5,
    },
  );
  if (qr !== undefined && layout.qr !== undefined) {
    drawVisibleStampQrMatrix(page, qr, layout.qr.x, layout.qr.y, layout.qr.width);
  }
  drawBadgePadlock(page, layout.header.padlock, theme.headerColor);
  drawBadgeTextRun(page, layout.header.text, boldFont, theme.headerColor);
  drawBadgeRows(page, layout, boldFont, regularFont, theme);
  drawBadgeFooter(pdfDoc, page, layout, regularFont, theme, pageCoordinateSystem);
};

export type PdfVisiblePageRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type PdfVisiblePageCoordinateSystem = {
  readonly cropBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly rotation: 0 | 90 | 180 | 270;
  readonly width: number;
  readonly height: number;
  readonly matrix: readonly [number, number, number, number, number, number];
};

const normalizedPageRotation = (page: PDFPage): 0 | 90 | 180 | 270 => {
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  if (angle === 90) return 90;
  if (angle === 180) return 180;
  if (angle === 270) return 270;
  return 0;
};

const visiblePageCoordinateSystem = (page: PDFPage): PdfVisiblePageCoordinateSystem => {
  const cropBox = page.getCropBox();
  const rotation = normalizedPageRotation(page);
  if (rotation === 90) {
    return {
      cropBox,
      rotation,
      width: cropBox.height,
      height: cropBox.width,
      matrix: [0, 1, -1, 0, cropBox.x + cropBox.width, cropBox.y],
    };
  }
  if (rotation === 180) {
    return {
      cropBox,
      rotation,
      width: cropBox.width,
      height: cropBox.height,
      matrix: [-1, 0, 0, -1, cropBox.x + cropBox.width, cropBox.y + cropBox.height],
    };
  }
  if (rotation === 270) {
    return {
      cropBox,
      rotation,
      width: cropBox.height,
      height: cropBox.width,
      matrix: [0, -1, 1, 0, cropBox.x, cropBox.y + cropBox.height],
    };
  }
  return {
    cropBox,
    rotation,
    width: cropBox.width,
    height: cropBox.height,
    matrix: [1, 0, 0, 1, cropBox.x, cropBox.y],
  };
};

export const visiblePdfPageSize = (
  page: PDFPage,
): { readonly width: number; readonly height: number } => {
  const { width, height } = visiblePageCoordinateSystem(page);
  return { width, height };
};

const isIdentityPageCoordinateSystem = (
  coordinateSystem: PdfVisiblePageCoordinateSystem,
): boolean =>
  coordinateSystem.matrix[0] === 1 &&
  coordinateSystem.matrix[1] === 0 &&
  coordinateSystem.matrix[2] === 0 &&
  coordinateSystem.matrix[3] === 1 &&
  coordinateSystem.matrix[4] === 0 &&
  coordinateSystem.matrix[5] === 0;

const pdfCoordinateTupleFromVisibleBottomLeftRect = (
  rect: PdfVisiblePageRect,
  coordinateSystem: PdfVisiblePageCoordinateSystem,
): PdfCoordinateTuple => {
  const { x, y, width, height } = rect;
  const cropBox = coordinateSystem.cropBox;
  switch (coordinateSystem.rotation) {
    case 90:
      return [
        cropBox.x + cropBox.width - y - height,
        cropBox.y + x,
        cropBox.x + cropBox.width - y,
        cropBox.y + x + width,
      ];
    case 180:
      return [
        cropBox.x + cropBox.width - x - width,
        cropBox.y + cropBox.height - y - height,
        cropBox.x + cropBox.width - x,
        cropBox.y + cropBox.height - y,
      ];
    case 270:
      return [
        cropBox.x + y,
        cropBox.y + cropBox.height - x - width,
        cropBox.x + y + height,
        cropBox.y + cropBox.height - x,
      ];
    case 0:
      return [cropBox.x + x, cropBox.y + y, cropBox.x + x + width, cropBox.y + y + height];
  }
};

export const pdfCoordinateTupleFromTopLeftRect = (
  rect: PdfSignatureRect,
  page: number | PDFPage,
): PdfCoordinateTuple => {
  if (typeof page === "number") {
    const bottom = page - rect.y - rect.height;
    return [rect.x, bottom, rect.x + rect.width, bottom + rect.height];
  }
  const coordinateSystem = visiblePageCoordinateSystem(page);
  return pdfCoordinateTupleFromVisibleBottomLeftRect(
    {
      x: rect.x,
      y: coordinateSystem.height - rect.y - rect.height,
      width: rect.width,
      height: rect.height,
    },
    coordinateSystem,
  );
};

export const topLeftRectFromPdfCoordinateTuple = (
  [left, bottom, right, top]: PdfCoordinateTuple,
  page: PDFPage,
): PdfVisiblePageRect => {
  const coordinateSystem = visiblePageCoordinateSystem(page);
  const cropBox = coordinateSystem.cropBox;
  switch (coordinateSystem.rotation) {
    case 90:
      return {
        x: bottom - cropBox.y,
        y: left - cropBox.x,
        width: top - bottom,
        height: right - left,
      };
    case 180:
      return {
        x: cropBox.x + cropBox.width - right,
        y: bottom - cropBox.y,
        width: right - left,
        height: top - bottom,
      };
    case 270:
      return {
        x: cropBox.y + cropBox.height - top,
        y: cropBox.x + cropBox.width - right,
        width: top - bottom,
        height: right - left,
      };
    case 0:
      return {
        x: left - cropBox.x,
        y: cropBox.y + cropBox.height - top,
        width: right - left,
        height: top - bottom,
      };
  }
};

export const rubricRectForPage = (
  targetPage: PdfSignaturePage,
  textBoxes: ReadonlyArray<PdfTextBox> = [],
): PdfSignatureRect => {
  const width = Math.min(RUBRIC_WIDTH_PT, targetPage.width);
  const height = Math.min(RUBRIC_HEIGHT_PT, targetPage.height);
  const maxX = Math.max(0, targetPage.width - width);
  const maxY = Math.max(0, targetPage.height - height);
  const x = clampCoordinate(targetPage.width - RUBRIC_RIGHT_MARGIN_PT - width, 0, maxX);
  const preferredY = clampCoordinate((targetPage.height - height) / 2, 0, maxY);
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
    .map((y) => clampCoordinate(y, 0, maxY))
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
  pageDimensions.flatMap((page) => (page.index === signaturePageIndex ? [] : [page.index]));

export const textBoxesFromLiteParseResult = (
  parsed: PdfLiteParseResult,
): ReadonlyArray<ReadonlyArray<PdfTextBox>> =>
  [...parsed.pages]
    .sort((left, right) => left.pageNum - right.pageNum)
    .map((page) =>
      page.textItems.flatMap((item) =>
        item.text.trim().length === 0
          ? []
          : [
              {
                x: item.x,
                y: item.y,
                width: item.width,
                height: item.height,
                text: item.text,
              },
            ],
      ),
    );

type PdfVisibleSignatureTarget = {
  readonly pageIndex: number;
  readonly rect: PdfSignatureRect;
};

type PdfVisibleSignatureBatch = Omit<PdfVisibleStampInput, "pageIndex" | "rect"> & {
  readonly stamps: readonly [PdfVisibleSignatureTarget, ...PdfVisibleSignatureTarget[]];
};

const PdfVisibleSignatureTargetSchema = Schema.Struct({
  pageIndex: Schema.Number,
  rect: PdfSignatureRectSchema,
}).check(
  Schema.makeFilter((target) =>
    target.pageIndex !== target.rect.pageIndex
      ? {
          path: ["pageIndex"],
          issue: "Visible stamp pageIndex must match rect.pageIndex.",
        }
      : undefined,
  ),
);

const PdfVisibleSignatureBatchSchema = Schema.Struct({
  pdf: Schema.Uint8Array,
  stamps: Schema.NonEmptyArray(PdfVisibleSignatureTargetSchema),
  inkPng: Schema.optional(Schema.Uint8Array),
  lines: Schema.optional(Schema.Array(Schema.String)),
  badge: Schema.optional(PdfSignatureBadgeSchema),
  border: Schema.optional(Schema.Boolean),
  qr: Schema.optional(PdfVisibleStampQrSchema),
}).check(
  Schema.makeFilter((input) => {
    if (
      input.badge !== undefined &&
      (input.lines !== undefined ||
        input.inkPng !== undefined ||
        input.qr !== undefined ||
        input.border !== undefined)
    ) {
      return {
        path: ["badge"],
        issue: "Visible stamp badge cannot be combined with lines, inkPng, qr, or border.",
      };
    }
    if (
      input.badge === undefined &&
      input.lines === undefined &&
      input.inkPng === undefined &&
      input.qr === undefined
    ) {
      return {
        path: ["lines"],
        issue: "Visible stamp requires lines, a badge, inkPng, or qr.",
      };
    }
    return undefined;
  }),
);

type PdfRubricTarget =
  | {
      readonly coordinateSpace: "pdf";
      readonly pages: PdfRubricStamp["pages"];
      readonly rect: PdfCoordinateTuple;
    }
  | {
      readonly coordinateSpace: "visible";
      readonly pageIndex: number;
      readonly rect: PdfVisiblePageRect;
    };

type ResolvedPdfRubricTarget =
  | {
      readonly coordinateSpace: "pdf";
      readonly pageIndex: number;
      readonly rect: PdfCoordinateTuple;
    }
  | {
      readonly coordinateSpace: "visible";
      readonly pageIndex: number;
      readonly rect: PdfVisiblePageRect;
    };

const visibleSignatureSaveOptions = (
  forIncrementalUpdate: boolean,
): Parameters<PDFDocument["save"]>[0] =>
  forIncrementalUpdate
    ? {
        useObjectStreams: false,
        updateFieldAppearances: false,
      }
    : undefined;

const isPageOutOfRange = (pageIndex: number, pageCount: number): boolean =>
  !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount;

const hasValidVisibleRect = (rect: PdfVisiblePageRect): boolean =>
  [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
  rect.x >= 0 &&
  rect.y >= 0 &&
  rect.width > 0 &&
  rect.height > 0;

const visibleRectFitsPage = (rect: PdfVisiblePageRect, page: PDFPage): boolean => {
  if (!hasValidVisibleRect(rect)) return false;
  const { width, height } = visiblePdfPageSize(page);
  return (
    rect.width <= width &&
    rect.height <= height &&
    rect.x <= width - rect.width &&
    rect.y <= height - rect.height
  );
};

const hasValidPdfCoordinateTuple = ([left, bottom, right, top]: PdfCoordinateTuple): boolean =>
  [left, bottom, right, top].every(Number.isFinite) && left < right && bottom < top;

const pdfCoordinateTupleFitsPage = (rect: PdfCoordinateTuple, page: PDFPage): boolean => {
  if (!hasValidPdfCoordinateTuple(rect)) return false;
  const [left, bottom, right, top] = rect;
  const { cropBox } = visiblePageCoordinateSystem(page);
  return (
    left >= cropBox.x &&
    bottom >= cropBox.y &&
    right <= cropBox.x + cropBox.width &&
    top <= cropBox.y + cropBox.height
  );
};

const pushVisiblePageCoordinateSystem = (
  page: PDFPage,
  coordinateSystem: PdfVisiblePageCoordinateSystem,
): boolean => {
  const transformed = !isIdentityPageCoordinateSystem(coordinateSystem);
  if (transformed) {
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...coordinateSystem.matrix));
  }
  return transformed;
};

const popVisiblePageCoordinateSystem = (page: PDFPage, transformed: boolean): void => {
  if (transformed) page.pushOperators(popGraphicsState());
};

const hasPositiveQrDrawingArea = (rect: PdfSignatureRect): boolean =>
  rect.width - PAD * 2 > 0 && rect.height - PAD * 2 > 0;

const pngUint32At = (png: Uint8Array, offset: number): number =>
  (png[offset] ?? 0) * 0x1000000 +
  (png[offset + 1] ?? 0) * 0x10000 +
  (png[offset + 2] ?? 0) * 0x100 +
  (png[offset + 3] ?? 0);

type PngPreflight = {
  readonly idat: Uint8Array;
  readonly inflatedByteLength: number;
};

const pngChunkTypeAt = (png: Uint8Array, offset: number, type: ReadonlyArray<number>): boolean =>
  type.every((byte, index) => png[offset + index] === byte);

const pngChannels = (colorType: number, bitDepth: number): number | undefined => {
  switch (colorType) {
    case 0:
      return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8 || bitDepth === 16
        ? 1
        : undefined;
    case 2:
      return bitDepth === 8 || bitDepth === 16 ? 3 : undefined;
    case 3:
      return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8 ? 1 : undefined;
    case 4:
      return bitDepth === 8 || bitDepth === 16 ? 2 : undefined;
    case 6:
      return bitDepth === 8 || bitDepth === 16 ? 4 : undefined;
    default:
      return undefined;
  }
};

const pngPassExtent = (length: number, start: number, step: number): number =>
  length <= start ? 0 : Math.ceil((length - start) / step);

const pngFilteredPassByteLength = (
  width: number,
  height: number,
  bitsPerPixel: number,
): number | undefined => {
  if (width === 0 || height === 0) return 0;
  const rowByteLength = Math.ceil((width * bitsPerPixel) / 8);
  const byteLength = (rowByteLength + 1) * height;
  return Number.isSafeInteger(byteLength) ? byteLength : undefined;
};

const pngExpectedInflatedByteLength = (
  width: number,
  height: number,
  bitsPerPixel: number,
  interlace: number,
): number | undefined => {
  if (interlace === 0) return pngFilteredPassByteLength(width, height, bitsPerPixel);
  let total = 0;
  for (const [startX, startY, stepX, stepY] of PNG_ADAM7_PASSES) {
    const passByteLength = pngFilteredPassByteLength(
      pngPassExtent(width, startX, stepX),
      pngPassExtent(height, startY, stepY),
      bitsPerPixel,
    );
    if (passByteLength === undefined || total > MAX_PNG_DECOMPRESSED_BYTES - passByteLength) {
      return undefined;
    }
    total += passByteLength;
  }
  return total;
};

const pngIdatBytes = (
  chunks: ReadonlyArray<Uint8Array>,
  byteLength: number,
): Uint8Array | undefined => {
  const first = chunks[0];
  if (first === undefined) return undefined;
  if (chunks.length === 1) return first;
  const idat = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    idat.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return idat;
};

const pngPreflight = (png: Uint8Array): PngPreflight | undefined => {
  if (png.byteLength < PNG_IHDR_END || png.byteLength > MAX_PNG_INPUT_BYTES) return undefined;
  if (!PNG_SIGNATURE.every((byte, index) => png[index] === byte)) return undefined;
  if (png[8] !== 0 || png[9] !== 0 || png[10] !== 0 || png[11] !== 13) return undefined;
  if (!pngChunkTypeAt(png, 12, PNG_IHDR_TYPE)) return undefined;
  const width = pngUint32At(png, 16);
  const height = pngUint32At(png, 20);
  const bitDepth = png[24];
  const colorType = png[25];
  const compression = png[26];
  const filter = png[27];
  const interlace = png[28];
  const channels =
    bitDepth === undefined || colorType === undefined
      ? undefined
      : pngChannels(colorType, bitDepth);
  if (
    bitDepth === undefined ||
    width === 0 ||
    height === 0 ||
    width > Math.floor(MAX_PNG_PIXELS / height) ||
    channels === undefined ||
    compression !== 0 ||
    filter !== 0 ||
    (interlace !== 0 && interlace !== 1)
  ) {
    return undefined;
  }
  const inflatedByteLength = pngExpectedInflatedByteLength(
    width,
    height,
    channels * bitDepth,
    interlace,
  );
  if (inflatedByteLength === undefined || inflatedByteLength > MAX_PNG_DECOMPRESSED_BYTES) {
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  let idatByteLength = 0;
  let chunkCount = 0;
  let offset = PNG_IHDR_END;
  while (offset < png.byteLength) {
    if (chunkCount >= MAX_PNG_CHUNKS || offset + 12 > png.byteLength) return undefined;
    const byteLength = pngUint32At(png, offset);
    const dataStart = offset + 8;
    const nextOffset = dataStart + byteLength + 4;
    if (nextOffset > png.byteLength) return undefined;
    const chunkTypeOffset = offset + 4;
    if (
      pngChunkTypeAt(png, chunkTypeOffset, PNG_ACTL_TYPE) ||
      pngChunkTypeAt(png, chunkTypeOffset, PNG_FCTL_TYPE) ||
      pngChunkTypeAt(png, chunkTypeOffset, PNG_FDAT_TYPE)
    ) {
      return undefined;
    }
    if (pngChunkTypeAt(png, offset + 4, PNG_IDAT_TYPE)) {
      if (chunks.length >= MAX_PNG_CHUNKS || byteLength > MAX_PNG_INPUT_BYTES - idatByteLength) {
        return undefined;
      }
      idatByteLength += byteLength;
      chunks.push(png.subarray(dataStart, dataStart + byteLength));
    }
    if (pngChunkTypeAt(png, offset + 4, PNG_IEND_TYPE)) {
      if (byteLength !== 0 || nextOffset !== png.byteLength) return undefined;
      const idat = pngIdatBytes(chunks, idatByteLength);
      return idat === undefined ? undefined : { idat, inflatedByteLength };
    }
    chunkCount += 1;
    offset = nextOffset;
  }
  return undefined;
};

const hasSafePng = (png: Uint8Array): Effect.Effect<boolean> => {
  const preflight = pngPreflight(png);
  if (preflight === undefined) return Effect.succeed(false);
  return inflateZlibBounded(preflight.idat, preflight.inflatedByteLength).pipe(
    Effect.map((inflated) => inflated.byteLength === preflight.inflatedByteLength),
    Effect.catch(() => Effect.succeed(false)),
  );
};

const hasConflictingRubricModes = (stamp: Omit<PdfRubricStamp, "rect" | "pages">): boolean =>
  stamp.initials !== undefined && (stamp.imagePng !== undefined || (stamp.lines?.length ?? 0) > 0);

const hasDrawableRubricContent = (stamp: Omit<PdfRubricStamp, "rect" | "pages">): boolean =>
  (stamp.border ?? true) ||
  stamp.imagePng !== undefined ||
  stamp.initials !== undefined ||
  (stamp.lines?.length ?? 0) > 0;

const drawRubric = (
  page: PDFPage,
  font: PDFFont,
  image: PDFImage | undefined,
  stamp: Omit<PdfRubricStamp, "rect" | "pages">,
  left: number,
  bottom: number,
  width: number,
  height: number,
): void => {
  if (stamp.border ?? true) {
    page.drawRectangle({
      x: left,
      y: bottom,
      width,
      height,
      borderColor: FRAME,
      borderWidth: 0.6,
    });
  }
  if (stamp.initials !== undefined) {
    drawInitialsRubric(
      page,
      font,
      left,
      bottom,
      width,
      height,
      stamp.initials,
      stamp.initialsTheme,
    );
    return;
  }
  drawInkPngTextColumn({
    page,
    font,
    image,
    lines: stamp.lines ?? [],
    x: left,
    y: bottom,
    width,
    height,
    textColor: INK,
    imageHeightRatioWithLines: 0.58,
    minTextSize: 4.5,
    textSizeOffset: 1,
    textPadding: PAD,
    leading: "fixed",
    separator: false,
  });
};

const resolveRubricTargets = (
  targets: ReadonlyArray<PdfRubricTarget>,
  pages: ReadonlyArray<PDFPage>,
): ReadonlyArray<ResolvedPdfRubricTarget> =>
  targets.flatMap((target) => {
    if (target.coordinateSpace === "visible") return [target];
    const pageIndexes =
      target.pages === undefined || target.pages === "all"
        ? pages.map((_page, index) => index)
        : target.pages;
    return pageIndexes.map(
      (pageIndex): ResolvedPdfRubricTarget => ({
        coordinateSpace: "pdf",
        pageIndex,
        rect: target.rect,
      }),
    );
  });

const stampPdfRubricTargets = (
  pdf: Uint8Array,
  stamp: Omit<PdfRubricStamp, "rect" | "pages">,
  targets: ReadonlyArray<PdfRubricTarget>,
  forIncrementalUpdate: boolean,
): Effect.Effect<Uint8Array, PdfError> => {
  if (hasConflictingRubricModes(stamp)) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.stampFailed,
        retryable: false,
        operation: PdfOperationValue.stamp,
        reason: "Initials rubrics cannot be combined with image or line content.",
      }),
    );
  }
  if (targets.length === 0 || !hasDrawableRubricContent(stamp)) return Effect.succeed(pdf);
  const invalidTarget = targets.find((target) =>
    target.coordinateSpace === "pdf"
      ? !hasValidPdfCoordinateTuple(target.rect)
      : !hasValidVisibleRect(target.rect),
  );
  if (invalidTarget !== undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.stampFailed,
        retryable: false,
        operation: PdfOperationValue.stamp,
        reason:
          invalidTarget.coordinateSpace === "pdf"
            ? "Rubric stamp rect must contain finite, ordered coordinates."
            : "Visible rubric rect must contain finite, positive coordinates.",
      }),
    );
  }

  return Effect.gen(function* () {
    const imagePng = stamp.imagePng;
    if (imagePng !== undefined && !(yield* hasSafePng(imagePng))) {
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.stampFailed,
          retryable: false,
          operation: PdfOperationValue.stamp,
          reason: "PNG image exceeds supported input or decoded pixel limits.",
        }),
      );
    }
    return yield* Effect.tryPromise({
      try: () =>
        PDFDocument.load(pdf, forIncrementalUpdate ? { forIncrementalUpdate: true } : undefined),
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
        const resolvedTargets = resolveRubricTargets(targets, pages);
        if (resolvedTargets.length === 0) return Effect.succeed(pdf);
        const invalidPage = resolvedTargets.find((target) =>
          isPageOutOfRange(target.pageIndex, pages.length),
        );
        if (invalidPage !== undefined) {
          return Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.stampFailed,
              retryable: false,
              operation: PdfOperationValue.stamp,
              reason: `Rubric page index ${invalidPage.pageIndex} is out of range (document has ${pages.length} pages).`,
            }),
          );
        }
        const outOfBoundsTarget = resolvedTargets.find((target) => {
          const page = pages[target.pageIndex];
          if (page === undefined) return true;
          return target.coordinateSpace === "pdf"
            ? !pdfCoordinateTupleFitsPage(target.rect, page)
            : !visibleRectFitsPage(target.rect, page);
        });
        if (outOfBoundsTarget !== undefined) {
          return Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.stampFailed,
              retryable: false,
              operation: PdfOperationValue.stamp,
              reason:
                outOfBoundsTarget.coordinateSpace === "pdf"
                  ? `Rubric stamp rect is outside the visible CropBox on page ${outOfBoundsTarget.pageIndex}.`
                  : `Visible rubric rect is outside page ${outOfBoundsTarget.pageIndex}.`,
            }),
          );
        }

        return Effect.tryPromise({
          try: async () => {
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
            const image =
              stamp.imagePng === undefined ? undefined : await pdfDoc.embedPng(stamp.imagePng);

            for (const target of resolvedTargets) {
              const page = pages[target.pageIndex];
              if (page === undefined) continue;
              if (target.coordinateSpace === "pdf") {
                const [left, bottom, right, top] = target.rect;
                drawRubric(page, font, image, stamp, left, bottom, right - left, top - bottom);
                continue;
              }
              const coordinateSystem = visiblePageCoordinateSystem(page);
              const bottom = coordinateSystem.height - target.rect.y - target.rect.height;
              const transformed = pushVisiblePageCoordinateSystem(page, coordinateSystem);
              drawRubric(
                page,
                font,
                image,
                stamp,
                target.rect.x,
                bottom,
                target.rect.width,
                target.rect.height,
              );
              popVisiblePageCoordinateSystem(page, transformed);
            }

            const saved = await pdfDoc.save({
              useObjectStreams: false,
              ...(forIncrementalUpdate ? { updateFieldAppearances: false } : {}),
            });
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
  });
};

export const stampPdfRubric = (
  pdf: Uint8Array,
  stamp: PdfRubricStamp,
  forIncrementalUpdate = hasPdfByteRange(pdf),
): Effect.Effect<Uint8Array, PdfError> =>
  Schema.decodeUnknownEffect(PdfRubricStampSchema)(stamp).pipe(
    Effect.mapError(
      (issue) =>
        new PdfError({
          code: PdfErrorCodeValue.stampFailed,
          retryable: false,
          operation: PdfOperationValue.stamp,
          schemaName: PdfSchemaNameValue.pdfRubricStamp,
          reason: "Rubric stamp input failed schema validation.",
          issueMessage: String(issue),
        }),
    ),
    Effect.flatMap((valid) => {
      if (hasConflictingRubricModes(valid)) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.stampFailed,
            retryable: false,
            operation: PdfOperationValue.stamp,
            reason: "Initials rubrics cannot be combined with image or line content.",
          }),
        );
      }
      if (
        (Array.isArray(valid.pages) && valid.pages.length === 0) ||
        !hasDrawableRubricContent(valid)
      ) {
        return Effect.succeed(pdf);
      }
      return stampPdfRubricTargets(
        pdf,
        valid,
        [{ coordinateSpace: "pdf", pages: valid.pages, rect: valid.rect }],
        forIncrementalUpdate,
      );
    }),
  );
export const stampPdfVisibleSignatures = (
  input: PdfVisibleSignatureBatch,
  forIncrementalUpdate: boolean,
): Effect.Effect<Uint8Array, PdfError> => {
  return Schema.decodeUnknownEffect(PdfVisibleSignatureBatchSchema)(input).pipe(
    Effect.mapError(
      (issue) =>
        new PdfError({
          code: PdfErrorCodeValue.stampFailed,
          retryable: false,
          operation: PdfOperationValue.stamp,
          schemaName: PdfSchemaNameValue.pdfVisibleStampInput,
          reason: "Visible PDF stamp input failed schema validation.",
          issueMessage: String(issue),
        }),
    ),
    Effect.flatMap((valid) =>
      Effect.gen(function* () {
        if (
          valid.border === false &&
          valid.badge === undefined &&
          valid.inkPng === undefined &&
          valid.qr === undefined &&
          (valid.lines?.length ?? 0) === 0
        ) {
          return valid.pdf;
        }
        const inkPng = valid.badge === undefined ? valid.inkPng : undefined;
        if (inkPng !== undefined && !(yield* hasSafePng(inkPng))) {
          return yield* Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.stampFailed,
              retryable: false,
              operation: PdfOperationValue.stamp,
              reason: "PNG image exceeds supported input or decoded pixel limits.",
            }),
          );
        }
        return yield* Effect.tryPromise({
          try: () =>
            PDFDocument.load(
              valid.pdf,
              forIncrementalUpdate ? { forIncrementalUpdate: true } : undefined,
            ),
          catch: () =>
            new PdfError({
              code: PdfErrorCodeValue.stampFailed,
              retryable: false,
              operation: PdfOperationValue.stamp,
              reason: "Failed to load the PDF for visible signature stamping.",
            }),
        }).pipe(
          Effect.flatMap((pdfDoc) => {
            const pages = pdfDoc.getPages();
            const invalidPage = valid.stamps.find((stamp) =>
              isPageOutOfRange(stamp.pageIndex, pages.length),
            );
            if (invalidPage !== undefined) {
              return Effect.fail(
                new PdfError({
                  code: PdfErrorCodeValue.stampFailed,
                  retryable: false,
                  operation: PdfOperationValue.stamp,
                  reason: `Visible stamp page index ${invalidPage.pageIndex} is out of range.`,
                }),
              );
            }
            const invalidRect = valid.stamps.find((stamp) => {
              const page = pages[stamp.pageIndex];
              return page === undefined || !visibleRectFitsPage(stamp.rect, page);
            });
            if (invalidRect !== undefined) {
              return Effect.fail(
                new PdfError({
                  code: PdfErrorCodeValue.stampFailed,
                  retryable: false,
                  operation: PdfOperationValue.stamp,
                  reason: `Visible stamp rect is outside page ${invalidRect.pageIndex}.`,
                }),
              );
            }

            const lines = valid.lines ?? [];
            const border = valid.border ?? true;
            const badge = valid.badge;
            const qr = badge === undefined ? valid.qr : badge.qr;
            const invalidQrStamp =
              badge === undefined && qr !== undefined
                ? valid.stamps.find((stamp) => !hasPositiveQrDrawingArea(stamp.rect))
                : undefined;
            if (invalidQrStamp !== undefined) {
              return Effect.fail(
                new PdfError({
                  code: PdfErrorCodeValue.stampFailed,
                  retryable: false,
                  operation: PdfOperationValue.stamp,
                  reason: "Visible stamp QR code requires a positive drawing area.",
                }),
              );
            }

            const qrEffect: Effect.Effect<QrMatrix | undefined, PdfError> =
              qr === undefined ? Effect.succeed(undefined) : encodeVisibleStampQr(qr);

            return qrEffect.pipe(
              Effect.flatMap((qrMatrix) =>
                Effect.tryPromise({
                  try: async () => {
                    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
                    const boldFont =
                      badge === undefined
                        ? undefined
                        : await pdfDoc.embedFont(StandardFonts.HelveticaBold);
                    const inkImage =
                      badge !== undefined || valid.inkPng === undefined
                        ? undefined
                        : await pdfDoc.embedPng(valid.inkPng);

                    for (const stamp of valid.stamps) {
                      const page = pages[stamp.pageIndex];
                      if (page === undefined) continue;
                      const { x, y, width, height } = stamp.rect;
                      const coordinateSystem = visiblePageCoordinateSystem(page);
                      const bottom = coordinateSystem.height - y - height;
                      const transformed = pushVisiblePageCoordinateSystem(page, coordinateSystem);

                      if (badge !== undefined) {
                        const layout = layoutPdfSignatureBadge(
                          badge,
                          { x, y: bottom, width, height },
                          font,
                          boldFont ?? font,
                        );
                        drawSignatureBadge(
                          pdfDoc,
                          page,
                          badge,
                          layout,
                          font,
                          boldFont ?? font,
                          qrMatrix,
                          coordinateSystem,
                        );
                      } else {
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

                        if (qrMatrix === undefined) {
                          drawInkPngTextColumn({
                            page,
                            font,
                            image: inkImage,
                            lines,
                            x,
                            y: bottom,
                            width,
                            height,
                            textColor: border === false ? rgb(0.25, 0.25, 0.25) : INK,
                            imageHeightRatioWithLines: 0.58,
                            minTextSize: 4.5,
                            textSizeOffset: 1,
                            textPadding: PAD,
                            leading: "fixed",
                            separator: border === false,
                          });
                        } else {
                          const qrSide = Math.min(height - PAD * 2, width - PAD * 2);
                          const qrX = x + PAD;
                          const qrY = bottom + (height - qrSide) / 2;
                          drawVisibleStampQrMatrix(page, qrMatrix, qrX, qrY, qrSide);

                          const textLeft = qrX + qrSide + QR_TEXT_GAP_PT;
                          const textRight = x + width - PAD;
                          const textWidth = Math.max(0, textRight - textLeft);
                          drawInkPngTextColumn({
                            page,
                            font,
                            image: inkImage,
                            lines,
                            x: textLeft,
                            y: bottom,
                            width: textWidth,
                            height,
                            textColor: border === false ? rgb(0.25, 0.25, 0.25) : INK,
                            imageHeightRatioWithLines: 0.35,
                            minTextSize: 3.5,
                            textSizeOffset: 0.75,
                            textPadding: 0,
                            leading: "proportional",
                            separator: border === false,
                          });
                        }
                      }
                      popVisiblePageCoordinateSystem(page, transformed);
                    }

                    const saved = await pdfDoc.save(
                      visibleSignatureSaveOptions(forIncrementalUpdate),
                    );
                    return new Uint8Array(saved);
                  },
                  catch: () =>
                    new PdfError({
                      code: PdfErrorCodeValue.stampFailed,
                      retryable: false,
                      operation: PdfOperationValue.stamp,
                      reason: "Failed to draw the visible signature stamp.",
                    }),
                }),
              ),
            );
          }),
        );
      }),
    ),
  );
};

export const stampPdfVisibleSignature = (
  input: PdfVisibleStampInput,
): Effect.Effect<Uint8Array, PdfError> =>
  stampPdfVisibleSignatures(
    {
      pdf: input.pdf,
      stamps: [{ pageIndex: input.pageIndex, rect: input.rect }],
      ...(input.lines === undefined ? {} : { lines: input.lines }),
      ...(input.badge === undefined ? {} : { badge: input.badge }),
      ...(input.inkPng === undefined ? {} : { inkPng: input.inkPng }),
      ...(input.border === undefined ? {} : { border: input.border }),
      ...(input.qr === undefined ? {} : { qr: input.qr }),
    },
    hasPdfByteRange(input.pdf),
  );

export const stampPdfRubricOnPages = (
  input: PdfRubricPageStampInput,
  forIncrementalUpdate = hasPdfByteRange(input.pdf),
): Effect.Effect<Uint8Array, PdfError> =>
  Schema.decodeUnknownEffect(PdfRubricPageStampInputSchema)(input).pipe(
    Effect.mapError(
      (issue) =>
        new PdfError({
          code: PdfErrorCodeValue.stampFailed,
          retryable: false,
          operation: PdfOperationValue.stamp,
          schemaName: PdfSchemaNameValue.pdfRubricPageStampInput,
          reason: "Rubric page stamp input failed schema validation.",
          issueMessage: String(issue),
        }),
    ),
    Effect.flatMap((valid) => {
      if (hasConflictingRubricModes(valid)) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.stampFailed,
            retryable: false,
            operation: PdfOperationValue.stamp,
            reason: "Initials rubrics cannot be combined with image or line content.",
          }),
        );
      }
      if (valid.pages.length === 0 || !hasDrawableRubricContent(valid)) {
        return Effect.succeed(valid.pdf);
      }
      const pageDimensions = new Map<number, PdfSignaturePage>();
      for (const page of valid.pageDimensions) {
        if (pageDimensions.has(page.index)) {
          return Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.stampFailed,
              retryable: false,
              operation: PdfOperationValue.stamp,
              reason: `Rubric page metadata has duplicate index ${page.index}.`,
            }),
          );
        }
        pageDimensions.set(page.index, page);
      }

      const targets: PdfRubricTarget[] = [];
      for (const pageIndex of valid.pages) {
        const page = pageDimensions.get(pageIndex);
        if (page === undefined) {
          return Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.stampFailed,
              retryable: false,
              operation: PdfOperationValue.stamp,
              reason: `Rubric page index ${pageIndex} has no page dimensions.`,
            }),
          );
        }
        const textBoxes = valid.pageTextBoxes?.[pageIndex] ?? [];
        targets.push({
          coordinateSpace: "visible",
          pageIndex,
          rect: rubricRectForPage(page, textBoxes),
        });
      }
      return stampPdfRubricTargets(valid.pdf, valid, targets, forIncrementalUpdate);
    }),
  );
