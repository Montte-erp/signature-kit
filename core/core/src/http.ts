import {
  RemoteSignatureProviderSchema,
  type SignatureKitSchemaName,
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  SignatureKitSchemaNameValue,
} from "./config";
import { Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect";

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
  timeoutMillis: Schema.optional(Schema.Number),
});
export type SignatureHttpRequest = (typeof SignatureHttpRequestSchema)["Type"];

const diagnosticRequestUrl = (request: SignatureHttpRequest): string =>
  request.diagnosticUrl ?? request.url;

const isRetryableMethod = (method: SignatureHttpMethod): boolean =>
  method === "DELETE" || method === "GET" || method === "PUT";

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

const AbortCauseSchema = Schema.Struct({
  name: Schema.Literal("AbortError"),
});

type RequestAbort = {
  readonly _tag: "RequestAbort";
  readonly timedOut: boolean;
};

type RequestAbortHandle = {
  readonly signal: AbortSignal;
  readonly promise: Promise<RequestAbort>;
  readonly clear: () => void;
};

type TimedResponse = {
  readonly response: Response;
  readonly abort: RequestAbortHandle;
};

const isRequestAbort = (value: unknown): value is RequestAbort =>
  typeof value === "object" && value !== null && Reflect.get(value, "_tag") === "RequestAbort";

const startRequestAbort = (
  request: SignatureHttpRequest,
  signal: AbortSignal,
): RequestAbortHandle => {
  const controller = new AbortController();
  const pending = Promise.withResolvers<RequestAbort>();
  const abort = (timedOut: boolean): void => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
    pending.resolve({ _tag: "RequestAbort", timedOut });
  };
  const timeoutId =
    request.timeoutMillis === undefined
      ? undefined
      : setTimeout(() => abort(true), request.timeoutMillis);
  const abortFromSignal = (): void => abort(false);
  if (signal.aborted) {
    abortFromSignal();
  } else {
    signal.addEventListener("abort", abortFromSignal, { once: true });
  }
  return {
    signal: controller.signal,
    promise: pending.promise,
    clear: () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", abortFromSignal);
    },
  };
};
const withRequestTimeout = <A>(
  request: SignatureHttpRequest,
  effect: Effect.Effect<A, SignatureKitError>,
): Effect.Effect<A, SignatureKitError> =>
  request.timeoutMillis === undefined
    ? effect
    : effect.pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(request.timeoutMillis),
          orElse: () =>
            Effect.fail(
              new SignatureKitError({
                code: SignatureKitErrorCodeValue.http,
                retryable: isRetryableMethod(request.method),
                provider: request.provider,
                operation: SignatureKitOperationValue.httpRequest,
                reason: `Request ${request.method} ${diagnosticRequestUrl(request)} timed out after ${request.timeoutMillis} ms.`,
              }),
            ),
        }),
      );

const readResponseText = (
  request: SignatureHttpRequest,
  timed: TimedResponse,
): Effect.Effect<string, SignatureKitError> =>
  Effect.tryPromise({
    try: () => {
      const text = timed.response.text().then(
        (body) => {
          timed.abort.clear();
          return body;
        },
        (error) => {
          timed.abort.clear();
          return Promise.reject(error);
        },
      );
      const abort = timed.abort.promise.then((event) => {
        timed.abort.clear();
        return event;
      });
      return Promise.race([text, abort]);
    },
    catch: () =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.http,
        retryable: isRetryableMethod(request.method),
        provider: request.provider,
        operation: SignatureKitOperationValue.httpRequest,
        status: timed.response.status,
        reason: `Failed to read ${request.method} ${diagnosticRequestUrl(request)} response body.`,
      }),
  }).pipe(
    Effect.flatMap((body) =>
      isRequestAbort(body)
        ? Effect.fail(
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.http,
              retryable: isRetryableMethod(request.method),
              provider: request.provider,
              operation: SignatureKitOperationValue.httpRequest,
              status: timed.response.status,
              reason: body.timedOut
                ? `Request ${request.method} ${diagnosticRequestUrl(request)} timed out after ${request.timeoutMillis} ms.`
                : `Request ${request.method} ${diagnosticRequestUrl(request)} was aborted.`,
            }),
          )
        : Effect.succeed(body),
    ),
  );

// A rate-limited request (429) was rejected before it took effect, so it is always
// safe to retry regardless of method idempotency. A 5xx on a non-idempotent method
// may have been processed, so it stays gated by isRetryableMethod.
const isRetryableStatus = (method: SignatureHttpMethod, status: number): boolean =>
  status === 429 || (isRetryableMethod(method) && status >= 500);

// Absolute epoch (seconds) after which a rate-limited request may be retried, read from
// the standard `x-ratelimit-reset` (epoch) or `Retry-After` (delta seconds) headers.
const retryAfterEpochSeconds = (timed: TimedResponse): number | undefined => {
  const reset = Number(timed.response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return reset;
  const retryAfter = Number(timed.response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.floor(Date.now() / 1000) + retryAfter;
  }
  return undefined;
};

const failOnHttpStatus = (
  request: SignatureHttpRequest,
  timed: TimedResponse,
): Effect.Effect<never, SignatureKitError> =>
  readResponseText(request, timed).pipe(
    Effect.flatMap((body) => {
      const resetAt = retryAfterEpochSeconds(timed);
      return Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.http,
          retryable: isRetryableStatus(request.method, timed.response.status),
          provider: request.provider,
          operation: SignatureKitOperationValue.httpRequest,
          status: timed.response.status,
          ...(resetAt === undefined ? {} : { retryAfterEpochSeconds: resetAt }),
          reason:
            body.length === 0
              ? `${request.method} ${diagnosticRequestUrl(request)} returned HTTP ${timed.response.status}.`
              : `${request.method} ${diagnosticRequestUrl(request)} returned HTTP ${timed.response.status}: ${compactBody(body)}`,
        }),
      );
    }),
  );

const fetchResponse = (
  request: SignatureHttpRequest,
): Effect.Effect<TimedResponse, SignatureKitError> =>
  Effect.tryPromise({
    try: (signal) => {
      const abort = startRequestAbort(request, signal);
      const response = fetch(request.url, {
        method: request.method,
        signal: abort.signal,
        ...(request.headers === undefined ? {} : { headers: request.headers }),
        ...(request.body === undefined ? {} : { body: request.body }),
      }).then(
        (response) => ({ response, abort }),
        (error) => {
          abort.clear();
          return Promise.reject(error);
        },
      );
      const aborted = abort.promise.then((event) => {
        abort.clear();
        return event;
      });
      return Promise.race([response, aborted]);
    },
    catch: (error) => {
      const abortCause = Schema.decodeUnknownOption(AbortCauseSchema)(error);
      return new SignatureKitError({
        code: SignatureKitErrorCodeValue.http,
        retryable: isRetryableMethod(request.method),
        provider: request.provider,
        operation: SignatureKitOperationValue.httpRequest,
        reason: Option.isSome(abortCause)
          ? `Request ${request.method} ${diagnosticRequestUrl(request)} was aborted.`
          : `Failed to call ${request.method} ${diagnosticRequestUrl(request)}.`,
      });
    },
  }).pipe(
    Effect.flatMap((result) =>
      isRequestAbort(result)
        ? Effect.fail(
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.http,
              retryable: isRetryableMethod(request.method),
              provider: request.provider,
              operation: SignatureKitOperationValue.httpRequest,
              reason: result.timedOut
                ? `Request ${request.method} ${diagnosticRequestUrl(request)} timed out after ${request.timeoutMillis} ms.`
                : `Request ${request.method} ${diagnosticRequestUrl(request)} was aborted.`,
            }),
          )
        : result.response.ok
          ? Effect.succeed(result)
          : failOnHttpStatus(request, result),
    ),
  );

const decodeJsonBody = <A>(
  request: SignatureHttpRequest,
  timed: TimedResponse,
  schema: Schema.ConstraintDecoder<A>,
  schemaName: SignatureKitSchemaName,
): Effect.Effect<A, SignatureKitError> =>
  readResponseText(request, timed).pipe(
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(body).pipe(
        Effect.mapError(
          (issue) =>
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.responseShape,
              retryable: false,
              provider: request.provider,
              operation: SignatureKitOperationValue.httpDecode,
              status: timed.response.status,
              schemaName,
              reason: `Failed to decode ${request.method} ${diagnosticRequestUrl(request)} JSON response.`,
              issueMessage: String(issue),
            }),
        ),
      ),
    ),
  );

const readResponseBytes = (
  request: SignatureHttpRequest,
  timed: TimedResponse,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  Effect.tryPromise({
    try: () => {
      const bytes = timed.response.arrayBuffer().then(
        (body) => {
          timed.abort.clear();
          return body;
        },
        (error) => {
          timed.abort.clear();
          return Promise.reject(error);
        },
      );
      const abort = timed.abort.promise.then((event) => {
        timed.abort.clear();
        return event;
      });
      return Promise.race([bytes, abort]);
    },
    catch: () =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.http,
        retryable: isRetryableMethod(request.method),
        provider: request.provider,
        operation: SignatureKitOperationValue.httpRequest,
        status: timed.response.status,
        reason: `Failed to read ${request.method} ${diagnosticRequestUrl(request)} response body.`,
      }),
  }).pipe(
    Effect.flatMap((body) =>
      isRequestAbort(body)
        ? Effect.fail(
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.http,
              retryable: isRetryableMethod(request.method),
              provider: request.provider,
              operation: SignatureKitOperationValue.httpRequest,
              status: timed.response.status,
              reason: body.timedOut
                ? `Request ${request.method} ${diagnosticRequestUrl(request)} timed out after ${request.timeoutMillis} ms.`
                : `Request ${request.method} ${diagnosticRequestUrl(request)} was aborted.`,
            }),
          )
        : Effect.succeed(new Uint8Array(body)),
    ),
  );

const discardResponseBody = (
  request: SignatureHttpRequest,
  timed: TimedResponse,
): Effect.Effect<void, SignatureKitError> =>
  Effect.tryPromise({
    try: () => {
      const body = timed.response.body;
      if (body === null) {
        timed.abort.clear();
        return Promise.resolve();
      }
      return body.cancel().then(
        () => {
          timed.abort.clear();
        },
        (error) => {
          timed.abort.clear();
          return Promise.reject(error);
        },
      );
    },
    catch: () =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.http,
        retryable: isRetryableMethod(request.method),
        provider: request.provider,
        operation: SignatureKitOperationValue.httpRequest,
        status: timed.response.status,
        reason: `Failed to discard ${request.method} ${diagnosticRequestUrl(request)} response body.`,
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
      Schema.decodeUnknownEffect(SignatureHttpRequestSchema)(request).pipe(
        Effect.mapError(
          (issue) =>
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.invalidInput,
              retryable: false,
              operation: SignatureKitOperationValue.schemaDecode,
              schemaName: SignatureKitSchemaNameValue.providerHttpRequest,
              issueMessage: String(issue),
            }),
        ),
        Effect.flatMap((valid) =>
          withRequestTimeout(
            valid,
            fetchResponse(valid).pipe(
              Effect.flatMap((timed) => decodeJsonBody(valid, timed, schema, schemaName)),
            ),
          ),
        ),
      ),
    requestBytes: (request: SignatureHttpRequest) =>
      Schema.decodeUnknownEffect(SignatureHttpRequestSchema)(request).pipe(
        Effect.mapError(
          (issue) =>
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.invalidInput,
              retryable: false,
              operation: SignatureKitOperationValue.schemaDecode,
              schemaName: SignatureKitSchemaNameValue.providerHttpRequest,
              issueMessage: String(issue),
            }),
        ),
        Effect.flatMap((valid) =>
          withRequestTimeout(
            valid,
            fetchResponse(valid).pipe(Effect.flatMap((timed) => readResponseBytes(valid, timed))),
          ),
        ),
      ),
    requestVoid: (request: SignatureHttpRequest) =>
      Schema.decodeUnknownEffect(SignatureHttpRequestSchema)(request).pipe(
        Effect.mapError(
          (issue) =>
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.invalidInput,
              retryable: false,
              operation: SignatureKitOperationValue.schemaDecode,
              schemaName: SignatureKitSchemaNameValue.providerHttpRequest,
              issueMessage: String(issue),
            }),
        ),
        Effect.flatMap((valid) =>
          withRequestTimeout(
            valid,
            fetchResponse(valid).pipe(Effect.flatMap((timed) => discardResponseBody(valid, timed))),
          ),
        ),
      ),
  },
);

export const bearerAuthorization = (token: Redacted.Redacted<string>): string =>
  `Bearer ${Redacted.value(token)}`;

export const normalizedBaseUrl = (url: string): string =>
  url.endsWith("/") ? url.slice(0, -1) : url;
