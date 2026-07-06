import { Schema } from "effect";

export const CryptoErrorCodeSchema = Schema.Literals([
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
export type CryptoErrorCode = (typeof CryptoErrorCodeSchema)["Type"];
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

export const CryptoOperationSchema = Schema.Literals([
  "base64.decode",
  "pem.decode",
  "pkcs12.decode",
  "pkcs12.mac",
  "pkcs12.decrypt",
  "cipher.aes",
  "cipher.des",
  "cipher.rc2",
]);
export type CryptoOperation = (typeof CryptoOperationSchema)["Type"];
export const CryptoOperationValue = {
  base64Decode: "base64.decode",
  pemDecode: "pem.decode",
  pkcs12Decode: "pkcs12.decode",
  pkcs12Mac: "pkcs12.mac",
  pkcs12Decrypt: "pkcs12.decrypt",
  cipherAes: "cipher.aes",
  cipherDes: "cipher.des",
  cipherRc2: "cipher.rc2",
} satisfies Record<string, CryptoOperation>;

export const CryptoErrorMessageLocaleSchema = Schema.Literals(["en-US", "pt-BR"]);
export type CryptoErrorMessageLocale = (typeof CryptoErrorMessageLocaleSchema)["Type"];
export const CryptoErrorMessagesSchema = Schema.Record(
  CryptoErrorMessageLocaleSchema,
  Schema.Record(CryptoErrorCodeSchema, Schema.String),
);
export type CryptoErrorMessages = (typeof CryptoErrorMessagesSchema)["Type"];

export const cryptoErrorMessages = {
  "en-US": {
    "crypto.DECODE_ERROR": "Failed to decode PKCS#12 ASN.1.",
    "crypto.INVALID_FORMAT": "Unsupported PKCS#12 format.",
    "crypto.UNSUPPORTED_ALGORITHM": "Unsupported PKCS#12 encryption algorithm.",
    "crypto.WRONG_PASSWORD": "Wrong PKCS#12 password.",
    "crypto.NO_CERTIFICATE": "No certificate found in PKCS#12 file.",
    "crypto.NO_PRIVATE_KEY": "No private key found in PKCS#12 file.",
    "crypto.CORRUPTED_FILE": "Corrupted PKCS#12 file.",
    "crypto.CIPHER_ERROR": "Cipher operation failed.",
    "crypto.UNKNOWN": "Unknown crypto failure.",
  },
  "pt-BR": {
    "crypto.DECODE_ERROR": "Não foi possível ler os dados ASN.1 do PKCS#12.",
    "crypto.INVALID_FORMAT": "Formato PKCS#12 não suportado.",
    "crypto.UNSUPPORTED_ALGORITHM": "O certificado usa um algoritmo de criptografia não suportado.",
    "crypto.WRONG_PASSWORD": "Senha do certificado incorreta.",
    "crypto.NO_CERTIFICATE": "O arquivo não contém um certificado.",
    "crypto.NO_PRIVATE_KEY": "O arquivo não contém uma chave privada.",
    "crypto.CORRUPTED_FILE": "Arquivo PKCS#12 corrompido.",
    "crypto.CIPHER_ERROR": "Falha na operação de criptografia.",
    "crypto.UNKNOWN": "Falha de criptografia desconhecida.",
  },
} satisfies Record<CryptoErrorMessageLocale, Record<CryptoErrorCode, string>>;

const cryptoErrorReasonOverridableByCode = {
  "crypto.DECODE_ERROR": true,
  "crypto.INVALID_FORMAT": true,
  "crypto.UNSUPPORTED_ALGORITHM": true,
  "crypto.WRONG_PASSWORD": false,
  "crypto.NO_CERTIFICATE": false,
  "crypto.NO_PRIVATE_KEY": false,
  "crypto.CORRUPTED_FILE": true,
  "crypto.CIPHER_ERROR": true,
  "crypto.UNKNOWN": true,
} satisfies Record<CryptoErrorCode, boolean>;

export class CryptoError extends Schema.TaggedErrorClass<CryptoError>()("CryptoError", {
  code: CryptoErrorCodeSchema,
  reason: Schema.optional(Schema.String),
  operation: Schema.optional(CryptoOperationSchema),
}) {
  get message(): string {
    const defaultMessage = cryptoErrorMessages["en-US"][this.code];
    return cryptoErrorReasonOverridableByCode[this.code]
      ? (this.reason ?? defaultMessage)
      : defaultMessage;
  }
}

export const Pkcs12ResultSchema = Schema.Struct({
  certificate: Schema.Uint8Array,
  privateKey: Schema.Uint8Array,
  chain: Schema.Array(Schema.Uint8Array),
});
export type Pkcs12Result = (typeof Pkcs12ResultSchema)["Type"];
