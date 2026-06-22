/**
 * @signature-kit/crypto — typed error catalog and the PKCS#12 result contract.
 *
 * The cipher primitives and the PKCS#12 parser construct `CryptoError` at the
 * exact decision point (bad padding, unsupported algorithm, missing material).
 */

import { Schema } from "effect";

export type CryptoErrorCode =
  | "crypto.DECODE_ERROR"
  | "crypto.INVALID_FORMAT"
  | "crypto.UNSUPPORTED_ALGORITHM"
  | "crypto.WRONG_PASSWORD"
  | "crypto.NO_CERTIFICATE"
  | "crypto.NO_PRIVATE_KEY"
  | "crypto.CORRUPTED_FILE"
  | "crypto.CIPHER_ERROR"
  | "crypto.UNKNOWN";
const CryptoErrorCodeSchema: Schema.Decoder<CryptoErrorCode> = Schema.Literals([
  "crypto.DECODE_ERROR",
  "crypto.INVALID_FORMAT",
  "crypto.UNSUPPORTED_ALGORITHM",
  "crypto.WRONG_PASSWORD",
  "crypto.NO_CERTIFICATE",
  "crypto.NO_PRIVATE_KEY",
  "crypto.CORRUPTED_FILE",
  "crypto.CIPHER_ERROR",
  "crypto.UNKNOWN",
]);
export const CryptoErrorCodeValue = {
  decodeError: "crypto.DECODE_ERROR",
  invalidFormat: "crypto.INVALID_FORMAT",
  unsupportedAlgorithm: "crypto.UNSUPPORTED_ALGORITHM",
  wrongPassword: "crypto.WRONG_PASSWORD",
  noCertificate: "crypto.NO_CERTIFICATE",
  noPrivateKey: "crypto.NO_PRIVATE_KEY",
  corruptedFile: "crypto.CORRUPTED_FILE",
  cipherError: "crypto.CIPHER_ERROR",
  unknown: "crypto.UNKNOWN",
} satisfies Record<string, CryptoErrorCode>;

export type CryptoOperation =
  | "pkcs12.decode"
  | "pkcs12.mac"
  | "pkcs12.decrypt"
  | "cipher.aes"
  | "cipher.des"
  | "cipher.rc2";
const CryptoOperationSchema: Schema.Decoder<CryptoOperation> = Schema.Literals([
  "pkcs12.decode",
  "pkcs12.mac",
  "pkcs12.decrypt",
  "cipher.aes",
  "cipher.des",
  "cipher.rc2",
]);
export const CryptoOperationValue = {
  pkcs12Decode: "pkcs12.decode",
  pkcs12Mac: "pkcs12.mac",
  pkcs12Decrypt: "pkcs12.decrypt",
  cipherAes: "cipher.aes",
  cipherDes: "cipher.des",
  cipherRc2: "cipher.rc2",
} satisfies Record<string, CryptoOperation>;

type CryptoErrorFields = {
  readonly _tag: "CryptoError";
  readonly code: CryptoErrorCode;
  readonly reason?: string | undefined;
  readonly operation?: CryptoOperation | undefined;
};
type CryptoErrorInput = {
  readonly code: CryptoErrorCode;
  readonly reason?: string | undefined;
  readonly operation?: CryptoOperation | undefined;
};
type CryptoErrorConstructor = new (input: CryptoErrorInput) => CryptoErrorFields;

const CryptoErrorBase: CryptoErrorConstructor = Schema.TaggedErrorClass<CryptoErrorFields>()(
  "CryptoError",
  {
    code: CryptoErrorCodeSchema,
    reason: Schema.optional(Schema.String),
    operation: Schema.optional(CryptoOperationSchema),
  },
);

export class CryptoError extends CryptoErrorBase {
  get message(): string {
    switch (this.code) {
      case "crypto.DECODE_ERROR":
        return this.reason ?? "Failed to decode PKCS#12 ASN.1.";
      case "crypto.INVALID_FORMAT":
        return this.reason ?? "Unsupported PKCS#12 format.";
      case "crypto.UNSUPPORTED_ALGORITHM":
        return this.reason ?? "Unsupported PKCS#12 encryption algorithm.";
      case "crypto.WRONG_PASSWORD":
        return "Wrong PKCS#12 password.";
      case "crypto.NO_CERTIFICATE":
        return "No certificate found in PKCS#12 file.";
      case "crypto.NO_PRIVATE_KEY":
        return "No private key found in PKCS#12 file.";
      case "crypto.CORRUPTED_FILE":
        return this.reason ?? "Corrupted PKCS#12 file.";
      case "crypto.CIPHER_ERROR":
        return this.reason ?? "Cipher operation failed.";
      case "crypto.UNKNOWN":
        return this.reason ?? "Unknown crypto failure.";
    }
  }
}

export type Pkcs12Result = {
  readonly certificate: Uint8Array;
  readonly privateKey: Uint8Array;
  readonly chain: readonly Uint8Array[];
};
