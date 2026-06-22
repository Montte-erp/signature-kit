/**
 * @signature-kit/asn1 — Effect-native ASN.1 DER decode/encode with a typed node model.
 */

export {
  Asn1Error,
  Asn1ErrorCodeValue,
  bytesOf,
  childrenOf,
  decode,
  encode,
  integerBigInt,
  oidString,
} from "./config";

export type {
  Asn1Class,
  Asn1Constructed,
  Asn1ErrorCode,
  Asn1Node,
  Asn1Primitive,
  Asn1Step,
} from "./config";
