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

const SignatureHttpTimeoutMillisSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(2_147_483_647),
);

export const SignatureHttpRequestSchema = Schema.Struct({
  method: SignatureHttpMethodSchema,
  url: Schema.NonEmptyString,
  provider: Schema.optional(Schema.String),
  headers: Schema.optional(SignatureHttpHeadersSchema),
  diagnosticUrl: Schema.optional(Schema.NonEmptyString),
  body: Schema.optional(SignatureHttpBodySchema),
  acceptedStatuses: Schema.optional(Schema.Array(Schema.Number)),
  timeoutMillis: Schema.optional(SignatureHttpTimeoutMillisSchema),
});
export type SignatureHttpRequest = (typeof SignatureHttpRequestSchema)["Type"];

export const SignatureHttpJsonResponseSchema = <Body extends Schema.Top>(body: Body) =>
  Schema.Struct({
    status: Schema.Number,
    body,
  });
export type SignatureHttpJsonResponse<A> = Schema.Struct.Type<{
  readonly status: typeof Schema.Number;
  readonly body: Schema.Schema<A>;
}>;

const diagnosticRequestUrl = (request: SignatureHttpRequest): string =>
  request.diagnosticUrl ??
  request.url.replace(/[?#].*$/, "").replace(/^([a-z][a-z\d+.-]*:\/\/)(?:[^/?#]*@)/i, "$1");

const isRetryableMethod = (method: SignatureHttpMethod): boolean =>
  method === "DELETE" || method === "GET" || method === "PUT";

export type SignatureHttpClientService = {
  readonly requestJson: <A>(
    request: SignatureHttpRequest,
    schema: Schema.ConstraintDecoder<A>,
    schemaName: string,
  ) => Effect.Effect<A, SignatureKitError>;
  readonly requestJsonResponse: <A extends SignatureHttpJsonResponse<unknown>>(
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

const isRetryableStatus = (method: SignatureHttpMethod, status: number): boolean =>
  status === 429 || (isRetryableMethod(method) && status >= 500);

const RATE_LIMIT_RESET_DELTA_CUTOFF_SECONDS = 10_000_000;
const RATE_LIMIT_RESET_PAST_SKEW_SECONDS = 86_400;
const RATE_LIMIT_RESET_FUTURE_WINDOW_SECONDS = 31_536_000;

const retryAfterEpochSeconds = (response: Response): number | undefined => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    if (reset < RATE_LIMIT_RESET_DELTA_CUTOFF_SECONDS) return nowSeconds + reset;
    if (
      reset >= nowSeconds - RATE_LIMIT_RESET_PAST_SKEW_SECONDS &&
      reset <= nowSeconds + RATE_LIMIT_RESET_FUTURE_WINDOW_SECONDS
    ) {
      return reset < nowSeconds ? nowSeconds : reset;
    }
  }
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter === null || retryAfter.length === 0) return undefined;
  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return nowSeconds + retryAfterSeconds;
  }
  const retryAfterDateMillis = Date.parse(retryAfter);
  return Number.isFinite(retryAfterDateMillis)
    ? Math.max(nowSeconds, Math.floor(retryAfterDateMillis / 1000))
    : undefined;
};

const RequestAbortSchema = Schema.Struct({
  _tag: Schema.Literal("RequestAbort"),
  timedOut: Schema.Boolean,
});
type RequestAbort = (typeof RequestAbortSchema)["Type"];

type AcceptedTransportResponse<A> = {
  readonly _tag: "Accepted";
  readonly response: Response;
  readonly body: A;
};

type HttpStatusTransportResponse = {
  readonly _tag: "HttpStatus";
  readonly response: Response;
  readonly body: string;
};

type TransportResult<A> = AcceptedTransportResponse<A> | HttpStatusTransportResponse | RequestAbort;

type TransportResponse<A> = {
  readonly response: Response;
  readonly body: A;
};

type RequestAbortHandle = {
  readonly signal: AbortSignal;
  readonly promise: Promise<RequestAbort>;
  readonly clear: () => void;
};

const startRequestAbort = (
  request: SignatureHttpRequest,
  signal: AbortSignal,
): RequestAbortHandle => {
  const controller = new AbortController();
  let resolvePending: (value: RequestAbort) => void = () => undefined;
  const promise = new Promise<RequestAbort>((resolve) => {
    resolvePending = resolve;
  });
  const abort = (timedOut: boolean): void => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
    resolvePending({ _tag: "RequestAbort", timedOut });
  };
  const timeout =
    request.timeoutMillis === undefined ? undefined : Duration.millis(request.timeoutMillis);
  const timeoutId =
    timeout === undefined ? undefined : setTimeout(() => abort(true), Duration.toMillis(timeout));
  const abortFromSignal = (): void => abort(false);
  if (signal.aborted) abortFromSignal();
  else signal.addEventListener("abort", abortFromSignal, { once: true });
  return {
    signal: controller.signal,
    promise,
    clear: () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", abortFromSignal);
    },
  };
};

const transport = <A>(
  request: SignatureHttpRequest,
  readAcceptedBody: (response: Response) => Promise<A>,
  acceptedBodyFailureReason: string,
): Effect.Effect<TransportResponse<A>, SignatureKitError> =>
  Effect.suspend(() => {
    let response: Response | undefined;
    let statusResponse: Response | undefined;
    let bodyFailureReason = `Failed to read ${request.method} ${diagnosticRequestUrl(request)} response body.`;
    return Effect.tryPromise({
      try: (signal): Promise<TransportResult<A>> => {
        const abort = startRequestAbort(request, signal);
        const requestPromise = Promise.resolve()
          .then(() =>
            fetch(request.url, {
              method: request.method,
              signal: abort.signal,
              ...(request.headers === undefined ? {} : { headers: request.headers }),
              ...(request.body === undefined ? {} : { body: request.body }),
            }),
          )
          .then(
            async (
              nextResponse,
            ): Promise<AcceptedTransportResponse<A> | HttpStatusTransportResponse> => {
              response = nextResponse;
              if (!nextResponse.ok) statusResponse = nextResponse;
              if (
                nextResponse.ok ||
                (request.acceptedStatuses?.includes(nextResponse.status) ?? false)
              ) {
                bodyFailureReason = acceptedBodyFailureReason;
                return {
                  _tag: "Accepted",
                  response: nextResponse,
                  body: await readAcceptedBody(nextResponse),
                };
              }
              return {
                _tag: "HttpStatus",
                response: nextResponse,
                body: await nextResponse.text(),
              };
            },
          );
        return Promise.race([abort.promise, requestPromise]).finally(() => abort.clear());
      },
      catch: () => {
        const resetAt =
          statusResponse === undefined ? undefined : retryAfterEpochSeconds(statusResponse);
        return new SignatureKitError({
          code: SignatureKitErrorCodeValue.http,
          retryable:
            statusResponse === undefined
              ? isRetryableMethod(request.method)
              : isRetryableStatus(request.method, statusResponse.status),
          provider: request.provider,
          operation: SignatureKitOperationValue.httpRequest,
          ...(response === undefined ? {} : { status: response.status }),
          ...(resetAt === undefined ? {} : { retryAfterEpochSeconds: resetAt }),
          reason:
            response === undefined
              ? `Failed to call ${request.method} ${diagnosticRequestUrl(request)}.`
              : bodyFailureReason,
        });
      },
    }).pipe(
      Effect.flatMap((result) => {
        if (Schema.is(RequestAbortSchema)(result)) {
          const resetAt =
            statusResponse === undefined ? undefined : retryAfterEpochSeconds(statusResponse);
          return Effect.fail(
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.http,
              retryable:
                statusResponse === undefined
                  ? isRetryableMethod(request.method)
                  : isRetryableStatus(request.method, statusResponse.status),
              provider: request.provider,
              operation: SignatureKitOperationValue.httpRequest,
              ...(response === undefined ? {} : { status: response.status }),
              ...(resetAt === undefined ? {} : { retryAfterEpochSeconds: resetAt }),
              reason: result.timedOut
                ? `Request ${request.method} ${diagnosticRequestUrl(request)} timed out after ${request.timeoutMillis} ms.`
                : `Request ${request.method} ${diagnosticRequestUrl(request)} was aborted.`,
            }),
          );
        }
        if (result._tag === "Accepted") {
          return Effect.succeed({ response: result.response, body: result.body });
        }
        const resetAt = retryAfterEpochSeconds(result.response);
        return Effect.fail(
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.http,
            retryable: isRetryableStatus(request.method, result.response.status),
            provider: request.provider,
            operation: SignatureKitOperationValue.httpRequest,
            status: result.response.status,
            ...(resetAt === undefined ? {} : { retryAfterEpochSeconds: resetAt }),
            reason:
              result.body.length === 0
                ? `${request.method} ${diagnosticRequestUrl(request)} returned HTTP ${result.response.status}.`
                : `${request.method} ${diagnosticRequestUrl(request)} returned HTTP ${result.response.status}: ${compactBody(result.body)}`,
          }),
        );
      }),
    );
  });

const JsonUnknownSchema = Schema.fromJsonString(Schema.Unknown);

const decodeJsonEnvelope = <A extends SignatureHttpJsonResponse<unknown>>(
  request: SignatureHttpRequest,
  response: Response,
  body: string,
  schema: Schema.ConstraintDecoder<A>,
  schemaName: string,
): Effect.Effect<A, SignatureKitError> =>
  Schema.decodeUnknownEffect(JsonUnknownSchema)(body).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.responseShape,
          retryable: false,
          provider: request.provider,
          operation: SignatureKitOperationValue.httpDecode,
          status: response.status,
          schemaName,
          reason: `Failed to decode ${request.method} ${diagnosticRequestUrl(request)} JSON response.`,
          issueMessage: String(issue),
        }),
    ),
    Effect.flatMap((decodedBody) =>
      Schema.decodeUnknownEffect(schema)({
        status: response.status,
        body: decodedBody,
      }).pipe(
        Effect.mapError(
          (issue) =>
            new SignatureKitError({
              code: SignatureKitErrorCodeValue.responseShape,
              retryable: false,
              provider: request.provider,
              operation: SignatureKitOperationValue.httpDecode,
              status: response.status,
              schemaName,
              reason: `Failed to decode ${request.method} ${diagnosticRequestUrl(request)} JSON response.`,
              issueMessage: String(issue),
            }),
        ),
      ),
    ),
  );

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
          transport(
            valid,
            (response) => response.text(),
            `Failed to read ${valid.method} ${diagnosticRequestUrl(valid)} response body.`,
          ).pipe(
            Effect.flatMap(({ response, body }) =>
              Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(body).pipe(
                Effect.mapError(
                  (issue) =>
                    new SignatureKitError({
                      code: SignatureKitErrorCodeValue.responseShape,
                      retryable: false,
                      provider: valid.provider,
                      operation: SignatureKitOperationValue.httpDecode,
                      status: response.status,
                      schemaName,
                      reason: `Failed to decode ${valid.method} ${diagnosticRequestUrl(valid)} JSON response.`,
                      issueMessage: String(issue),
                    }),
                ),
              ),
            ),
          ),
        ),
      ),
    requestJsonResponse: <A extends SignatureHttpJsonResponse<unknown>>(
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
          transport(
            valid,
            (response) => response.text(),
            `Failed to read ${valid.method} ${diagnosticRequestUrl(valid)} response body.`,
          ).pipe(
            Effect.flatMap(({ response, body }) =>
              decodeJsonEnvelope(valid, response, body, schema, schemaName),
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
          transport(
            valid,
            (response) => response.arrayBuffer(),
            `Failed to read ${valid.method} ${diagnosticRequestUrl(valid)} response body.`,
          ).pipe(Effect.map(({ body }) => new Uint8Array(body))),
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
          transport(
            valid,
            (response) => response.body?.cancel() ?? Promise.resolve(),
            `Failed to discard ${valid.method} ${diagnosticRequestUrl(valid)} response body.`,
          ).pipe(Effect.map(() => undefined)),
        ),
      ),
  },
);

export const bearerAuthorization = (token: Redacted.Redacted<string>): string =>
  `Bearer ${Redacted.value(token)}`;

export const normalizedBaseUrl = (url: string): string =>
  url.endsWith("/") ? url.slice(0, -1) : url;
