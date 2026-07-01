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

export const RemoteSignatureStateSchema = Schema.Literals([
  "draft",
  "sent",
  "completed",
  "cancelled",
  "deleted",
  "declined",
  "expired",
]);
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
  documents: Schema.NonEmptyArray(RemoteSignatureDocumentSchema),
  recipients: Schema.NonEmptyArray(RemoteSignatureRecipientSchema),
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
  documents: Schema.NonEmptyArray(RemoteSignatureDocumentPropsSchema),
  recipients: Schema.NonEmptyArray(RemoteSignatureRecipientSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: Schema.optional(nonEmptyString),
});
export type RemoteSignatureRequestProps = (typeof RemoteSignatureRequestPropsSchema)["Type"];

export const remoteSignatureInputFromProps = (
  props: RemoteSignatureRequestProps,
): RemoteSignatureRequestInput => {
  const [firstDocument, ...restDocuments] = props.documents;
  return {
    title: props.title,
    documents: [
      {
        fileName: firstDocument.fileName,
        mimeType: firstDocument.mimeType,
        content: Uint8Array.fromBase64(firstDocument.contentBase64),
      },
      ...restDocuments.map((document) => ({
        fileName: document.fileName,
        mimeType: document.mimeType,
        content: Uint8Array.fromBase64(document.contentBase64),
      })),
    ],
    recipients: props.recipients,
    ...(props.subject === undefined ? {} : { subject: props.subject }),
    ...(props.message === undefined ? {} : { message: props.message }),
    ...(props.send === undefined ? {} : { send: props.send }),
    ...(props.expiresAt === undefined ? {} : { expiresAt: props.expiresAt }),
    ...(props.redirectUrl === undefined ? {} : { redirectUrl: props.redirectUrl }),
  };
};

export const RemoteSignatureRequestSchema = Schema.Struct({
  provider: RemoteSignatureProviderSchema,
  id: nonEmptyString,
  state: RemoteSignatureStateSchema,
  providerStatus: Schema.optional(Schema.String),
  signingUrl: Schema.optional(Schema.String),
  detailsUrl: Schema.optional(Schema.String),
  downloadUrl: Schema.optional(Schema.String),
});
export type RemoteSignatureRequest = (typeof RemoteSignatureRequestSchema)["Type"];

export const remoteSignatureInputFromResourceProps = (
  provider: RemoteSignatureProvider,
  props: unknown,
): Effect.Effect<RemoteSignatureRequestInput, SignatureKitError> =>
  Schema.decodeUnknownEffect(RemoteSignatureRequestPropsSchema)(props).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          provider,
          operation: SignatureKitOperationValue.schemaDecode,
          schemaName: SignatureKitSchemaNameValue.remoteSignatureRequestProps,
          issueMessage: String(issue),
        }),
    ),
    Effect.map(remoteSignatureInputFromProps),
  );

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

export const SignatureKitErrorCatalogEntrySchema = Schema.Struct({
  code: SignatureKitErrorCodeSchema,
  message: Schema.String,
  overridable: Schema.Boolean,
});
export type SignatureKitErrorCatalogEntry = (typeof SignatureKitErrorCatalogEntrySchema)["Type"];

const signatureKitErrorCatalogByCode = {
  "signature-kit.EMPTY_FILE": {
    code: "signature-kit.EMPTY_FILE",
    message: "Certificate file is empty (0 bytes).",
    overridable: false,
  },
  "signature-kit.INVALID_FORMAT": {
    code: "signature-kit.INVALID_FORMAT",
    message: "The file is not a PKCS#12 (.pfx/.p12) certificate.",
    overridable: true,
  },
  "signature-kit.INVALID_INPUT": {
    code: "signature-kit.INVALID_INPUT",
    message: "Invalid signing input.",
    overridable: true,
  },
  "signature-kit.WRONG_PASSWORD": {
    code: "signature-kit.WRONG_PASSWORD",
    message: "Wrong certificate password.",
    overridable: false,
  },
  "signature-kit.UNSUPPORTED_ALGORITHM": {
    code: "signature-kit.UNSUPPORTED_ALGORITHM",
    message: "The certificate uses an unsupported encryption algorithm.",
    overridable: true,
  },
  "signature-kit.NO_CERTIFICATE": {
    code: "signature-kit.NO_CERTIFICATE",
    message: "The file does not contain a certificate.",
    overridable: false,
  },
  "signature-kit.NO_PRIVATE_KEY": {
    code: "signature-kit.NO_PRIVATE_KEY",
    message: "The file does not contain a private key.",
    overridable: false,
  },
  "signature-kit.CORRUPTED_FILE": {
    code: "signature-kit.CORRUPTED_FILE",
    message: "The file is corrupted or not a valid PKCS#12 certificate.",
    overridable: false,
  },
  "signature-kit.X509_PARSE_FAILED": {
    code: "signature-kit.X509_PARSE_FAILED",
    message: "X.509 parsing failed.",
    overridable: true,
  },
  "signature-kit.PEM_EXTRACTION_FAILED": {
    code: "signature-kit.PEM_EXTRACTION_FAILED",
    message: "Failed to extract PEM material from the PFX.",
    overridable: false,
  },
  "signature-kit.KEY_IMPORT_FAILED": {
    code: "signature-kit.KEY_IMPORT_FAILED",
    message: "Failed to import the key into Web Crypto.",
    overridable: true,
  },
  "signature-kit.DIGEST_FAILED": {
    code: "signature-kit.DIGEST_FAILED",
    message: "Failed to compute the certificate digest.",
    overridable: false,
  },
  "signature-kit.SIGN_FAILED": {
    code: "signature-kit.SIGN_FAILED",
    message: "Failed to sign the content.",
    overridable: true,
  },
  "signature-kit.VERIFY_FAILED": {
    code: "signature-kit.VERIFY_FAILED",
    message: "Failed to verify the signature.",
    overridable: true,
  },
  "signature-kit.HTTP": {
    code: "signature-kit.HTTP",
    message: "Remote signature HTTP request failed.",
    overridable: true,
  },
  "signature-kit.RESPONSE_SHAPE": {
    code: "signature-kit.RESPONSE_SHAPE",
    message: "Remote signature response shape was invalid.",
    overridable: true,
  },
  "signature-kit.UNSUPPORTED_OPERATION": {
    code: "signature-kit.UNSUPPORTED_OPERATION",
    message: "Remote signature operation is unsupported.",
    overridable: true,
  },
  "signature-kit.UNKNOWN": {
    code: "signature-kit.UNKNOWN",
    message: "Unknown SignatureKit failure.",
    overridable: true,
  },
} satisfies Record<SignatureKitErrorCode, SignatureKitErrorCatalogEntry>;

export const signatureKitErrorCatalog: readonly SignatureKitErrorCatalogEntry[] = [
  signatureKitErrorCatalogByCode["signature-kit.EMPTY_FILE"],
  signatureKitErrorCatalogByCode["signature-kit.INVALID_FORMAT"],
  signatureKitErrorCatalogByCode["signature-kit.INVALID_INPUT"],
  signatureKitErrorCatalogByCode["signature-kit.WRONG_PASSWORD"],
  signatureKitErrorCatalogByCode["signature-kit.UNSUPPORTED_ALGORITHM"],
  signatureKitErrorCatalogByCode["signature-kit.NO_CERTIFICATE"],
  signatureKitErrorCatalogByCode["signature-kit.NO_PRIVATE_KEY"],
  signatureKitErrorCatalogByCode["signature-kit.CORRUPTED_FILE"],
  signatureKitErrorCatalogByCode["signature-kit.X509_PARSE_FAILED"],
  signatureKitErrorCatalogByCode["signature-kit.PEM_EXTRACTION_FAILED"],
  signatureKitErrorCatalogByCode["signature-kit.KEY_IMPORT_FAILED"],
  signatureKitErrorCatalogByCode["signature-kit.DIGEST_FAILED"],
  signatureKitErrorCatalogByCode["signature-kit.SIGN_FAILED"],
  signatureKitErrorCatalogByCode["signature-kit.VERIFY_FAILED"],
  signatureKitErrorCatalogByCode["signature-kit.HTTP"],
  signatureKitErrorCatalogByCode["signature-kit.RESPONSE_SHAPE"],
  signatureKitErrorCatalogByCode["signature-kit.UNSUPPORTED_OPERATION"],
  signatureKitErrorCatalogByCode["signature-kit.UNKNOWN"],
];

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
  "remote.get",
  "remote.list",
  "remote.cancel",
  "remote.delete",
  "remote.download",
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
  remoteGet: "remote.get",
  remoteList: "remote.list",
  remoteCancel: "remote.cancel",
  remoteDelete: "remote.delete",
  remoteDownload: "remote.download",
  schemaDecode: "schema.decode",
} satisfies Record<string, SignatureKitOperation>;

export const SignatureKitSchemaNameSchema = Schema.Literals([
  "Certificate",
  "CertificateSource",
  "SignInput",
  "VerifyInput",
  "A1SignerOptions",
  "A1RemoteFetch",
  "A1RemoteSource",
  "RemoteSignatureRequestInput",
  "RemoteSignatureRequestProps",
  "ProviderHttpRequest",
  "ClicksignProviderOptions",
  "ClicksignDocumentResult",
  "ClicksignSignerResult",
  "ClicksignListResult",
  "ClicksignDocumentsResult",
  "AssinafyProviderOptions",
  "AssinafyDocumentResult",
  "AssinafySignerResult",
  "AssinafyAssignmentResult",
  "AssinafyAssignmentsResult",
  "ZapSignProviderOptions",
  "ZapSignDocumentResult",
  "ZapSignDocumentsResult",
  "DocuSealProviderOptions",
  "DocuSealSubmissionResult",
  "DocuSealSubmissionsResult",
  "DocuSealSubmissionDocumentsResult",
  "DocumensoProviderOptions",
  "DocumensoCreateEnvelopeResult",
  "DocumensoDistributeEnvelopeResult",
  "DocumensoEnvelopeResult",
  "DocumensoEnvelopeListResult",
]);
export type SignatureKitSchemaName = (typeof SignatureKitSchemaNameSchema)["Type"];
export const SignatureKitSchemaNameValue = {
  certificate: "Certificate",
  certificateSource: "CertificateSource",
  signInput: "SignInput",
  verifyInput: "VerifyInput",
  remoteSignatureRequestInput: "RemoteSignatureRequestInput",
  remoteSignatureRequestProps: "RemoteSignatureRequestProps",
  providerHttpRequest: "ProviderHttpRequest",
  clicksignProviderOptions: "ClicksignProviderOptions",
  clicksignDocumentResult: "ClicksignDocumentResult",
  clicksignSignerResult: "ClicksignSignerResult",
  clicksignListResult: "ClicksignListResult",
  clicksignDocumentsResult: "ClicksignDocumentsResult",
  assinafyProviderOptions: "AssinafyProviderOptions",
  assinafyDocumentResult: "AssinafyDocumentResult",
  assinafySignerResult: "AssinafySignerResult",
  assinafyAssignmentResult: "AssinafyAssignmentResult",
  assinafyAssignmentsResult: "AssinafyAssignmentsResult",
  zapSignProviderOptions: "ZapSignProviderOptions",
  zapSignDocumentResult: "ZapSignDocumentResult",
  zapSignDocumentsResult: "ZapSignDocumentsResult",
  docuSealProviderOptions: "DocuSealProviderOptions",
  docuSealSubmissionResult: "DocuSealSubmissionResult",
  docuSealSubmissionsResult: "DocuSealSubmissionsResult",
  docuSealSubmissionDocumentsResult: "DocuSealSubmissionDocumentsResult",
  documensoProviderOptions: "DocumensoProviderOptions",
  documensoCreateEnvelopeResult: "DocumensoCreateEnvelopeResult",
  documensoDistributeEnvelopeResult: "DocumensoDistributeEnvelopeResult",
  documensoEnvelopeResult: "DocumensoEnvelopeResult",
  documensoEnvelopeListResult: "DocumensoEnvelopeListResult",
  a1SignerOptions: "A1SignerOptions",
  a1RemoteFetch: "A1RemoteFetch",
  a1RemoteSource: "A1RemoteSource",
} satisfies Record<string, SignatureKitSchemaName>;

export class SignatureKitError extends Schema.TaggedErrorClass<SignatureKitError>()(
  "SignatureKitError",
  {
    code: SignatureKitErrorCodeSchema,
    retryable: Schema.Boolean,
    reason: Schema.optional(Schema.String),
    operation: Schema.optional(SignatureKitOperationSchema),
    schemaName: Schema.optional(SignatureKitSchemaNameSchema),
    issueMessage: Schema.optional(Schema.String),
    provider: Schema.optional(RemoteSignatureProviderSchema),
    status: Schema.optional(Schema.Number),
  },
) {
  get message(): string {
    const catalogEntry = signatureKitErrorCatalogByCode[this.code];
    return catalogEntry.overridable ? (this.reason ?? catalogEntry.message) : catalogEntry.message;
  }
}
