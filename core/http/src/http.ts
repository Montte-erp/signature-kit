import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
} from "@signature-kit/signatures";
import { Context, Duration, Effect, Layer, Redacted, Schema } from "effect";

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
  provider: Schema.optional(Schema.String),
  headers: Schema.optional(SignatureHttpHeadersSchema),
  diagnosticUrl: Schema.optional(Schema.NonEmptyString),
  body: Schema.optional(SignatureHttpBodySchema),
  acceptedStatuses: Schema.optional(Schema.Array(Schema.Number)),
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
    schemaName: string,
  ) => Effect.Effect<A, SignatureKitError>;
  readonly requestBytes: (
    request: SignatureHttpRequest,
  ) => Effect.Effect<Uint8Array, SignatureKitError>;
  readonly requestVoid: (request: SignatureHttpRequest) => Effect.Effect<void, SignatureKitError>;
};

export class SignatureHttpClient extends Context.Service<
  SignatureHttpClient,
  SignatureHttpClientService
>()("@signature-kit/http/SignatureHttpClient") {}

const compactBody = (body: string): string =>
  body.length <= 512 ? body : `${body.slice(0, 512)}…`;

const AbortCauseSchema = Schema.Struct({
  name: Schema.Literal("AbortError"),
});
const RequestAbortSchema = Schema.Struct({
  _tag: Schema.Literal("RequestAbort"),
  timedOut: Schema.Boolean,
});

type RequestAbort = (typeof RequestAbortSchema)["Type"];

type RequestAbortHandle = {
  readonly signal: AbortSignal;
  readonly promise: Promise<RequestAbort>;
  readonly clear: () => void;
};

type TimedResponse = {
  readonly response: Response;
  readonly abort: RequestAbortHandle;
};

const isRequestAbort = Schema.is(RequestAbortSchema);

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

const raceWithRequestAbort = <A>({
  request,
  abort,
  status,
  run,
  clearOnSuccess = true,
  catch: catchFailure,
}: {
  readonly request: SignatureHttpRequest;
  readonly abort: (signal: AbortSignal) => RequestAbortHandle;
  readonly status?: number;
  readonly run: (abort: RequestAbortHandle) => Promise<A>;
  readonly catch: (error: unknown) => SignatureKitError;
  readonly clearOnSuccess?: boolean;
}): Effect.Effect<A, SignatureKitError> =>
  Effect.tryPromise({
    try: (signal) => {
      const handle = abort(signal);
      const body = run(handle).then(
        (value) => {
          if (clearOnSuccess) handle.clear();
          return value;
        },
        (error) => {
          handle.clear();
          return Promise.reject(error);
        },
      );
      const aborted = handle.promise.then((event) => {
        handle.clear();
        return event;
      });
      return Promise.race([body, aborted]);
    },
    catch: catchFailure,
  }).pipe(
    Effect.flatMap((result) =>
      isRequestAbort(result)
        ? Effect.fail(
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.http,
              retryable: isRetryableMethod(request.method),
              provider: request.provider,
              operation: SignatureKitOperationValue.httpRequest,
              ...(status === undefined ? {} : { status }),
              reason: result.timedOut
                ? `Request ${request.method} ${diagnosticRequestUrl(request)} timed out after ${request.timeoutMillis} ms.`
                : `Request ${request.method} ${diagnosticRequestUrl(request)} was aborted.`,
            }),
          )
        : Effect.succeed(result),
    ),
  );
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
  raceWithRequestAbort({
    request,
    abort: () => timed.abort,
    status: timed.response.status,
    run: () => timed.response.text(),
    catch: () =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.http,
        retryable: isRetryableMethod(request.method),
        provider: request.provider,
        operation: SignatureKitOperationValue.httpRequest,
        status: timed.response.status,
        reason: `Failed to read ${request.method} ${diagnosticRequestUrl(request)} response body.`,
      }),
  });

const isRetryableStatus = (method: SignatureHttpMethod, status: number): boolean =>
  status === 429 || (isRetryableMethod(method) && status >= 500);

const RATE_LIMIT_RESET_DELTA_CUTOFF_SECONDS = 10_000_000;
const RATE_LIMIT_RESET_PAST_SKEW_SECONDS = 86_400;
const RATE_LIMIT_RESET_FUTURE_WINDOW_SECONDS = 31_536_000;

const retryAfterEpochSeconds = (timed: TimedResponse): number | undefined => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const reset = Number(timed.response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    if (reset < RATE_LIMIT_RESET_DELTA_CUTOFF_SECONDS) return nowSeconds + reset;
    if (
      reset >= nowSeconds - RATE_LIMIT_RESET_PAST_SKEW_SECONDS &&
      reset <= nowSeconds + RATE_LIMIT_RESET_FUTURE_WINDOW_SECONDS
    ) {
      return reset < nowSeconds ? nowSeconds : reset;
    }
  }
  const retryAfter = Number(timed.response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return nowSeconds + retryAfter;
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
  raceWithRequestAbort({
    request,
    abort: (signal) => startRequestAbort(request, signal),
    clearOnSuccess: false,
    run: (abort) =>
      fetch(request.url, {
        method: request.method,
        signal: abort.signal,
        ...(request.headers === undefined ? {} : { headers: request.headers }),
        ...(request.body === undefined ? {} : { body: request.body }),
      }).then((response) => ({ response, abort })),
    catch: (error) =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.http,
        retryable: isRetryableMethod(request.method),
        provider: request.provider,
        operation: SignatureKitOperationValue.httpRequest,
        reason: Schema.is(AbortCauseSchema)(error)
          ? `Request ${request.method} ${diagnosticRequestUrl(request)} was aborted.`
          : `Failed to call ${request.method} ${diagnosticRequestUrl(request)}.`,
      }),
  }).pipe(
    Effect.flatMap((result) =>
      result.response.ok || (request.acceptedStatuses?.includes(result.response.status) ?? false)
        ? Effect.succeed(result)
        : failOnHttpStatus(request, result),
    ),
  );

const decodeJsonBody = <A>(
  request: SignatureHttpRequest,
  timed: TimedResponse,
  schema: Schema.ConstraintDecoder<A>,
  schemaName: string,
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
  raceWithRequestAbort({
    request,
    abort: () => timed.abort,
    status: timed.response.status,
    run: () => timed.response.arrayBuffer(),
    catch: () =>
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.http,
        retryable: isRetryableMethod(request.method),
        provider: request.provider,
        operation: SignatureKitOperationValue.httpRequest,
        status: timed.response.status,
        reason: `Failed to read ${request.method} ${diagnosticRequestUrl(request)} response body.`,
      }),
  }).pipe(Effect.map((body) => new Uint8Array(body)));

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
      schemaName: string,
    ) =>
      Schema.decodeUnknownEffect(SignatureHttpRequestSchema)(request).pipe(
        Effect.mapError(
          (issue) =>
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.invalidInput,
              retryable: false,
              operation: SignatureKitOperationValue.schemaDecode,
              schemaName: "SignatureHttpRequest",
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
              schemaName: "SignatureHttpRequest",
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
              schemaName: "SignatureHttpRequest",
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
