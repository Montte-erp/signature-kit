import { verifyDetachedSignedData } from "@signature-kit/cms";
import type { CmsError } from "@signature-kit/cms";
import { Effect } from "effect";
import { extractPdfSignature } from "./byte-range";
import { PdfError } from "./config";
import type { PdfVerificationRequest, PdfVerificationResult } from "./config";

export const verifyPdf = (
  input: PdfVerificationRequest,
): Effect.Effect<PdfVerificationResult, PdfError | CmsError> =>
  Effect.gen(function* () {
    const extracted = yield* extractPdfSignature(input.pdf);
    const cmsResult = yield* verifyDetachedSignedData({
      cms: extracted.signature,
      content: extracted.signedData,
      trustedRoots: input.trustedRoots,
    });

    return {
      valid: cmsResult.valid,
      chainValid: cmsResult.chainValid,
      signatureCount: extracted.signatureCount,
      byteRange: extracted.byteRange,
      signerSerialNumber: cmsResult.signerSerialNumber,
    };
  });
