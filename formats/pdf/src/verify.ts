import type { CmsError } from "@signature-kit/cms/config";
import { verifyDetachedSignedData } from "@signature-kit/cms/verify";
import { Effect, Schema } from "effect";
import { forEachPdfSignature } from "./byte-range.js";
import {
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfSchemaNameValue,
  PdfVerificationRequestSchema,
} from "./config.js";
import type { PdfVerificationRequest, PdfVerificationResult } from "./config.js";

export const verifyPdf = (
  input: PdfVerificationRequest,
): Effect.Effect<PdfVerificationResult, PdfError | CmsError> =>
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

    let coverageValid = true;
    let cryptoValid = true;
    let chainValid = true;
    let revocationStatus: PdfVerificationResult["revocationStatus"] = "checked";
    let signerSerialNumber: PdfVerificationResult["signerSerialNumber"] = null;
    let byteRange: PdfVerificationResult["byteRange"] = [0, 0, 0, 0];
    let signatureCount = 0;
    yield* forEachPdfSignature(request.pdf, (extracted, index, total) =>
      Effect.gen(function* () {
        signatureCount += 1;
        const isNewest = index === total - 1;
        if (!extracted.startsAtZero) coverageValid = false;
        if (isNewest) {
          if (!extracted.coversFileEnd) coverageValid = false;
          byteRange = extracted.byteRange;
        }
        const cmsResult = yield* verifyDetachedSignedData({
          cms: extracted.signature,
          content: extracted.signedData,
          trustedRoots: request.trustedRoots,
        });
        if (!cmsResult.valid) cryptoValid = false;
        if (!cmsResult.chainValid) chainValid = false;
        if (cmsResult.revocationStatus === "not_checked") revocationStatus = "not_checked";
        signerSerialNumber = cmsResult.signerSerialNumber;
      }),
    );

    const valid =
      cryptoValid && coverageValid && (request.trustedRoots === undefined || chainValid);

    return {
      valid,
      chainValid,
      revocationStatus,
      signatureCount,
      byteRange,
      signerSerialNumber,
    };
  });
