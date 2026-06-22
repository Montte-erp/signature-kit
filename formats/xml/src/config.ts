import { Schema } from "effect";
import type { SignatureAlgorithm } from "@signature-kit/contracts";

export type XmlErrorCode =
  | "xml.RUNTIME_UNAVAILABLE"
  | "xml.INVALID_XML"
  | "xml.SIGNATURE_NOT_FOUND"
  | "xml.UNSUPPORTED_ALGORITHM"
  | "xml.KEY_IMPORT_FAILED"
  | "xml.SIGN_FAILED"
  | "xml.VERIFY_FAILED";

const XmlErrorCodeSchema: Schema.Decoder<XmlErrorCode> = Schema.Literals([
  "xml.RUNTIME_UNAVAILABLE",
  "xml.INVALID_XML",
  "xml.SIGNATURE_NOT_FOUND",
  "xml.UNSUPPORTED_ALGORITHM",
  "xml.KEY_IMPORT_FAILED",
  "xml.SIGN_FAILED",
  "xml.VERIFY_FAILED",
]);

export const XmlErrorCodeValue = {
  runtimeUnavailable: "xml.RUNTIME_UNAVAILABLE",
  invalidXml: "xml.INVALID_XML",
  signatureNotFound: "xml.SIGNATURE_NOT_FOUND",
  unsupportedAlgorithm: "xml.UNSUPPORTED_ALGORITHM",
  keyImportFailed: "xml.KEY_IMPORT_FAILED",
  signFailed: "xml.SIGN_FAILED",
  verifyFailed: "xml.VERIFY_FAILED",
} satisfies Record<string, XmlErrorCode>;

export type XmlOperation =
  | "xml.runtime"
  | "xml.parse"
  | "xml.key-import"
  | "xml.sign"
  | "xml.verify";

const XmlOperationSchema: Schema.Decoder<XmlOperation> = Schema.Literals([
  "xml.runtime",
  "xml.parse",
  "xml.key-import",
  "xml.sign",
  "xml.verify",
]);

export const XmlOperationValue = {
  runtime: "xml.runtime",
  parse: "xml.parse",
  keyImport: "xml.key-import",
  sign: "xml.sign",
  verify: "xml.verify",
} satisfies Record<string, XmlOperation>;

export type XmlSigningRequest = {
  readonly xml: string;
  readonly algorithm?: SignatureAlgorithm | undefined;
  readonly referenceId?: string | undefined;
  readonly signatureId?: string | undefined;
  readonly signingTime?: Date | undefined;
};

export type XmlVerificationRequest = {
  readonly xml: string;
  readonly algorithm?: SignatureAlgorithm | undefined;
  readonly publicKeyDer?: Uint8Array | undefined;
  readonly requireReferenceUri?: string | undefined;
};

export type XmlVerificationResult = {
  readonly valid: boolean;
  readonly signatureCount: number;
  readonly referenceUris: readonly string[];
};

type XmlErrorFields = {
  readonly code: XmlErrorCode;
  readonly retryable: boolean;
  readonly reason?: string | undefined;
  readonly operation?: XmlOperation | undefined;
  readonly upstreamTag?: string | undefined;
  readonly upstreamCode?: string | undefined;
};

type XmlErrorInput = XmlErrorFields & {
  readonly cause?: unknown;
};

type XmlErrorConstructor = new (input: XmlErrorInput) => XmlErrorFields;

const XmlErrorBase: XmlErrorConstructor = Schema.TaggedErrorClass<XmlErrorFields>()("XmlError", {
  code: XmlErrorCodeSchema,
  retryable: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  operation: Schema.optional(XmlOperationSchema),
  upstreamTag: Schema.optional(Schema.String),
  upstreamCode: Schema.optional(Schema.String),
});

export class XmlError extends XmlErrorBase {
  get message(): string {
    return this.reason ?? this.code;
  }
}

const firstStringField = (input: unknown, field: string): string | undefined => {
  if (input === null || typeof input !== "object") return undefined;
  const value = Reflect.get(input, field);
  return typeof value === "string" ? value : undefined;
};

export type XmlCauseMetadata = {
  readonly reason?: string | undefined;
  readonly upstreamTag?: string | undefined;
  readonly upstreamCode?: string | undefined;
};

export const safeCauseMetadata = (cause: unknown): XmlCauseMetadata => ({
  reason: firstStringField(cause, "message"),
  upstreamTag: firstStringField(cause, "_tag") ?? firstStringField(cause, "name"),
  upstreamCode: firstStringField(cause, "code"),
});
