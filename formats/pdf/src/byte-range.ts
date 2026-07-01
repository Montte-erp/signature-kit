import { Effect, Schema } from "effect";
import {
  asciiSlice,
  concatBytes,
  encodeAscii,
  hexToBytes,
  indexOfByte,
  indexOfBytes,
  lastIndexOfBytes,
  replaceRange,
  trimTrailingZeroHex,
} from "./bytes";
import { PdfError, PdfErrorCodeValue, PdfOperationValue } from "./config";

const BYTE_RANGE_PREFIX = encodeAscii("/ByteRange [");
const CONTENTS_PREFIX = encodeAscii("/Contents");
const LEFT_ANGLE = 0x3c;
const RIGHT_ANGLE = 0x3e;
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
});
export type ExtractedPdfSignature = (typeof ExtractedPdfSignatureSchema)["Type"];

const countByteRanges = (pdf: Uint8Array): number => {
  let count = 0;
  let offset = 0;
  while (offset < pdf.byteLength) {
    const found = indexOfBytes(pdf, BYTE_RANGE_PREFIX, offset);
    if (found === -1) return count;
    count++;
    offset = found + BYTE_RANGE_PREFIX.byteLength;
  }
  return count;
};

const parseByteRange = (pdf: Uint8Array): Effect.Effect<PdfByteRange, PdfError> => {
  const byteRangeStart = lastIndexOfBytes(pdf, BYTE_RANGE_PREFIX);
  if (byteRangeStart === -1) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.placeholderNotFound,
        retryable: false,
        reason: "Failed to locate /ByteRange.",
        operation: PdfOperationValue.verify,
      }),
    );
  }
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
  const byteRangeText = asciiSlice(pdf, byteRangeStart, byteRangeEnd + 1);
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
  const byteRangeStart = lastIndexOfBytes(pdf, BYTE_RANGE_PREFIX);
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

export const extractPdfSignature = (
  pdf: Uint8Array,
): Effect.Effect<ExtractedPdfSignature, PdfError> =>
  Effect.gen(function* () {
    const byteRange = yield* parseByteRange(pdf);
    const signedData = concatBytes([
      pdf.subarray(byteRange[0], byteRange[0] + byteRange[1]),
      pdf.subarray(byteRange[2], byteRange[2] + byteRange[3]),
    ]);
    const signatureHexStart = byteRange[0] + byteRange[1] + 1;
    const signatureHexEnd = byteRange[2] - 1;
    if (signatureHexStart >= signatureHexEnd) {
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.placeholderNotFound,
          retryable: false,
          reason: "Malformed signature /Contents range.",
          operation: PdfOperationValue.verify,
        }),
      );
    }
    const signatureHex = trimTrailingZeroHex(asciiSlice(pdf, signatureHexStart, signatureHexEnd));
    return {
      byteRange,
      signedData,
      signature: hexToBytes(signatureHex),
      signatureCount: countByteRanges(pdf),
    };
  });
