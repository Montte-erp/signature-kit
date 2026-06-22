/**
 * @signature-kit/contracts — contracts, schemas, and the single typed error model.
 *
 * Everything that defines the shape of the signing runtime lives here:
 * the certificate data contract, the signer-adapter contract, the byte
 * signing inputs, and the one `SignatureKitError` every package constructs at
 * its own decision point. No package invents a parallel error model.
 */

import { Schema } from "effect";
import type { Effect, Redacted, SchemaIssue } from "effect";

// =============================================================================
// Primitive decoders
// =============================================================================

const nonEmptyString: Schema.Decoder<string> = Schema.NonEmptyString;
const cnpjDigits: Schema.Decoder<string> = Schema.String.check(Schema.isPattern(/^\d{14}$/));
const cpfDigits: Schema.Decoder<string> = Schema.String.check(Schema.isPattern(/^\d{11}$/));
const sha256Hex: Schema.Decoder<string> = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const certificatePem: Schema.Decoder<string> = Schema.String.check(
  Schema.isPattern(/-----BEGIN CERTIFICATE-----/),
);
const redactedPrivateKeyPem: Schema.Decoder<Redacted.Redacted<string>> = Schema.RedactedFromValue(
  Schema.String.check(Schema.isPattern(/-----BEGIN (RSA )?PRIVATE KEY-----/)),
  { label: "signature-kit-private-key", disallowEncode: true },
);

// =============================================================================
// Signature algorithm
// =============================================================================

export type SignatureAlgorithm = "rsa-sha256" | "rsa-sha512";
const SignatureAlgorithmSchema: Schema.Decoder<SignatureAlgorithm> = Schema.Literals([
  "rsa-sha256",
  "rsa-sha512",
]);
export const signatureAlgorithmSchema: Schema.Decoder<SignatureAlgorithm> =
  SignatureAlgorithmSchema;
export const SignatureAlgorithmValue = {
  rsaSha256: "rsa-sha256",
  rsaSha512: "rsa-sha512",
} satisfies Record<string, SignatureAlgorithm>;

// =============================================================================
// Certificate data contract
// =============================================================================

export type CertificateSubject = {
  readonly commonName: string | null;
  readonly organization: string | null;
  readonly organizationalUnit: string | null;
  readonly country: string | null;
  readonly state: string | null;
  readonly locality: string | null;
  readonly raw: string;
};
const CertificateSubjectSchema: Schema.Decoder<CertificateSubject> = Schema.Struct({
  commonName: Schema.NullOr(Schema.String),
  organization: Schema.NullOr(Schema.String),
  organizationalUnit: Schema.NullOr(Schema.String),
  country: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.String),
  locality: Schema.NullOr(Schema.String),
  raw: Schema.String,
});

export type CertificateIssuer = {
  readonly commonName: string | null;
  readonly organization: string | null;
  readonly country: string | null;
  readonly raw: string;
};
const CertificateIssuerSchema: Schema.Decoder<CertificateIssuer> = Schema.Struct({
  commonName: Schema.NullOr(Schema.String),
  organization: Schema.NullOr(Schema.String),
  country: Schema.NullOr(Schema.String),
  raw: Schema.String,
});

export type CertificateValidity = {
  readonly notBefore: Date;
  readonly notAfter: Date;
};
const CertificateValiditySchema: Schema.Decoder<CertificateValidity> = Schema.Struct({
  notBefore: Schema.Date,
  notAfter: Schema.Date,
});

export type BrazilianFields = {
  readonly cnpj: string | null;
  readonly cpf: string | null;
};
const BrazilianFieldsSchema: Schema.Decoder<BrazilianFields> = Schema.Struct({
  cnpj: Schema.NullOr(cnpjDigits),
  cpf: Schema.NullOr(cpfDigits),
});

/**
 * Fully parsed A1 certificate. The private key stays `Redacted` until the
 * explicit Web Crypto import boundary inside a signer adapter.
 */
export type Certificate = {
  readonly serialNumber: string;
  readonly subject: CertificateSubject;
  readonly issuer: CertificateIssuer;
  readonly validity: CertificateValidity;
  readonly fingerprint: string;
  readonly subjectAltName: string | null;
  readonly isValid: boolean;
  readonly brazilian: BrazilianFields;
  readonly certPem: string;
  readonly certificateDer: Uint8Array;
  readonly publicKeyDer: Uint8Array;
  readonly privateKeyPem: Redacted.Redacted<string>;
};
const CertificateSchema: Schema.Decoder<Certificate> = Schema.Struct({
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
export const certificateSchema: Schema.Decoder<Certificate> = CertificateSchema;

// =============================================================================
// Signer adapter contract
// =============================================================================

/** Normalized signer identity, backend-agnostic. */
export type SignerIdentity = {
  readonly subject: string;
  readonly issuer: string;
  readonly serialNumber: string;
  readonly thumbprint: string;
  readonly validFrom: Date;
  readonly validTo: Date;
  readonly document?: string | undefined;
};
const SignerIdentitySchema: Schema.Decoder<SignerIdentity> = Schema.Struct({
  subject: Schema.String,
  issuer: Schema.String,
  serialNumber: Schema.String,
  thumbprint: Schema.String,
  validFrom: Schema.Date,
  validTo: Schema.Date,
  document: Schema.optional(Schema.String),
});
export const signerIdentitySchema: Schema.Decoder<SignerIdentity> = SignerIdentitySchema;

export type SignInput = {
  readonly content: Uint8Array;
  readonly algorithm: SignatureAlgorithm;
};
const SignInputSchema: Schema.Decoder<SignInput> = Schema.Struct({
  content: Schema.Uint8Array,
  algorithm: SignatureAlgorithmSchema,
});
export const signInputSchema: Schema.Decoder<SignInput> = SignInputSchema;

export type VerifyInput = {
  readonly content: Uint8Array;
  readonly signature: Uint8Array;
  readonly algorithm: SignatureAlgorithm;
};
const VerifyInputSchema: Schema.Decoder<VerifyInput> = Schema.Struct({
  content: Schema.Uint8Array,
  signature: Schema.Uint8Array,
  algorithm: SignatureAlgorithmSchema,
});
export const verifyInputSchema: Schema.Decoder<VerifyInput> = VerifyInputSchema;

export type SignatureArtifact = {
  readonly algorithm: SignatureAlgorithm;
  readonly signature: Uint8Array;
};

export type VerificationResult = {
  readonly valid: boolean;
  readonly algorithm: SignatureAlgorithm;
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

export type SignatureKitErrorCode =
  | "signature-kit.EMPTY_FILE"
  | "signature-kit.INVALID_FORMAT"
  | "signature-kit.INVALID_INPUT"
  | "signature-kit.WRONG_PASSWORD"
  | "signature-kit.UNSUPPORTED_ALGORITHM"
  | "signature-kit.NO_CERTIFICATE"
  | "signature-kit.NO_PRIVATE_KEY"
  | "signature-kit.CORRUPTED_FILE"
  | "signature-kit.X509_PARSE_FAILED"
  | "signature-kit.PEM_EXTRACTION_FAILED"
  | "signature-kit.KEY_IMPORT_FAILED"
  | "signature-kit.DIGEST_FAILED"
  | "signature-kit.SIGN_FAILED"
  | "signature-kit.VERIFY_FAILED"
  | "signature-kit.UNKNOWN";
const SignatureKitErrorCodeSchema: Schema.Decoder<SignatureKitErrorCode> = Schema.Literals([
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
  "signature-kit.UNKNOWN",
]);
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
  unknown: "signature-kit.UNKNOWN",
} satisfies Record<string, SignatureKitErrorCode>;

export type SignatureKitOperation =
  | "pkcs12.parse"
  | "x509.parse"
  | "crypto.digest"
  | "crypto.import"
  | "crypto.sign"
  | "crypto.verify"
  | "schema.decode";
const SignatureKitOperationSchema: Schema.Decoder<SignatureKitOperation> = Schema.Literals([
  "pkcs12.parse",
  "x509.parse",
  "crypto.digest",
  "crypto.import",
  "crypto.sign",
  "crypto.verify",
  "schema.decode",
]);
export const SignatureKitOperationValue = {
  pkcs12Parse: "pkcs12.parse",
  x509Parse: "x509.parse",
  cryptoDigest: "crypto.digest",
  cryptoImport: "crypto.import",
  cryptoSign: "crypto.sign",
  cryptoVerify: "crypto.verify",
  schemaDecode: "schema.decode",
} satisfies Record<string, SignatureKitOperation>;

export type SignatureKitSchemaName =
  | "Certificate"
  | "SignInput"
  | "VerifyInput"
  | "A1SignerOptions";
const SignatureKitSchemaNameSchema: Schema.Decoder<SignatureKitSchemaName> = Schema.Literals([
  "Certificate",
  "SignInput",
  "VerifyInput",
  "A1SignerOptions",
]);
export const SignatureKitSchemaNameValue = {
  certificate: "Certificate",
  signInput: "SignInput",
  verifyInput: "VerifyInput",
  a1SignerOptions: "A1SignerOptions",
} satisfies Record<string, SignatureKitSchemaName>;

type SignatureKitErrorFields = {
  readonly _tag: "SignatureKitError";
  readonly code: SignatureKitErrorCode;
  readonly retryable: boolean;
  readonly reason?: string | undefined;
  readonly operation?: SignatureKitOperation | undefined;
  readonly schemaName?: SignatureKitSchemaName | undefined;
  readonly issuePath?: string | undefined;
  readonly issueMessage?: string | undefined;
  readonly upstreamTag?: string | undefined;
  readonly upstreamCode?: string | undefined;
};

type SignatureKitErrorInput = {
  readonly code: SignatureKitErrorCode;
  readonly retryable: boolean;
  readonly reason?: string | undefined;
  readonly operation?: SignatureKitOperation | undefined;
  readonly schemaName?: SignatureKitSchemaName | undefined;
  readonly issuePath?: string | undefined;
  readonly issueMessage?: string | undefined;
  readonly upstreamTag?: string | undefined;
  readonly upstreamCode?: string | undefined;
};

type SignatureKitErrorConstructor = new (input: SignatureKitErrorInput) => SignatureKitErrorFields;

const SignatureKitErrorBase: SignatureKitErrorConstructor =
  Schema.TaggedErrorClass<SignatureKitErrorFields>()("SignatureKitError", {
    code: SignatureKitErrorCodeSchema,
    retryable: Schema.Boolean,
    reason: Schema.optional(Schema.String),
    operation: Schema.optional(SignatureKitOperationSchema),
    schemaName: Schema.optional(SignatureKitSchemaNameSchema),
    issuePath: Schema.optional(Schema.String),
    issueMessage: Schema.optional(Schema.String),
    upstreamTag: Schema.optional(Schema.String),
    upstreamCode: Schema.optional(Schema.String),
  });

export class SignatureKitError extends SignatureKitErrorBase {
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
      case "signature-kit.UNKNOWN":
        return this.reason ?? "Unknown SignatureKit failure.";
    }
  }
}

// =============================================================================
// Boundary helpers (preserve structured origin metadata, never branch on shapes)
// =============================================================================

type SafeCauseMetadata = {
  readonly upstreamTag?: string | undefined;
  readonly upstreamCode?: string | undefined;
};

const firstStringField = (input: unknown, field: string): string | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  // Reflect.get (not Object.entries) so prototype getters like DOMException.name
  // — the useful tag on Web Crypto failures — are captured.
  const value = Reflect.get(input, field);
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return value.toString();
  return undefined;
};

export const safeCauseMetadata = (cause: unknown): SafeCauseMetadata => ({
  upstreamTag: firstStringField(cause, "_tag") ?? firstStringField(cause, "name"),
  upstreamCode: firstStringField(cause, "code"),
});

type SchemaIssueMetadata = {
  readonly issuePath?: string | undefined;
  readonly issueMessage: string;
  readonly upstreamTag: string;
};

const formatIssuePath = (path: ReadonlyArray<PropertyKey>): string | undefined =>
  path.length === 0 ? undefined : path.map((segment) => String(segment)).join(".");

const schemaIssueLeafMetadata = (
  issue: SchemaIssue.Issue,
  path: ReadonlyArray<PropertyKey> = [],
): SchemaIssueMetadata => {
  switch (issue._tag) {
    case "Pointer":
      return schemaIssueLeafMetadata(issue.issue, [...path, ...issue.path]);
    case "Composite":
      return schemaIssueLeafMetadata(issue.issues[0], path);
    case "Encoding":
      return schemaIssueLeafMetadata(issue.issue, path);
    case "Filter":
      return schemaIssueLeafMetadata(issue.issue, path);
    case "AnyOf":
      return issue.issues[0] === undefined
        ? {
            issuePath: formatIssuePath(path),
            issueMessage: "No union member accepted the value.",
            upstreamTag: issue._tag,
          }
        : schemaIssueLeafMetadata(issue.issues[0], path);
    case "InvalidType":
      return {
        issuePath: formatIssuePath(path),
        issueMessage: "Invalid type for schema.",
        upstreamTag: issue._tag,
      };
    case "InvalidValue":
      return {
        issuePath: formatIssuePath(path),
        issueMessage: "Invalid value for schema.",
        upstreamTag: issue._tag,
      };
    case "MissingKey":
      return {
        issuePath: formatIssuePath(path),
        issueMessage: "Required key missing.",
        upstreamTag: issue._tag,
      };
    case "UnexpectedKey":
      return {
        issuePath: formatIssuePath(path),
        issueMessage: "Unexpected key.",
        upstreamTag: issue._tag,
      };
    case "Forbidden":
      return {
        issuePath: formatIssuePath(path),
        issueMessage: "Forbidden operation during schema decode.",
        upstreamTag: issue._tag,
      };
    case "OneOf":
      return {
        issuePath: formatIssuePath(path),
        issueMessage: "More than one union member accepted the value.",
        upstreamTag: issue._tag,
      };
  }
};

export const schemaErrorMetadata = (error: Schema.SchemaError): SchemaIssueMetadata =>
  schemaIssueLeafMetadata(error.issue);
