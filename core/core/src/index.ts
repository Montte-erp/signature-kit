/**
 * @signature-kit/core — the small signing runtime.
 *
 * Contracts and errors live in `@signature-kit/contracts`; X.509 helpers live in
 * `@signature-kit/x509`; concrete signing power lives in `signers/*`.
 */

export { createSignaturesService, signatures, Signatures, signaturesLayer } from "./signatures";
export { createSignatureKit } from "./runtime";
export type {
  CertificatesRuntime,
  SignaturesRuntime,
  SignatureKitRuntime,
  SignatureKitSetup,
} from "./runtime";
export type { SignaturesService } from "./signatures";
