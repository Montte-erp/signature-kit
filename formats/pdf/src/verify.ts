import type { CmsError } from "@signature-kit/cms/config";
import { verifyDetachedSignedData } from "@signature-kit/cms/verify";
import { Effect } from "effect";
import { extractPdfSignatures } from "./byte-range";
import { PdfError } from "./config";
import type { PdfVerificationRequest, PdfVerificationResult } from "./config";

export const verifyPdf = (
  input: PdfVerificationRequest,
): Effect.Effect<PdfVerificationResult, PdfError | CmsError> =>
  Effect.gen(function* () {
    const signatures = yield* extractPdfSignatures(input.pdf);

    // Every signed range must start at byte 0, and the newest signature must
    // reach the end of the file — bytes appended after the signed range would
    // otherwise change what renders without invalidating the signature
    // (signature-exclusion forgery). Earlier signatures legitimately cover a
    // prefix: each one signed the file as it existed at that revision.
    const newest = signatures[signatures.length - 1];
    let coverageValid = newest !== undefined && newest.coversFileEnd;
    let cryptoValid = true;
    let chainValid = true;
    let lastResult: {
      revocationStatus: PdfVerificationResult["revocationStatus"];
      signerSerialNumber: PdfVerificationResult["signerSerialNumber"];
    } = { revocationStatus: "not_checked", signerSerialNumber: null };

    for (const extracted of signatures) {
      if (!extracted.startsAtZero) coverageValid = false;
      const cmsResult = yield* verifyDetachedSignedData({
        cms: extracted.signature,
        content: extracted.signedData,
        trustedRoots: input.trustedRoots,
      });
      if (!cmsResult.valid) cryptoValid = false;
      if (!cmsResult.chainValid) chainValid = false;
      lastResult = {
        revocationStatus: cmsResult.revocationStatus,
        signerSerialNumber: cmsResult.signerSerialNumber,
      };
    }

    return {
      valid: cryptoValid && coverageValid,
      chainValid,
      revocationStatus: lastResult.revocationStatus,
      signatureCount: signatures.length,
      byteRange: newest?.byteRange ?? [0, 0, 0, 0],
      signerSerialNumber: lastResult.signerSerialNumber,
    };
  });
