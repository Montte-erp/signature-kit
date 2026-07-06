import type { CmsError } from "@signature-kit/cms/config";
import { verifyDetachedSignedData } from "@signature-kit/cms/verify";
import { Effect } from "effect";
import { extractPdfSignatureAtOffset, findPdfByteRangeOffsets } from "./byte-range";
import { PdfError } from "./config";
import type { PdfVerificationRequest, PdfVerificationResult } from "./config";

export const verifyPdf = (
  input: PdfVerificationRequest,
): Effect.Effect<PdfVerificationResult, PdfError | CmsError> =>
  Effect.gen(function* () {
    const offsets = yield* findPdfByteRangeOffsets(input.pdf);

    let coverageValid = true;
    let cryptoValid = true;
    let chainValid = true;
    let revocationStatus: PdfVerificationResult["revocationStatus"] = "checked";
    let signerSerialNumber: PdfVerificationResult["signerSerialNumber"] = null;
    let byteRange: PdfVerificationResult["byteRange"] = [0, 0, 0, 0];
    let index = 0;

    for (const offset of offsets) {
      index += 1;
      const extracted = yield* extractPdfSignatureAtOffset(input.pdf, offset, offsets.length);
      if (!extracted.startsAtZero) coverageValid = false;
      if (index === offsets.length) {
        if (!extracted.coversFileEnd) coverageValid = false;
        byteRange = extracted.byteRange;
      }
      const cmsResult = yield* verifyDetachedSignedData({
        cms: extracted.signature,
        content: extracted.signedData,
        trustedRoots: input.trustedRoots,
      });
      if (!cmsResult.valid) cryptoValid = false;
      if (!cmsResult.chainValid) chainValid = false;
      if (cmsResult.revocationStatus === "not_checked") revocationStatus = "not_checked";
      signerSerialNumber = cmsResult.signerSerialNumber;
    }

    const valid = cryptoValid && coverageValid && (input.trustedRoots === undefined || chainValid);

    return {
      valid,
      chainValid,
      revocationStatus,
      signatureCount: offsets.length,
      byteRange,
      signerSerialNumber,
    };
  });
