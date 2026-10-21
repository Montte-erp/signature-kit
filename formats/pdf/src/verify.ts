import type { CmsError } from "@signature-kit/cms/config";
import { verifyDetachedSignedData } from "@signature-kit/cms/verify";
import { Effect, Schema } from "effect";
import { forEachPdfSignature, isCompletePdfRevision } from "./byte-range.js";
import {
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfSchemaNameValue,
  PdfVerificationRequestSchema,
} from "./config.js";
import type {
  PdfSignatureVerificationResult,
  PdfVerificationRequest,
  PdfVerificationResult,
} from "./config.js";

export const verifyPdfSignatures = (
  input: PdfVerificationRequest,
): Effect.Effect<readonly PdfSignatureVerificationResult[], PdfError | CmsError> =>
  Effect.gen(function* () {
    const request = yield* Schema.decodeUnknownEffect(PdfVerificationRequestSchema)(input).pipe(
      Effect.mapError(
        (issue) =>
          new PdfError({
            code: PdfErrorCodeValue.invalidBuilderInput,
            retryable: false,
            operation: PdfOperationValue.verify,
            schemaName: PdfSchemaNameValue.pdfVerificationRequest,
            reason: "PDF verification request failed schema validation.",
            issueMessage: String(issue),
          }),
      ),
    );

    const results: PdfSignatureVerificationResult[] = [];
    yield* forEachPdfSignature(request.pdf, (extracted, index, total) =>
      Effect.gen(function* () {
        const isNewest = index === total - 1;
        const revisionEnd = extracted.byteRange[2] + extracted.byteRange[3];
        const revisionComplete = yield* isCompletePdfRevision(request.pdf, revisionEnd);
        const coverageValid =
          extracted.startsAtZero && revisionComplete && (!isNewest || extracted.coversFileEnd);
        const cmsResult = yield* verifyDetachedSignedData({
          cms: extracted.signature,
          content: extracted.signedData,
          trustedRoots: request.trustedRoots,
        });
        results.push({
          signatureIndex: index,
          valid:
            cmsResult.valid &&
            coverageValid &&
            (request.trustedRoots === undefined || cmsResult.chainValid),
          cryptographicValid: cmsResult.valid,
          coverageValid,
          chainValid: cmsResult.chainValid,
          revocationStatus: cmsResult.revocationStatus,
          byteRange: extracted.byteRange,
          signerSerialNumber: cmsResult.signerSerialNumber,
          revisionEnd,
          coversFileEnd: extracted.coversFileEnd,
        });
      }),
    );
    return results;
  });

export const verifyPdf = Effect.fn(function* (
  input: PdfVerificationRequest,
): Effect.fn.Return<PdfVerificationResult, PdfError | CmsError> {
  const results = yield* verifyPdfSignatures(input);
  const newest = results.at(-1);
  if (newest === undefined) {
    return yield* Effect.die("PDF signature traversal completed without a signature.");
  }
  return {
    valid: results.every((result) => result.valid),
    chainValid: results.every((result) => result.chainValid),
    revocationStatus: results.some((result) => result.revocationStatus === "not_checked")
      ? "not_checked"
      : "checked",
    signatureCount: results.length,
    byteRange: newest.byteRange,
    signerSerialNumber: newest.signerSerialNumber,
  };
});
