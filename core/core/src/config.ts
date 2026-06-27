/**
 * @signature-kit/core/config — contracts, schemas, and the single typed error model.
 *
 * Everything that defines the shape of the signing runtime lives here:
 * the certificate data contract, the signer-adapter contract, the byte
 * signing inputs, and the one `SignatureKitError` every package constructs at
 * its own decision point. No package invents a parallel error model.
 */

import { Effect, Schema } from "effect";
import type { Redacted } from "effect";

// =============================================================================
// Primitive decoders
// =============================================================================

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

// =============================================================================
// Signature algorithm
// =============================================================================

export const SignatureAlgorithmSchema = Schema.Literals(["rsa-sha1", "rsa-sha256", "rsa-sha512"]);
export type SignatureAlgorithm = (typeof SignatureAlgorithmSchema)["Type"];
export const SignatureAlgorithmValue = {
  rsaSha1: "rsa-sha1",
  rsaSha256: "rsa-sha256",
  rsaSha512: "rsa-sha512",
} satisfies Record<string, SignatureAlgorithm>;

// =============================================================================
// Certificate data contract
// =============================================================================

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

/**
 * Fully parsed A1 certificate. The private key stays `Redacted` until the
 * explicit Web Crypto import boundary inside a signer adapter.
 */
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
  publicKeyDer: Schema.Uint8Array,
  privateKeyPem: redactedPrivateKeyPem,
});
export type Certificate = (typeof CertificateSchema)["Type"];

// =============================================================================
// Signer adapter contract
// =============================================================================

/** Normalized signer identity, backend-agnostic. */
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

// =============================================================================
// Remote signature workflow contracts
// =============================================================================

export const RemoteSignatureProviderSchema = Schema.Literals([
  "clicksign",
  "assinafy",
  "zapsign",
  "docuseal",
  "documenso",
]);
export type RemoteSignatureProvider = (typeof RemoteSignatureProviderSchema)["Type"];

export const RemoteSignatureStateSchema = Schema.Literals(["draft", "sent"]);
export type RemoteSignatureState = (typeof RemoteSignatureStateSchema)["Type"];

export const RemoteSignatureRecipientRoleSchema = Schema.Literals(["approver", "signer"]);
export type RemoteSignatureRecipientRole = (typeof RemoteSignatureRecipientRoleSchema)["Type"];

export const RemoteSignatureDocumentSchema = Schema.Struct({
  fileName: nonEmptyString,
  mimeType: nonEmptyString,
  content: Schema.Uint8Array,
});
export type RemoteSignatureDocument = (typeof RemoteSignatureDocumentSchema)["Type"];

export const RemoteSignatureRecipientSchema = Schema.Struct({
  name: nonEmptyString,
  email: nonEmptyString,
  role: Schema.optional(RemoteSignatureRecipientRoleSchema),
  routingOrder: Schema.optional(Schema.Number),
});
export type RemoteSignatureRecipient = (typeof RemoteSignatureRecipientSchema)["Type"];

export const RemoteSignatureRequestInputSchema = Schema.Struct({
  title: nonEmptyString,
  subject: Schema.optional(nonEmptyString),
  message: Schema.optional(nonEmptyString),
  documents: Schema.Array(RemoteSignatureDocumentSchema),
  recipients: Schema.Array(RemoteSignatureRecipientSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: Schema.optional(nonEmptyString),
});
export type RemoteSignatureRequestInput = (typeof RemoteSignatureRequestInputSchema)["Type"];

const base64String: Schema.ConstraintDecoder<string> = Schema.String.check(Schema.isBase64());

export const RemoteSignatureDocumentPropsSchema = Schema.Struct({
  fileName: nonEmptyString,
  mimeType: nonEmptyString,
  contentBase64: base64String,
});
export type RemoteSignatureDocumentProps = (typeof RemoteSignatureDocumentPropsSchema)["Type"];

export const RemoteSignatureRequestPropsSchema = Schema.Struct({
  title: nonEmptyString,
  subject: Schema.optional(nonEmptyString),
  message: Schema.optional(nonEmptyString),
  documents: Schema.Array(RemoteSignatureDocumentPropsSchema),
  recipients: Schema.Array(RemoteSignatureRecipientSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: Schema.optional(nonEmptyString),
});
export type RemoteSignatureRequestProps = (typeof RemoteSignatureRequestPropsSchema)["Type"];

export const remoteSignatureInputFromProps = (
  props: RemoteSignatureRequestProps,
): RemoteSignatureRequestInput => ({
  title: props.title,
  documents: props.documents.map((document) => ({
    fileName: document.fileName,
    mimeType: document.mimeType,
    content: Uint8Array.fromBase64(document.contentBase64),
  })),
  recipients: props.recipients,
  ...(props.subject === undefined ? {} : { subject: props.subject }),
  ...(props.message === undefined ? {} : { message: props.message }),
  ...(props.send === undefined ? {} : { send: props.send }),
  ...(props.expiresAt === undefined ? {} : { expiresAt: props.expiresAt }),
  ...(props.redirectUrl === undefined ? {} : { redirectUrl: props.redirectUrl }),
});

export const RemoteSignatureRequestSchema = Schema.Struct({
  provider: RemoteSignatureProviderSchema,
  id: nonEmptyString,
  state: RemoteSignatureStateSchema,
  providerStatus: Schema.optional(Schema.String),
  signingUrl: Schema.optional(Schema.String),
  detailsUrl: Schema.optional(Schema.String),
});
export type RemoteSignatureRequest = (typeof RemoteSignatureRequestSchema)["Type"];

const hasDocumentsAndRecipients = (input: RemoteSignatureRequestInput): boolean =>
  input.documents.length > 0 && input.recipients.length > 0;

export const validRemoteSignatureRequest = (
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequestInput, SignatureKitError> => {
  if (hasDocumentsAndRecipients(input)) return Effect.succeed(input);
  return Effect.fail(
    new SignatureKitError({
      code: SignatureKitErrorCodeValue.invalidInput,
      retryable: false,
      operation: SignatureKitOperationValue.schemaDecode,
      schemaName: SignatureKitSchemaNameValue.remoteSignatureRequestInput,
      reason: "At least one document and one recipient are required.",
    }),
  );
};

/**
 * The capability seam. A signer owns "where the signing power comes from".
 * It never owns document-format mutation (XML/PDF live in format modules).
 */
export type SignerAdapter = {
  readonly id: string;
  inspect(): Effect.Effect<SignerIdentity, SignatureKitError>;
  certificate(): Effect.Effect<Certificate, SignatureKitError>;
  importSigningKey(algorithm: SignatureAlgorithm): Effect.Effect<CryptoKey, SignatureKitError>;
  sign(input: SignInput): Effect.Effect<SignatureArtifact, SignatureKitError>;
  verify(input: VerifyInput): Effect.Effect<VerificationResult, SignatureKitError>;
};

// =============================================================================
// Error model — one tagged error, a literal code catalog
// =============================================================================

export const SignatureKitErrorCodeSchema = Schema.Literals([
  "signature-kit.EMPTY_FILE",
  "signature-kit.INVALID_FORMAT",
  "signature-kit.INVALID_INPUT",
  "signature-kit.WRONG_PASSWORD",
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
  "remote.create",
  "remote.delete",
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
  remoteCreate: "remote.create",
  remoteDelete: "remote.delete",
  schemaDecode: "schema.decode",
} satisfies Record<string, SignatureKitOperation>;

export const SignatureKitSchemaNameSchema = Schema.Literals([
  "Certificate",
  "SignInput",
  "VerifyInput",
  "A1SignerOptions",
  "RemoteSignatureRequestInput",
  "RemoteSignatureRequestProps",
  "ProviderHttpRequest",
  "ClicksignProviderOptions",
  "ClicksignDocumentResult",
  "ClicksignSignerResult",
  "ClicksignListResult",
  "AssinafyProviderOptions",
  "AssinafyDocumentResult",
  "AssinafySignerResult",
  "AssinafyAssignmentResult",
  "ZapSignProviderOptions",
  "ZapSignDocumentResult",
  "DocuSealProviderOptions",
  "DocuSealSubmissionResult",
  "DocumensoProviderOptions",
  "DocumensoCreateEnvelopeResult",
  "DocumensoDistributeEnvelopeResult",
]);
export type SignatureKitSchemaName = (typeof SignatureKitSchemaNameSchema)["Type"];
export const SignatureKitSchemaNameValue = {
  certificate: "Certificate",
  signInput: "SignInput",
  verifyInput: "VerifyInput",
  remoteSignatureRequestInput: "RemoteSignatureRequestInput",
  remoteSignatureRequestProps: "RemoteSignatureRequestProps",
  providerHttpRequest: "ProviderHttpRequest",
  clicksignProviderOptions: "ClicksignProviderOptions",
  clicksignDocumentResult: "ClicksignDocumentResult",
  clicksignSignerResult: "ClicksignSignerResult",
  clicksignListResult: "ClicksignListResult",
  assinafyProviderOptions: "AssinafyProviderOptions",
  assinafyDocumentResult: "AssinafyDocumentResult",
  assinafySignerResult: "AssinafySignerResult",
  assinafyAssignmentResult: "AssinafyAssignmentResult",
  zapSignProviderOptions: "ZapSignProviderOptions",
  zapSignDocumentResult: "ZapSignDocumentResult",
  docuSealProviderOptions: "DocuSealProviderOptions",
  docuSealSubmissionResult: "DocuSealSubmissionResult",
  documensoProviderOptions: "DocumensoProviderOptions",
  documensoCreateEnvelopeResult: "DocumensoCreateEnvelopeResult",
  documensoDistributeEnvelopeResult: "DocumensoDistributeEnvelopeResult",
  a1SignerOptions: "A1SignerOptions",
} satisfies Record<string, SignatureKitSchemaName>;

export class SignatureKitError extends Schema.TaggedErrorClass<SignatureKitError>()(
  "SignatureKitError",
  {
    code: SignatureKitErrorCodeSchema,
    retryable: Schema.Boolean,
    reason: Schema.optional(Schema.String),
    operation: Schema.optional(SignatureKitOperationSchema),
    schemaName: Schema.optional(SignatureKitSchemaNameSchema),
    provider: Schema.optional(RemoteSignatureProviderSchema),
    status: Schema.optional(Schema.Number),
  },
) {
  get message(): string {
    switch (this.code) {
      case "signature-kit.EMPTY_FILE":
        return "Certificate file is empty (0 bytes).";
      case "signature-kit.INVALID_FORMAT":
        return this.reason ?? "The file is not a PKCS#12 (.pfx/.p12) certificate.";
      case "signature-kit.INVALID_INPUT":
        return this.reason ?? "Invalid signing input.";
      case "signature-kit.WRONG_PASSWORD":
        return "Wrong certificate password.";
      case "signature-kit.UNSUPPORTED_ALGORITHM":
        return this.reason ?? "The certificate uses an unsupported encryption algorithm.";
      case "signature-kit.NO_CERTIFICATE":
        return "The file does not contain a certificate.";
      case "signature-kit.NO_PRIVATE_KEY":
        return "The file does not contain a private key.";
      case "signature-kit.CORRUPTED_FILE":
        return "The file is corrupted or not a valid PKCS#12 certificate.";
      case "signature-kit.X509_PARSE_FAILED":
        return this.reason ?? "X.509 parsing failed.";
      case "signature-kit.PEM_EXTRACTION_FAILED":
        return "Failed to extract PEM material from the PFX.";
      case "signature-kit.KEY_IMPORT_FAILED":
        return this.reason ?? "Failed to import the key into Web Crypto.";
      case "signature-kit.DIGEST_FAILED":
        return "Failed to compute the certificate digest.";
      case "signature-kit.SIGN_FAILED":
        return this.reason ?? "Failed to sign the content.";
      case "signature-kit.VERIFY_FAILED":
        return this.reason ?? "Failed to verify the signature.";
      case "signature-kit.HTTP":
        return this.reason ?? "Remote signature HTTP request failed.";
      case "signature-kit.RESPONSE_SHAPE":
        return this.reason ?? "Remote signature response shape was invalid.";
      case "signature-kit.UNSUPPORTED_OPERATION":
        return this.reason ?? "Remote signature operation is unsupported.";
      case "signature-kit.UNKNOWN":
        return this.reason ?? "Unknown SignatureKit failure.";
    }
  }
}
