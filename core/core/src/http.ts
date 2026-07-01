import {
  RemoteSignatureProviderSchema,
  type SignatureKitSchemaName,
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  SignatureKitSchemaNameValue,
} from "./config";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

export const SignatureHttpMethodSchema = Schema.Literals(["DELETE", "GET", "PATCH", "POST", "PUT"]);
export type SignatureHttpMethod = (typeof SignatureHttpMethodSchema)["Type"];

export const SignatureHttpHeadersSchema = Schema.Record(Schema.String, Schema.String);
export type SignatureHttpHeaders = (typeof SignatureHttpHeadersSchema)["Type"];

export const SignatureHttpBodySchema = Schema.Union([
  Schema.String,
  Schema.FormData,
  Schema.URLSearchParams,
]);
export type SignatureHttpBody = (typeof SignatureHttpBodySchema)["Type"];

export const SignatureHttpRequestSchema = Schema.Struct({
  method: SignatureHttpMethodSchema,
  url: Schema.NonEmptyString,
  provider: Schema.optional(RemoteSignatureProviderSchema),
  headers: Schema.optional(SignatureHttpHeadersSchema),
  diagnosticUrl: Schema.optional(Schema.NonEmptyString),
  body: Schema.optional(SignatureHttpBodySchema),
});
export type SignatureHttpRequest = (typeof SignatureHttpRequestSchema)["Type"];

const diagnosticRequestUrl = (request: SignatureHttpRequest): string =>
  request.diagnosticUrl ?? request.url;

export type SignatureHttpClientService = {
  readonly requestJson: <A>(
    request: SignatureHttpRequest,
    schema: Schema.ConstraintDecoder<A>,
    schemaName: SignatureKitSchemaName,
  ) => Effect.Effect<A, SignatureKitError>;
  readonly requestBytes: (
    request: SignatureHttpRequest,
  ) => Effect.Effect<Uint8Array, SignatureKitError>;
  readonly requestVoid: (request: SignatureHttpRequest) => Effect.Effect<void, SignatureKitError>;
};

export class SignatureHttpClient extends Context.Service<
  SignatureHttpClient,
  SignatureHttpClientService
>()("@signature-kit/core/SignatureHttpClient") {}

const compactBody = (body: string): string =>
  body.length <= 512 ? body : `${body.slice(0, 512)}…`;

const readResponseText = (
  request: SignatureHttpRequest,
  response: Response,
): Effect.Effect<string, SignatureKitError> =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: () =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.http,
        retryable: true,
        provider: request.provider,
        operation: SignatureKitOperationValue.httpRequest,
        status: response.status,
        reason: `Failed to read ${request.method} ${diagnosticRequestUrl(request)} response body.`,
      }),
  });

const failOnHttpStatus = (
  request: SignatureHttpRequest,
  response: Response,
): Effect.Effect<never, SignatureKitError> =>
  readResponseText(request, response).pipe(
    Effect.flatMap((body) =>
      Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.http,
          retryable: response.status >= 500 || response.status === 429,
          provider: request.provider,
          operation: SignatureKitOperationValue.httpRequest,
          status: response.status,
          reason:
            body.length === 0
              ? `${request.method} ${diagnosticRequestUrl(request)} returned HTTP ${response.status}.`
              : `${request.method} ${diagnosticRequestUrl(request)} returned HTTP ${response.status}: ${compactBody(body)}`,
        }),
      ),
    ),
  );

const fetchResponse = (request: SignatureHttpRequest): Effect.Effect<Response, SignatureKitError> =>
  Effect.tryPromise({
    try: () =>
      fetch(request.url, {
        method: request.method,
        ...(request.headers === undefined ? {} : { headers: request.headers }),
        ...(request.body === undefined ? {} : { body: request.body }),
      }),
    catch: () =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.http,
        retryable: true,
        provider: request.provider,
        operation: SignatureKitOperationValue.httpRequest,
        reason: `Failed to call ${request.method} ${diagnosticRequestUrl(request)}.`,
      }),
  }).pipe(
    Effect.flatMap((response) =>
      response.ok ? Effect.succeed(response) : failOnHttpStatus(request, response),
    ),
  );

const parseJsonBody = (
  request: SignatureHttpRequest,
  response: Response,
): Effect.Effect<unknown, SignatureKitError> =>
  Effect.tryPromise({
    try: async () => {
      const parsed: unknown = await response.json();
      return parsed;
    },
    catch: () =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.responseShape,
        retryable: false,
        provider: request.provider,
        operation: SignatureKitOperationValue.httpDecode,
        status: response.status,
        schemaName: SignatureKitSchemaNameValue.providerHttpRequest,
        reason: `Failed to decode ${request.method} ${diagnosticRequestUrl(request)} JSON response.`,
      }),
  });

const decodeJsonBody = <A>(
  request: SignatureHttpRequest,
  response: Response,
  schema: Schema.ConstraintDecoder<A>,
  schemaName: SignatureKitSchemaName,
): Effect.Effect<A, SignatureKitError> =>
  parseJsonBody(request, response).pipe(
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(schema)(body).pipe(
        Effect.mapError(
          (issue) =>
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.responseShape,
              retryable: false,
              provider: request.provider,
              operation: SignatureKitOperationValue.httpDecode,
              status: response.status,
              schemaName,
              issueMessage: String(issue),
            }),
        ),
      ),
    ),
  );

const readResponseBytes = (
  request: SignatureHttpRequest,
  response: Response,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  Effect.tryPromise({
    try: async () => new Uint8Array(await response.arrayBuffer()),
    catch: () =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.http,
        retryable: true,
        provider: request.provider,
        operation: SignatureKitOperationValue.httpRequest,
        status: response.status,
        reason: `Failed to read ${request.method} ${diagnosticRequestUrl(request)} response body.`,
      }),
  });

export const signatureHttpClientLive: Layer.Layer<SignatureHttpClient> = Layer.succeed(
  SignatureHttpClient,
  {
    requestJson: <A>(
      request: SignatureHttpRequest,
      schema: Schema.ConstraintDecoder<A>,
      schemaName: SignatureKitSchemaName,
    ) =>
      fetchResponse(request).pipe(
        Effect.flatMap((response) => decodeJsonBody(request, response, schema, schemaName)),
      ),
    requestBytes: (request: SignatureHttpRequest) =>
      fetchResponse(request).pipe(
        Effect.flatMap((response) => readResponseBytes(request, response)),
      ),
    requestVoid: (request: SignatureHttpRequest) => fetchResponse(request).pipe(Effect.asVoid),
  },
);

export const bearerAuthorization = (token: Redacted.Redacted<string>): string =>
  `Bearer ${Redacted.value(token)}`;

export const normalizedBaseUrl = (url: string): string =>
  url.endsWith("/") ? url.slice(0, -1) : url;
