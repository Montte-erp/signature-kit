import { Effect, Schema } from "effect";
import {
  asciiSlice,
  concatBytes,
  encodeAscii,
  hexToBytes,
  indexOfByte,
  indexOfBytes,
  replaceRange,
} from "./bytes";
import { PdfError, PdfErrorCodeValue, PdfOperationValue } from "./config";

const BYTE_RANGE_NAME = encodeAscii("/ByteRange");
const CONTENTS_PREFIX = encodeAscii("/Contents");
const LEFT_ANGLE = 0x3c;
const RIGHT_ANGLE = 0x3e;
const LEFT_BRACKET = 0x5b;
const RIGHT_BRACKET = 0x5d;
export const PdfByteRangeSchema = Schema.Tuple([
  Schema.Number,
  Schema.Number,
  Schema.Number,
  Schema.Number,
]);
export type PdfByteRange = (typeof PdfByteRangeSchema)["Type"];

export const PreparedPdfSignatureSchema = Schema.Struct({
  pdf: Schema.Uint8Array,
  byteRange: PdfByteRangeSchema,
  signedData: Schema.Uint8Array,
  contentsStart: Schema.Number,
  contentsEnd: Schema.Number,
  placeholderLength: Schema.Number,
});
export type PreparedPdfSignature = (typeof PreparedPdfSignatureSchema)["Type"];

export const ExtractedPdfSignatureSchema = Schema.Struct({
  byteRange: PdfByteRangeSchema,
  signedData: Schema.Uint8Array,
  signature: Schema.Uint8Array,
  signatureCount: Schema.Number,
  // The signed range must start at byte 0 and, for the newest signature, end at
  // the end of the file — otherwise appended content escapes the signature
  // (classic PDF signature-exclusion forgery).
  startsAtZero: Schema.Boolean,
  coversFileEnd: Schema.Boolean,
});
export type ExtractedPdfSignature = (typeof ExtractedPdfSignatureSchema)["Type"];

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

const isByteRangeArrayAt = (pdf: Uint8Array, offset: number): boolean =>
  pdf[skipPdfWhitespace(pdf, offset + BYTE_RANGE_NAME.byteLength)] === LEFT_BRACKET;

const findByteRangeOffsets = (pdf: Uint8Array): Array<number> => {
  const offsets: Array<number> = [];
  let offset = 0;
  while (offset < pdf.byteLength) {
    const found = indexOfBytes(pdf, BYTE_RANGE_NAME, offset);
    if (found === -1) return offsets;
    if (isByteRangeArrayAt(pdf, found)) offsets.push(found);
    offset = found + BYTE_RANGE_NAME.byteLength;
  }
  return offsets;
};

export const hasPdfByteRange = (pdf: Uint8Array): boolean => findByteRangeOffsets(pdf).length > 0;

export const findPdfByteRangeOffsets = (
  pdf: Uint8Array,
): Effect.Effect<ReadonlyArray<number>, PdfError> => {
  const offsets = findByteRangeOffsets(pdf);
  if (offsets.length === 0) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.placeholderNotFound,
        retryable: false,
        reason: "Failed to locate /ByteRange.",
        operation: PdfOperationValue.verify,
      }),
    );
  }
  return Effect.succeed(offsets);
};

const parseByteRangeAt = (
  pdf: Uint8Array,
  byteRangeStart: number,
): Effect.Effect<PdfByteRange, PdfError> => {
  const byteRangeEnd = indexOfByte(pdf, RIGHT_BRACKET, byteRangeStart);
  if (byteRangeEnd === -1) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.placeholderNotFound,
        retryable: false,
        reason: "Failed to locate the end of /ByteRange.",
        operation: PdfOperationValue.verify,
      }),
    );
  }
  const byteRangeText = asciiSlice(pdf, byteRangeStart, byteRangeEnd + 1).replaceAll("\u0000", " ");
  const matches = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(byteRangeText);
  const first = matches?.[1];
  const second = matches?.[2];
  const third = matches?.[3];
  const fourth = matches?.[4];
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.placeholderNotFound,
        retryable: false,
        reason: "Failed to parse /ByteRange values.",
        operation: PdfOperationValue.verify,
      }),
    );
  }
  const byteRange: PdfByteRange = [Number(first), Number(second), Number(third), Number(fourth)];
  return Effect.succeed(byteRange);
};

export const preparePdfByteRange = (
  pdf: Uint8Array,
): Effect.Effect<PreparedPdfSignature, PdfError> => {
  const byteRangeOffsets = findByteRangeOffsets(pdf);
  const byteRangeStart = byteRangeOffsets[byteRangeOffsets.length - 1] ?? -1;
  if (byteRangeStart === -1) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.placeholderNotFound,
        retryable: false,
        reason: "No /ByteRange placeholder found.",
        operation: PdfOperationValue.sign,
      }),
    );
  }
  const byteRangeEnd = indexOfByte(pdf, RIGHT_BRACKET, byteRangeStart);
  if (byteRangeEnd === -1) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.placeholderNotFound,
        retryable: false,
        reason: "No /ByteRange placeholder terminator found.",
        operation: PdfOperationValue.sign,
      }),
    );
  }

  const contentsPrefix = indexOfBytes(pdf, CONTENTS_PREFIX, byteRangeEnd);
  if (contentsPrefix === -1) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.placeholderNotFound,
        retryable: false,
        reason: "No /Contents placeholder found.",
        operation: PdfOperationValue.sign,
      }),
    );
  }
  const contentsStart = indexOfByte(pdf, LEFT_ANGLE, contentsPrefix);
  const contentsEnd = contentsStart === -1 ? -1 : indexOfByte(pdf, RIGHT_ANGLE, contentsStart);
  if (contentsStart === -1 || contentsEnd === -1 || contentsEnd <= contentsStart) {
    return Effect.fail(
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
  const actualByteRange = encodeAscii(`/ByteRange [${byteRange.join(" ")}]`);
  const byteRangeLength = byteRangeEnd + 1 - byteRangeStart;
  if (actualByteRange.byteLength > byteRangeLength) {
    return Effect.fail(
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
  const withByteRange = replaceRange(pdf, byteRangeStart, byteRangeEnd + 1, paddedByteRange);
  const signedData = concatBytes([
    withByteRange.subarray(byteRange[0], byteRange[0] + byteRange[1]),
    withByteRange.subarray(byteRange[2], byteRange[2] + byteRange[3]),
  ]);

  return Effect.succeed({
    pdf: withByteRange,
    byteRange,
    signedData,
    contentsStart,
    contentsEnd,
    placeholderLength: contentsEnd - contentsStart - 1,
  });
};

/**
 * Total length of the DER TLV at the start of `bytes`, or undefined when the
 * bytes do not begin with a well-formed SEQUENCE. Used to cut the CMS out of
 * the zero-padded /Contents placeholder without corrupting signatures whose
 * DER legitimately ends in 0x00 bytes.
 */
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

const isHexCharacterCode = (code: number): boolean =>
  (code >= 0x30 && code <= 0x39) ||
  (code >= 0x41 && code <= 0x46) ||
  (code >= 0x61 && code <= 0x66);

const decodeSignatureHex = (hex: string): Effect.Effect<Uint8Array, PdfError> => {
  let normalizedHex = "";
  for (let index = 0; index < hex.length; index += 1) {
    const code = hex.charCodeAt(index);
    if (isHexCharacterCode(code)) {
      normalizedHex += hex[index] ?? "";
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
  if (normalizedHex.length % 2 !== 0) normalizedHex += "0";
  return Effect.succeed(hexToBytes(normalizedHex));
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

export const extractPdfSignatureAtOffset = (
  pdf: Uint8Array,
  byteRangeStart: number,
  signatureCount: number,
): Effect.Effect<ExtractedPdfSignature, PdfError> =>
  Effect.gen(function* () {
    const byteRange = yield* parseByteRangeAt(pdf, byteRangeStart);
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
    if (
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
    const signatureHexStart = contentsStart + 1;
    const signatureHexEnd = contentsEnd;
    const signatureHex = asciiSlice(pdf, signatureHexStart, signatureHexEnd);
    const paddedSignature = yield* decodeSignatureHex(signatureHex);
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

/** Every signature in the document, in file order (oldest first). */
export const extractPdfSignatures = (
  pdf: Uint8Array,
): Effect.Effect<ReadonlyArray<ExtractedPdfSignature>, PdfError> =>
  Effect.gen(function* () {
    const offsets = yield* findPdfByteRangeOffsets(pdf);
    return yield* Effect.forEach(offsets, (offset) =>
      extractPdfSignatureAtOffset(pdf, offset, offsets.length),
    );
  });

/** The newest signature (the one whose range must reach the end of the file). */
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
