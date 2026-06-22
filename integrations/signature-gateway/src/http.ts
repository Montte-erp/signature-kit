import { Context, Effect, Layer, Redacted, Schema } from "effect";
import type { SignatureDocument, SignatureProviderId, SignatureProviderSchemaName } from "./config";
import {
  SignatureProviderError,
  SignatureProviderErrorCodeValue,
  SignatureProviderOperationValue,
  SignatureProviderSchemaNameValue,
  safeCauseMetadata,
  schemaIssueMetadata,
  signatureGatewayRequestInputSchema,
  signatureRequestInputSchema,
} from "./config";

export type ProviderHttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export type ProviderHttpRequest = {
  readonly method: ProviderHttpMethod;
  readonly url: string;
  readonly provider?: SignatureProviderId | undefined;
  readonly headers?: HeadersInit | undefined;
  readonly body?: BodyInit | undefined;
};

export type ProviderHttpClientService = {
  readonly requestJson: (
    request: ProviderHttpRequest,
  ) => Effect.Effect<unknown, SignatureProviderError>;
  readonly requestVoid: (
    request: ProviderHttpRequest,
  ) => Effect.Effect<void, SignatureProviderError>;
};

export class ProviderHttpClient extends Context.Service<
  ProviderHttpClient,
  ProviderHttpClientService
>()("@signature-kit/signature-gateway/ProviderHttpClient") {}

const compactBody = (body: string): string =>
  body.length <= 512 ? body : `${body.slice(0, 512)}…`;

const readResponseText = (
  request: ProviderHttpRequest,
  response: Response,
): Effect.Effect<string, SignatureProviderError> =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) =>
      new SignatureProviderError({
        code: SignatureProviderErrorCodeValue.http,
        retryable: true,
        provider: request.provider,
        operation: SignatureProviderOperationValue.http,
        status: response.status,
        reason: `Failed to read ${request.method} ${request.url} response body.`,
        ...safeCauseMetadata(cause),
      }),
  });

const failOnHttpStatus = (
  request: ProviderHttpRequest,
  response: Response,
): Effect.Effect<never, SignatureProviderError> =>
  readResponseText(request, response).pipe(
    Effect.flatMap((body) =>
      Effect.fail(
        new SignatureProviderError({
          code: SignatureProviderErrorCodeValue.http,
          retryable: response.status >= 500 || response.status === 429,
          provider: request.provider,
          operation: SignatureProviderOperationValue.http,
          status: response.status,
          reason:
            body.length === 0
              ? `${request.method} ${request.url} returned HTTP ${response.status}.`
              : `${request.method} ${request.url} returned HTTP ${response.status}: ${compactBody(body)}`,
        }),
      ),
    ),
  );

const fetchInit = (request: ProviderHttpRequest): RequestInit => {
  const init: RequestInit = { method: request.method };
  if (request.headers !== undefined) init.headers = request.headers;
  if (request.body !== undefined) init.body = request.body;
  return init;
};

const fetchResponse = (
  request: ProviderHttpRequest,
): Effect.Effect<Response, SignatureProviderError> =>
  Effect.tryPromise({
    try: () => fetch(request.url, fetchInit(request)),
    catch: (cause) =>
      new SignatureProviderError({
        code: SignatureProviderErrorCodeValue.http,
        retryable: true,
        provider: request.provider,
        operation: SignatureProviderOperationValue.http,
        reason: `Failed to call ${request.method} ${request.url}.`,
        ...safeCauseMetadata(cause),
      }),
  }).pipe(
    Effect.flatMap((response) =>
      response.ok ? Effect.succeed(response) : failOnHttpStatus(request, response),
    ),
  );

const parseJsonBody = (
  request: ProviderHttpRequest,
  response: Response,
): Effect.Effect<unknown, SignatureProviderError> =>
  Effect.tryPromise({
    try: async () => {
      const parsed: unknown = await response.json();
      return parsed;
    },
    catch: (cause) =>
      new SignatureProviderError({
        code: SignatureProviderErrorCodeValue.responseShape,
        retryable: false,
        provider: request.provider,
        operation: SignatureProviderOperationValue.decode,
        status: response.status,
        reason: `Failed to decode ${request.method} ${request.url} JSON response.`,
        ...safeCauseMetadata(cause),
      }),
  });

export const createFetchHttpClient = (): ProviderHttpClientService => ({
  requestJson: (request) =>
    fetchResponse(request).pipe(Effect.flatMap((response) => parseJsonBody(request, response))),
  requestVoid: (request) => fetchResponse(request).pipe(Effect.asVoid),
});

export const providerHttpClientLive: Layer.Layer<ProviderHttpClient> = Layer.succeed(
  ProviderHttpClient,
  createFetchHttpClient(),
);

export const decodeProviderShape = <A>(
  schema: Schema.Decoder<A>,
  schemaName: SignatureProviderSchemaName,
  provider: SignatureProviderId,
  value: unknown,
): Effect.Effect<A, SignatureProviderError> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureProviderError({
          code: SignatureProviderErrorCodeValue.responseShape,
          retryable: false,
          provider,
          operation: SignatureProviderOperationValue.decode,
          schemaName,
          ...schemaIssueMetadata(issue),
        }),
    ),
  );

export const decodeProviderOptions = <A>(
  schema: Schema.Decoder<A>,
  schemaName: SignatureProviderSchemaName,
  provider: SignatureProviderId,
  value: unknown,
): Effect.Effect<A, SignatureProviderError> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureProviderError({
          code: SignatureProviderErrorCodeValue.invalidInput,
          retryable: false,
          provider,
          operation: SignatureProviderOperationValue.decode,
          schemaName,
          ...schemaIssueMetadata(issue),
        }),
    ),
  );

type DocumentRecipientShape = {
  readonly documents: readonly unknown[];
  readonly recipients: readonly unknown[];
};

const ensureDocumentsAndRecipients = <A extends DocumentRecipientShape>(
  valid: A,
  schemaName: SignatureProviderSchemaName,
): Effect.Effect<A, SignatureProviderError> => {
  if (valid.documents.length === 0) {
    return Effect.fail(
      new SignatureProviderError({
        code: SignatureProviderErrorCodeValue.invalidInput,
        retryable: false,
        operation: SignatureProviderOperationValue.decode,
        schemaName,
        reason: "At least one document is required.",
      }),
    );
  }
  if (valid.recipients.length === 0) {
    return Effect.fail(
      new SignatureProviderError({
        code: SignatureProviderErrorCodeValue.invalidInput,
        retryable: false,
        operation: SignatureProviderOperationValue.decode,
        schemaName,
        reason: "At least one recipient is required.",
      }),
    );
  }
  return Effect.succeed(valid);
};

export const normalizeSignatureRequestInput = (
  input: unknown,
): Effect.Effect<(typeof signatureRequestInputSchema)["Type"], SignatureProviderError> =>
  Schema.decodeUnknownEffect(signatureRequestInputSchema)(input).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureProviderError({
          code: SignatureProviderErrorCodeValue.invalidInput,
          retryable: false,
          operation: SignatureProviderOperationValue.decode,
          schemaName: SignatureProviderSchemaNameValue.signatureRequestInput,
          ...schemaIssueMetadata(issue),
        }),
    ),
    Effect.flatMap((valid) =>
      ensureDocumentsAndRecipients(valid, SignatureProviderSchemaNameValue.signatureRequestInput),
    ),
  );

export const normalizeSignatureGatewayRequestInput = (
  input: unknown,
): Effect.Effect<(typeof signatureGatewayRequestInputSchema)["Type"], SignatureProviderError> =>
  Schema.decodeUnknownEffect(signatureGatewayRequestInputSchema)(input).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureProviderError({
          code: SignatureProviderErrorCodeValue.invalidInput,
          retryable: false,
          operation: SignatureProviderOperationValue.decode,
          schemaName: SignatureProviderSchemaNameValue.signatureGatewayRequestInput,
          ...schemaIssueMetadata(issue),
        }),
    ),
    Effect.flatMap((valid) =>
      ensureDocumentsAndRecipients(
        valid,
        SignatureProviderSchemaNameValue.signatureGatewayRequestInput,
      ),
    ),
  );

export const jsonBody = (value: unknown): string => {
  const body = JSON.stringify(value);
  return body === undefined ? "null" : body;
};

export const jsonHeaders: HeadersInit = {
  "Content-Type": "application/json",
};

export const jsonContentHeaders = (authorization: string): HeadersInit => ({
  ...jsonHeaders,
  Authorization: authorization,
});

export const bearerAuthorization = (token: Redacted.Redacted<string>): string =>
  `Bearer ${Redacted.value(token)}`;

export const appendDocumentFile = (
  formData: FormData,
  fieldName: string,
  document: SignatureDocument,
): void => {
  const bytes = new Uint8Array(document.content.length);
  bytes.set(document.content);
  const blob = new Blob([bytes], { type: document.mimeType });
  formData.append(fieldName, blob, document.fileName);
};

export const fileExtension = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot < 0 || lastDot === fileName.length - 1) return "bin";
  return fileName.slice(lastDot + 1).toLowerCase();
};

export const normalizedBaseUrl = (url: string): string =>
  url.endsWith("/") ? url.slice(0, -1) : url;
