import { Schema } from "effect";
import type { CmsHashAlgorithm, IcpBrasilPolicy, TimestampOptions } from "@signature-kit/cms";

export type PdfErrorCode =
  | "pdf.INVALID_PDF"
  | "pdf.PLACEHOLDER_NOT_FOUND"
  | "pdf.SIGNATURE_TOO_LARGE"
  | "pdf.SIGN_FAILED"
  | "pdf.VERIFY_FAILED";

const PdfErrorCodeSchema: Schema.Decoder<PdfErrorCode> = Schema.Literals([
  "pdf.INVALID_PDF",
  "pdf.PLACEHOLDER_NOT_FOUND",
  "pdf.SIGNATURE_TOO_LARGE",
  "pdf.SIGN_FAILED",
  "pdf.VERIFY_FAILED",
]);

export const PdfErrorCodeValue = {
  invalidPdf: "pdf.INVALID_PDF",
  placeholderNotFound: "pdf.PLACEHOLDER_NOT_FOUND",
  signatureTooLarge: "pdf.SIGNATURE_TOO_LARGE",
  signFailed: "pdf.SIGN_FAILED",
  verifyFailed: "pdf.VERIFY_FAILED",
} satisfies Record<string, PdfErrorCode>;

export type PdfOperation = "pdf.parse" | "pdf.placeholder" | "pdf.sign" | "pdf.verify";

const PdfOperationSchema: Schema.Decoder<PdfOperation> = Schema.Literals([
  "pdf.parse",
  "pdf.placeholder",
  "pdf.sign",
  "pdf.verify",
]);

export const PdfOperationValue = {
  parse: "pdf.parse",
  placeholder: "pdf.placeholder",
  sign: "pdf.sign",
  verify: "pdf.verify",
} satisfies Record<string, PdfOperation>;

export type PdfSignatureAppearance = {
  readonly pageIndex?: number | undefined;
  readonly widgetRect?: readonly [number, number, number, number] | undefined;
};

export type PdfSignaturePolicy = "pades-ades" | "pades-icp-brasil";

export type PdfSigningRequest = {
  readonly pdf: Uint8Array;
  readonly reason?: string | undefined;
  readonly contactInfo?: string | undefined;
  readonly name?: string | undefined;
  readonly location?: string | undefined;
  readonly signingTime?: Date | undefined;
  readonly signatureLength?: number | undefined;
  readonly hashAlgorithm?: CmsHashAlgorithm | undefined;
  readonly policy?: PdfSignaturePolicy | undefined;
  readonly icpBrasil?: IcpBrasilPolicy | undefined;
  readonly policyTimeoutMillis?: number | undefined;
  readonly timestamp?: TimestampOptions | undefined;
  readonly appearance?: PdfSignatureAppearance | undefined;
};

export type PdfVerificationRequest = {
  readonly pdf: Uint8Array;
  readonly trustedRoots?: readonly Uint8Array[] | undefined;
};

export type PdfVerificationResult = {
  readonly valid: boolean;
  readonly chainValid: boolean;
  readonly signatureCount: number;
  readonly byteRange: readonly [number, number, number, number];
  readonly signerSerialNumber: string | null;
};

type PdfErrorFields = {
  readonly code: PdfErrorCode;
  readonly retryable: boolean;
  readonly reason?: string | undefined;
  readonly operation?: PdfOperation | undefined;
  readonly upstreamTag?: string | undefined;
  readonly upstreamCode?: string | undefined;
};

type PdfErrorInput = PdfErrorFields & {
  readonly cause?: unknown;
};

type PdfErrorConstructor = new (input: PdfErrorInput) => PdfErrorFields;

const PdfErrorBase: PdfErrorConstructor = Schema.TaggedErrorClass<PdfErrorFields>()("PdfError", {
  code: PdfErrorCodeSchema,
  retryable: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  operation: Schema.optional(PdfOperationSchema),
  upstreamTag: Schema.optional(Schema.String),
  upstreamCode: Schema.optional(Schema.String),
});

export class PdfError extends PdfErrorBase {
  get message(): string {
    return this.reason ?? this.code;
  }
}

const firstStringField = (input: unknown, field: string): string | undefined => {
  if (input === null || typeof input !== "object") return undefined;
  const value = Reflect.get(input, field);
  return typeof value === "string" ? value : undefined;
};

export type PdfCauseMetadata = {
  readonly reason?: string | undefined;
  readonly upstreamTag?: string | undefined;
  readonly upstreamCode?: string | undefined;
};

export const safeCauseMetadata = (cause: unknown): PdfCauseMetadata => ({
  reason: firstStringField(cause, "message"),
  upstreamTag: firstStringField(cause, "_tag") ?? firstStringField(cause, "name"),
  upstreamCode: firstStringField(cause, "code"),
});
