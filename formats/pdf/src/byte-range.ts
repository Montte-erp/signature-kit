import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFParser,
  PDFRef,
} from "@cantoo/pdf-lib";
import type { PDFObject } from "@cantoo/pdf-lib";
import { Effect, Result, Schema } from "effect";
import { concatBytes, encodeAscii, replaceRange } from "./bytes.js";
import {
  MAX_PDF_SIGNATURE_BYTES,
  PdfByteRangeSchema,
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
} from "./config.js";
import type { PdfOperation } from "./config.js";
export { PdfByteRangeSchema } from "./config.js";

const LEFT_ANGLE = 0x3c;
const RIGHT_ANGLE = 0x3e;
const PDF_OBJECT_KEYWORD = [0x6f, 0x62, 0x6a];
const PDF_END_OBJECT_KEYWORD = [0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a];
const PDF_STREAM_KEYWORD = [0x73, 0x74, 0x72, 0x65, 0x61, 0x6d];
const PDF_END_STREAM_KEYWORD = [0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d];
const PDF_XREF_KEYWORD = [0x78, 0x72, 0x65, 0x66];
const PDF_TRAILER_KEYWORD = [0x74, 0x72, 0x61, 0x69, 0x6c, 0x65, 0x72];
const PDF_START_XREF_KEYWORD = [0x73, 0x74, 0x61, 0x72, 0x74, 0x78, 0x72, 0x65, 0x66];
const PDF_EOF_KEYWORD = [0x25, 0x25, 0x45, 0x4f, 0x46];
const PDF_TYPE_NAME = PDFName.of("Type");
const PDF_SIGNATURE_TYPE_NAME = PDFName.of("Sig");
const PDF_DOCUMENT_TIMESTAMP_TYPE_NAME = PDFName.of("DocTimeStamp");
const PDF_XREF_TYPE_NAME = PDFName.of("XRef");
const PDF_PREV_NAME = PDFName.of("Prev");
const PDF_BYTE_RANGE_NAME = PDFName.of("ByteRange");
const PDF_CONTENTS_NAME = PDFName.of("Contents");
const PDF_ACRO_FORM_FIELDS_NAME = PDFName.of("Fields");
const PDF_FIELD_TYPE_NAME = PDFName.of("FT");
const PDF_FIELD_KIDS_NAME = PDFName.of("Kids");
const PDF_FIELD_VALUE_NAME = PDFName.of("V");
const PDF_ROOT_NAME = PDFName.of("Root");
const PDF_ACRO_FORM_NAME = PDFName.of("AcroForm");
const PDF_FIELD_PARENT_NAME = PDFName.of("Parent");
const PDF_BYTE_RANGE_PLACEHOLDER_NAME = PDFName.of("**********");
const PDF_FILTER_NAME = PDFName.of("Filter");
const PDF_FLATE_DECODE_NAME = PDFName.of("FlateDecode");
const MAX_XREF_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_XREF_ENTRIES = 1_000_000;
const PDF_XREF_WIDTHS_NAME = PDFName.of("W");
const PDF_XREF_INDEX_NAME = PDFName.of("Index");
const PDF_XREF_SIZE_NAME = PDFName.of("Size");
const PDF_XREF_STREAM_NAME = PDFName.of("XRefStm");
const PDF_DECODE_PARMS_NAME = PDFName.of("DecodeParms");
const PDF_PREDICTOR_NAME = PDFName.of("Predictor");
const PDF_COLUMNS_NAME = PDFName.of("Columns");
const PDF_COLORS_NAME = PDFName.of("Colors");
const PDF_BITS_PER_COMPONENT_NAME = PDFName.of("BitsPerComponent");
const PDF_OBJECT_STREAM_TYPE_NAME = PDFName.of("ObjStm");
const PDF_OBJECT_STREAM_COUNT_NAME = PDFName.of("N");
const PDF_OBJECT_STREAM_FIRST_NAME = PDFName.of("First");
export const MAX_PDF_REVISIONS = 128;
export const MAX_PDF_SIGNATURE_DICTIONARIES = 1_024;
const MAX_PDF_INDIRECT_NUMBER_VALUES = 200_000;
export const MAX_PDF_SIGNATURE_REVISION_WORK = 200_000;
const MAX_CROSS_REFERENCE_SOURCES = MAX_PDF_REVISIONS * 2;
const MAX_TOTAL_CROSS_REFERENCE_ENTRIES = 500_000;
const MAX_OBJECT_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_OBJECT_STREAM_OBJECTS = 100_000;
const MAX_OBJECT_STREAM_RESOLUTIONS = 10_000;
export type PdfByteRange = (typeof PdfByteRangeSchema)["Type"];

export const PreparedPdfSignatureSchema = Schema.Struct({
  pdf: Schema.Uint8Array,
  byteRange: PdfByteRangeSchema,
  signedData: Schema.Uint8Array,
  contentsStart: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  contentsEnd: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  placeholderLength: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
export type PreparedPdfSignature = (typeof PreparedPdfSignatureSchema)["Type"];

export const ExtractedPdfSignatureSchema = Schema.Struct({
  byteRange: PdfByteRangeSchema,
  signedData: Schema.Uint8Array,
  signature: Schema.Uint8Array,
  signatureCount: Schema.Number,
  startsAtZero: Schema.Boolean,
  coversFileEnd: Schema.Boolean,
});
export type ExtractedPdfSignature = (typeof ExtractedPdfSignatureSchema)["Type"];

export const inflateZlibBounded = (
  input: Uint8Array,
  maxOutputBytes: number,
): Effect.Effect<Uint8Array, PdfError> => {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.invalidPdf,
        retryable: false,
        reason: "Failed to decompress bounded zlib data.",
        operation: PdfOperationValue.verify,
      }),
    );
  }
  return Effect.tryPromise({
    try: async () => {
      const copy = new Uint8Array(input.byteLength);
      copy.set(input);
      const decompression = new DecompressionStream("deflate");
      const writer = decompression.writable.getWriter();
      const writing = writer.write(copy).then(() => writer.close());
      const reader = decompression.readable.getReader();
      const reading = (async () => {
        const chunks: Array<Uint8Array> = [];
        let length = 0;
        while (true) {
          const next = await reader.read();
          if (next.done) return concatBytes(chunks);
          const chunk = next.value;
          if (chunk === undefined) return undefined;
          length += chunk.byteLength;
          if (length > maxOutputBytes) {
            await reader.cancel();
            return undefined;
          }
          chunks.push(chunk);
        }
      })();
      const [, output] = await Promise.all([writing, reading]);
      return output;
    },
    catch: () =>
      new PdfError({
        code: PdfErrorCodeValue.invalidPdf,
        retryable: false,
        reason: "Failed to decompress bounded zlib data.",
        operation: PdfOperationValue.verify,
      }),
  }).pipe(
    Effect.flatMap((output) =>
      output === undefined
        ? Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.invalidPdf,
              retryable: false,
              reason: "Failed to decompress bounded zlib data.",
              operation: PdfOperationValue.verify,
            }),
          )
        : Effect.succeed(output),
    ),
  );
};

const isPdfWhitespaceByte = (byte: number | undefined): boolean =>
  byte === 0x00 ||
  byte === 0x09 ||
  byte === 0x0a ||
  byte === 0x0c ||
  byte === 0x0d ||
  byte === 0x20;

const skipPdfWhitespace = (pdf: Uint8Array, offset: number): number => {
  let current = offset;
  while (current < pdf.byteLength && isPdfWhitespaceByte(pdf[current])) current += 1;
  return current;
};

const isPdfDelimiterByte = (byte: number | undefined): boolean =>
  byte === 0x28 ||
  byte === 0x29 ||
  byte === 0x3c ||
  byte === 0x3e ||
  byte === 0x5b ||
  byte === 0x5d ||
  byte === 0x7b ||
  byte === 0x7d ||
  byte === 0x2f ||
  byte === 0x25;

const isPdfTokenBoundary = (byte: number | undefined): boolean =>
  byte === undefined || isPdfWhitespaceByte(byte) || isPdfDelimiterByte(byte);

const isPdfDigit = (byte: number | undefined): boolean =>
  byte !== undefined && byte >= 0x30 && byte <= 0x39;

type PdfDictionaryField = {
  readonly key: PDFName;
  readonly keyStart: number;
  readonly valueStart: number;
  readonly valueEnd: number;
  readonly value: PDFObject;
};

type PdfIndirectObjectReference = {
  readonly objectNumber: number;
  readonly generationNumber: number;
};

type PdfIndirectObjectDefinition = PdfIndirectObjectLocation & {
  readonly object: PDFObject;
  readonly stream: PdfIndirectStream | undefined;
};
type PdfIndirectObjectLocation = {
  readonly reference: PdfIndirectObjectReference;
  readonly objectStart: number;
};
type PdfIndirectStream = {
  readonly dict: PDFDict;
  readonly start: number;
  readonly end: number;
};

type PdfSignatureDictionaryKind = "regular" | "document-timestamp";

type PdfSignatureDictionary = {
  readonly kind: PdfSignatureDictionaryKind;
  readonly reference: PdfIndirectObjectReference;
  readonly objectStart: number;
  readonly byteRange: PdfDictionaryField | undefined;
  readonly contents: PdfDictionaryField | undefined;
};
type PdfRevisionNumberValues = {
  readonly eofEnd: number;
  readonly numbers: ReadonlyMap<string, number>;
};

type PdfSignatureDictionaryParseResult = {
  readonly dictionaries: ReadonlyArray<PdfSignatureDictionary>;
  readonly indirectObjectDefinitions: ReadonlyArray<PdfIndirectObjectDefinition>;
  readonly indirectNumbers: ReadonlyMap<string, number>;
  readonly revisionNumberValues: ReadonlyArray<PdfRevisionNumberValues>;
  readonly streamParsingFailed: boolean;
  readonly streamParsingUncertain: boolean;
  readonly resourceLimitExceeded: boolean;
};

const lastFieldForName = (
  fields: ReadonlyArray<PdfDictionaryField>,
  name: PDFName,
): PdfDictionaryField | undefined => {
  for (let index = fields.length - 1; index >= 0; index -= 1) {
    const field = fields[index];
    if (field !== undefined && field.key === name) return field;
  }
  return undefined;
};
type PdfSignatureDictionaryWithByteRange = PdfSignatureDictionary & {
  readonly byteRange: PdfDictionaryField;
};

const hasSignatureByteRange = (
  dictionary: PdfSignatureDictionary,
): dictionary is PdfSignatureDictionaryWithByteRange => dictionary.byteRange !== undefined;

type PdfRegularSignatureDictionary = PdfSignatureDictionary & {
  readonly kind: "regular";
};

type PdfRegularSignatureDictionaryWithByteRange = PdfSignatureDictionaryWithByteRange &
  PdfRegularSignatureDictionary;

const isRegularSignatureDictionary = (
  dictionary: PdfSignatureDictionary,
): dictionary is PdfRegularSignatureDictionary => dictionary.kind === "regular";

const isRegularSignatureWithByteRange = (
  dictionary: PdfSignatureDictionary,
): dictionary is PdfRegularSignatureDictionaryWithByteRange =>
  isRegularSignatureDictionary(dictionary) && hasSignatureByteRange(dictionary);

const isPdfWhitespaceOnly = (pdf: Uint8Array, start: number): boolean => {
  for (let offset = start; offset < pdf.byteLength; offset += 1) {
    if (!isPdfWhitespaceByte(pdf[offset])) return false;
  }
  return true;
};

type PdfCrossReferenceEntry =
  | {
      readonly kind: "free";
      readonly objectNumber: number;
      readonly generationNumber: number;
      readonly inUse: false;
    }
  | {
      readonly kind: "uncompressed";
      readonly objectNumber: number;
      readonly generationNumber: number;
      readonly offset: number;
      readonly inUse: true;
    }
  | {
      readonly kind: "compressed";
      readonly objectNumber: number;
      readonly generationNumber: 0;
      readonly objectStreamObjectNumber: number;
      readonly objectStreamIndex: number;
      readonly inUse: true;
    };

type PdfCrossReferenceSource = {
  readonly offset: number;
  readonly previousOffset: number | undefined;
  readonly supplementalOffset: number | undefined;
  readonly kind: "table" | "stream";
  readonly hasTrailer: boolean;
  readonly root: PDFObject | undefined;
  readonly entries: ReadonlyMap<number, PdfCrossReferenceEntry>;
};

type PdfCrossReferenceStream = {
  readonly objectOffset: number;
  readonly dict: PDFDict;
  readonly start: number;
  readonly end: number;
  readonly widths: readonly [number, number, number];
  readonly ranges: ReadonlyArray<readonly [number, number]>;
  readonly expectedLength: number;
};

type PdfRevisionTerminal = {
  readonly crossReferenceOffset: number;
  readonly eofEnd: number;
};

type PdfRevisionStructure = {
  readonly crossReferences: ReadonlyArray<PdfCrossReferenceSource>;
  readonly crossReferenceByOffset: ReadonlyMap<number, PdfCrossReferenceSource>;
  readonly xrefStreams: ReadonlyMap<number, PdfCrossReferenceStream>;
  readonly revisionTerminals: ReadonlyArray<PdfRevisionTerminal>;
  readonly structurallyValid: boolean;
  readonly resourceLimitExceeded: boolean;
};

class PdfSignatureDictionaryParser extends PDFParser {
  private readonly signatureDictionaries: Array<PdfSignatureDictionary> = [];
  private readonly indirectObjectDefinitions: Array<PdfIndirectObjectDefinition> = [];
  private readonly indirectNumbers: Map<string, number>;
  private readonly source: Uint8Array;
  private readonly sourceByteLength: number;
  private parsingIndirectObject = false;
  private currentIndirectObject: PdfIndirectObjectLocation | undefined;
  private currentIndirectStream: PdfIndirectStream | undefined;
  private dictionaryDepth = 0;
  private streamParsingFailed = false;
  private streamParsingUncertain = false;
  private resourceLimitExceeded = false;

  constructor(
    pdf: Uint8Array,
    indirectNumbers: ReadonlyMap<string, number> = new Map(),
    private readonly revisionNumberValues: ReadonlyArray<PdfRevisionNumberValues> = [],
  ) {
    super(pdf);
    this.indirectNumbers = new Map(indirectNumbers);
    this.source = pdf;
    this.sourceByteLength = pdf.byteLength;
  }

  scan(): PdfSignatureDictionaryParseResult {
    while (!this.bytes.done()) {
      this.skipWhitespaceAndComments();
      if (this.bytes.done()) break;

      if (this.matchPdfKeyword(PDF_TRAILER_KEYWORD)) {
        this.skipWhitespaceAndComments();
        this.parseObject();
        continue;
      }

      if (this.matchPdfKeyword(PDF_START_XREF_KEYWORD)) {
        this.skipWhitespaceAndComments();
        if (isPdfDigit(this.bytes.peek())) this.parseRawInt();
        continue;
      }

      const objectStart = this.bytes.offset();
      const reference = this.parseSignatureIndirectObjectHeader();
      if (reference === undefined) {
        this.bytes.next();
        continue;
      }
      const indirectObject: PdfIndirectObjectLocation = {
        reference,
        objectStart,
      };

      this.skipWhitespaceAndComments();
      this.parsingIndirectObject = true;
      this.currentIndirectObject = indirectObject;
      this.currentIndirectStream = undefined;
      this.dictionaryDepth = 0;
      const object = this.parseObject();
      if (this.indirectObjectDefinitions.length >= MAX_PDF_INDIRECT_NUMBER_VALUES) {
        this.resourceLimitExceeded = true;
      } else {
        this.indirectObjectDefinitions.push({
          ...indirectObject,
          object,
          stream: this.currentIndirectStream,
        });
      }
      if (object instanceof PDFNumber) {
        if (this.indirectNumbers.size >= MAX_PDF_INDIRECT_NUMBER_VALUES) {
          this.resourceLimitExceeded = true;
        } else {
          this.indirectNumbers.set(pdfReferenceKey(indirectObject.reference), object.asNumber());
        }
      }
      this.currentIndirectObject = undefined;
      this.parsingIndirectObject = false;
      this.skipWhitespaceAndComments();
      this.matchPdfKeyword(PDF_END_OBJECT_KEYWORD);
    }

    this.signatureDictionaries.sort(
      (left, right) =>
        (left.byteRange?.keyStart ?? Number.MAX_SAFE_INTEGER) -
        (right.byteRange?.keyStart ?? Number.MAX_SAFE_INTEGER),
    );
    return {
      dictionaries: this.signatureDictionaries,
      indirectObjectDefinitions: this.indirectObjectDefinitions,
      indirectNumbers: this.indirectNumbers,
      revisionNumberValues: this.revisionNumberValues,
      streamParsingFailed: this.streamParsingFailed,
      streamParsingUncertain: this.streamParsingUncertain,
      resourceLimitExceeded: this.resourceLimitExceeded,
    };
  }

  private indirectLength(reference: PDFRef): number | undefined {
    const objectOffset = this.currentIndirectObject?.objectStart;
    if (objectOffset !== undefined) {
      for (const revision of this.revisionNumberValues) {
        if (objectOffset < revision.eofEnd) {
          return revision.numbers.get(pdfReferenceKey(reference));
        }
      }
    }
    return this.indirectNumbers.get(pdfReferenceKey(reference));
  }

  protected parseDictOrStream(): PDFDict {
    const dict = this.parseDict();
    this.skipWhitespaceAndComments();
    if (!this.matchPdfKeyword(PDF_STREAM_KEYWORD)) return dict;
    if (!this.consumeStreamLineEnding()) {
      this.streamParsingFailed = true;
      return dict;
    }

    const start = this.bytes.offset();
    const lengthObject = dict.get(PDFName.Length);
    const length =
      lengthObject instanceof PDFNumber
        ? lengthObject.asNumber()
        : lengthObject instanceof PDFRef
          ? this.indirectLength(lengthObject)
          : undefined;
    if (length !== undefined) {
      const end = start + length;
      if (
        !Number.isSafeInteger(end) ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        end < start ||
        end > this.sourceByteLength
      ) {
        this.streamParsingFailed = true;
        this.bytes.moveTo(this.sourceByteLength);
        return dict;
      }
      this.bytes.moveTo(end);
      this.skipWhitespaceAndComments();
      if (!this.matchPdfKeyword(PDF_END_STREAM_KEYWORD)) {
        this.streamParsingFailed = true;
      } else if (this.currentIndirectObject !== undefined && this.dictionaryDepth === 0) {
        this.currentIndirectStream = { dict, start, end };
      }
      return dict;
    }

    this.streamParsingUncertain = true;
    this.skipUnknownLengthStream();
    return dict;
  }

  protected parseDict(ref?: PDFRef): PDFDict {
    const depth = this.dictionaryDepth;
    this.dictionaryDepth += 1;
    this.bytes.assertNext(LEFT_ANGLE);
    this.bytes.assertNext(LEFT_ANGLE);
    this.skipWhitespaceAndComments();

    const dict = new Map<PDFName, PDFObject>();
    const fields: Array<PdfDictionaryField> = [];
    while (
      !this.bytes.done() &&
      (this.bytes.peek() !== RIGHT_ANGLE || this.bytes.peekAhead(1) !== RIGHT_ANGLE)
    ) {
      const keyStart = this.bytes.offset();
      const key = this.parseName();
      this.skipWhitespaceAndComments();
      const valueStart = this.bytes.offset();
      const value = this.parseObject(ref);
      const valueEnd = this.bytes.offset();
      dict.set(key, value);
      fields.push({ key, keyStart, valueStart, valueEnd, value });
      this.skipWhitespaceAndComments();
    }

    this.skipWhitespaceAndComments();
    this.bytes.assertNext(RIGHT_ANGLE);
    this.bytes.assertNext(RIGHT_ANGLE);
    this.dictionaryDepth -= 1;

    if (this.parsingIndirectObject && depth === 0) {
      const byteRange = lastFieldForName(fields, PDF_BYTE_RANGE_NAME);
      const contents = lastFieldForName(fields, PDF_CONTENTS_NAME);
      const type = dict.get(PDF_TYPE_NAME);
      const kind =
        type === PDF_DOCUMENT_TIMESTAMP_TYPE_NAME
          ? "document-timestamp"
          : type === PDF_SIGNATURE_TYPE_NAME
            ? "regular"
            : type === undefined && byteRange !== undefined && contents !== undefined
              ? "regular"
              : undefined;
      if (kind !== undefined && this.currentIndirectObject !== undefined) {
        if (this.signatureDictionaries.length >= MAX_PDF_SIGNATURE_DICTIONARIES) {
          this.resourceLimitExceeded = true;
        } else {
          this.signatureDictionaries.push({
            kind,
            reference: this.currentIndirectObject.reference,
            objectStart: this.currentIndirectObject.objectStart,
            byteRange,
            contents,
          });
        }
      }
    }

    return PDFDict.fromMapWithContext(dict, this.context);
  }

  private consumeStreamLineEnding(): boolean {
    const first = this.bytes.peek();
    if (first === 0x0d) {
      this.bytes.next();
      if (this.bytes.peek() === 0x0a) this.bytes.next();
      return true;
    }
    if (first === 0x0a) {
      this.bytes.next();
      return true;
    }
    return false;
  }

  private skipUnknownLengthStream(): void {
    while (!this.bytes.done()) {
      const offset = this.bytes.offset();
      const previous = offset === 0 ? undefined : this.source[offset - 1];
      if (
        (previous === 0x0a || previous === 0x0d) &&
        this.matchPdfKeyword(PDF_END_STREAM_KEYWORD)
      ) {
        return;
      }
      this.bytes.next();
    }
    this.streamParsingFailed = true;
  }

  private matchPdfKeyword(keyword: Array<number>): boolean {
    const offset = this.bytes.offset();
    if (!this.matchKeyword(keyword) || !isPdfTokenBoundary(this.bytes.peek())) {
      this.bytes.moveTo(offset);
      return false;
    }
    return true;
  }

  private parseSignatureIndirectObjectHeader(): PdfIndirectObjectReference | undefined {
    if (!isPdfDigit(this.bytes.peek())) return undefined;
    const objectNumber = this.parseRawInt();
    this.skipWhitespaceAndComments();
    if (!isPdfDigit(this.bytes.peek())) return undefined;
    const generationNumber = this.parseRawInt();
    this.skipWhitespaceAndComments();
    if (!this.matchPdfKeyword(PDF_OBJECT_KEYWORD)) return undefined;
    return { objectNumber, generationNumber };
  }
}

class PdfObjectValueParser extends PDFParser {
  parseValue(): PDFObject {
    return this.parseObject();
  }
}

class PdfRevisionParser extends PDFParser {
  private readonly crossReferences = new Map<number, PdfCrossReferenceSource>();
  private readonly revisionTerminals: Array<PdfRevisionTerminal> = [];
  private readonly source: Uint8Array;
  private readonly sourceByteLength: number;
  private readonly indirectNumbers: ReadonlyMap<string, number>;
  private readonly xrefStreamsByObjectOffset = new Map<number, PdfCrossReferenceStream>();
  private currentIndirectObjectOffset: number | undefined;
  private pendingCrossReferenceTable: number | undefined;
  private structurallyValid = true;
  private resourceLimitExceeded = false;
  private crossReferenceEntryCount = 0;

  constructor(
    pdf: Uint8Array,
    indirectNumbers: ReadonlyMap<string, number> = new Map(),
    private readonly revisionNumberValues: ReadonlyArray<PdfRevisionNumberValues> = [],
  ) {
    super(pdf);
    this.indirectNumbers = indirectNumbers;
    this.source = pdf;
    this.sourceByteLength = pdf.byteLength;
  }

  scan(): PdfRevisionStructure {
    while (!this.bytes.done()) {
      this.skipWhitespaceAndComments();
      if (this.bytes.done()) break;

      if (this.parseCrossReferenceTable()) continue;
      if (this.parseTrailer()) continue;
      if (this.parseStartXref()) continue;

      const objectOffset = this.bytes.offset();
      const reference = this.parseRevisionIndirectObjectHeader();
      if (reference === undefined) {
        this.bytes.next();
        continue;
      }

      this.skipWhitespaceAndComments();
      this.currentIndirectObjectOffset = objectOffset;
      const object = this.parseObject();
      this.currentIndirectObjectOffset = undefined;
      if (object instanceof PDFDict && object.get(PDF_TYPE_NAME) === PDF_XREF_TYPE_NAME) {
        const previousOffset = this.previousOffset(object);
        if (object.get(PDF_PREV_NAME) !== undefined && previousOffset === undefined) {
          this.structurallyValid = false;
        }
        const stream = this.xrefStreamsByObjectOffset.get(objectOffset);
        if (stream === undefined) this.structurallyValid = false;
        if (this.crossReferences.size >= MAX_CROSS_REFERENCE_SOURCES) {
          this.resourceLimitExceeded = true;
          this.structurallyValid = false;
        } else {
          this.crossReferences.set(objectOffset, {
            offset: objectOffset,
            previousOffset,
            supplementalOffset: undefined,
            kind: "stream",
            hasTrailer: true,
            root: object.get(PDF_ROOT_NAME),
            entries: new Map(),
          });
        }
      }
      this.skipWhitespaceAndComments();
      if (!this.matchPdfKeyword(PDF_END_OBJECT_KEYWORD)) this.structurallyValid = false;
    }

    if (this.pendingCrossReferenceTable !== undefined) this.structurallyValid = false;
    return {
      crossReferences: Array.from(this.crossReferences.values()),
      crossReferenceByOffset: this.crossReferences,
      xrefStreams: this.xrefStreamsByObjectOffset,
      revisionTerminals: this.revisionTerminals,
      structurallyValid: this.structurallyValid,
      resourceLimitExceeded: this.resourceLimitExceeded,
    };
  }

  private indirectLength(reference: PDFRef): number | undefined {
    const objectOffset = this.currentIndirectObjectOffset;
    if (objectOffset !== undefined) {
      for (const revision of this.revisionNumberValues) {
        if (objectOffset < revision.eofEnd) {
          return revision.numbers.get(pdfReferenceKey(reference));
        }
      }
    }
    return this.indirectNumbers.get(pdfReferenceKey(reference));
  }

  protected parseDictOrStream(ref?: PDFRef): PDFDict {
    const dict = this.parseDict(ref);
    this.skipWhitespaceAndComments();
    if (!this.matchPdfKeyword(PDF_STREAM_KEYWORD)) return dict;
    const first = this.bytes.peek();
    if (first === 0x0d) {
      this.bytes.next();
      if (this.bytes.peek() === 0x0a) this.bytes.next();
    } else if (first === 0x0a) {
      this.bytes.next();
    } else {
      this.structurallyValid = false;
      return dict;
    }

    const start = this.bytes.offset();
    const lengthObject = dict.get(PDFName.Length);
    const length =
      lengthObject instanceof PDFNumber
        ? lengthObject.asNumber()
        : lengthObject instanceof PDFRef
          ? this.indirectLength(lengthObject)
          : undefined;
    if (length !== undefined) {
      const end = start + length;
      if (
        !Number.isSafeInteger(end) ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        end < start ||
        end > this.sourceByteLength
      ) {
        this.structurallyValid = false;
        this.bytes.moveTo(this.sourceByteLength);
        return dict;
      }
      this.bytes.moveTo(end);
      this.skipWhitespaceAndComments();
      if (!this.matchPdfKeyword(PDF_END_STREAM_KEYWORD)) {
        this.structurallyValid = false;
        return dict;
      }
      if (dict.get(PDF_TYPE_NAME) === PDF_XREF_TYPE_NAME) {
        const objectOffset = this.currentIndirectObjectOffset;
        const stream =
          objectOffset === undefined
            ? undefined
            : this.xrefStreamDefinition(dict, objectOffset, start, end);
        if (stream === undefined || objectOffset === undefined) {
          this.structurallyValid = false;
        } else {
          this.xrefStreamsByObjectOffset.set(objectOffset, stream);
        }
      }
      return dict;
    }
    this.structurallyValid = false;
    while (!this.bytes.done()) {
      const offset = this.bytes.offset();
      const previous = offset === 0 ? undefined : this.source[offset - 1];
      if (
        (previous === 0x0a || previous === 0x0d) &&
        this.matchPdfKeyword(PDF_END_STREAM_KEYWORD)
      ) {
        return dict;
      }
      this.bytes.next();
    }
    this.structurallyValid = false;
    return dict;
  }

  private xrefStreamDefinition(
    dict: PDFDict,
    objectOffset: number,
    start: number,
    end: number,
  ): PdfCrossReferenceStream | undefined {
    if (end - start > MAX_XREF_STREAM_BYTES) return undefined;
    const widths = dict.lookupMaybe(PDF_XREF_WIDTHS_NAME, PDFArray);
    if (widths === undefined || widths.size() !== 3) return undefined;
    const typeWidth = widths.get(0);
    const offsetWidth = widths.get(1);
    const generationWidth = widths.get(2);
    if (
      !(typeWidth instanceof PDFNumber) ||
      !(offsetWidth instanceof PDFNumber) ||
      !(generationWidth instanceof PDFNumber)
    ) {
      return undefined;
    }
    const widthsValue: readonly [number, number, number] = [
      typeWidth.asNumber(),
      offsetWidth.asNumber(),
      generationWidth.asNumber(),
    ];
    if (widthsValue.some((width) => !Number.isSafeInteger(width) || width < 0 || width > 8)) {
      return undefined;
    }
    const width = widthsValue[0] + widthsValue[1] + widthsValue[2];
    if (width <= 0) return undefined;

    const index = dict.lookupMaybe(PDF_XREF_INDEX_NAME, PDFArray);
    const size = dict.lookupMaybe(PDF_XREF_SIZE_NAME, PDFNumber)?.asNumber();
    const ranges: Array<readonly [number, number]> = [];
    if (index === undefined) {
      if (size === undefined || !Number.isSafeInteger(size) || size < 0) return undefined;
      ranges.push([0, size]);
    } else {
      if (index.size() % 2 !== 0) return undefined;
      for (let position = 0; position < index.size(); position += 2) {
        const first = index.get(position);
        const count = index.get(position + 1);
        if (
          !(first instanceof PDFNumber) ||
          !(count instanceof PDFNumber) ||
          !Number.isSafeInteger(first.asNumber()) ||
          !Number.isSafeInteger(count.asNumber()) ||
          first.asNumber() < 0 ||
          count.asNumber() < 0
        ) {
          return undefined;
        }
        ranges.push([first.asNumber(), count.asNumber()]);
      }
    }

    let entryCount = 0;
    for (const [, count] of ranges) {
      entryCount += count;
      if (!Number.isSafeInteger(entryCount) || entryCount > MAX_XREF_ENTRIES) {
        return undefined;
      }
    }
    const expectedLength = entryCount * width;
    if (!Number.isSafeInteger(expectedLength) || expectedLength > MAX_XREF_STREAM_BYTES) {
      return undefined;
    }
    return {
      dict,
      objectOffset,
      start,
      end,
      widths: widthsValue,
      ranges,
      expectedLength,
    };
  }

  private parseCrossReferenceTable(): boolean {
    const offset = this.bytes.offset();
    if (!this.matchPdfKeyword(PDF_XREF_KEYWORD)) return false;
    this.skipWhitespaceAndComments();

    const entries = new Map<number, PdfCrossReferenceEntry>();
    let subsectionCount = 0;
    while (isPdfDigit(this.bytes.peek())) {
      const firstObjectNumber = this.parseRawInt();
      this.skipWhitespaceAndComments();
      if (!isPdfDigit(this.bytes.peek())) {
        this.structurallyValid = false;
        return true;
      }
      const entryCount = this.parseRawInt();
      this.skipWhitespaceAndComments();
      if (
        !Number.isSafeInteger(firstObjectNumber) ||
        !Number.isSafeInteger(entryCount) ||
        entryCount > MAX_XREF_ENTRIES ||
        entryCount > this.sourceByteLength - this.bytes.offset()
      ) {
        this.structurallyValid = false;
        this.resourceLimitExceeded = entryCount > MAX_XREF_ENTRIES;
        return true;
      }
      this.crossReferenceEntryCount += entryCount;
      if (this.crossReferenceEntryCount > MAX_TOTAL_CROSS_REFERENCE_ENTRIES) {
        this.resourceLimitExceeded = true;
        this.structurallyValid = false;
        return true;
      }

      for (let entry = 0; entry < entryCount; entry += 1) {
        if (!isPdfDigit(this.bytes.peek())) {
          this.structurallyValid = false;
          return true;
        }
        const objectOffset = this.parseRawInt();
        this.skipWhitespaceAndComments();
        if (!isPdfDigit(this.bytes.peek())) {
          this.structurallyValid = false;
          return true;
        }
        const generationNumber = this.parseRawInt();
        this.skipWhitespaceAndComments();
        const entryType = this.bytes.peek();
        if (
          (entryType !== 0x6e && entryType !== 0x66) ||
          !isPdfTokenBoundary(this.bytes.peekAhead(1))
        ) {
          this.structurallyValid = false;
          return true;
        }
        const objectNumber = firstObjectNumber + entry;
        if (
          !Number.isSafeInteger(objectNumber) ||
          !Number.isSafeInteger(objectOffset) ||
          !Number.isSafeInteger(generationNumber)
        ) {
          this.structurallyValid = false;
          return true;
        }
        if (!entries.has(objectNumber)) {
          entries.set(
            objectNumber,
            entryType === 0x6e
              ? {
                  kind: "uncompressed",
                  objectNumber,
                  generationNumber,
                  offset: objectOffset,
                  inUse: true,
                }
              : {
                  kind: "free",
                  objectNumber,
                  generationNumber,
                  inUse: false,
                },
          );
        }
        this.bytes.next();
        this.skipWhitespaceAndComments();
      }
      subsectionCount += 1;
    }

    if (subsectionCount === 0) {
      this.structurallyValid = false;
      return true;
    }
    if (this.crossReferences.size >= MAX_CROSS_REFERENCE_SOURCES) {
      this.resourceLimitExceeded = true;
      this.structurallyValid = false;
      return true;
    }
    this.crossReferences.set(offset, {
      offset,
      previousOffset: undefined,
      supplementalOffset: undefined,
      kind: "table",
      hasTrailer: false,
      root: undefined,
      entries,
    });
    this.pendingCrossReferenceTable = offset;
    return true;
  }

  private parseTrailer(): boolean {
    if (!this.matchPdfKeyword(PDF_TRAILER_KEYWORD)) return false;
    this.skipWhitespaceAndComments();
    const trailer = this.parseObject();
    const tableOffset = this.pendingCrossReferenceTable;
    if (!(trailer instanceof PDFDict) || tableOffset === undefined) {
      this.structurallyValid = false;
      return true;
    }

    const source = this.crossReferences.get(tableOffset);
    if (source === undefined) {
      this.structurallyValid = false;
      return true;
    }
    const previousOffset = this.previousOffset(trailer);
    const supplementalOffset = this.xrefStreamOffset(trailer);
    if (
      (trailer.get(PDF_PREV_NAME) !== undefined && previousOffset === undefined) ||
      (trailer.get(PDF_XREF_STREAM_NAME) !== undefined && supplementalOffset === undefined) ||
      (supplementalOffset !== undefined && supplementalOffset >= tableOffset)
    ) {
      this.structurallyValid = false;
    }
    this.crossReferences.set(tableOffset, {
      ...source,
      previousOffset,
      supplementalOffset,
      hasTrailer: true,
      root: trailer.get(PDF_ROOT_NAME),
    });
    this.pendingCrossReferenceTable = undefined;
    return true;
  }

  private parseStartXref(): boolean {
    if (!this.matchPdfKeyword(PDF_START_XREF_KEYWORD)) return false;
    this.skipWhitespace();
    if (!isPdfDigit(this.bytes.peek())) {
      this.structurallyValid = false;
      return true;
    }
    const crossReferenceOffset = this.parseRawInt();
    this.skipWhitespace();
    if (!Number.isSafeInteger(crossReferenceOffset) || !this.matchPdfKeyword(PDF_EOF_KEYWORD)) {
      this.structurallyValid = false;
      return true;
    }
    if (this.revisionTerminals.length >= MAX_PDF_REVISIONS) {
      this.resourceLimitExceeded = true;
      this.structurallyValid = false;
      return true;
    }
    this.revisionTerminals.push({
      crossReferenceOffset,
      eofEnd: this.bytes.offset(),
    });
    return true;
  }

  private previousOffset(dict: PDFDict): number | undefined {
    const previous = dict.get(PDF_PREV_NAME);
    if (!(previous instanceof PDFNumber)) return undefined;
    const offset = previous.asNumber();
    return Number.isSafeInteger(offset) ? offset : undefined;
  }

  private xrefStreamOffset(dict: PDFDict): number | undefined {
    const offset = dict.get(PDF_XREF_STREAM_NAME);
    if (!(offset instanceof PDFNumber)) return undefined;
    const value = offset.asNumber();
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }

  private matchPdfKeyword(keyword: Array<number>): boolean {
    const offset = this.bytes.offset();
    if (!this.matchKeyword(keyword) || !isPdfTokenBoundary(this.bytes.peek())) {
      this.bytes.moveTo(offset);
      return false;
    }
    return true;
  }

  private parseRevisionIndirectObjectHeader(): PdfIndirectObjectReference | undefined {
    if (!isPdfDigit(this.bytes.peek())) return undefined;
    const objectNumber = this.parseRawInt();
    this.skipWhitespaceAndComments();
    if (!isPdfDigit(this.bytes.peek())) return undefined;
    const generationNumber = this.parseRawInt();
    this.skipWhitespaceAndComments();
    if (!this.matchPdfKeyword(PDF_OBJECT_KEYWORD)) return undefined;
    return { objectNumber, generationNumber };
  }
}

const invalidCrossReferenceStream = (operation: PdfOperation): PdfError =>
  new PdfError({
    code: PdfErrorCodeValue.placeholderNotFound,
    retryable: false,
    reason: "Failed to decode PDF cross-reference stream.",
    operation,
  });

const xrefEntriesFromDecodedStream = (
  stream: PdfCrossReferenceStream,
  decoded: Uint8Array,
): ReadonlyMap<number, PdfCrossReferenceEntry> | undefined => {
  if (decoded.byteLength !== stream.expectedLength) return undefined;
  const readField = (offset: number, fieldWidth: number): number | undefined => {
    let value = 0;
    for (let index = 0; index < fieldWidth; index += 1) {
      const byte = decoded[offset + index];
      if (byte === undefined) return undefined;
      value = value * 256 + byte;
      if (!Number.isSafeInteger(value)) return undefined;
    }
    return value;
  };

  const entries = new Map<number, PdfCrossReferenceEntry>();
  let offset = 0;
  for (const [first, count] of stream.ranges) {
    for (let index = 0; index < count; index += 1) {
      const type = stream.widths[0] === 0 ? 1 : readField(offset, stream.widths[0]);
      const firstField = readField(offset + stream.widths[0], stream.widths[1]);
      const secondField = readField(offset + stream.widths[0] + stream.widths[1], stream.widths[2]);
      if (
        type === undefined ||
        firstField === undefined ||
        secondField === undefined ||
        !Number.isSafeInteger(first + index)
      ) {
        return undefined;
      }
      const objectNumber = first + index;
      if (type === 0) {
        entries.set(objectNumber, {
          kind: "free",
          objectNumber,
          generationNumber: secondField,
          inUse: false,
        });
      } else if (type === 1) {
        entries.set(objectNumber, {
          kind: "uncompressed",
          objectNumber,
          generationNumber: secondField,
          offset: firstField,
          inUse: true,
        });
      } else if (type === 2) {
        if (secondField > MAX_OBJECT_STREAM_OBJECTS) return undefined;
        entries.set(objectNumber, {
          kind: "compressed",
          objectNumber,
          generationNumber: 0,
          objectStreamObjectNumber: firstField,
          objectStreamIndex: secondField,
          inUse: true,
        });
      } else {
        return undefined;
      }
      offset += stream.widths[0] + stream.widths[1] + stream.widths[2];
    }
  }
  return entries;
};

const predictedXrefLength = (
  expectedLength: number,
  parameters: PDFDict | undefined,
):
  | {
      readonly maxInflatedLength: number;
      readonly predictor: number;
      readonly colors: number;
      readonly columns: number;
      readonly bitsPerComponent: number;
    }
  | undefined => {
  const predictorValue = parameters?.get(PDF_PREDICTOR_NAME);
  const colorsValue = parameters?.get(PDF_COLORS_NAME);
  const columnsValue = parameters?.get(PDF_COLUMNS_NAME);
  const bitsPerComponentValue = parameters?.get(PDF_BITS_PER_COMPONENT_NAME);
  const predictor = predictorValue instanceof PDFNumber ? predictorValue.asNumber() : 1;
  const colors = colorsValue instanceof PDFNumber ? colorsValue.asNumber() : 1;
  const columns = columnsValue instanceof PDFNumber ? columnsValue.asNumber() : 1;
  const bitsPerComponent =
    bitsPerComponentValue instanceof PDFNumber ? bitsPerComponentValue.asNumber() : 8;
  if (
    !Number.isSafeInteger(predictor) ||
    !Number.isSafeInteger(colors) ||
    !Number.isSafeInteger(columns) ||
    !Number.isSafeInteger(bitsPerComponent) ||
    colors <= 0 ||
    columns <= 0 ||
    ![1, 2, 4, 8, 16].includes(bitsPerComponent)
  ) {
    return undefined;
  }
  if (predictor === 1 || predictor === 2) {
    return {
      maxInflatedLength: expectedLength,
      predictor,
      colors,
      columns,
      bitsPerComponent,
    };
  }
  if (predictor < 10 || predictor > 15) return undefined;
  const rowBits = colors * columns * bitsPerComponent;
  const rowBytes = Math.ceil(rowBits / 8);
  if (
    !Number.isSafeInteger(rowBits) ||
    !Number.isSafeInteger(rowBytes) ||
    rowBytes <= 0 ||
    expectedLength % rowBytes !== 0
  ) {
    return undefined;
  }
  const maxInflatedLength = expectedLength + expectedLength / rowBytes;
  if (!Number.isSafeInteger(maxInflatedLength) || maxInflatedLength > MAX_XREF_STREAM_BYTES) {
    return undefined;
  }
  return {
    maxInflatedLength,
    predictor,
    colors,
    columns,
    bitsPerComponent,
  };
};

const decodeXrefPredictor = (
  input: Uint8Array,
  expectedLength: number,
  configuration: {
    readonly predictor: number;
    readonly colors: number;
    readonly columns: number;
    readonly bitsPerComponent: number;
  },
): Uint8Array | undefined => {
  const { predictor, colors, columns, bitsPerComponent } = configuration;
  if (predictor === 1) return input.byteLength === expectedLength ? input : undefined;
  const rowBits = colors * columns * bitsPerComponent;
  const rowBytes = Math.ceil(rowBits / 8);
  if (!Number.isSafeInteger(rowBytes) || rowBytes <= 0 || expectedLength % rowBytes !== 0) {
    return undefined;
  }
  if (predictor === 2) {
    if (input.byteLength !== expectedLength) return undefined;
    const output = new Uint8Array(input);
    const samplesPerRow = colors * columns;
    const modulo = 2 ** bitsPerComponent;
    for (let row = 0; row < expectedLength / rowBytes; row += 1) {
      const rowBitOffset = row * rowBytes * 8;
      for (let sample = colors; sample < samplesPerRow; sample += 1) {
        const bitOffset = rowBitOffset + sample * bitsPerComponent;
        const previousBitOffset = bitOffset - colors * bitsPerComponent;
        let encoded = 0;
        let previous = 0;
        for (let bit = 0; bit < bitsPerComponent; bit += 1) {
          const byteIndex = Math.floor((bitOffset + bit) / 8);
          const byteBit = 7 - ((bitOffset + bit) % 8);
          const previousByteIndex = Math.floor((previousBitOffset + bit) / 8);
          const previousByteBit = 7 - ((previousBitOffset + bit) % 8);
          encoded = encoded * 2 + (((input[byteIndex] ?? 0) >> byteBit) & 1);
          previous = previous * 2 + (((output[previousByteIndex] ?? 0) >> previousByteBit) & 1);
        }
        const value = (encoded + previous) % modulo;
        for (let bit = 0; bit < bitsPerComponent; bit += 1) {
          const byteIndex = Math.floor((bitOffset + bit) / 8);
          const byteBit = 7 - ((bitOffset + bit) % 8);
          const current = output[byteIndex];
          if (current === undefined) return undefined;
          output[byteIndex] =
            ((value >> (bitsPerComponent - bit - 1)) & 1) === 1
              ? current | (1 << byteBit)
              : current & ~(1 << byteBit);
        }
      }
    }
    return output;
  }
  if (predictor < 10 || predictor > 15) return undefined;
  const rows = expectedLength / rowBytes;
  if (input.byteLength !== expectedLength + rows) return undefined;
  const bytesPerPixel = Math.ceil((colors * bitsPerComponent) / 8);
  if (!Number.isSafeInteger(bytesPerPixel) || bytesPerPixel <= 0) return undefined;
  const output = new Uint8Array(expectedLength);
  let inputOffset = 0;
  for (let row = 0; row < rows; row += 1) {
    const filter = input[inputOffset];
    inputOffset += 1;
    if (filter === undefined || filter > 4 || (predictor !== 15 && filter !== predictor - 10)) {
      return undefined;
    }
    const rowOffset = row * rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      const encoded = input[inputOffset];
      inputOffset += 1;
      if (encoded === undefined) return undefined;
      const left = column >= bytesPerPixel ? (output[rowOffset + column - bytesPerPixel] ?? 0) : 0;
      const above = row > 0 ? (output[rowOffset + column - rowBytes] ?? 0) : 0;
      const upperLeft =
        row > 0 && column >= bytesPerPixel
          ? (output[rowOffset + column - rowBytes - bytesPerPixel] ?? 0)
          : 0;
      const prediction =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : (() => {
                    const estimate = left + above - upperLeft;
                    const leftDistance = Math.abs(estimate - left);
                    const aboveDistance = Math.abs(estimate - above);
                    const upperLeftDistance = Math.abs(estimate - upperLeft);
                    return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
                      ? left
                      : aboveDistance <= upperLeftDistance
                        ? above
                        : upperLeft;
                  })();
      output[rowOffset + column] = (encoded + prediction) & 0xff;
    }
  }
  return output;
};

const xrefStreamEntries = (
  pdf: Uint8Array,
  stream: PdfCrossReferenceStream,
  operation: PdfOperation,
): Effect.Effect<ReadonlyMap<number, PdfCrossReferenceEntry>, PdfError> => {
  const filter = stream.dict.get(PDF_FILTER_NAME);
  const decodeParms = stream.dict.get(PDF_DECODE_PARMS_NAME);
  const isFlateArray =
    filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === PDF_FLATE_DECODE_NAME;
  let parameters: PDFDict | undefined;
  let supported = false;
  if (filter === undefined) {
    supported = decodeParms === undefined;
  } else if (filter === PDF_FLATE_DECODE_NAME) {
    supported =
      decodeParms === undefined ||
      decodeParms instanceof PDFDict ||
      decodeParms.toString() === "null";
    parameters = decodeParms instanceof PDFDict ? decodeParms : undefined;
  } else if (isFlateArray) {
    if (decodeParms === undefined) {
      supported = true;
    } else if (decodeParms instanceof PDFArray && decodeParms.size() === 1) {
      const item = decodeParms.get(0);
      supported = item instanceof PDFDict || item?.toString() === "null";
      parameters = item instanceof PDFDict ? item : undefined;
    }
  }
  if (!supported) return Effect.fail(invalidCrossReferenceStream(operation));
  const configuration = predictedXrefLength(stream.expectedLength, parameters);
  if (configuration === undefined) return Effect.fail(invalidCrossReferenceStream(operation));
  const encoded = pdf.subarray(stream.start, stream.end);
  const decoded =
    filter === undefined
      ? Effect.succeed(encoded)
      : inflateZlibBounded(encoded, configuration.maxInflatedLength).pipe(
          Effect.mapError(() => invalidCrossReferenceStream(operation)),
        );
  return decoded.pipe(
    Effect.flatMap((bytes) => {
      const predicted = decodeXrefPredictor(bytes, stream.expectedLength, configuration);
      const entries =
        predicted === undefined ? undefined : xrefEntriesFromDecodedStream(stream, predicted);
      return entries === undefined
        ? Effect.fail(invalidCrossReferenceStream(operation))
        : Effect.succeed(entries);
    }),
  );
};

const hydratePdfRevisionStructure = (
  pdf: Uint8Array,
  structure: PdfRevisionStructure,
  operation: PdfOperation,
): Effect.Effect<PdfRevisionStructure, PdfError> =>
  Effect.gen(function* () {
    if (structure.resourceLimitExceeded)
      return yield* Effect.fail(invalidCrossReferenceStream(operation));
    const crossReferenceByOffset = new Map(structure.crossReferenceByOffset);
    let entryCount = 0;
    for (const source of crossReferenceByOffset.values()) {
      if (source.kind === "table") entryCount += source.entries.size;
    }
    if (entryCount > MAX_TOTAL_CROSS_REFERENCE_ENTRIES) {
      return yield* Effect.fail(invalidCrossReferenceStream(operation));
    }
    for (const [offset, stream] of structure.xrefStreams) {
      let streamEntryCount = 0;
      for (const [, count] of stream.ranges) streamEntryCount += count;
      if (entryCount + streamEntryCount > MAX_TOTAL_CROSS_REFERENCE_ENTRIES) {
        return yield* Effect.fail(invalidCrossReferenceStream(operation));
      }
      const entries = yield* xrefStreamEntries(pdf, stream, operation);
      entryCount += entries.size;
      const source = crossReferenceByOffset.get(offset);
      if (source === undefined) return yield* Effect.fail(invalidCrossReferenceStream(operation));
      crossReferenceByOffset.set(offset, { ...source, entries });
    }
    for (const source of crossReferenceByOffset.values()) {
      if (source.kind !== "table" || source.supplementalOffset === undefined) continue;
      const supplemental = crossReferenceByOffset.get(source.supplementalOffset);
      if (
        supplemental === undefined ||
        supplemental.kind !== "stream" ||
        supplemental.offset >= source.offset ||
        (supplemental.previousOffset !== undefined &&
          supplemental.previousOffset !== source.previousOffset)
      ) {
        return yield* Effect.fail(invalidCrossReferenceStream(operation));
      }
      const entries = new Map(supplemental.entries);
      for (const [objectNumber, entry] of source.entries) entries.set(objectNumber, entry);
      crossReferenceByOffset.set(source.offset, { ...source, entries });
    }
    return {
      ...structure,
      crossReferences: Array.from(crossReferenceByOffset.values()),
      crossReferenceByOffset,
    };
  });

const effectiveCrossReferenceEntry = (
  structure: PdfRevisionStructure,
  terminal: PdfRevisionTerminal,
  reference: PdfIndirectObjectReference,
): PdfCrossReferenceEntry | undefined => {
  const sources = structure.crossReferenceByOffset;

  const visited = new Set<number>();
  let offset = terminal.crossReferenceOffset;
  while (true) {
    if (visited.has(offset)) return undefined;
    visited.add(offset);
    const source = sources.get(offset);
    if (
      source === undefined ||
      source.offset >= terminal.eofEnd ||
      (source.kind === "table" && !source.hasTrailer)
    ) {
      return undefined;
    }
    const entry = source.entries.get(reference.objectNumber);
    if (entry !== undefined) {
      return entry.inUse && entry.generationNumber === reference.generationNumber
        ? entry
        : undefined;
    }
    const previousOffset = source.previousOffset;
    if (previousOffset === undefined || previousOffset < 0 || previousOffset >= source.offset) {
      return undefined;
    }
    offset = previousOffset;
  }
};

const rootForRevisionTerminal = (
  structure: PdfRevisionStructure,
  terminal: PdfRevisionTerminal,
): PDFObject | undefined => {
  const visited = new Set<number>();
  let offset = terminal.crossReferenceOffset;
  while (true) {
    if (visited.has(offset)) return undefined;
    visited.add(offset);
    const source = structure.crossReferenceByOffset.get(offset);
    if (
      source === undefined ||
      source.offset >= terminal.eofEnd ||
      (source.kind === "table" && !source.hasTrailer)
    ) {
      return undefined;
    }
    if (source.root !== undefined) return source.root;
    const previousOffset = source.previousOffset;
    if (previousOffset === undefined || previousOffset < 0 || previousOffset >= source.offset) {
      return undefined;
    }
    offset = previousOffset;
  }
};

const hasCompleteCrossReferenceChainAtTerminal = (
  structure: PdfRevisionStructure,
  terminal: PdfRevisionTerminal,
): boolean => {
  if (!structure.structurallyValid) return false;
  const sources = structure.crossReferenceByOffset;

  const visited = new Set<number>();
  let offset = terminal.crossReferenceOffset;
  while (true) {
    if (visited.has(offset)) return false;
    visited.add(offset);
    const source = sources.get(offset);
    if (
      source === undefined ||
      source.offset >= terminal.eofEnd ||
      (source.kind === "table" && !source.hasTrailer)
    ) {
      return false;
    }
    const previousOffset = source.previousOffset;
    if (previousOffset === undefined) return true;
    if (previousOffset < 0 || previousOffset >= source.offset) return false;
    offset = previousOffset;
  }
};

const hasCompleteCrossReferenceChain = (
  structure: PdfRevisionStructure,
  pdf: Uint8Array,
): boolean => {
  const terminal = structure.revisionTerminals[structure.revisionTerminals.length - 1];
  return (
    terminal !== undefined &&
    isPdfWhitespaceOnly(pdf, terminal.eofEnd) &&
    hasCompleteCrossReferenceChainAtTerminal(structure, terminal)
  );
};

export const isCompletePdfRevision = (
  pdf: Uint8Array,
  end: number,
): Effect.Effect<boolean, PdfError> => {
  if (!Number.isSafeInteger(end) || end <= 0 || end > pdf.byteLength) {
    return Effect.succeed(false);
  }
  const prefix = pdf.subarray(0, end);
  return indirectNumberValues(prefix, PdfOperationValue.verify).pipe(
    Effect.flatMap((numbers) =>
      Effect.try({
        try: () => new PdfRevisionParser(prefix, numbers).scan(),
        catch: () =>
          new PdfError({
            code: PdfErrorCodeValue.invalidPdf,
            retryable: false,
            reason: "Failed to parse PDF revision structure.",
            operation: PdfOperationValue.verify,
          }),
      }),
    ),
    Effect.flatMap((structure) => {
      if (!hasCompleteCrossReferenceChain(structure, prefix)) return Effect.succeed(false);
      return Effect.tryPromise({
        try: () =>
          PDFDocument.load(prefix, {
            ignoreEncryption: true,
            throwOnInvalidObject: true,
            updateMetadata: false,
          }),
        catch: () =>
          new PdfError({
            code: PdfErrorCodeValue.invalidPdf,
            retryable: false,
            reason: "Failed to load PDF revision.",
            operation: PdfOperationValue.verify,
          }),
      }).pipe(
        Effect.map(() => true),
        Effect.catch(() => Effect.succeed(false)),
      );
    }),
    Effect.catch(() => Effect.succeed(false)),
  );
};

const indirectNumberValues = (
  pdf: Uint8Array,
  operation: PdfOperation,
): Effect.Effect<ReadonlyMap<string, number>, PdfError> =>
  Effect.tryPromise({
    try: () =>
      PDFDocument.load(pdf, {
        ignoreEncryption: true,
        throwOnInvalidObject: true,
        updateMetadata: false,
      }),
    catch: () =>
      new PdfError({
        code: PdfErrorCodeValue.placeholderNotFound,
        retryable: false,
        reason: "Failed to resolve indirect PDF stream lengths.",
        operation,
      }),
  }).pipe(
    Effect.flatMap((pdfDocument) =>
      Effect.try({
        try: () => {
          const numbers = new Map<string, number>();
          for (const [reference, object] of pdfDocument.context.enumerateIndirectObjects()) {
            if (object instanceof PDFNumber) {
              if (numbers.size >= MAX_PDF_INDIRECT_NUMBER_VALUES) return undefined;
              numbers.set(
                `${reference.objectNumber}:${reference.generationNumber}`,
                object.asNumber(),
              );
            }
          }
          return numbers;
        },
        catch: () =>
          new PdfError({
            code: PdfErrorCodeValue.placeholderNotFound,
            retryable: false,
            reason: "Failed to read indirect PDF stream lengths.",
            operation,
          }),
      }).pipe(
        Effect.flatMap((numbers) =>
          numbers === undefined
            ? Effect.fail(
                new PdfError({
                  code: PdfErrorCodeValue.placeholderNotFound,
                  retryable: false,
                  reason: "Exceeded the indirect PDF stream-length budget.",
                  operation,
                }),
              )
            : Effect.succeed(numbers),
        ),
      ),
    ),
  );

const revisionNumberValues = (
  pdf: Uint8Array,
  operation: PdfOperation,
): Effect.Effect<ReadonlyArray<PdfRevisionNumberValues>, PdfError> => {
  const parsed = Result.try(() => new PdfRevisionParser(pdf).scan());
  if (
    Result.isFailure(parsed) ||
    parsed.success.resourceLimitExceeded ||
    parsed.success.revisionTerminals.length === 0
  ) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.placeholderNotFound,
        retryable: false,
        reason: "Failed to locate bounded PDF revision stream lengths.",
        operation,
      }),
    );
  }
  return Effect.forEach(
    parsed.success.revisionTerminals,
    (terminal) =>
      indirectNumberValues(pdf.subarray(0, terminal.eofEnd), operation).pipe(
        Effect.map((numbers) => ({ eofEnd: terminal.eofEnd, numbers })),
      ),
    { concurrency: 1 },
  );
};

const parsePdfSignatureDictionaryResult = (
  pdf: Uint8Array,
  operation: PdfOperation,
): Effect.Effect<PdfSignatureDictionaryParseResult, PdfError> => {
  const initial = Result.try(() => new PdfSignatureDictionaryParser(pdf).scan());
  if (
    Result.isSuccess(initial) &&
    !initial.success.streamParsingFailed &&
    !initial.success.streamParsingUncertain
  ) {
    return Effect.succeed(initial.success);
  }
  return revisionNumberValues(pdf, operation).pipe(
    Effect.flatMap((numbers) =>
      Effect.try({
        try: () => new PdfSignatureDictionaryParser(pdf, new Map(), numbers).scan(),
        catch: () =>
          new PdfError({
            code: PdfErrorCodeValue.placeholderNotFound,
            retryable: false,
            reason: "Failed to parse PDF signature dictionaries.",
            operation,
          }),
      }),
    ),
  );
};

const parsePdfSignatureDictionaries = (
  pdf: Uint8Array,
  operation: PdfOperation,
): Effect.Effect<ReadonlyArray<PdfSignatureDictionary>, PdfError> =>
  parsePdfSignatureDictionaryResult(pdf, operation).pipe(
    Effect.flatMap((parsed) =>
      parsed.streamParsingFailed || parsed.streamParsingUncertain
        ? Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.placeholderNotFound,
              retryable: false,
              reason: "Failed to locate the end of a PDF stream.",
              operation,
            }),
          )
        : Effect.succeed(parsed.dictionaries),
    ),
  );

const pdfReferenceKey = (reference: PdfIndirectObjectReference | PDFRef): string =>
  `${reference.objectNumber}:${reference.generationNumber}`;

const revisionTerminalForByteRange = (
  pdf: Uint8Array,
  structure: PdfRevisionStructure,
  rangeEnd: number,
): PdfRevisionTerminal | undefined => {
  let terminal: PdfRevisionTerminal | undefined;
  for (const candidate of structure.revisionTerminals) {
    if (
      candidate.eofEnd > rangeEnd ||
      !hasCompleteCrossReferenceChainAtTerminal(structure, candidate)
    ) {
      continue;
    }
    let whitespaceOnly = true;
    for (let offset = candidate.eofEnd; offset < rangeEnd; offset += 1) {
      if (!isPdfWhitespaceByte(pdf[offset])) {
        whitespaceOnly = false;
        break;
      }
    }
    if (whitespaceOnly && (terminal === undefined || candidate.eofEnd > terminal.eofEnd)) {
      terminal = candidate;
    }
  }
  return terminal;
};

const MAX_SIGNATURE_FIELD_TRAVERSAL_DEPTH = 64;
const MAX_SIGNATURE_FIELD_TRAVERSAL_NODES = 10_000;
const MAX_OBJECT_STREAM_DECOMPRESSION_BYTES = 64 * 1024 * 1024;

const invalidObjectStream = (operation: PdfOperation): PdfError =>
  new PdfError({
    code: PdfErrorCodeValue.placeholderNotFound,
    retryable: false,
    reason: "Failed to resolve a compressed PDF object.",
    operation,
  });

const parseObjectStreamReferences = (
  bytes: Uint8Array,
  first: number,
  count: number,
): ReadonlyArray<readonly [number, number]> | undefined => {
  let offset = 0;
  const values: Array<number> = [];
  while (values.length < count * 2) {
    while (isPdfWhitespaceByte(bytes[offset])) offset += 1;
    if (bytes[offset] === 0x25) {
      while (offset < first && bytes[offset] !== 0x0a && bytes[offset] !== 0x0d) offset += 1;
      continue;
    }
    if (offset >= first || !isPdfDigit(bytes[offset])) return undefined;
    let value = 0;
    while (isPdfDigit(bytes[offset])) {
      value = value * 10 + (bytes[offset] ?? 0) - 0x30;
      if (!Number.isSafeInteger(value)) return undefined;
      offset += 1;
    }
    values.push(value);
  }
  while (offset < first && isPdfWhitespaceByte(bytes[offset])) offset += 1;
  if (offset !== first) return undefined;
  const references: Array<readonly [number, number]> = [];
  const numbers = new Set<number>();
  let previousOffset = -1;
  for (let index = 0; index < values.length; index += 2) {
    const objectNumber = values[index];
    const objectOffset = values[index + 1];
    if (
      objectNumber === undefined ||
      objectOffset === undefined ||
      !Number.isSafeInteger(objectNumber) ||
      !Number.isSafeInteger(objectOffset) ||
      objectNumber < 0 ||
      objectOffset < 0 ||
      objectOffset <= previousOffset ||
      numbers.has(objectNumber)
    ) {
      return undefined;
    }
    numbers.add(objectNumber);
    previousOffset = objectOffset;
    references.push([objectNumber, objectOffset]);
  }
  return references;
};

type PdfDecodedObjectStream = {
  readonly objectNumber: number;
  readonly bytes: Uint8Array;
  readonly first: number;
  readonly references: ReadonlyArray<readonly [number, number]>;
};

class PdfRevisionObjectResolver {
  private readonly definitionsByOffset = new Map<number, PdfIndirectObjectDefinition>();
  private readonly resolvedObjects = new Map<string, PDFObject>();
  private decodedObjectStream: PdfDecodedObjectStream | undefined;
  private compressedObjectResolutions = 0;
  private decompressedBytes = 0;

  constructor(
    private readonly pdf: Uint8Array,
    private readonly structure: PdfRevisionStructure,
    private readonly terminal: PdfRevisionTerminal,
    definitions: ReadonlyArray<PdfIndirectObjectDefinition>,
    private readonly operation: PdfOperation,
  ) {
    for (const definition of definitions) {
      if (!this.definitionsByOffset.has(definition.objectStart)) {
        this.definitionsByOffset.set(definition.objectStart, definition);
      }
    }
  }

  resolve(value: PDFObject | undefined): Effect.Effect<PDFObject | undefined, PdfError> {
    if (!(value instanceof PDFRef)) return Effect.succeed(value);
    const key = pdfReferenceKey(value);
    const resolved = this.resolvedObjects.get(key);
    if (resolved !== undefined) return Effect.succeed(resolved);
    const entry = effectiveCrossReferenceEntry(this.structure, this.terminal, value);
    if (entry === undefined) return Effect.succeed(undefined);
    if (entry.kind === "uncompressed") {
      const definition = this.definitionsByOffset.get(entry.offset);
      if (
        definition === undefined ||
        definition.objectStart >= this.terminal.eofEnd ||
        definition.reference.objectNumber !== value.objectNumber ||
        definition.reference.generationNumber !== value.generationNumber
      ) {
        return Effect.succeed(undefined);
      }
      this.resolvedObjects.set(key, definition.object);
      return Effect.succeed(definition.object);
    }
    if (entry.kind === "free") return Effect.succeed(undefined);
    return this.resolveCompressed(value, entry);
  }

  private resolveCompressed(
    reference: PDFRef,
    entry: Extract<PdfCrossReferenceEntry, { readonly kind: "compressed" }>,
  ): Effect.Effect<PDFObject | undefined, PdfError> {
    if (this.compressedObjectResolutions >= MAX_OBJECT_STREAM_RESOLUTIONS) {
      return Effect.fail(invalidObjectStream(this.operation));
    }
    const cached = this.decodedObjectStream;
    const decoded =
      cached !== undefined && cached.objectNumber === entry.objectStreamObjectNumber
        ? Effect.succeed(cached)
        : this.decodeObjectStream(entry.objectStreamObjectNumber);
    return decoded.pipe(
      Effect.flatMap((stream) => {
        const item = stream.references[entry.objectStreamIndex];
        if (item === undefined || item[0] !== reference.objectNumber) {
          return Effect.fail(invalidObjectStream(this.operation));
        }
        const next = stream.references[entry.objectStreamIndex + 1];
        const start = stream.first + item[1];
        const end = next === undefined ? stream.bytes.byteLength : stream.first + next[1];
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < stream.first ||
          end <= start ||
          end > stream.bytes.byteLength
        ) {
          return Effect.fail(invalidObjectStream(this.operation));
        }
        const parsed = Result.try(() =>
          new PdfObjectValueParser(stream.bytes.subarray(start, end)).parseValue(),
        );
        if (Result.isFailure(parsed)) return Effect.fail(invalidObjectStream(this.operation));
        this.compressedObjectResolutions += 1;
        this.resolvedObjects.set(pdfReferenceKey(reference), parsed.success);
        return Effect.succeed(parsed.success);
      }),
    );
  }

  private decodeObjectStream(
    objectNumber: number,
  ): Effect.Effect<PdfDecodedObjectStream, PdfError> {
    const entry = effectiveCrossReferenceEntry(this.structure, this.terminal, {
      objectNumber,
      generationNumber: 0,
    });
    if (entry === undefined || entry.kind !== "uncompressed") {
      return Effect.fail(invalidObjectStream(this.operation));
    }
    const definition = this.definitionsByOffset.get(entry.offset);
    const stream = definition?.stream;
    if (
      definition === undefined ||
      definition.reference.objectNumber !== objectNumber ||
      definition.reference.generationNumber !== 0 ||
      !(definition.object instanceof PDFDict) ||
      definition.object.get(PDF_TYPE_NAME) !== PDF_OBJECT_STREAM_TYPE_NAME ||
      stream === undefined ||
      stream.start < 0 ||
      stream.end < stream.start ||
      stream.end > this.pdf.byteLength ||
      stream.end - stream.start > MAX_OBJECT_STREAM_BYTES
    ) {
      return Effect.fail(invalidObjectStream(this.operation));
    }
    const count = definition.object.get(PDF_OBJECT_STREAM_COUNT_NAME);
    const first = definition.object.get(PDF_OBJECT_STREAM_FIRST_NAME);
    if (
      !(count instanceof PDFNumber) ||
      !(first instanceof PDFNumber) ||
      !Number.isSafeInteger(count.asNumber()) ||
      !Number.isSafeInteger(first.asNumber()) ||
      count.asNumber() < 0 ||
      count.asNumber() > MAX_OBJECT_STREAM_OBJECTS ||
      first.asNumber() < 0 ||
      first.asNumber() > MAX_OBJECT_STREAM_BYTES
    ) {
      return Effect.fail(invalidObjectStream(this.operation));
    }
    const filter = stream.dict.get(PDF_FILTER_NAME);
    const decodeParms = stream.dict.get(PDF_DECODE_PARMS_NAME);
    const hasFlateFilter =
      filter === PDF_FLATE_DECODE_NAME ||
      (filter instanceof PDFArray &&
        filter.size() === 1 &&
        filter.get(0) === PDF_FLATE_DECODE_NAME);
    if (
      (filter === undefined && decodeParms !== undefined) ||
      (filter !== undefined && (!hasFlateFilter || decodeParms !== undefined))
    ) {
      return Effect.fail(invalidObjectStream(this.operation));
    }
    const encoded = this.pdf.subarray(stream.start, stream.end);
    const decoded =
      filter === undefined
        ? Effect.succeed(encoded)
        : inflateZlibBounded(encoded, MAX_OBJECT_STREAM_BYTES).pipe(
            Effect.mapError(() => invalidObjectStream(this.operation)),
          );
    return decoded.pipe(
      Effect.flatMap((bytes) => {
        if (
          bytes.byteLength > MAX_OBJECT_STREAM_BYTES ||
          this.decompressedBytes + bytes.byteLength > MAX_OBJECT_STREAM_DECOMPRESSION_BYTES ||
          first.asNumber() > bytes.byteLength
        ) {
          return Effect.fail(invalidObjectStream(this.operation));
        }
        const references = parseObjectStreamReferences(bytes, first.asNumber(), count.asNumber());
        if (references === undefined) return Effect.fail(invalidObjectStream(this.operation));
        const decodedStream: PdfDecodedObjectStream = {
          objectNumber,
          bytes,
          first: first.asNumber(),
          references,
        };
        this.decompressedBytes += bytes.byteLength;
        this.decodedObjectStream = decodedStream;
        return Effect.succeed(decodedStream);
      }),
    );
  }
}

const exhaustedSignatureReachability = (operation: PdfOperation): PdfError =>
  new PdfError({
    code: PdfErrorCodeValue.placeholderNotFound,
    retryable: false,
    reason: "Exceeded the PDF signature revision traversal budget.",
    operation,
  });
type PdfSignatureTraversalBudget = {
  remaining: number;
};

const reachableSignatureReferences = (
  pdf: Uint8Array,
  structure: PdfRevisionStructure,
  terminal: PdfRevisionTerminal,
  definitions: ReadonlyArray<PdfIndirectObjectDefinition>,
  operation: PdfOperation,
  budget: PdfSignatureTraversalBudget,
): Effect.Effect<ReadonlySet<string>, PdfError> =>
  Effect.gen(function* () {
    const resolver = new PdfRevisionObjectResolver(
      pdf,
      structure,
      terminal,
      definitions,
      operation,
    );
    const reachable = new Set<string>();
    const visitedFields = new Set<string>();
    let traversedNodes = 0;

    const consumeWork = (): Effect.Effect<void, PdfError> => {
      if (budget.remaining <= 0) return Effect.fail(exhaustedSignatureReachability(operation));
      budget.remaining -= 1;
      return Effect.void;
    };

    const inheritsSignatureType = (
      value: PDFObject | undefined,
      visitedParents: ReadonlySet<string>,
      depth: number,
    ): Effect.Effect<boolean, PdfError> => {
      if (depth > MAX_SIGNATURE_FIELD_TRAVERSAL_DEPTH) {
        return Effect.fail(exhaustedSignatureReachability(operation));
      }
      return consumeWork().pipe(
        Effect.flatMap(() => {
          if (value instanceof PDFRef) {
            const key = pdfReferenceKey(value);
            if (visitedParents.has(key)) return Effect.succeed(false);
            return resolver.resolve(value).pipe(
              Effect.flatMap((field) => {
                if (!(field instanceof PDFDict)) return Effect.succeed(false);
                const fieldType = field.get(PDF_FIELD_TYPE_NAME);
                if (fieldType === PDF_SIGNATURE_TYPE_NAME) return Effect.succeed(true);
                if (fieldType !== undefined) return Effect.succeed(false);
                const parents = new Set(visitedParents);
                parents.add(key);
                return inheritsSignatureType(field.get(PDF_FIELD_PARENT_NAME), parents, depth + 1);
              }),
            );
          }
          if (!(value instanceof PDFDict)) return Effect.succeed(false);
          const fieldType = value.get(PDF_FIELD_TYPE_NAME);
          if (fieldType === PDF_SIGNATURE_TYPE_NAME) return Effect.succeed(true);
          if (fieldType !== undefined) return Effect.succeed(false);
          return inheritsSignatureType(value.get(PDF_FIELD_PARENT_NAME), visitedParents, depth + 1);
        }),
      );
    };

    const visitField = (
      value: PDFObject | undefined,
      inheritedSignatureField: boolean,
      depth: number,
    ): Effect.Effect<void, PdfError> => {
      if (value === undefined) return Effect.void;
      if (depth > MAX_SIGNATURE_FIELD_TRAVERSAL_DEPTH) {
        return Effect.fail(exhaustedSignatureReachability(operation));
      }
      if (value instanceof PDFRef) {
        const key = pdfReferenceKey(value);
        if (visitedFields.has(key)) return Effect.void;
        visitedFields.add(key);
      }
      return consumeWork().pipe(
        Effect.flatMap(() =>
          resolver.resolve(value).pipe(
            Effect.flatMap((field) => {
              if (!(field instanceof PDFDict)) return Effect.void;
              traversedNodes += 1;
              if (traversedNodes > MAX_SIGNATURE_FIELD_TRAVERSAL_NODES) {
                return Effect.fail(exhaustedSignatureReachability(operation));
              }
              const fieldType = field.get(PDF_FIELD_TYPE_NAME);
              const signatureField =
                fieldType === PDF_SIGNATURE_TYPE_NAME
                  ? Effect.succeed(true)
                  : fieldType !== undefined
                    ? Effect.succeed(false)
                    : inheritedSignatureField
                      ? Effect.succeed(true)
                      : inheritsSignatureType(
                          field.get(PDF_FIELD_PARENT_NAME),
                          new Set(),
                          depth + 1,
                        );
              return signatureField.pipe(
                Effect.flatMap((isSignatureField) => {
                  const signature = field.get(PDF_FIELD_VALUE_NAME);
                  const recordSignature =
                    isSignatureField && signature instanceof PDFRef
                      ? resolver.resolve(signature).pipe(
                          Effect.map((resolved) => {
                            if (resolved !== undefined) reachable.add(pdfReferenceKey(signature));
                          }),
                        )
                      : Effect.void;
                  return recordSignature.pipe(
                    Effect.flatMap(() =>
                      resolver.resolve(field.get(PDF_FIELD_KIDS_NAME)).pipe(
                        Effect.flatMap((kids) => {
                          if (!(kids instanceof PDFArray)) return Effect.void;
                          const visitKids = (index: number): Effect.Effect<void, PdfError> => {
                            if (index >= kids.size()) return Effect.void;
                            return visitField(kids.get(index), isSignatureField, depth + 1).pipe(
                              Effect.flatMap(() => visitKids(index + 1)),
                            );
                          };
                          return visitKids(0);
                        }),
                      ),
                    ),
                  );
                }),
              );
            }),
          ),
        ),
      );
    };

    const root = yield* resolver.resolve(rootForRevisionTerminal(structure, terminal));
    if (!(root instanceof PDFDict)) return reachable;
    const acroForm = yield* resolver.resolve(root.get(PDF_ACRO_FORM_NAME));
    if (!(acroForm instanceof PDFDict)) return reachable;
    const fields = yield* resolver.resolve(acroForm.get(PDF_ACRO_FORM_FIELDS_NAME));
    if (!(fields instanceof PDFArray)) return reachable;
    for (let index = 0; index < fields.size(); index += 1) {
      yield* visitField(fields.get(index), false, 0);
    }
    return reachable;
  });

const verificationSignatureDictionaries = (
  pdf: Uint8Array,
  operation: PdfOperation,
): Effect.Effect<ReadonlyArray<PdfSignatureDictionary>, PdfError> =>
  Effect.gen(function* () {
    const parsed = yield* parsePdfSignatureDictionaryResult(pdf, operation);
    if (parsed.streamParsingFailed || parsed.streamParsingUncertain) {
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.placeholderNotFound,
          retryable: false,
          reason: "Failed to locate the end of a PDF stream.",
          operation,
        }),
      );
    }
    if (parsed.resourceLimitExceeded) {
      return yield* Effect.fail(exhaustedSignatureReachability(operation));
    }
    if (parsed.dictionaries.length === 0) return parsed.dictionaries;

    const parsedStructure = yield* Effect.try({
      try: () =>
        new PdfRevisionParser(pdf, parsed.indirectNumbers, parsed.revisionNumberValues).scan(),
      catch: () =>
        new PdfError({
          code: PdfErrorCodeValue.placeholderNotFound,
          retryable: false,
          reason: "Failed to parse PDF revision structure.",
          operation,
        }),
    });
    const structure = yield* hydratePdfRevisionStructure(pdf, parsedStructure, operation);
    const candidatesByRevision = new Map<
      number,
      {
        readonly terminal: PdfRevisionTerminal;
        readonly dictionaries: Array<PdfSignatureDictionary>;
      }
    >();
    const invalidByteRangeCandidates: Array<PdfSignatureDictionary> = [];
    const finalTerminal = revisionTerminalForByteRange(pdf, structure, pdf.byteLength);

    for (const dictionary of parsed.dictionaries) {
      const byteRange =
        dictionary.byteRange === undefined ? undefined : byteRangeValue(dictionary.byteRange);
      const rangeEnd = byteRange === undefined ? undefined : byteRange[2] + byteRange[3];
      const terminal =
        rangeEnd === undefined || !Number.isSafeInteger(rangeEnd) || rangeEnd > pdf.byteLength
          ? undefined
          : revisionTerminalForByteRange(pdf, structure, rangeEnd);
      if (terminal !== undefined && rangeEnd !== undefined) {
        const activeEntry = effectiveCrossReferenceEntry(structure, terminal, dictionary.reference);
        if (activeEntry?.kind !== "uncompressed" || activeEntry.offset !== dictionary.objectStart) {
          continue;
        }
        const candidate = candidatesByRevision.get(terminal.eofEnd);
        if (candidate === undefined) {
          candidatesByRevision.set(terminal.eofEnd, {
            terminal,
            dictionaries: [dictionary],
          });
        } else {
          candidate.dictionaries.push(dictionary);
        }
        continue;
      }
      const finalEntry =
        finalTerminal === undefined
          ? undefined
          : effectiveCrossReferenceEntry(structure, finalTerminal, dictionary.reference);
      if (finalEntry?.kind === "uncompressed" && finalEntry.offset === dictionary.objectStart) {
        invalidByteRangeCandidates.push(dictionary);
      }
    }

    const reachable: Array<PdfSignatureDictionary> = [];
    const budget = { remaining: MAX_PDF_SIGNATURE_REVISION_WORK };
    for (const candidate of candidatesByRevision.values()) {
      const revisionReachable = yield* reachableSignatureReferences(
        pdf,
        structure,
        candidate.terminal,
        parsed.indirectObjectDefinitions,
        operation,
        budget,
      );
      for (const dictionary of candidate.dictionaries) {
        if (revisionReachable.has(pdfReferenceKey(dictionary.reference))) {
          reachable.push(dictionary);
        }
      }
    }
    if (finalTerminal !== undefined && invalidByteRangeCandidates.length > 0) {
      const finalReachable = yield* reachableSignatureReferences(
        pdf,
        structure,
        finalTerminal,
        parsed.indirectObjectDefinitions,
        operation,
        budget,
      );
      for (const dictionary of invalidByteRangeCandidates) {
        if (finalReachable.has(pdfReferenceKey(dictionary.reference))) {
          return yield* Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.placeholderNotFound,
              retryable: false,
              reason: "A reachable signature dictionary has an invalid /ByteRange.",
              operation,
            }),
          );
        }
      }
    }
    return reachable;
  });

const signatureDictionaryAtOffset = (
  pdf: Uint8Array,
  byteRangeStart: number,
  operation: PdfOperation,
): Effect.Effect<PdfRegularSignatureDictionaryWithByteRange, PdfError> =>
  verificationSignatureDictionaries(pdf, operation).pipe(
    Effect.flatMap((dictionaries) => {
      const dictionary = dictionaries.find(
        (candidate) =>
          candidate.byteRange?.keyStart === byteRangeStart &&
          isRegularSignatureWithByteRange(candidate),
      );
      if (dictionary === undefined || !isRegularSignatureWithByteRange(dictionary)) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.placeholderNotFound,
            retryable: false,
            reason: "Failed to locate /ByteRange.",
            operation,
          }),
        );
      }
      return Effect.succeed(dictionary);
    }),
  );

export const hasPdfSignatureDictionary = (pdf: Uint8Array): boolean => {
  const parsed = Result.try(() => new PdfSignatureDictionaryParser(pdf).scan());
  return (
    !Result.isSuccess(parsed) ||
    parsed.success.streamParsingFailed ||
    parsed.success.streamParsingUncertain ||
    parsed.success.dictionaries.length > 0
  );
};

export const hasPdfByteRange = (pdf: Uint8Array): boolean => {
  const parsed = Result.try(() => new PdfSignatureDictionaryParser(pdf).scan());
  return (
    !Result.isSuccess(parsed) ||
    parsed.success.streamParsingFailed ||
    parsed.success.streamParsingUncertain ||
    parsed.success.dictionaries.some(hasSignatureByteRange)
  );
};

export const hasPdfSignatureDictionaryEffect = (
  pdf: Uint8Array,
): Effect.Effect<boolean, PdfError> =>
  parsePdfSignatureDictionaryResult(pdf, PdfOperationValue.mergeDocuments).pipe(
    Effect.flatMap((parsed) =>
      parsed.streamParsingFailed || parsed.streamParsingUncertain
        ? Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.placeholderNotFound,
              retryable: false,
              reason: "Failed to locate the end of a PDF stream.",
              operation: PdfOperationValue.mergeDocuments,
            }),
          )
        : Effect.succeed(parsed.dictionaries.length > 0),
    ),
  );

export const findPdfByteRangeOffsets = (
  pdf: Uint8Array,
): Effect.Effect<ReadonlyArray<number>, PdfError> =>
  parsePdfSignatureDictionaries(pdf, PdfOperationValue.verify).pipe(
    Effect.flatMap((dictionaries) => {
      const signatures = dictionaries.filter(isRegularSignatureWithByteRange);
      return signatures.length === 0
        ? Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.placeholderNotFound,
              retryable: false,
              reason: "Failed to locate /ByteRange.",
              operation: PdfOperationValue.verify,
            }),
          )
        : Effect.succeed(signatures.map((dictionary) => dictionary.byteRange.keyStart));
    }),
  );

const byteRangeValue = (field: PdfDictionaryField): PdfByteRange | undefined => {
  if (!(field.value instanceof PDFArray) || field.value.size() !== 4) return undefined;
  const first = field.value.get(0);
  const second = field.value.get(1);
  const third = field.value.get(2);
  const fourth = field.value.get(3);
  if (
    !(first instanceof PDFNumber) ||
    !(second instanceof PDFNumber) ||
    !(third instanceof PDFNumber) ||
    !(fourth instanceof PDFNumber)
  ) {
    return undefined;
  }
  const byteRange: PdfByteRange = [
    first.asNumber(),
    second.asNumber(),
    third.asNumber(),
    fourth.asNumber(),
  ];
  return byteRange.every((value) => Number.isSafeInteger(value) && value >= 0)
    ? byteRange
    : undefined;
};

const isUnsignedPlaceholder = (
  pdf: Uint8Array,
  signature: PdfRegularSignatureDictionaryWithByteRange,
): boolean => {
  const value = signature.byteRange.value;
  if (!(value instanceof PDFArray) || value.size() !== 4) return false;
  const first = value.get(0);
  const second = value.get(1);
  const third = value.get(2);
  const fourth = value.get(3);
  if (
    !(first instanceof PDFNumber) ||
    first.asNumber() !== 0 ||
    second !== PDF_BYTE_RANGE_PLACEHOLDER_NAME ||
    third !== PDF_BYTE_RANGE_PLACEHOLDER_NAME ||
    fourth !== PDF_BYTE_RANGE_PLACEHOLDER_NAME
  ) {
    return false;
  }
  const contents = signature.contents;
  if (contents === undefined) return false;
  const contentsEnd = contents.valueEnd - 1;
  if (
    contents.valueStart < 0 ||
    contentsEnd <= contents.valueStart ||
    pdf[contents.valueStart] !== LEFT_ANGLE ||
    pdf[contentsEnd] !== RIGHT_ANGLE
  ) {
    return false;
  }
  for (let offset = contents.valueStart + 1; offset < contentsEnd; offset += 1) {
    const byte = pdf[offset];
    if (byte !== 0x30 && !isPdfWhitespaceByte(byte)) return false;
  }
  return true;
};

const parseByteRange = (field: PdfDictionaryField): Effect.Effect<PdfByteRange, PdfError> => {
  const byteRange = byteRangeValue(field);
  return byteRange === undefined
    ? Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.placeholderNotFound,
          retryable: false,
          reason: "Failed to parse /ByteRange values.",
          operation: PdfOperationValue.verify,
        }),
      )
    : Effect.succeed(byteRange);
};

export const preparePdfByteRange = (
  pdf: Uint8Array,
): Effect.Effect<PreparedPdfSignature, PdfError> =>
  Effect.gen(function* () {
    const dictionaries = yield* parsePdfSignatureDictionaries(pdf, PdfOperationValue.sign);
    const signatures = dictionaries.filter(isRegularSignatureWithByteRange);
    let signature: PdfRegularSignatureDictionaryWithByteRange | undefined;
    for (let index = signatures.length - 1; index >= 0; index -= 1) {
      const candidate = signatures[index];
      if (candidate !== undefined && isUnsignedPlaceholder(pdf, candidate)) {
        signature = candidate;
        break;
      }
    }
    if (signature === undefined) {
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.placeholderNotFound,
          retryable: false,
          reason: "No /ByteRange placeholder found.",
          operation: PdfOperationValue.sign,
        }),
      );
    }

    const contents = signature.contents;
    if (contents === undefined) {
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.placeholderNotFound,
          retryable: false,
          reason: "No /Contents placeholder found.",
          operation: PdfOperationValue.sign,
        }),
      );
    }

    const contentsStart = contents.valueStart;
    const contentsEnd = contents.valueEnd - 1;
    if (
      contentsStart < 0 ||
      contentsEnd <= contentsStart ||
      pdf[contentsStart] !== LEFT_ANGLE ||
      pdf[contentsEnd] !== RIGHT_ANGLE
    ) {
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.placeholderNotFound,
          retryable: false,
          reason: "Malformed /Contents placeholder.",
          operation: PdfOperationValue.sign,
        }),
      );
    }

    const byteRange: PdfByteRange = [
      0,
      contentsStart,
      contentsEnd + 1,
      pdf.byteLength - (contentsEnd + 1),
    ];
    const actualByteRange = concatBytes([
      pdf.subarray(signature.byteRange.keyStart, signature.byteRange.valueStart),
      encodeAscii(`[${byteRange.join(" ")}]`),
    ]);
    const byteRangeLength = signature.byteRange.valueEnd - signature.byteRange.keyStart;
    if (actualByteRange.byteLength > byteRangeLength) {
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.placeholderNotFound,
          retryable: false,
          reason: "The /ByteRange placeholder is too small.",
          operation: PdfOperationValue.sign,
        }),
      );
    }

    const paddedByteRange = new Uint8Array(byteRangeLength);
    paddedByteRange.fill(0x20);
    paddedByteRange.set(actualByteRange);
    const withByteRange = replaceRange(
      pdf,
      signature.byteRange.keyStart,
      signature.byteRange.valueEnd,
      paddedByteRange,
    );
    const signedData = concatBytes([
      withByteRange.subarray(byteRange[0], byteRange[0] + byteRange[1]),
      withByteRange.subarray(byteRange[2], byteRange[2] + byteRange[3]),
    ]);

    return {
      pdf: withByteRange,
      byteRange,
      signedData,
      contentsStart,
      contentsEnd,
      placeholderLength: contentsEnd - contentsStart - 1,
    };
  });

const derSequenceTotalLength = (bytes: Uint8Array): number | undefined => {
  if (bytes.byteLength < 2 || bytes[0] !== 0x30) return undefined;
  const firstLengthByte = bytes[1] ?? 0;
  if (firstLengthByte < 0x80) return 2 + firstLengthByte;
  const lengthByteCount = firstLengthByte & 0x7f;
  if (lengthByteCount === 0 || lengthByteCount > 4 || bytes.byteLength < 2 + lengthByteCount) {
    return undefined;
  }
  let contentLength = 0;
  for (let index = 0; index < lengthByteCount; index += 1) {
    contentLength = contentLength * 256 + (bytes[2 + index] ?? 0);
  }
  const total = 2 + lengthByteCount + contentLength;
  return total <= bytes.byteLength ? total : undefined;
};

const hexNibble = (code: number): number | undefined => {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return undefined;
};

const decodeSignatureHex = (
  pdf: Uint8Array,
  start: number,
  end: number,
): Effect.Effect<Uint8Array, PdfError> => {
  let hexLength = 0;
  for (let index = start; index < end; index += 1) {
    const code = pdf[index];
    if (code === undefined) continue;
    if (hexNibble(code) !== undefined) {
      hexLength += 1;
    } else if (!isPdfWhitespaceByte(code)) {
      return Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.placeholderNotFound,
          retryable: false,
          reason: "Malformed signature /Contents hex.",
          operation: PdfOperationValue.verify,
        }),
      );
    }
  }
  const byteLength = Math.ceil(hexLength / 2);
  if (byteLength > MAX_PDF_SIGNATURE_BYTES) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.placeholderNotFound,
        retryable: false,
        reason: "Signature /Contents exceeds supported capacity.",
        operation: PdfOperationValue.verify,
      }),
    );
  }

  const bytes = new Uint8Array(byteLength);
  let outputIndex = 0;
  let highNibble: number | undefined;
  for (let index = start; index < end; index += 1) {
    const code = pdf[index];
    if (code === undefined || isPdfWhitespaceByte(code)) continue;
    const nibble = hexNibble(code);
    if (nibble === undefined) {
      return Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.placeholderNotFound,
          retryable: false,
          reason: "Malformed signature /Contents hex.",
          operation: PdfOperationValue.verify,
        }),
      );
    }
    if (highNibble === undefined) {
      highNibble = nibble;
    } else {
      bytes[outputIndex] = (highNibble << 4) | nibble;
      outputIndex += 1;
      highNibble = undefined;
    }
  }
  if (highNibble !== undefined) bytes[outputIndex] = highNibble << 4;
  return Effect.succeed(bytes);
};

const hasOnlyZeroBytesFrom = (bytes: Uint8Array, offset: number): boolean => {
  for (let index = offset; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
};

const trimTrailingZeroBytes = (bytes: Uint8Array): Uint8Array => {
  let end = bytes.byteLength;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return bytes.subarray(0, end);
};

const extractPdfSignatureFromDictionary = (
  pdf: Uint8Array,
  dictionary: PdfRegularSignatureDictionaryWithByteRange,
  signatureCount: number,
): Effect.Effect<ExtractedPdfSignature, PdfError> =>
  Effect.gen(function* () {
    const byteRange = yield* parseByteRange(dictionary.byteRange);
    const rangeEnd = byteRange[2] + byteRange[3];
    if (
      byteRange[1] < 0 ||
      byteRange[3] < 0 ||
      byteRange[2] <= byteRange[0] + byteRange[1] ||
      rangeEnd > pdf.byteLength
    ) {
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.placeholderNotFound,
          retryable: false,
          reason: "Malformed /ByteRange values.",
          operation: PdfOperationValue.verify,
        }),
      );
    }
    const signedData = concatBytes([
      pdf.subarray(byteRange[0], byteRange[0] + byteRange[1]),
      pdf.subarray(byteRange[2], byteRange[2] + byteRange[3]),
    ]);
    const contentsBoundaryStart = byteRange[0] + byteRange[1];
    const contentsBoundaryEnd = byteRange[2] - 1;
    const contentsStart = skipPdfWhitespace(pdf, contentsBoundaryStart);
    let contentsEnd = contentsBoundaryEnd;
    while (contentsEnd > contentsStart && isPdfWhitespaceByte(pdf[contentsEnd])) contentsEnd -= 1;
    const contents = dictionary.contents;
    if (
      contents === undefined ||
      contentsStart !== contents.valueStart ||
      contentsEnd !== contents.valueEnd - 1 ||
      contentsStart >= contentsEnd ||
      pdf[contentsStart] !== LEFT_ANGLE ||
      pdf[contentsEnd] !== RIGHT_ANGLE
    ) {
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.placeholderNotFound,
          retryable: false,
          reason: "Malformed signature /Contents range.",
          operation: PdfOperationValue.verify,
        }),
      );
    }
    const paddedSignature = yield* decodeSignatureHex(pdf, contentsStart + 1, contentsEnd);
    const derLength = derSequenceTotalLength(paddedSignature);
    if (derLength !== undefined && !hasOnlyZeroBytesFrom(paddedSignature, derLength)) {
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.placeholderNotFound,
          retryable: false,
          reason: "Non-zero bytes after DER signature contents.",
          operation: PdfOperationValue.verify,
        }),
      );
    }
    const signature =
      derLength === undefined
        ? trimTrailingZeroBytes(paddedSignature)
        : paddedSignature.subarray(0, derLength);
    return {
      byteRange,
      signedData,
      signature,
      signatureCount,
      startsAtZero: byteRange[0] === 0,
      coversFileEnd: rangeEnd === pdf.byteLength,
    };
  });

export const extractPdfSignatureAtOffset = (
  pdf: Uint8Array,
  byteRangeStart: number,
  signatureCount: number,
): Effect.Effect<ExtractedPdfSignature, PdfError> =>
  signatureDictionaryAtOffset(pdf, byteRangeStart, PdfOperationValue.verify).pipe(
    Effect.flatMap((dictionary) =>
      extractPdfSignatureFromDictionary(pdf, dictionary, signatureCount),
    ),
  );

const verificationRegularSignatureDictionaries = (
  pdf: Uint8Array,
): Effect.Effect<ReadonlyArray<PdfRegularSignatureDictionaryWithByteRange>, PdfError> =>
  verificationSignatureDictionaries(pdf, PdfOperationValue.verify).pipe(
    Effect.flatMap((dictionaries) => {
      if (dictionaries.some((dictionary) => dictionary.kind === "document-timestamp")) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.verifyFailed,
            retryable: false,
            reason: "PDF DocTimeStamp verification is not supported.",
            operation: PdfOperationValue.verify,
          }),
        );
      }
      const signatures = dictionaries.filter(isRegularSignatureWithByteRange);
      return signatures.length === 0
        ? Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.placeholderNotFound,
              retryable: false,
              reason: "Failed to locate /ByteRange.",
              operation: PdfOperationValue.verify,
            }),
          )
        : Effect.succeed(signatures);
    }),
  );

export const forEachPdfSignature = <E, R>(
  pdf: Uint8Array,
  f: (
    signature: ExtractedPdfSignature,
    index: number,
    signatureCount: number,
  ) => Effect.Effect<void, E, R>,
): Effect.Effect<void, PdfError | E, R> =>
  verificationRegularSignatureDictionaries(pdf).pipe(
    Effect.flatMap((dictionaries) =>
      Effect.forEach(
        dictionaries,
        (dictionary, index) =>
          extractPdfSignatureFromDictionary(pdf, dictionary, dictionaries.length).pipe(
            Effect.flatMap((signature) => f(signature, index, dictionaries.length)),
          ),
        { discard: true },
      ),
    ),
  );

export const extractPdfSignatures = (
  pdf: Uint8Array,
): Effect.Effect<ReadonlyArray<ExtractedPdfSignature>, PdfError> =>
  verificationRegularSignatureDictionaries(pdf).pipe(
    Effect.flatMap((dictionaries) =>
      Effect.forEach(dictionaries, (dictionary) =>
        extractPdfSignatureFromDictionary(pdf, dictionary, dictionaries.length),
      ),
    ),
  );

export const extractPdfSignature = (
  pdf: Uint8Array,
): Effect.Effect<ExtractedPdfSignature, PdfError> =>
  Effect.gen(function* () {
    const signatures = yield* extractPdfSignatures(pdf);
    const last = signatures[signatures.length - 1];
    if (last === undefined) {
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.placeholderNotFound,
          retryable: false,
          reason: "Failed to locate /ByteRange.",
          operation: PdfOperationValue.verify,
        }),
      );
    }
    return last;
  });
