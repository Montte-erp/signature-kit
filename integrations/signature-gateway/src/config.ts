import { Schema } from "effect";
import type { SchemaIssue } from "effect";

const nonEmptyString: Schema.Decoder<string> = Schema.NonEmptyString;
const optionalNonEmptyString = Schema.optional(nonEmptyString);
const SignatureProviderIdSchema = nonEmptyString;
export const signatureProviderIdSchema = SignatureProviderIdSchema;
export type SignatureProviderId = (typeof signatureProviderIdSchema)["Type"];

const SignatureProviderStateSchema = Schema.Literals(["draft", "sent"]);
export const signatureProviderStateSchema = SignatureProviderStateSchema;
export type SignatureProviderState = (typeof signatureProviderStateSchema)["Type"];

const SignatureRecipientRoleSchema = Schema.Literals(["approver", "signer"]);
export const signatureRecipientRoleSchema = SignatureRecipientRoleSchema;
export type SignatureRecipientRole = (typeof signatureRecipientRoleSchema)["Type"];

export const SignatureDocumentSchema = Schema.Struct({
  fileName: nonEmptyString,
  mimeType: nonEmptyString,
  content: Schema.Uint8Array,
});
export type SignatureDocument = (typeof SignatureDocumentSchema)["Type"];
export const signatureDocumentSchema = SignatureDocumentSchema;

export const SignatureRecipientSchema = Schema.Struct({
  name: nonEmptyString,
  email: nonEmptyString,
  role: Schema.optional(SignatureRecipientRoleSchema),
  routingOrder: Schema.optional(Schema.Number),
});
export type SignatureRecipient = (typeof SignatureRecipientSchema)["Type"];
export const signatureRecipientSchema = SignatureRecipientSchema;

export const SignatureRequestInputSchema = Schema.Struct({
  title: nonEmptyString,
  subject: optionalNonEmptyString,
  message: optionalNonEmptyString,
  documents: Schema.Array(SignatureDocumentSchema),
  recipients: Schema.Array(SignatureRecipientSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: optionalNonEmptyString,
});
export type SignatureRequestInput = (typeof SignatureRequestInputSchema)["Type"];
export const signatureRequestInputSchema = SignatureRequestInputSchema;

export const SignatureGatewayRequestInputSchema = Schema.Struct({
  provider: SignatureProviderIdSchema,
  title: nonEmptyString,
  subject: optionalNonEmptyString,
  message: optionalNonEmptyString,
  documents: Schema.Array(SignatureDocumentSchema),
  recipients: Schema.Array(SignatureRecipientSchema),
  send: Schema.optional(Schema.Boolean),
  expiresAt: Schema.optional(Schema.Date),
  redirectUrl: optionalNonEmptyString,
});
export type SignatureGatewayRequestInput = (typeof SignatureGatewayRequestInputSchema)["Type"];
export const signatureGatewayRequestInputSchema = SignatureGatewayRequestInputSchema;

export const RemoteSignatureRequestSchema = Schema.Struct({
  provider: SignatureProviderIdSchema,
  id: nonEmptyString,
  state: SignatureProviderStateSchema,
  providerStatus: optionalNonEmptyString,
  signingUrl: optionalNonEmptyString,
  detailsUrl: optionalNonEmptyString,
});
export type RemoteSignatureRequest = (typeof RemoteSignatureRequestSchema)["Type"];
export const remoteSignatureRequestSchema = RemoteSignatureRequestSchema;

export type SignatureProviderErrorCode =
  | "signature_provider.HTTP"
  | "signature_provider.INVALID_INPUT"
  | "signature_provider.RESPONSE_SHAPE"
  | "signature_provider.UNSUPPORTED_OPERATION";
const SignatureProviderErrorCodeSchema: Schema.Decoder<SignatureProviderErrorCode> =
  Schema.Literals([
    "signature_provider.HTTP",
    "signature_provider.INVALID_INPUT",
    "signature_provider.RESPONSE_SHAPE",
    "signature_provider.UNSUPPORTED_OPERATION",
  ]);
export const SignatureProviderErrorCodeValue = {
  http: "signature_provider.HTTP",
  invalidInput: "signature_provider.INVALID_INPUT",
  responseShape: "signature_provider.RESPONSE_SHAPE",
  unsupportedOperation: "signature_provider.UNSUPPORTED_OPERATION",
} satisfies Record<string, SignatureProviderErrorCode>;

export type SignatureProviderOperation =
  | "signature_provider.create"
  | "signature_provider.decode"
  | "signature_provider.download"
  | "signature_provider.http"
  | "signature_provider.link_recipient"
  | "signature_provider.notify"
  | "signature_provider.upload";
const SignatureProviderOperationSchema: Schema.Decoder<SignatureProviderOperation> =
  Schema.Literals([
    "signature_provider.create",
    "signature_provider.decode",
    "signature_provider.download",
    "signature_provider.http",
    "signature_provider.link_recipient",
    "signature_provider.notify",
    "signature_provider.upload",
  ]);
export const SignatureProviderOperationValue = {
  create: "signature_provider.create",
  decode: "signature_provider.decode",
  download: "signature_provider.download",
  http: "signature_provider.http",
  linkRecipient: "signature_provider.link_recipient",
  notify: "signature_provider.notify",
  upload: "signature_provider.upload",
} satisfies Record<string, SignatureProviderOperation>;

const SignatureProviderSchemaNameSchema = nonEmptyString;
export type SignatureProviderSchemaName = (typeof SignatureProviderSchemaNameSchema)["Type"];
export const SignatureProviderSchemaNameValue = {
  providerOptions: "ProviderOptions",
  providerResponse: "ProviderResponse",
  signatureGatewayRequestInput: "SignatureGatewayRequestInput",
  signatureRequestInput: "SignatureRequestInput",
} satisfies Record<string, SignatureProviderSchemaName>;

type SignatureProviderErrorFields = {
  readonly _tag: "SignatureProviderError";
  readonly code: SignatureProviderErrorCode;
  readonly retryable: boolean;
  readonly provider?: SignatureProviderId | undefined;
  readonly operation?: SignatureProviderOperation | undefined;
  readonly status?: number | undefined;
  readonly reason?: string | undefined;
  readonly schemaName?: SignatureProviderSchemaName | undefined;
  readonly issuePath?: string | undefined;
  readonly issueMessage?: string | undefined;
  readonly upstreamTag?: string | undefined;
  readonly upstreamCode?: string | undefined;
};

type SignatureProviderErrorInput = {
  readonly code: SignatureProviderErrorCode;
  readonly retryable: boolean;
  readonly provider?: SignatureProviderId | undefined;
  readonly operation?: SignatureProviderOperation | undefined;
  readonly status?: number | undefined;
  readonly reason?: string | undefined;
  readonly schemaName?: SignatureProviderSchemaName | undefined;
  readonly issuePath?: string | undefined;
  readonly issueMessage?: string | undefined;
  readonly upstreamTag?: string | undefined;
  readonly upstreamCode?: string | undefined;
};

type SignatureProviderErrorConstructor = new (
  input: SignatureProviderErrorInput,
) => SignatureProviderErrorFields;

const SignatureProviderErrorBase: SignatureProviderErrorConstructor =
  Schema.TaggedErrorClass<SignatureProviderErrorFields>()("SignatureProviderError", {
    code: SignatureProviderErrorCodeSchema,
    retryable: Schema.Boolean,
    provider: Schema.optional(SignatureProviderIdSchema),
    operation: Schema.optional(SignatureProviderOperationSchema),
    status: Schema.optional(Schema.Number),
    reason: Schema.optional(Schema.String),
    schemaName: Schema.optional(SignatureProviderSchemaNameSchema),
    issuePath: Schema.optional(Schema.String),
    issueMessage: Schema.optional(Schema.String),
    upstreamTag: Schema.optional(Schema.String),
    upstreamCode: Schema.optional(Schema.String),
  });

export class SignatureProviderError extends SignatureProviderErrorBase {
  get message(): string {
    switch (this.code) {
      case "signature_provider.HTTP":
        return this.reason ?? "Signature provider HTTP request failed.";
      case "signature_provider.INVALID_INPUT":
        return this.reason ?? "Invalid signature provider input.";
      case "signature_provider.RESPONSE_SHAPE":
        return this.reason ?? "Signature provider returned an unexpected response.";
      case "signature_provider.UNSUPPORTED_OPERATION":
        return this.reason ?? "Signature provider does not support the requested operation.";
    }
  }
}

export type SignatureProviderCauseMetadata = {
  readonly upstreamTag?: string | undefined;
  readonly upstreamCode?: string | undefined;
};

const firstStringField = (input: unknown, field: string): string | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  const value = Reflect.get(input, field);
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return value.toString();
  return undefined;
};

export const safeCauseMetadata = (cause: unknown): SignatureProviderCauseMetadata => ({
  upstreamTag: firstStringField(cause, "_tag") ?? firstStringField(cause, "name"),
  upstreamCode: firstStringField(cause, "code"),
});

export type SignatureProviderSchemaMetadata = {
  readonly issuePath?: string | undefined;
  readonly issueMessage: string;
  readonly upstreamTag: string;
};

const formatIssuePath = (path: ReadonlyArray<PropertyKey>): string | undefined =>
  path.length === 0 ? undefined : path.map((segment) => String(segment)).join(".");

const schemaIssueLeafMetadata = (
  issue: SchemaIssue.Issue,
  path: ReadonlyArray<PropertyKey> = [],
): SignatureProviderSchemaMetadata => {
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

export const schemaIssueMetadata = (issue: Schema.SchemaError): SignatureProviderSchemaMetadata =>
  schemaIssueLeafMetadata(issue.issue);
