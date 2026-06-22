/**
 * @signature-kit/a1 — A1 / PKCS#12 signer adapter, the first e-signature backend.
 */

export {
  a1SignaturesLayer,
  createA1SignerAdapter,
  loadA1SignerAdapter,
} from "./create-a1-signer-adapter";
export { a1SignerOptionsSchema, type A1SignerOptions } from "./config";
export { parseCertificate } from "./certificate";
