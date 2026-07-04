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

import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type PDFImage,
  type RGB,
} from "@cantoo/pdf-lib";
import qrcode from "qrcode-generator";
import { Effect, Schema } from "effect";
import {
  type PdfCoordinateTuple,
  type PdfLiteParseResult,
  type PdfRubricInitialsTheme,
  type PdfRubricPageStampInput,
  type PdfRubricStamp,
  type PdfSignatureBadge,
  type PdfSignatureBadgeFooterSegment,
  type PdfSignatureBadgeRowItem,
  type PdfSignatureBadgeTheme,
  type PdfSignaturePage,
  type PdfSignatureRect,
  type PdfStampSize,
  type PdfTextBox,
  type PdfVisibleStampQr,
  type PdfVisibleStampInput,
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfRubricPageStampInputSchema,
  PdfRubricStampSchema,
  PdfSchemaNameValue,
  PdfVisibleStampInputSchema,
} from "./config";
import { hasPdfByteRange } from "./byte-range";
import { clampCoordinate } from "./placement";
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
    const measured: FooterLineSegment = {
      segment,
      width: font.widthOfTextAtSize(segment.text, size),
    };
    const gap = current.length === 0 ? 0 : separatorWidth;
    const projected = currentWidth + gap + measured.width;
    if (current.length > 0 && projected > maxWidth && lines.length === 0) {
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
  const lockSize = headerSize * 0.86;
  const gap = Math.max(1.8, headerSize * 0.22);
  const textX = textLeft + lockSize + gap;
  const textActualWidth = boldFont.widthOfTextAtSize(badge.header.text, headerSize);
  const textRect = textRunLayout(
    badge.header.text,
    textX,
    baseline,
    Math.min(textActualWidth, Math.max(0, textWidth - lockSize - gap)),
    headerSize,
  );
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
      width: Math.min(textWidth, lockSize + gap + textRect.rect.width),
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
  let baseline = firstBaseline;
  for (const row of rows) {
    let cursor = textLeft;
    const items: Array<PdfSignatureBadgeRowItemLayout> = [];
    for (let index = 0; index < row.length; index += 1) {
      const pair = row[index];
      if (pair !== undefined) {
        let separator: PdfSignatureBadgeTextRunLayout | undefined;
        if (index > 0) {
          const separatorWidth = regularFont.widthOfTextAtSize(BADGE_FOOTER_SEPARATOR, rowSize);
          separator = textRunLayout(
            BADGE_FOOTER_SEPARATOR,
            cursor,
            baseline,
            separatorWidth,
            rowSize,
          );
          cursor += separatorWidth;
        }
        const label = `${pair.label}: `;
        const labelWidth = boldFont.widthOfTextAtSize(label, rowSize);
        const labelRun = textRunLayout(label, cursor, baseline, labelWidth, rowSize);
        cursor += labelWidth;
        const valueWidth = regularFont.widthOfTextAtSize(pair.value, rowSize);
        const valueRun = textRunLayout(pair.value, cursor, baseline, valueWidth, rowSize);
        cursor += valueWidth;
        items.push({ separator, label: labelRun, value: valueRun });
      }
    }
    rowLayouts.push({
      rect: {
        x: textLeft,
        y: baseline,
        width: Math.min(Math.max(0, cursor - textLeft), textWidth),
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
      URI: PDFString.of(uri),
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
        addUriLinkAnnotation(
          pdfDoc,
          page,
          item.annotation.x,
          item.annotation.y,
          item.annotation.width,
          item.annotation.height,
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
  drawBadgeFooter(pdfDoc, page, layout, regularFont, theme);
};

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
        target.push({
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          text: item.text,
        });
      }
    }
  }
  return pages;
};

type PdfVisibleSignatureTarget = {
  readonly pageIndex: number;
  readonly rect: PdfSignatureRect;
};

type PdfVisibleSignatureBatch = Omit<PdfVisibleStampInput, "pageIndex" | "rect"> & {
  readonly stamps: ReadonlyArray<PdfVisibleSignatureTarget>;
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

const hasPositiveQrDrawingArea = (rect: PdfSignatureRect): boolean =>
  rect.width - PAD * 2 > 0 && rect.height - PAD * 2 > 0;

export const stampPdfRubric = (
  pdf: Uint8Array,
  stamp: PdfRubricStamp,
  forIncrementalUpdate = false,
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
          const targets =
            valid.pages === undefined || valid.pages === "all"
              ? pages.map((_page, index) => index)
              : valid.pages;
          const invalidPage = targets.find((index) => isPageOutOfRange(index, pages.length));
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

                if (valid.initials !== undefined) {
                  drawInitialsRubric(
                    page,
                    font,
                    left,
                    bottom,
                    width,
                    height,
                    valid.initials,
                    valid.initialsTheme,
                  );
                  continue;
                }

                drawInkPngTextColumn({
                  page,
                  font,
                  image,
                  lines,
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
    }),
  );

export const stampPdfVisibleSignatures = (
  input: PdfVisibleSignatureBatch,
  forIncrementalUpdate: boolean,
): Effect.Effect<Uint8Array, PdfError> => {
  const first = input.stamps[0];
  if (first === undefined) return Effect.succeed(input.pdf);

  return Schema.decodeUnknownEffect(PdfVisibleStampInputSchema)({
    pdf: input.pdf,
    pageIndex: first.pageIndex,
    rect: first.rect,
    ...(input.lines === undefined ? {} : { lines: input.lines }),
    ...(input.badge === undefined ? {} : { badge: input.badge }),
    ...(input.inkPng === undefined ? {} : { inkPng: input.inkPng }),
    ...(input.border === undefined ? {} : { border: input.border }),
    ...(input.qr === undefined ? {} : { qr: input.qr }),
  }).pipe(
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
      Effect.tryPromise({
        try: () =>
          PDFDocument.load(
            input.pdf,
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
          const invalidPage = input.stamps.find((stamp) =>
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

          const lines = valid.lines ?? [];
          const border = valid.border ?? true;
          const badge = valid.badge;
          const qr = badge === undefined ? valid.qr : badge.qr;
          const invalidQrStamp =
            badge === undefined && qr !== undefined
              ? input.stamps.find((stamp) => !hasPositiveQrDrawingArea(stamp.rect))
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

                  for (const stamp of input.stamps) {
                    const page = pages[stamp.pageIndex];
                    if (page === undefined) continue;
                    const { x, y, width, height } = stamp.rect;
                    const bottom = page.getSize().height - y - height;

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
      ),
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
  forIncrementalUpdate = false,
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

        let pdf = valid.pdf;
        for (const group of groups.values()) {
          pdf = yield* stampPdfRubric(
            pdf,
            {
              rect: group.rect,
              pages: group.pages,
              ...(valid.lines === undefined ? {} : { lines: valid.lines }),
              ...(valid.imagePng === undefined ? {} : { imagePng: valid.imagePng }),
              ...(valid.initials === undefined ? {} : { initials: valid.initials }),
              ...(valid.initialsTheme === undefined ? {} : { initialsTheme: valid.initialsTheme }),
              ...(valid.border === undefined ? {} : { border: valid.border }),
            },
            forIncrementalUpdate,
          );
        }
        return pdf;
      }),
    ),
  );
