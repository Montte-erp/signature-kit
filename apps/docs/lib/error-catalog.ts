export interface ErrorEntry {
  /** The literal `signature-kit.*` code. */
  readonly code: string;
  /** The default `message` text for this code. */
  readonly message: string;
  /** Whether `reason` can override the default message. */
  readonly overridable: boolean;
}

/**
 * The 18 `SignatureKitError` codes and their default messages, mirroring the
 * `signature-kit.*` literal union in `@signature-kit/core`.
 */
export const errorCatalog: readonly ErrorEntry[] = [
  { code: "signature-kit.EMPTY_FILE", message: "Certificate file is empty (0 bytes).", overridable: false },
  { code: "signature-kit.INVALID_FORMAT", message: "The file is not a PKCS#12 (.pfx/.p12) certificate.", overridable: true },
  { code: "signature-kit.INVALID_INPUT", message: "Invalid signing input.", overridable: true },
  { code: "signature-kit.WRONG_PASSWORD", message: "Wrong certificate password.", overridable: false },
  { code: "signature-kit.UNSUPPORTED_ALGORITHM", message: "The certificate uses an unsupported encryption algorithm.", overridable: true },
  { code: "signature-kit.NO_CERTIFICATE", message: "The file does not contain a certificate.", overridable: false },
  { code: "signature-kit.NO_PRIVATE_KEY", message: "The file does not contain a private key.", overridable: false },
  { code: "signature-kit.CORRUPTED_FILE", message: "The file is corrupted or not a valid PKCS#12 certificate.", overridable: false },
  { code: "signature-kit.X509_PARSE_FAILED", message: "X.509 parsing failed.", overridable: true },
  { code: "signature-kit.PEM_EXTRACTION_FAILED", message: "Failed to extract PEM material from the PFX.", overridable: false },
  { code: "signature-kit.KEY_IMPORT_FAILED", message: "Failed to import the key into Web Crypto.", overridable: true },
  { code: "signature-kit.DIGEST_FAILED", message: "Failed to compute the certificate digest.", overridable: false },
  { code: "signature-kit.SIGN_FAILED", message: "Failed to sign the content.", overridable: true },
  { code: "signature-kit.VERIFY_FAILED", message: "Failed to verify the signature.", overridable: true },
  { code: "signature-kit.HTTP", message: "Remote signature HTTP request failed.", overridable: true },
  { code: "signature-kit.RESPONSE_SHAPE", message: "Remote signature response shape was invalid.", overridable: true },
  { code: "signature-kit.UNSUPPORTED_OPERATION", message: "Remote signature operation is unsupported.", overridable: true },
  { code: "signature-kit.UNKNOWN", message: "Unknown SignatureKit failure.", overridable: true },
];
