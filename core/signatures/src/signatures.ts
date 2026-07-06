import type { ErrorMessageLocale } from "@signature-kit/i18n";
import { Context, Effect, Layer, Schema } from "effect";
import type { Redacted } from "effect";

const nonEmptyString: Schema.ConstraintDecoder<string> = Schema.NonEmptyString;
export const redactedStringSchema: Schema.ConstraintDecoder<Redacted.Redacted<string>> =
  Schema.Redacted(Schema.String);

const cnpjDigits: Schema.ConstraintDecoder<string> = Schema.String.check(
  Schema.isPattern(/^\d{14}$/),
);
const cpfDigits: Schema.ConstraintDecoder<string> = Schema.String.check(
  Schema.isPattern(/^\d{11}$/),
);
const sha256Hex: Schema.ConstraintDecoder<string> = Schema.String.check(
  Schema.isPattern(/^[a-f0-9]{64}$/),
);
const certificatePem: Schema.ConstraintDecoder<string> = Schema.String.check(
  Schema.isPattern(/-----BEGIN CERTIFICATE-----/),
);
const redactedPrivateKeyPem: Schema.ConstraintDecoder<Redacted.Redacted<string>> =
  Schema.RedactedFromValue(
    Schema.String.check(Schema.isPattern(/-----BEGIN (RSA )?PRIVATE KEY-----/)),
    { label: "signature-kit-private-key", disallowEncode: true },
  );

export const SignatureAlgorithmSchema = Schema.Literals(["rsa-sha1", "rsa-sha256", "rsa-sha512"]);
export type SignatureAlgorithm = (typeof SignatureAlgorithmSchema)["Type"];
export const SignatureAlgorithmValue = {
  rsaSha1: "rsa-sha1",
  rsaSha256: "rsa-sha256",
  rsaSha512: "rsa-sha512",
} satisfies Record<string, SignatureAlgorithm>;

export const CertificateSubjectSchema = Schema.Struct({
  commonName: Schema.NullOr(Schema.String),
  organization: Schema.NullOr(Schema.String),
  organizationalUnit: Schema.NullOr(Schema.String),
  country: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.String),
  locality: Schema.NullOr(Schema.String),
  raw: Schema.String,
});
export type CertificateSubject = (typeof CertificateSubjectSchema)["Type"];

export const CertificateIssuerSchema = Schema.Struct({
  commonName: Schema.NullOr(Schema.String),
  organization: Schema.NullOr(Schema.String),
  country: Schema.NullOr(Schema.String),
  raw: Schema.String,
});
export type CertificateIssuer = (typeof CertificateIssuerSchema)["Type"];

export const CertificateValiditySchema = Schema.Struct({
  notBefore: Schema.Date,
  notAfter: Schema.Date,
});
export type CertificateValidity = (typeof CertificateValiditySchema)["Type"];

export const BrazilianFieldsSchema = Schema.Struct({
  cnpj: Schema.NullOr(cnpjDigits),
  cpf: Schema.NullOr(cpfDigits),
});
export type BrazilianFields = (typeof BrazilianFieldsSchema)["Type"];

export const CertificateSchema = Schema.Struct({
  serialNumber: nonEmptyString,
  subject: CertificateSubjectSchema,
  issuer: CertificateIssuerSchema,
  validity: CertificateValiditySchema,
  fingerprint: sha256Hex,
  subjectAltName: Schema.NullOr(Schema.String),
  isValid: Schema.Boolean,
  brazilian: BrazilianFieldsSchema,
  certPem: certificatePem,
  certificateDer: Schema.Uint8Array,
  intermediateCertificates: Schema.Array(Schema.Uint8Array),
  publicKeyDer: Schema.Uint8Array,
  privateKeyPem: redactedPrivateKeyPem,
});
export type Certificate = (typeof CertificateSchema)["Type"];

export const SignerIdentitySchema = Schema.Struct({
  subject: Schema.String,
  issuer: Schema.String,
  serialNumber: Schema.String,
  thumbprint: Schema.String,
  validFrom: Schema.Date,
  validTo: Schema.Date,
  document: Schema.optional(Schema.String),
});
export type SignerIdentity = (typeof SignerIdentitySchema)["Type"];

export const SignInputSchema = Schema.Struct({
  content: Schema.Uint8Array,
  algorithm: SignatureAlgorithmSchema,
});
export type SignInput = (typeof SignInputSchema)["Type"];

export const VerifyInputSchema = Schema.Struct({
  content: Schema.Uint8Array,
  signature: Schema.Uint8Array,
  algorithm: SignatureAlgorithmSchema,
});
export type VerifyInput = (typeof VerifyInputSchema)["Type"];

export const SignatureArtifactSchema = Schema.Struct({
  algorithm: SignatureAlgorithmSchema,
  signature: Schema.Uint8Array,
});
export type SignatureArtifact = (typeof SignatureArtifactSchema)["Type"];

export const VerificationResultSchema = Schema.Struct({
  valid: Schema.Boolean,
  algorithm: SignatureAlgorithmSchema,
});
export type VerificationResult = (typeof VerificationResultSchema)["Type"];

export type SignerAdapter = {
  readonly id: string;
  inspect(): Effect.Effect<SignerIdentity, SignatureKitError>;
  certificate(): Effect.Effect<Certificate, SignatureKitError>;
  importSigningKey(algorithm: SignatureAlgorithm): Effect.Effect<CryptoKey, SignatureKitError>;
  sign(input: SignInput): Effect.Effect<SignatureArtifact, SignatureKitError>;
  verify(input: VerifyInput): Effect.Effect<VerificationResult, SignatureKitError>;
};

export const SignatureKitErrorCodeSchema = Schema.Literals([
  "signature-kit.EMPTY_FILE",
  "signature-kit.INVALID_FORMAT",
  "signature-kit.INVALID_INPUT",
  "signature-kit.WRONG_PASSWORD",
  "signature-kit.CERTIFICATE_EXPIRED",
  "signature-kit.CERTIFICATE_NOT_YET_VALID",
  "signature-kit.MISSING_BR_IDENTIFIER",
  "signature-kit.UNSUPPORTED_ALGORITHM",
  "signature-kit.NO_CERTIFICATE",
  "signature-kit.NO_PRIVATE_KEY",
  "signature-kit.CORRUPTED_FILE",
  "signature-kit.X509_PARSE_FAILED",
  "signature-kit.PEM_EXTRACTION_FAILED",
  "signature-kit.KEY_IMPORT_FAILED",
  "signature-kit.DIGEST_FAILED",
  "signature-kit.SIGN_FAILED",
  "signature-kit.VERIFY_FAILED",
  "signature-kit.HTTP",
  "signature-kit.RESPONSE_SHAPE",
  "signature-kit.UNSUPPORTED_OPERATION",
  "signature-kit.UNKNOWN",
]);
export type SignatureKitErrorCode = (typeof SignatureKitErrorCodeSchema)["Type"];
export const SignatureKitErrorCodeValue = {
  emptyFile: "signature-kit.EMPTY_FILE",
  invalidFormat: "signature-kit.INVALID_FORMAT",
  invalidInput: "signature-kit.INVALID_INPUT",
  wrongPassword: "signature-kit.WRONG_PASSWORD",
  certificateExpired: "signature-kit.CERTIFICATE_EXPIRED",
  certificateNotYetValid: "signature-kit.CERTIFICATE_NOT_YET_VALID",
  missingBrIdentifier: "signature-kit.MISSING_BR_IDENTIFIER",
  unsupportedAlgorithm: "signature-kit.UNSUPPORTED_ALGORITHM",
  noCertificate: "signature-kit.NO_CERTIFICATE",
  noPrivateKey: "signature-kit.NO_PRIVATE_KEY",
  corruptedFile: "signature-kit.CORRUPTED_FILE",
  x509ParseFailed: "signature-kit.X509_PARSE_FAILED",
  pemExtractionFailed: "signature-kit.PEM_EXTRACTION_FAILED",
  keyImportFailed: "signature-kit.KEY_IMPORT_FAILED",
  digestFailed: "signature-kit.DIGEST_FAILED",
  signFailed: "signature-kit.SIGN_FAILED",
  verifyFailed: "signature-kit.VERIFY_FAILED",
  http: "signature-kit.HTTP",
  responseShape: "signature-kit.RESPONSE_SHAPE",
  unsupportedOperation: "signature-kit.UNSUPPORTED_OPERATION",
  unknown: "signature-kit.UNKNOWN",
} satisfies Record<string, SignatureKitErrorCode>;

export const signatureKitErrorMessages = {
  "en-US": {
    "signature-kit.EMPTY_FILE": "Certificate file is empty (0 bytes).",
    "signature-kit.INVALID_FORMAT": "The file is not a PKCS#12 (.pfx/.p12) certificate.",
    "signature-kit.INVALID_INPUT": "Invalid signing input.",
    "signature-kit.WRONG_PASSWORD": "Wrong certificate password.",
    "signature-kit.CERTIFICATE_EXPIRED": "Certificate expired.",
    "signature-kit.CERTIFICATE_NOT_YET_VALID": "Certificate is not valid yet.",
    "signature-kit.MISSING_BR_IDENTIFIER": "Certificate does not contain a Brazilian CPF or CNPJ.",
    "signature-kit.UNSUPPORTED_ALGORITHM":
      "The certificate uses an unsupported encryption algorithm.",
    "signature-kit.NO_CERTIFICATE": "The file does not contain a certificate.",
    "signature-kit.NO_PRIVATE_KEY": "The file does not contain a private key.",
    "signature-kit.CORRUPTED_FILE": "The file is corrupted or not a valid PKCS#12 certificate.",
    "signature-kit.X509_PARSE_FAILED": "X.509 parsing failed.",
    "signature-kit.PEM_EXTRACTION_FAILED": "Failed to extract PEM material from the PFX.",
    "signature-kit.KEY_IMPORT_FAILED": "Failed to import the key into Web Crypto.",
    "signature-kit.DIGEST_FAILED": "Failed to compute the certificate digest.",
    "signature-kit.SIGN_FAILED": "Failed to sign the content.",
    "signature-kit.VERIFY_FAILED": "Failed to verify the signature.",
    "signature-kit.HTTP": "HTTP request failed.",
    "signature-kit.RESPONSE_SHAPE": "HTTP response shape was invalid.",
    "signature-kit.UNSUPPORTED_OPERATION": "Operation is unsupported.",
    "signature-kit.UNKNOWN": "Unknown SignatureKit failure.",
  },
  "pt-BR": {
    "signature-kit.EMPTY_FILE": "O arquivo do certificado está vazio.",
    "signature-kit.INVALID_FORMAT": "O arquivo não é um certificado PKCS#12 (.pfx/.p12).",
    "signature-kit.INVALID_INPUT": "Entrada de assinatura inválida.",
    "signature-kit.WRONG_PASSWORD": "Senha do certificado incorreta.",
    "signature-kit.CERTIFICATE_EXPIRED": "Certificado expirado.",
    "signature-kit.CERTIFICATE_NOT_YET_VALID": "Certificado ainda não está válido.",
    "signature-kit.MISSING_BR_IDENTIFIER": "Certificado não contém CPF ou CNPJ brasileiro.",
    "signature-kit.UNSUPPORTED_ALGORITHM":
      "O certificado usa um algoritmo de criptografia não suportado.",
    "signature-kit.NO_CERTIFICATE": "O arquivo não contém um certificado.",
    "signature-kit.NO_PRIVATE_KEY": "O arquivo não contém uma chave privada.",
    "signature-kit.CORRUPTED_FILE":
      "O arquivo está corrompido ou não é um certificado PKCS#12 válido.",
    "signature-kit.X509_PARSE_FAILED": "Não foi possível ler o certificado X.509.",
    "signature-kit.PEM_EXTRACTION_FAILED": "Não foi possível extrair o material PEM do PFX.",
    "signature-kit.KEY_IMPORT_FAILED": "Não foi possível importar a chave no Web Crypto.",
    "signature-kit.DIGEST_FAILED": "Não foi possível calcular o digest do certificado.",
    "signature-kit.SIGN_FAILED": "Não foi possível assinar o conteúdo.",
    "signature-kit.VERIFY_FAILED": "Não foi possível verificar a assinatura.",
    "signature-kit.HTTP": "A requisição HTTP falhou.",
    "signature-kit.RESPONSE_SHAPE": "A resposta HTTP veio em um formato inválido.",
    "signature-kit.UNSUPPORTED_OPERATION": "Operação não suportada.",
    "signature-kit.UNKNOWN": "Falha desconhecida do SignatureKit.",
  },
} satisfies Record<ErrorMessageLocale, Record<SignatureKitErrorCode, string>>;

export const SignatureKitErrorCatalogEntrySchema = Schema.Struct({
  code: SignatureKitErrorCodeSchema,
  message: Schema.String,
  overridable: Schema.Boolean,
});
export type SignatureKitErrorCatalogEntry = (typeof SignatureKitErrorCatalogEntrySchema)["Type"];

const nonOverridableSignatureKitErrorCodes = Schema.Literals([
  "signature-kit.EMPTY_FILE",
  "signature-kit.WRONG_PASSWORD",
  "signature-kit.CERTIFICATE_EXPIRED",
  "signature-kit.CERTIFICATE_NOT_YET_VALID",
  "signature-kit.MISSING_BR_IDENTIFIER",
  "signature-kit.NO_CERTIFICATE",
  "signature-kit.NO_PRIVATE_KEY",
  "signature-kit.CORRUPTED_FILE",
  "signature-kit.PEM_EXTRACTION_FAILED",
  "signature-kit.DIGEST_FAILED",
]);

const isNonOverridableSignatureKitErrorCode = Schema.is(nonOverridableSignatureKitErrorCodes);

const signatureKitErrorCatalogEntry = (
  code: SignatureKitErrorCode,
): SignatureKitErrorCatalogEntry => ({
  code,
  message: signatureKitErrorMessages["en-US"][code],
  overridable: !isNonOverridableSignatureKitErrorCode(code),
});

export const signatureKitErrorCatalog: readonly SignatureKitErrorCatalogEntry[] =
  SignatureKitErrorCodeSchema.literals.map(signatureKitErrorCatalogEntry);

export const SignatureKitOperationSchema = Schema.Literals([
  "pkcs12.parse",
  "x509.parse",
  "crypto.digest",
  "crypto.import",
  "crypto.sign",
  "crypto.verify",
  "schema.decode",
  "http.request",
  "http.decode",
]);
export type SignatureKitOperation = (typeof SignatureKitOperationSchema)["Type"];
export const SignatureKitOperationValue = {
  pkcs12Parse: "pkcs12.parse",
  x509Parse: "x509.parse",
  cryptoDigest: "crypto.digest",
  cryptoImport: "crypto.import",
  cryptoSign: "crypto.sign",
  cryptoVerify: "crypto.verify",
  httpRequest: "http.request",
  httpDecode: "http.decode",
  schemaDecode: "schema.decode",
} satisfies Record<string, SignatureKitOperation>;

export class SignatureKitError extends Schema.TaggedErrorClass<SignatureKitError>()(
  "SignatureKitError",
  {
    code: SignatureKitErrorCodeSchema,
    retryable: Schema.Boolean,
    reason: Schema.optional(Schema.String),
    operation: Schema.optional(Schema.String),
    schemaName: Schema.optional(Schema.String),
    issueMessage: Schema.optional(Schema.String),
    provider: Schema.optional(Schema.String),
    status: Schema.optional(Schema.Number),
    retryAfterEpochSeconds: Schema.optional(Schema.Number),
  },
) {
  get message(): string {
    const catalogEntry = signatureKitErrorCatalogEntry(this.code);
    return catalogEntry.overridable ? (this.reason ?? catalogEntry.message) : catalogEntry.message;
  }
}

export class Signatures extends Context.Service<Signatures, SignerAdapter>()(
  "@signature-kit/signatures/Signatures",
) {}

export const signaturesLayer = (signer: SignerAdapter): Layer.Layer<Signatures> =>
  Layer.succeed(Signatures, signer);

export const signatures = {
  inspect: (): Effect.Effect<SignerIdentity, SignatureKitError, Signatures> =>
    Signatures.use((service) => service.inspect()),
  certificate: (): Effect.Effect<Certificate, SignatureKitError, Signatures> =>
    Signatures.use((service) => service.certificate()),
  importSigningKey: (
    algorithm: SignatureAlgorithm,
  ): Effect.Effect<CryptoKey, SignatureKitError, Signatures> =>
    Schema.decodeUnknownEffect(SignatureAlgorithmSchema)(algorithm).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            reason: "Invalid signature algorithm.",
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: "SignatureAlgorithm",
            issueMessage: String(issue),
          }),
      ),
      Effect.flatMap((valid) => Signatures.use((service) => service.importSigningKey(valid))),
    ),
  sign: (input: SignInput): Effect.Effect<SignatureArtifact, SignatureKitError, Signatures> =>
    Schema.decodeUnknownEffect(SignInputSchema)(input).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            reason: "Invalid sign input.",
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: "SignInput",
            issueMessage: String(issue),
          }),
      ),
      Effect.flatMap((valid) => Signatures.use((service) => service.sign(valid))),
    ),
  verify: (input: VerifyInput): Effect.Effect<VerificationResult, SignatureKitError, Signatures> =>
    Schema.decodeUnknownEffect(VerifyInputSchema)(input).pipe(
      Effect.mapError(
        (issue) =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            reason: "Invalid verify input.",
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: "VerifyInput",
            issueMessage: String(issue),
          }),
      ),
      Effect.flatMap((valid) => Signatures.use((service) => service.verify(valid))),
    ),
};
