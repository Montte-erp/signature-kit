import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

// Top-left builder rect with its owning page index. `toBottomLeft` only reads the
// geometry fields, so any structurally-compatible rect works.
type DocRect = {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

// Top-left builder rect → bottom-left PDF tuple [left, bottom, right, top], using
// that document's own page height. `stampPdfRubric` validates right>left && top>bottom.
export const toBottomLeft = (
  rect: DocRect,
  pageHeight: number,
): [number, number, number, number] => {
  const bottom = pageHeight - rect.y - rect.height;
  return [rect.x, bottom, rect.x + rect.width, bottom + rect.height];
};

// ---------------------------------------------------------------------------
// Visible stamp (single-page). The core PAdES signature widget is invisible (no
// /AP stream), so we draw the configured appearance — a hand-drawn rubric image
// and/or the signer identity + date — onto the page at the placed rectangle
// BEFORE signing. The signature's ByteRange then covers the stamp, so the visual
// is part of the signed bytes. The "every page" toggle swaps this for the
// library's `stampPdfRubric`. Coordinates: rect is top-left origin in points;
// pdf-lib is bottom-left origin.
// ---------------------------------------------------------------------------

export interface StampOptions {
  pageIndex: number;
  rect: { x: number; y: number; width: number; height: number };
  inkDataUrl?: string;
  lines: string[];
  border?: boolean;
}

export const bakeStamp = async (pdfBytes: Uint8Array, opts: StampOptions): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.getPages()[opts.pageIndex];
  if (!page) return pdfBytes;

  const pageHeight = page.getSize().height;
  const { x, y, width, height } = opts.rect;
  const bottom = pageHeight - y - height;
  const pad = 3;

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // hairline frame — dropped for the DocuSign "Signed by" look (border === false)
  if (opts.border !== false) {
    page.drawRectangle({
      x,
      y: bottom,
      width,
      height,
      borderColor: rgb(0.45, 0.45, 0.45),
      borderWidth: 0.6,
    });
  }

  let textTop = bottom + height - pad;
  if (opts.inkDataUrl) {
    const png = await pdfDoc.embedPng(opts.inkDataUrl);
    const maxH = height * (opts.lines.length > 0 ? 0.58 : 0.92) - pad;
    const maxW = width - pad * 2;
    const scale = Math.min(maxW / png.width, maxH / png.height);
    const drawW = png.width * scale;
    const drawH = png.height * scale;
    page.drawImage(png, {
      x: x + (width - drawW) / 2,
      y: bottom + height - drawH - pad,
      width: drawW,
      height: drawH,
    });
    textTop = bottom + height - drawH - pad - 1;
  }

  // DocuSign polish: one hairline rule between the mark and the caption.
  if (opts.border === false && opts.inkDataUrl && opts.lines.length > 0) {
    page.drawLine({
      start: { x: x + pad, y: textTop },
      end: { x: x + width - pad, y: textTop },
      thickness: 0.5,
      color: rgb(0.55, 0.55, 0.55),
    });
  }

  if (opts.lines.length > 0) {
    const rows = opts.lines.length;
    const size = Math.max(4.5, Math.min(7, (textTop - bottom - pad) / rows - 1));
    const captionColor = opts.border === false ? rgb(0.25, 0.25, 0.25) : rgb(0.1, 0.1, 0.1);
    let ty = textTop - size;
    for (const line of opts.lines) {
      page.drawText(line, {
        x: x + pad,
        y: ty,
        size,
        font,
        color: captionColor,
        maxWidth: width - pad * 2,
      });
      ty -= size + 1.5;
    }
  }

  return new Uint8Array(await pdfDoc.save());
};
