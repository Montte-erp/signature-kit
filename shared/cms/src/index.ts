// @signature-kit/cms — CMS / PKCS#7 SignedData engine (detached create + verify) and
// RFC 3161 timestamping. The cryptographic core that PAdES embeds and CAdES reuses.
// Signing uses a WebCrypto CryptoKey; secrets are unwrapped upstream, never here.
// See docs/SIGNING-PLAN.md.

export {
  type CmsErrorCode,
  type CmsHashAlgorithm,
  type CmsOperation,
  type CmsVerifyResult,
  type CreateDetachedSignedDataInput,
  type IcpBrasilPolicy,
  type TimestampOptions,
  type VerifyDetachedSignedDataInput,
  CmsError,
  CmsErrorCodeValue,
  CmsHashAlgorithmValue,
  CmsOid,
  CmsOperationValue,
} from "./config";
export {
  clearIcpBrasilPolicyCache,
  fetchIcpBrasilPadesPolicy,
  IcpBrasilPadesPolicy,
  parseIcpBrasilPadesPolicy,
} from "./icp-brasil";
export { createDetachedSignedData } from "./sign";
export { requestTimestamp } from "./timestamp";
export { verifyDetachedSignedData } from "./verify";
