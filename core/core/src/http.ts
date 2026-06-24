import {
  RemoteSignatureProviderSchema,
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  SignatureKitSchemaNameValue,
  schemaErrorMetadata,
  type RemoteSignatureProvider,
  type SignatureKitSchemaName,
} from "./config";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

export const SignatureHttpMethodSchema = Schema.Literals(["DELETE", "GET", "PATCH", "POST", "PUT"]);
export type SignatureHttpMethod = (typeof SignatureHttpMethodSchema)["Type"];

const HeadersInitSchema = Schema.declare<HeadersInit>(
  (value): value is HeadersInit => typeof value === "object" && value !== null,
  { identifier: "HeadersInit" },
);

const BodyInitSchema = Schema.declare<BodyInit>(
  (value): value is BodyInit =>
    typeof value === "string" || (typeof value === "object" && value !== null),
  { identifier: "BodyInit" },
);

export const SignatureHttpRequestSchema = Schema.Struct({
  method: SignatureHttpMethodSchema,
  url: Schema.NonEmptyString,
  provider: Schema.optional(RemoteSignatureProviderSchema),
  headers: Schema.optional(HeadersInitSchema),
  body: Schema.optional(BodyInitSchema),
});
export type SignatureHttpRequest = (typeof SignatureHttpRequestSchema)["Type"];

export type SignatureHttpClientService = {
  readonly requestJson: (
    request: SignatureHttpRequest,
  ) => Effect.Effect<unknown, SignatureKitError>;
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
        reason: `Failed to read ${request.method} ${request.url} response body.`,
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
              ? `${request.method} ${request.url} returned HTTP ${response.status}.`
              : `${request.method} ${request.url} returned HTTP ${response.status}: ${compactBody(body)}`,
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
        reason: `Failed to call ${request.method} ${request.url}.`,
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
        reason: `Failed to decode ${request.method} ${request.url} JSON response.`,
      }),
  });

export const signatureHttpClientLive: Layer.Layer<SignatureHttpClient> = Layer.succeed(
  SignatureHttpClient,
  {
    requestJson: (request: SignatureHttpRequest) =>
      fetchResponse(request).pipe(Effect.flatMap((response) => parseJsonBody(request, response))),
    requestVoid: (request: SignatureHttpRequest) => fetchResponse(request).pipe(Effect.asVoid),
  },
);

export const decodeRemoteShape = <A>(
  schema: Schema.ConstraintDecoder<A>,
  schemaName: SignatureKitSchemaName,
  provider: RemoteSignatureProvider,
  value: unknown,
): Effect.Effect<A, SignatureKitError> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.responseShape,
          retryable: false,
          provider,
          operation: SignatureKitOperationValue.httpDecode,
          schemaName,
          ...schemaErrorMetadata(issue),
        }),
    ),
  );

export const decodeRemoteOptions = <A>(
  schema: Schema.ConstraintDecoder<A>,
  schemaName: SignatureKitSchemaName,
  provider: RemoteSignatureProvider,
  value: unknown,
): Effect.Effect<A, SignatureKitError> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          provider,
          operation: SignatureKitOperationValue.schemaDecode,
          schemaName,
          ...schemaErrorMetadata(issue),
        }),
    ),
  );

export const bearerAuthorization = (token: Redacted.Redacted<string>): string =>
  `Bearer ${Redacted.value(token)}`;

export const normalizedBaseUrl = (url: string): string =>
  url.endsWith("/") ? url.slice(0, -1) : url;
