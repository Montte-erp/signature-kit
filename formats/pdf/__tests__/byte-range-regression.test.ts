import { describe, expect, it } from "@effect/vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signPdf } from "../src/sign";
import { verifyPdf } from "../src/verify";
import { Effect, Redacted, Result, Schema } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import {
  MAX_PDF_REVISIONS,
  PreparedPdfSignatureSchema,
  extractPdfSignatures,
  findPdfByteRangeOffsets,
  hasPdfByteRange,
  hasPdfSignatureDictionary,
  hasPdfSignatureDictionaryEffect,
  isCompletePdfRevision,
  preparePdfByteRange,
} from "../src/byte-range";
import { concatBytes, encodeAscii, indexOfBytes } from "../src/bytes";
import {
  PdfByteRangeSchema,
  PdfSigningRequestSchema,
  PdfVerificationResultSchema,
} from "../src/config";

const fakeByteRange = "/ByteRange [0 0 0 0]";
const fakeStreamContents = `/Type /Sig ${fakeByteRange} /Contents <00>`;

const streamObject = (): string =>
  `2 0 obj\n<< /Length ${fakeStreamContents.length} >>\nstream\n${fakeStreamContents}\nendstream\nendobj`;

const fakeSignatureSyntax = (): Uint8Array =>
  encodeAscii(
    `%PDF-1.7\n1 0 obj\n<< /Note (${fakeByteRange} /Contents <00>) >>\nendobj\n${streamObject()}\n% ${fakeByteRange}\n%%EOF`,
  );

const fakeRevisionInsideStream = (): { readonly pdf: Uint8Array; readonly end: number } => {
  const marker = "XREF_OFFSET";
  const fakeRevisionTemplate = `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 >>\nstartxref\n${marker}\n%%EOF`;
  const streamPrefix = "payload\n";
  const streamContents = `${streamPrefix}${fakeRevisionTemplate}\ncontinued stream data`;
  const beforeStream = `%PDF-1.7\n1 0 obj\n<< /Type /Sig ${fakeByteRange} /Contents <00> >>\nendobj\n2 0 obj\n<< /Length ${streamContents.length} >>\nstream\n`;
  const xrefOffset = encodeAscii(`${beforeStream}${streamPrefix}`).byteLength;
  const fakeRevision = fakeRevisionTemplate.replace(
    marker,
    String(xrefOffset).padStart(marker.length, "0"),
  );
  const prefix = `${beforeStream}${streamPrefix}${fakeRevision}`;
  return {
    pdf: encodeAscii(`${prefix}\ncontinued stream data\nendstream\nendobj\n%%EOF`),
    end: encodeAscii(prefix).byteLength,
  };
};

type RawSignaturePdf = {
  readonly pdf: Uint8Array;
  readonly byteRangeText: string;
  readonly xrefOffset: number;
};

const createRawSignaturePdf = (
  type = "Sig",
  formatByteRange = ([first, second, third, fourth]: readonly number[]): string =>
    `[${String(first).padStart(10, "0")} ${String(second).padStart(10, "0")} ${String(third).padStart(10, "0")} ${String(fourth).padStart(10, "0")}]`,
  fieldBody = "<< /FT /Sig /V 8 0 R >>",
  unindexedObjects: ReadonlyArray<readonly [number, string]> = [],
): RawSignaturePdf => {
  const marker = formatByteRange([0, 0, 0, 0]);
  const streamContents = "binary\nendstream fake\nstream payload";
  const render = (
    byteRangeText: string,
  ): { readonly source: string; readonly xrefOffset: number } => {
    const objects: ReadonlyArray<readonly [number, string]> = [
      [1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 3 0 R >>"],
      [2, "<< /Type /Pages /Kids [4 0 R] /Count 1 >>"],
      [3, "<< /Fields [6 0 R] >>"],
      [4, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 7 0 R >>"],
      [6, fieldBody],
      [7, `<< /Length 5 0 R >>\nstream\n${streamContents}\nendstream`],
      [8, `<< /Type /${type} /ByteRange ${byteRangeText} /Contents <00> >>`],
      [5, String(encodeAscii(streamContents).byteLength)],
    ];
    let source = "%PDF-1.7\n";
    const offsets = new Map<number, number>();
    for (const [objectNumber, body] of objects) {
      offsets.set(objectNumber, encodeAscii(source).byteLength);
      source += `${objectNumber} 0 obj\n${body}\nendobj\n`;
    }
    for (const [objectNumber, body] of unindexedObjects) {
      source += `${objectNumber} 0 obj\n${body}\nendobj\n`;
    }
    const xrefOffset = encodeAscii(source).byteLength;
    source += "xref\n0 9\n0000000000 65535 f \n";
    for (let objectNumber = 1; objectNumber < 9; objectNumber += 1) {
      const offset = offsets.get(objectNumber);
      source +=
        offset === undefined
          ? "0000000000 00000 f \n"
          : `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    source += `trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return { source, xrefOffset };
  };

  const template = render(marker);
  const contentsStart =
    indexOfBytes(encodeAscii(template.source), encodeAscii("/Contents <")) + "/Contents ".length;
  const contentsEnd = contentsStart + 4;
  const byteRangeText = formatByteRange([
    0,
    contentsStart,
    contentsEnd,
    encodeAscii(template.source).byteLength - contentsEnd,
  ]);
  const rendered = render(byteRangeText);
  return {
    pdf: encodeAscii(rendered.source),
    byteRangeText,
    xrefOffset: rendered.xrefOffset,
  };
};

const appendUnindexedSignatureDuplicate = (pdf: RawSignaturePdf): Uint8Array => {
  const source = new TextDecoder().decode(pdf.pdf);
  const duplicate = `\n8 0 obj\n<< /Type /Sig /ByteRange ${pdf.byteRangeText} /Contents <00> >>\nendobj\n`;
  const objectOffset = pdf.pdf.byteLength + encodeAscii(duplicate).byteLength;
  const xrefOffset =
    objectOffset + encodeAscii("9 0 obj\n<< /Note /Duplicate >>\nendobj\n").byteLength;
  return encodeAscii(
    `${source}${duplicate}9 0 obj\n<< /Note /Duplicate >>\nendobj\nxref\n9 1\n${String(objectOffset).padStart(10, "0")} 00000 n \ntrailer\n<< /Size 10 /Prev ${pdf.xrefOffset} >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );
};

const appendReusedLengthRevision = (pdf: RawSignaturePdf): Uint8Array => {
  const source = new TextDecoder().decode(pdf.pdf);
  const objectOffset = pdf.pdf.byteLength + 1;
  const object = "5 1 obj\n1\nendobj\n";
  const xrefOffset = objectOffset + encodeAscii(object).byteLength;
  return encodeAscii(
    `${source}\n${object}xref\n5 1\n${String(objectOffset).padStart(10, "0")} 00001 n \ntrailer\n<< /Size 9 /Prev ${pdf.xrefOffset} >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );
};

const appendEmptyRevisions = (pdf: RawSignaturePdf, count: number): Uint8Array => {
  let source = new TextDecoder().decode(pdf.pdf);
  let previousXrefOffset = pdf.xrefOffset;
  for (let index = 0; index < count; index += 1) {
    const objectNumber = 9 + index;
    const objectOffset = encodeAscii(source).byteLength + 1;
    source += `\n${objectNumber} 0 obj\n<< /Note /Revision >>\nendobj\n`;
    const xrefOffset = encodeAscii(source).byteLength;
    source += `xref\n${objectNumber} 1\n${String(objectOffset).padStart(10, "0")} 00000 n \ntrailer\n<< /Size ${objectNumber + 1} /Prev ${previousXrefOffset} >>\nstartxref\n${xrefOffset}\n%%EOF`;
    previousXrefOffset = xrefOffset;
  }
  return encodeAscii(source);
};

const createXrefStreamSignaturePdf = (): Uint8Array => {
  const marker = "[0000000000 0000000000 0000000000 0000000000]";
  const streamContents = "q\nQ";
  const render = (byteRangeText: string): Uint8Array => {
    const objects: ReadonlyArray<readonly [number, string]> = [
      [1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 3 0 R >>"],
      [2, "<< /Type /Pages /Kids [4 0 R] /Count 1 >>"],
      [3, "<< /Fields [6 0 R] >>"],
      [4, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 7 0 R >>"],
      [5, String(encodeAscii(streamContents).byteLength)],
      [6, "<< /FT /Sig /V 8 0 R >>"],
      [7, `<< /Length 5 0 R >>\nstream\n${streamContents}\nendstream`],
      [8, `<< /Type /Sig /ByteRange ${byteRangeText} /Contents <00> >>`],
    ];
    let prefix = "%PDF-1.7\n";
    const offsets = new Map<number, number>();
    for (const [objectNumber, body] of objects) {
      offsets.set(objectNumber, encodeAscii(prefix).byteLength);
      prefix += `${objectNumber} 0 obj\n${body}\nendobj\n`;
    }
    const xrefOffset = encodeAscii(prefix).byteLength;
    const xrefHeader =
      "9 0 obj\n<< /Type /XRef /Size 10 /Root 1 0 R /W [1 4 2] /Index [0 10] /Length 70 >>\nstream\n";
    const entries = new Uint8Array(70);
    const writeEntry = (
      objectNumber: number,
      type: number,
      offset: number,
      generationNumber: number,
    ): void => {
      const index = objectNumber * 7;
      entries[index] = type;
      entries[index + 1] = (offset >>> 24) & 0xff;
      entries[index + 2] = (offset >>> 16) & 0xff;
      entries[index + 3] = (offset >>> 8) & 0xff;
      entries[index + 4] = offset & 0xff;
      entries[index + 5] = (generationNumber >>> 8) & 0xff;
      entries[index + 6] = generationNumber & 0xff;
    };
    writeEntry(0, 0, 0, 65535);
    for (let objectNumber = 1; objectNumber < 9; objectNumber += 1) {
      writeEntry(objectNumber, 1, offsets.get(objectNumber) ?? 0, 0);
    }
    writeEntry(9, 1, xrefOffset, 0);
    return concatBytes([
      encodeAscii(`${prefix}${xrefHeader}`),
      entries,
      encodeAscii(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF`),
    ]);
  };

  const template = render(marker);
  const contentsStart = indexOfBytes(template, encodeAscii("/Contents <")) + "/Contents ".length;
  const contentsEnd = contentsStart + 4;
  return render(
    `[${String(0).padStart(10, "0")} ${String(contentsStart).padStart(10, "0")} ${String(contentsEnd).padStart(10, "0")} ${String(template.byteLength - contentsEnd).padStart(10, "0")}]`,
  );
};

const deflateBytes = async (input: Uint8Array): Promise<Uint8Array> => {
  const compression = new CompressionStream("deflate");
  const writer = compression.writable.getWriter();
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  await writer.write(copy);
  await writer.close();
  return new Uint8Array(await new Response(compression.readable).arrayBuffer());
};

const pngUpPredictor = (input: Uint8Array, columns: number): Uint8Array => {
  const rows = input.byteLength / columns;
  const output = new Uint8Array(input.byteLength + rows);
  for (let row = 0; row < rows; row += 1) {
    const outputOffset = row * (columns + 1);
    const inputOffset = row * columns;
    output[outputOffset] = 2;
    for (let column = 0; column < columns; column += 1) {
      output[outputOffset + column + 1] =
        (input[inputOffset + column] ?? 0) -
        (row === 0 ? 0 : (input[inputOffset - columns + column] ?? 0));
    }
  }
  return output;
};

type XrefEncoding = "scalar" | "array" | "predictor" | "unsupported" | "malformed-predictor";

const createFilteredXrefStreamSignaturePdf = async (
  encoding: XrefEncoding,
): Promise<Uint8Array> => {
  const marker = "[0000000000 0000000000 0000000000 0000000000]";
  const streamContents = "q\nQ";
  const render = async (byteRangeText: string): Promise<Uint8Array> => {
    const objects: ReadonlyArray<readonly [number, string]> = [
      [1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 3 0 R >>"],
      [2, "<< /Type /Pages /Kids [4 0 R] /Count 1 >>"],
      [3, "<< /Fields [6 0 R] >>"],
      [4, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 7 0 R >>"],
      [5, String(encodeAscii(streamContents).byteLength)],
      [6, "<< /FT /Sig /V 8 0 R >>"],
      [7, `<< /Length 5 0 R >>\nstream\n${streamContents}\nendstream`],
      [8, `<< /Type /Sig /ByteRange ${byteRangeText} /Contents <00> >>`],
    ];
    let prefix = "%PDF-1.7\n";
    const offsets = new Map<number, number>();
    for (const [objectNumber, body] of objects) {
      offsets.set(objectNumber, encodeAscii(prefix).byteLength);
      prefix += `${objectNumber} 0 obj\n${body}\nendobj\n`;
    }
    const xrefOffset = encodeAscii(prefix).byteLength;
    const entries = new Uint8Array(70);
    const writeEntry = (
      objectNumber: number,
      type: number,
      offset: number,
      generationNumber: number,
    ): void => {
      const index = objectNumber * 7;
      entries[index] = type;
      entries[index + 1] = (offset >>> 24) & 0xff;
      entries[index + 2] = (offset >>> 16) & 0xff;
      entries[index + 3] = (offset >>> 8) & 0xff;
      entries[index + 4] = offset & 0xff;
      entries[index + 5] = (generationNumber >>> 8) & 0xff;
      entries[index + 6] = generationNumber & 0xff;
    };
    writeEntry(0, 0, 0, 65535);
    for (let objectNumber = 1; objectNumber < 9; objectNumber += 1) {
      writeEntry(objectNumber, 1, offsets.get(objectNumber) ?? 0, 0);
    }
    writeEntry(9, 1, xrefOffset, 0);
    const encoded =
      encoding === "unsupported"
        ? entries
        : await deflateBytes(
            encoding === "predictor"
              ? pngUpPredictor(entries, 7)
              : encoding === "malformed-predictor"
                ? entries
                : entries,
          );
    const filter =
      encoding === "scalar"
        ? "/Filter /FlateDecode"
        : encoding === "array"
          ? "/Filter [/FlateDecode]"
          : encoding === "predictor" || encoding === "malformed-predictor"
            ? "/Filter [/FlateDecode] /DecodeParms [<< /Predictor 12 /Columns 7 >>]"
            : "/Filter /LZWDecode";
    const header = `9 0 obj\n<< /Type /XRef /Size 10 /Root 1 0 R /W [1 4 2] /Index [0 10] ${filter} /Length ${encoded.byteLength} >>\nstream\n`;
    return concatBytes([
      encodeAscii(`${prefix}${header}`),
      encoded,
      encodeAscii(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF`),
    ]);
  };
  const template = await render(marker);
  const contentsStart = indexOfBytes(template, encodeAscii("/Contents <")) + "/Contents ".length;
  const contentsEnd = contentsStart + 4;
  return render(
    `[${String(0).padStart(10, "0")} ${String(contentsStart).padStart(10, "0")} ${String(contentsEnd).padStart(10, "0")} ${String(template.byteLength - contentsEnd).padStart(10, "0")}]`,
  );
};

const createCompressedFieldXrefStreamPdf = async (malformed = false): Promise<Uint8Array> => {
  const marker = "[0000000000 0000000000 0000000000 0000000000]";
  const streamContents = "q\nQ";
  const objectStream = await deflateBytes(encodeAscii("6 0 << /FT /Sig /V 8 0 R >>"));
  const render = (byteRangeText: string): Uint8Array => {
    const objects: ReadonlyArray<readonly [number, string]> = [
      [1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 3 0 R >>"],
      [2, "<< /Type /Pages /Kids [4 0 R] /Count 1 >>"],
      [3, "<< /Fields [6 0 R] >>"],
      [4, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 7 0 R >>"],
      [5, String(encodeAscii(streamContents).byteLength)],
      [7, `<< /Length 5 0 R >>\nstream\n${streamContents}\nendstream`],
      [8, `<< /Type /Sig /ByteRange ${byteRangeText} /Contents <00> >>`],
    ];
    const chunks: Array<Uint8Array> = [encodeAscii("%PDF-1.7\n")];
    const offsets = new Map<number, number>();
    let offset = chunks[0]?.byteLength ?? 0;
    for (const [objectNumber, body] of objects) {
      const bytes = encodeAscii(`${objectNumber} 0 obj\n${body}\nendobj\n`);
      offsets.set(objectNumber, offset);
      chunks.push(bytes);
      offset += bytes.byteLength;
    }
    offsets.set(10, offset);
    const objectStreamHeader = encodeAscii(
      `10 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${objectStream.byteLength} >>\nstream\n`,
    );
    const objectStreamFooter = encodeAscii("\nendstream\nendobj\n");
    chunks.push(objectStreamHeader, objectStream, objectStreamFooter);
    offset +=
      objectStreamHeader.byteLength + objectStream.byteLength + objectStreamFooter.byteLength;
    const xrefOffset = offset;
    const entries = new Uint8Array(84);
    const writeEntry = (
      objectNumber: number,
      type: number,
      first: number,
      second: number,
    ): void => {
      const index = objectNumber * 7;
      entries[index] = type;
      entries[index + 1] = (first >>> 24) & 0xff;
      entries[index + 2] = (first >>> 16) & 0xff;
      entries[index + 3] = (first >>> 8) & 0xff;
      entries[index + 4] = first & 0xff;
      entries[index + 5] = (second >>> 8) & 0xff;
      entries[index + 6] = second & 0xff;
    };
    writeEntry(0, 0, 0, 65535);
    for (const [objectNumber, objectOffset] of offsets) {
      writeEntry(objectNumber, 1, objectOffset, 0);
    }
    writeEntry(6, 2, 10, malformed ? 1 : 0);
    writeEntry(11, 1, xrefOffset, 0);
    chunks.push(
      encodeAscii(
        `11 0 obj\n<< /Type /XRef /Size 12 /Root 1 0 R /W [1 4 2] /Index [0 12] /Length 84 >>\nstream\n`,
      ),
      entries,
      encodeAscii(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF`),
    );
    return concatBytes(chunks);
  };
  const template = render(marker);
  const contentsStart = indexOfBytes(template, encodeAscii("/Contents <")) + "/Contents ".length;
  const contentsEnd = contentsStart + 4;
  return render(
    `[${String(0).padStart(10, "0")} ${String(contentsStart).padStart(10, "0")} ${String(contentsEnd).padStart(10, "0")} ${String(template.byteLength - contentsEnd).padStart(10, "0")}]`,
  );
};

const createHybridXrefSignaturePdf = (malformed = false): Uint8Array => {
  const marker = "[0000000000 0000000000 0000000000 0000000000]";
  const render = (byteRangeText: string): Uint8Array => {
    const objects: ReadonlyArray<readonly [number, string]> = [
      [1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 3 0 R >>"],
      [2, "<< /Type /Pages /Kids [4 0 R] /Count 1 >>"],
      [3, "<< /Fields [6 0 R] >>"],
      [4, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>"],
      [6, "<< /FT /Sig /V 8 0 R >>"],
      [8, `<< /Type /Sig /ByteRange ${byteRangeText} /Contents <00> >>`],
    ];
    let prefix = "%PDF-1.7\n";
    const offsets = new Map<number, number>();
    for (const [objectNumber, body] of objects) {
      offsets.set(objectNumber, encodeAscii(prefix).byteLength);
      prefix += `${objectNumber} 0 obj\n${body}\nendobj\n`;
    }
    const xrefStreamOffset = encodeAscii(prefix).byteLength;
    const fieldOffset = offsets.get(6) ?? 0;
    const entry = new Uint8Array([
      1,
      (fieldOffset >>> 24) & 0xff,
      (fieldOffset >>> 16) & 0xff,
      (fieldOffset >>> 8) & 0xff,
      fieldOffset & 0xff,
      0,
      0,
    ]);
    const supplemental = concatBytes([
      encodeAscii(
        "10 0 obj\n<< /Type /XRef /Size 11 /W [1 4 2] /Index [6 1] /Length 7 >>\nstream\n",
      ),
      entry,
      encodeAscii("\nendstream\nendobj\n"),
    ]);
    const xrefOffset = xrefStreamOffset + supplemental.byteLength;
    const tableEntry = (objectNumber: number): string =>
      `${String(offsets.get(objectNumber) ?? 0).padStart(10, "0")} 00000 n \n`;
    return concatBytes([
      encodeAscii(prefix),
      supplemental,
      encodeAscii(
        `xref\n0 1\n0000000000 65535 f \n1 4\n${tableEntry(1)}${tableEntry(2)}${tableEntry(3)}${tableEntry(4)}8 1\n${tableEntry(8)}10 1\n${String(xrefStreamOffset).padStart(10, "0")} 00000 n \ntrailer\n<< /Size 11 /Root 1 0 R /XRefStm ${xrefStreamOffset + (malformed ? 1 : 0)} >>\nstartxref\n${xrefOffset}\n%%EOF`,
      ),
    ]);
  };
  const template = render(marker);
  const contentsStart = indexOfBytes(template, encodeAscii("/Contents <")) + "/Contents ".length;
  const contentsEnd = contentsStart + 4;
  return render(
    `[${String(0).padStart(10, "0")} ${String(contentsStart).padStart(10, "0")} ${String(contentsEnd).padStart(10, "0")} ${String(template.byteLength - contentsEnd).padStart(10, "0")}]`,
  );
};

const PASSWORD = Redacted.make("changeit");

const createPdf: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([320, 180]);
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
});

describe("PDF signature dictionary parsing", () => {
  it("ignores ByteRange-like syntax in comments, strings, and streams", () => {
    expect(hasPdfByteRange(fakeSignatureSyntax())).toBe(false);
  });

  it("detects typed signature dictionaries even when their ByteRange is absent", () => {
    const signature = encodeAscii(
      "%PDF-1.7\n1 0 obj\n<< /Type /Sig /Contents <00> >>\nendobj\n%%EOF",
    );
    const timestamp = encodeAscii(
      "%PDF-1.7\n1 0 obj\n<< /Type /DocTimeStamp /Contents <00> >>\nendobj\n%%EOF",
    );

    expect(hasPdfSignatureDictionary(signature)).toBe(true);
    expect(hasPdfSignatureDictionary(timestamp)).toBe(true);
    expect(hasPdfByteRange(signature)).toBe(false);
    expect(hasPdfByteRange(timestamp)).toBe(false);
  });

  it.effect("discovers untyped signature dictionaries and preserves DocTimeStamp candidates", () =>
    Effect.gen(function* () {
      const untyped = encodeAscii(
        `%PDF-1.7\n1 0 obj\n<< ${fakeByteRange} /Contents <00> >>\nendobj\n%%EOF`,
      );
      const timestamp = encodeAscii(
        `%PDF-1.7\n1 0 obj\n<< /Type /DocTimeStamp ${fakeByteRange} /Contents <00> >>\nendobj\n%%EOF`,
      );
      const malformed = encodeAscii(
        "%PDF-1.7\n1 0 obj\n<< /ByteRange [0 /Invalid 0 0] /Contents <00> >>\nendobj\n%%EOF",
      );
      const timestampOffsets = yield* Effect.result(findPdfByteRangeOffsets(timestamp));
      const timestampVerification = yield* Effect.result(verifyPdf({ pdf: timestamp }));
      const malformedResult = yield* Effect.result(verifyPdf({ pdf: malformed }));

      expect(hasPdfSignatureDictionary(untyped)).toBe(true);
      expect(hasPdfByteRange(untyped)).toBe(true);
      expect(yield* findPdfByteRangeOffsets(untyped)).toHaveLength(1);
      expect(hasPdfSignatureDictionary(timestamp)).toBe(true);
      expect(hasPdfByteRange(timestamp)).toBe(true);
      expect(Result.isFailure(timestampOffsets)).toBe(true);
      expect(Result.isFailure(timestampVerification)).toBe(true);
      if (Result.isFailure(timestampVerification)) {
        expect(timestampVerification.failure.code).toBe("pdf.PLACEHOLDER_NOT_FOUND");
      }
      expect(hasPdfByteRange(malformed)).toBe(true);
      expect(Result.isFailure(malformedResult)).toBe(true);
    }),
  );

  it.effect("finds only ByteRanges owned by signature dictionaries", () =>
    Effect.gen(function* () {
      const signature = `3 0 obj\n<< /Type /Sig ${fakeByteRange} /Contents <0000> >>\nendobj`;
      const pdf = encodeAscii(
        `%PDF-1.7\n1 0 obj\n<< /Note (${fakeByteRange} /Contents <00>) >>\nendobj\n${streamObject()}\n% ${fakeByteRange}\n${signature}\n%%EOF`,
      );
      const expected = indexOfBytes(
        pdf,
        encodeAscii(fakeByteRange),
        pdf.byteLength - signature.length,
      );
      const offsets = yield* findPdfByteRangeOffsets(pdf);

      expect(offsets).toEqual([expected]);
    }),
  );

  it.effect(
    "resolves forward indirect stream lengths without inspecting token-shaped payloads",
    () =>
      Effect.gen(function* () {
        const pdf = createRawSignaturePdf();
        const signatures = yield* extractPdfSignatures(pdf.pdf);

        expect(hasPdfByteRange(pdf.pdf)).toBe(true);
        expect(hasPdfSignatureDictionary(pdf.pdf)).toBe(true);
        expect(yield* hasPdfSignatureDictionaryEffect(pdf.pdf)).toBe(true);
        expect(signatures).toHaveLength(1);
      }),
  );

  it.effect("binds reachable signature objects through xref-stream entries", () =>
    Effect.gen(function* () {
      const pdf = createXrefStreamSignaturePdf();
      const signatures = yield* extractPdfSignatures(pdf);

      expect(signatures).toHaveLength(1);
      expect(yield* isCompletePdfRevision(pdf, pdf.byteLength)).toBe(true);
    }),
  );

  it.effect("resolves a compressed signature field from its effective object stream entry", () =>
    Effect.gen(function* () {
      const pdf = yield* Effect.promise((_signal) => createCompressedFieldXrefStreamPdf());
      const signatures = yield* extractPdfSignatures(pdf);

      expect(signatures).toHaveLength(1);
    }),
  );

  it.effect("rejects a compressed entry whose object-stream index is malformed", () =>
    Effect.gen(function* () {
      const pdf = yield* Effect.promise(() => createCompressedFieldXrefStreamPdf(true));
      const result = yield* Effect.result(extractPdfSignatures(pdf));

      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  it.effect("accepts scalar, array, and predictor Flate xref streams", () =>
    Effect.gen(function* () {
      const [scalar, array, predictor] = yield* Effect.all(
        [
          Effect.promise(() => createFilteredXrefStreamSignaturePdf("scalar")),
          Effect.promise(() => createFilteredXrefStreamSignaturePdf("array")),
          Effect.promise(() => createFilteredXrefStreamSignaturePdf("predictor")),
        ],
        { concurrency: 1 },
      );
      const signatures = yield* Effect.all(
        [
          extractPdfSignatures(scalar),
          extractPdfSignatures(array),
          extractPdfSignatures(predictor),
        ],
        { concurrency: 1 },
      );

      expect(signatures.map((value) => value.length)).toEqual([1, 1, 1]);
    }),
  );

  it.effect("rejects unsupported and malformed xref stream filters", () =>
    Effect.gen(function* () {
      const [unsupported, malformedPredictor] = yield* Effect.all(
        [
          Effect.promise(() => createFilteredXrefStreamSignaturePdf("unsupported")),
          Effect.promise(() => createFilteredXrefStreamSignaturePdf("malformed-predictor")),
        ],
        { concurrency: 1 },
      );
      const results = yield* Effect.all(
        [
          Effect.result(extractPdfSignatures(unsupported)),
          Effect.result(extractPdfSignatures(malformedPredictor)),
        ],
        { concurrency: 1 },
      );

      expect(results.every(Result.isFailure)).toBe(true);
    }),
  );

  it.effect("merges a hybrid supplemental xref stream below table entries", () =>
    Effect.gen(function* () {
      const pdf = createHybridXrefSignaturePdf();
      const signatures = yield* extractPdfSignatures(pdf);

      expect(signatures).toHaveLength(1);
    }),
  );

  it.effect("rejects a hybrid trailer that points outside its supplemental xref stream", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(extractPdfSignatures(createHybridXrefSignaturePdf(true)));

      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  it.effect("fails closed when incremental revisions exceed the parser budget", () =>
    Effect.gen(function* () {
      const pdf = appendEmptyRevisions(createRawSignaturePdf(), MAX_PDF_REVISIONS);
      const result = yield* Effect.result(extractPdfSignatures(pdf));

      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  it.effect("uses each revision's effective indirect length values", () =>
    Effect.gen(function* () {
      const first = createRawSignaturePdf();
      const revised = appendReusedLengthRevision(first);
      const signatures = yield* extractPdfSignatures(revised);

      expect(signatures).toHaveLength(1);
      expect(yield* isCompletePdfRevision(revised, first.pdf.byteLength)).toBe(true);
    }),
  );

  it.effect("accepts comments and signed integer lexemes in parsed ByteRange arrays", () =>
    Effect.gen(function* () {
      const pdf = createRawSignaturePdf(
        "Sig",
        ([first, second, third, fourth]) =>
          `[+${String(first).padStart(10, "0")} % byte range\n+${String(second).padStart(10, "0")} +${String(third).padStart(10, "0")} +${String(fourth).padStart(10, "0")}]`,
      );
      const signatures = yield* extractPdfSignatures(pdf.pdf);

      expect(signatures).toHaveLength(1);
      expect(signatures[0]?.startsAtZero).toBe(true);
    }),
  );

  it.effect("excludes an unindexed duplicate signature object from verification extraction", () =>
    Effect.gen(function* () {
      const duplicate = appendUnindexedSignatureDuplicate(createRawSignaturePdf());
      const signatures = yield* extractPdfSignatures(duplicate);

      expect(signatures).toHaveLength(1);
    }),
  );

  it.effect("excludes an unindexed duplicate signature field from reachability", () =>
    Effect.gen(function* () {
      const pdf = createRawSignaturePdf("Sig", undefined, "<< /FT /Sig >>", [
        [6, "<< /FT /Sig /V 8 0 R >>"],
      ]);
      const extraction = yield* Effect.result(extractPdfSignatures(pdf.pdf));

      expect(yield* hasPdfSignatureDictionaryEffect(pdf.pdf)).toBe(true);
      expect(Result.isFailure(extraction)).toBe(true);
    }),
  );

  it.effect("does not infer signatures from explicit non-signature dictionary types", () =>
    Effect.gen(function* () {
      const pdf = createRawSignaturePdf("XObject");
      const extraction = yield* Effect.result(extractPdfSignatures(pdf.pdf));

      expect(yield* hasPdfSignatureDictionaryEffect(pdf.pdf)).toBe(false);
      expect(Result.isFailure(extraction)).toBe(true);
    }),
  );

  it.effect(
    "rejects reachable DocTimeStamp dictionaries without routing them to detached CMS",
    () =>
      Effect.gen(function* () {
        const timestamp = createRawSignaturePdf("DocTimeStamp");
        const extraction = yield* Effect.result(extractPdfSignatures(timestamp.pdf));

        expect(Result.isFailure(extraction)).toBe(true);
        if (Result.isFailure(extraction)) {
          expect(extraction.failure.code).toBe("pdf.VERIFY_FAILED");
        }
      }),
  );

  it.effect("rejects malformed runtime verification requests with a typed schema error", () =>
    Effect.gen(function* () {
      const malformed = JSON.parse('{"pdf":"not a byte array"}');
      const result = yield* Effect.result(verifyPdf(malformed));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("pdf.INVALID_BUILDER_INPUT");
        expect(result.failure._tag).toBe("PdfError");
        if (result.failure._tag === "PdfError") {
          expect(result.failure.schemaName).toBe("PdfVerificationRequest");
        }
      }
    }),
  );

  it.effect("treats a ByteRange-like appended comment as unsigned tampering", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const signed = yield* signPdf({ pdf: yield* createPdf }).pipe(
        Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
      );
      const appended = encodeAscii(`\n% ${fakeByteRange}\n%%EOF\n`);
      const forged = new Uint8Array(signed.byteLength + appended.byteLength);
      forged.set(signed);
      forged.set(appended, signed.byteLength);
      const offsets = yield* findPdfByteRangeOffsets(forged);
      expect(offsets).toHaveLength(1);
      const result = yield* Effect.result(verifyPdf({ pdf: forged }));

      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.signatureCount).toBe(1);
        expect(result.success.valid).toBe(false);
      }
    }),
  );

  it.effect("prepares the Contents sibling of the selected ByteRange", () =>
    Effect.gen(function* () {
      const contentsHex = "0000000000000000";
      const pdf = encodeAscii(
        `%PDF-1.7\n1 0 obj\n<< /Type /Sig /ByteRange [0 /********** /********** /**********] /Note (/Contents <11111111>) /Contents <${contentsHex}> >>\nendobj\n%%EOF`,
      );
      const expectedContentsStart =
        indexOfBytes(pdf, encodeAscii(`/Contents <${contentsHex}>`), 0) + "/Contents ".length;
      const prepared = yield* preparePdfByteRange(pdf);

      expect(prepared.contentsStart).toBe(expectedContentsStart);
      expect(prepared.placeholderLength).toBe(contentsHex.length);
      expect(prepared.byteRange[1]).toBe(expectedContentsStart);
    }),
  );

  it.effect("recognizes parsed signature dictionaries for incremental signing", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const first = yield* signPdf({ pdf: yield* createPdf }).pipe(
        Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
      );
      const second = yield* signPdf({ pdf: first }).pipe(
        Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
      );
      const verification = yield* verifyPdf({ pdf: second });

      expect(hasPdfByteRange(first)).toBe(true);
      expect(verification.signatureCount).toBe(2);
      expect(verification.valid).toBe(true);
    }),
  );

  it.effect(
    "accepts actual incremental revision ends and rejects xref markers inside streams",
    () =>
      Effect.gen(function* () {
        const pfx = yield* readA1Fixture("ecnpj");
        const first = yield* signPdf({ pdf: yield* createPdf }).pipe(
          Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
        );
        const second = yield* signPdf({ pdf: first }).pipe(
          Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
        );
        const fake = fakeRevisionInsideStream();

        const firstRevision = yield* isCompletePdfRevision(second, first.byteLength);
        const secondRevision = yield* isCompletePdfRevision(second, second.byteLength);
        const fakeRevision = yield* isCompletePdfRevision(fake.pdf, fake.end);

        expect(firstRevision).toBe(true);
        expect(secondRevision).toBe(true);
        expect(fakeRevision).toBe(false);
      }),
  );

  it.effect("requires configured signature capacity to be positive whole bytes", () =>
    Effect.gen(function* () {
      const valid = yield* Schema.decodeUnknownEffect(PdfSigningRequestSchema)({
        pdf: new Uint8Array(),
        signatureLength: 64,
      });
      const fractional = yield* Effect.result(
        Schema.decodeUnknownEffect(PdfSigningRequestSchema)({
          pdf: new Uint8Array(),
          signatureLength: 64.5,
        }),
      );
      const zero = yield* Effect.result(
        Schema.decodeUnknownEffect(PdfSigningRequestSchema)({
          pdf: new Uint8Array(),
          signatureLength: 0,
        }),
      );

      expect(valid.signatureLength).toBe(64);
      expect(Result.isFailure(fractional)).toBe(true);
      expect(Result.isFailure(zero)).toBe(true);
    }),
  );
  it.effect("enforces safe non-negative PDF byte-range contracts", () =>
    Effect.gen(function* () {
      const invalidRanges = [
        [-1, 1, 2, 3],
        [0.5, 1, 2, 3],
        [Number.NaN, 1, 2, 3],
        [Number.POSITIVE_INFINITY, 1, 2, 3],
        [Number.NEGATIVE_INFINITY, 1, 2, 3],
        [Number.MAX_SAFE_INTEGER + 1, 1, 2, 3],
      ];

      for (const byteRange of invalidRanges) {
        const result = yield* Effect.result(
          Schema.decodeUnknownEffect(PdfByteRangeSchema)(byteRange),
        );
        expect(Result.isFailure(result)).toBe(true);
      }

      const decodedRange = yield* Schema.decodeUnknownEffect(PdfByteRangeSchema)([0, 1, 2, 3]);
      expect(decodedRange).toStrictEqual([0, 1, 2, 3]);

      const validVerificationResult = {
        valid: true,
        chainValid: true,
        revocationStatus: "checked",
        signatureCount: 1,
        byteRange: [0, 1, 2, 3],
        signerSerialNumber: null,
      };
      const decodedVerificationResult = yield* Schema.decodeUnknownEffect(
        PdfVerificationResultSchema,
      )(validVerificationResult);
      expect(decodedVerificationResult.byteRange).toStrictEqual([0, 1, 2, 3]);

      const invalidVerificationByteRange = yield* Effect.result(
        Schema.decodeUnknownEffect(PdfVerificationResultSchema)({
          ...validVerificationResult,
          byteRange: [-1, 1, 2, 3],
        }),
      );
      expect(Result.isFailure(invalidVerificationByteRange)).toBe(true);

      const validPrepared = {
        pdf: new Uint8Array(),
        byteRange: [0, 0, 0, 0],
        signedData: new Uint8Array(),
        contentsStart: 1,
        contentsEnd: 2,
        placeholderLength: 0,
      };
      const decodedPrepared = yield* Schema.decodeUnknownEffect(PreparedPdfSignatureSchema)(
        validPrepared,
      );
      expect(decodedPrepared.contentsStart).toBe(1);

      const fields: ReadonlyArray<"contentsStart" | "contentsEnd" | "placeholderLength"> = [
        "contentsStart",
        "contentsEnd",
        "placeholderLength",
      ];
      for (const field of fields) {
        for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
          const result = yield* Effect.result(
            Schema.decodeUnknownEffect(PreparedPdfSignatureSchema)({
              ...validPrepared,
              [field]: value,
            }),
          );
          expect(Result.isFailure(result)).toBe(true);
        }
      }
    }),
  );
});
