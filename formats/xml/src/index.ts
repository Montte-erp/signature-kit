/**
 * @signature-kit/xml — XML-DSig adapter over xmldsigjs.
 *
 * Signing consumes the agnostic @signature-kit/core Signatures service. Verification
 * can use an explicit public key or the embedded X.509 KeyInfo.
 */

export {
  XmlError,
  XmlErrorCodeValue,
  XmlOperationValue,
  type XmlErrorCode,
  type XmlOperation,
  type XmlSigningRequest,
  type XmlVerificationRequest,
  type XmlVerificationResult,
} from "./config";
export { signXml } from "./sign";
export { verifyXml } from "./verify";
