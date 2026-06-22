/**
 * @signature-kit/pdf — PDF/PAdES detached-signature adapter.
 *
 * Uses @cantoo/pdf-lib for PDF mutation and @signature-kit/cms for the detached CMS
 * signature bytes embedded into the PDF ByteRange.
 */

export {
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  type PdfErrorCode,
  type PdfOperation,
  type PdfSignatureAppearance,
  type PdfSignaturePolicy,
  type PdfSigningRequest,
  type PdfVerificationRequest,
  type PdfVerificationResult,
} from "./config";
export { signPdf } from "./sign";
export { verifyPdf } from "./verify";
