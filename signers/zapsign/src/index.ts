import { bytesToBase64 } from "@signature-kit/crypto/base64";
import {
  RemoteSignatureRequestPropsSchema,
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  SignatureKitSchemaNameValue,
  redactedStringSchema,
  remoteSignatureInputFromProps,
  validRemoteSignatureRequest,
} from "@signature-kit/core/config";
import type {
  RemoteSignatureProvider,
  RemoteSignatureRecipient,
  RemoteSignatureRequest,
  RemoteSignatureRequestInput,
  RemoteSignatureRequestProps,
} from "@signature-kit/core/config";
import {
  SignatureHttpClient,
  bearerAuthorization,
  decodeRemoteOptions,
  decodeRemoteShape,
  signatureHttpClientLive,
  normalizedBaseUrl,
} from "@signature-kit/core/http";
import type { SignatureHttpClientService } from "@signature-kit/core/http";
import { Resource } from "alchemy/Resource";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Schema } from "effect";

const PROVIDER: RemoteSignatureProvider = "zapsign";
const ZAPSIGN_SIGNATURE_REQUEST_RESOURCE = "SignatureKit.ZapSignSignatureRequest";
const ZAPSIGN_PROVIDER_COLLECTION_ID = "@signature-kit/zapsign/Providers";
const SANDBOX_BASE_URL = "https://sandbox.api.zapsign.com.br/api/v1";
const PRODUCTION_BASE_URL = "https://api.zapsign.com.br/api/v1";
const BRAZIL_BASE_URL = "https://br.api.zapsign.com.br/api/v1";

const publicIdentifier: Schema.ConstraintDecoder<string> = Schema.NonEmptyString;

const ZapSignEnvironmentSchema = Schema.Literals(["production", "sandbox", "brazil"]);
export type ZapSignEnvironment = (typeof ZapSignEnvironmentSchema)["Type"];

const ZapSignLocaleSchema = Schema.Literals(["pt-br", "es", "en"]);
export type ZapSignLocale = (typeof ZapSignLocaleSchema)["Type"];

const ZapSignAuthModeSchema = Schema.Literals([
  "assinaturaTela",
  "tokenEmail",
  "assinaturaTela-tokenEmail",
  "tokenSms",
  "assinaturaTela-tokenSms",
  "tokenWhatsapp",
  "assinaturaTela-tokenWhatsapp",
  "certificadoDigital",
]);
export type ZapSignAuthMode = (typeof ZapSignAuthModeSchema)["Type"];

export const ZapSignProviderOptionsSchema = Schema.Struct({
  apiToken: redactedStringSchema,
  environment: Schema.optional(ZapSignEnvironmentSchema),
  baseUrl: Schema.optional(Schema.NonEmptyString),
  locale: Schema.optional(ZapSignLocaleSchema),
  authMode: Schema.optional(ZapSignAuthModeSchema),
  disableSignerEmails: Schema.optional(Schema.Boolean),
});
export type ZapSignProviderOptions = (typeof ZapSignProviderOptionsSchema)["Type"];

const ZapSignSignerResultSchema = Schema.Struct({
  token: publicIdentifier,
  sign_url: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  status: Schema.optional(Schema.String),
});

const ZapSignDocumentResultSchema = Schema.Struct({
  token: publicIdentifier,
  status: Schema.optional(Schema.String),
  original_file: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  signed_file: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  signers: Schema.optional(Schema.Array(ZapSignSignerResultSchema)),
});
type ZapSignDocumentResult = (typeof ZapSignDocumentResultSchema)["Type"];

const ZapSignDocumentsResultSchema = Schema.Struct({
  count: Schema.optional(Schema.Number),
  next: Schema.optional(Schema.Union([Schema.Null, Schema.String])),
  previous: Schema.optional(Schema.Union([Schema.Null, Schema.String])),
  results: Schema.Array(ZapSignDocumentResultSchema),
});

export type ZapSignSignatureRequest = Resource<
  typeof ZAPSIGN_SIGNATURE_REQUEST_RESOURCE,
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const ZapSignSignatureRequest = Resource<ZapSignSignatureRequest>(
  ZAPSIGN_SIGNATURE_REQUEST_RESOURCE,
  { defaultRemovalPolicy: "retain" },
);

export class ZapSignCredentials extends Context.Service<
  ZapSignCredentials,
  ZapSignProviderOptions
>()("@signature-kit/zapsign/Credentials") {}

export const zapSignCredentialsLayer = (
  options: ZapSignProviderOptions,
): Layer.Layer<ZapSignCredentials, SignatureKitError> =>
  Layer.effect(
    ZapSignCredentials,
    decodeRemoteOptions(
      ZapSignProviderOptionsSchema,
      SignatureKitSchemaNameValue.zapSignProviderOptions,
      PROVIDER,
      options,
    ),
  );

const zapSignBaseUrl = (options: ZapSignProviderOptions): string => {
  if (options.baseUrl !== undefined) return normalizedBaseUrl(options.baseUrl);
  if (options.environment === "brazil") return BRAZIL_BASE_URL;
  if (options.environment !== undefined) {
    return options.environment === "production" ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
  }
  return typeof process !== "undefined" && process.env.NODE_ENV === "production"
    ? PRODUCTION_BASE_URL
    : SANDBOX_BASE_URL;
};

const signerPayload = (
  options: ZapSignProviderOptions,
  recipient: RemoteSignatureRecipient,
  input: RemoteSignatureRequestInput,
  index: number,
) => ({
  name: recipient.name,
  email: recipient.email,
  auth_mode: options.authMode ?? "assinaturaTela",
  send_automatic_email: input.send !== false && options.disableSignerEmails !== true,
  order_group: recipient.routingOrder ?? index + 1,
  ...(input.message === undefined ? {} : { custom_message: input.message }),
  ...(input.redirectUrl === undefined ? {} : { redirect_link: input.redirectUrl }),
});

const zapSignRequestState = (status: string | undefined): RemoteSignatureRequest["state"] => {
  if (status === undefined) return "sent";
  const normalized = status.toLowerCase();
  if (normalized.includes("draft")) return "draft";
  if (normalized.includes("signed") || normalized.includes("completed")) return "completed";
  if (
    normalized.includes("refused") ||
    normalized.includes("rejected") ||
    normalized.includes("cancel")
  ) {
    return "cancelled";
  }
  if (normalized.includes("deleted")) return "deleted";
  if (normalized.includes("declined")) return "declined";
  if (normalized.includes("expired")) return "expired";
  return "sent";
};

const toRemoteSignatureRequest = (
  result: ZapSignDocumentResult,
  state?: RemoteSignatureRequest["state"],
): RemoteSignatureRequest => {
  const signingUrl = result.signers?.[0]?.sign_url;
  const originalFile = result.original_file;
  const signedFile = result.signed_file;

  return {
    provider: PROVIDER,
    id: result.token,
    state: state ?? zapSignRequestState(result.status),
    ...(result.status === undefined ? {} : { providerStatus: result.status }),
    ...(signingUrl === undefined || signingUrl === null ? {} : { signingUrl }),
    ...(originalFile === undefined || originalFile === null ? {} : { detailsUrl: originalFile }),
    ...(signedFile === undefined || signedFile === null ? {} : { downloadUrl: signedFile }),
  };
};

const createRemoteRequest = (
  http: SignatureHttpClientService,
  options: ZapSignProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> => {
  const document = input.documents[0];
  if (input.documents.length !== 1 || document?.mimeType !== "application/pdf") {
    return Effect.fail(
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.unsupportedOperation,
        retryable: false,
        provider: PROVIDER,
        operation: SignatureKitOperationValue.remoteCreate,
        reason: "ZapSign creates one PDF document per signature request.",
      }),
    );
  }

  return http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      url: `${baseUrl}/docs/`,
      headers: {
        "Content-Type": "application/json",
        Authorization: bearerAuthorization(options.apiToken),
      },
      body: JSON.stringify({
        name: input.title,
        base64_pdf: bytesToBase64(document.content),
        lang: options.locale ?? "pt-br",
        disable_signer_emails: input.send === false || options.disableSignerEmails === true,
        signature_order_active: input.recipients.some(
          (recipient) => recipient.routingOrder !== undefined,
        ),
        signers: input.recipients.map((recipient, index) =>
          signerPayload(options, recipient, input, index),
        ),
        ...(input.expiresAt === undefined
          ? {}
          : { date_limit_to_sign: input.expiresAt.toISOString() }),
      }),
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          ZapSignDocumentResultSchema,
          SignatureKitSchemaNameValue.zapSignDocumentResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) =>
        toRemoteSignatureRequest(result, input.send === false ? "draft" : "sent"),
      ),
    );
};

const getZapSignSignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: ZapSignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "GET",
      url: `${baseUrl}/docs/${id}/`,
      headers: {
        Authorization: bearerAuthorization(options.apiToken),
      },
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          ZapSignDocumentResultSchema,
          SignatureKitSchemaNameValue.zapSignDocumentResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => toRemoteSignatureRequest(result)),
    );

const resolveZapSignListNextUrl = (
  baseUrl: string,
  next: string | null | undefined,
): string | null =>
  next === undefined || next === null || next === ""
    ? null
    : new URL(next.startsWith("/") ? `${baseUrl}${next}` : next, `${baseUrl}/`).toString();

const listZapSignSignatureRequestsInternal = (
  http: SignatureHttpClientService,
  options: ZapSignProviderOptions,
  baseUrl: string,
): Effect.Effect<readonly RemoteSignatureRequest[], SignatureKitError> =>
  Effect.gen(function* () {
    const requests: RemoteSignatureRequest[] = [];
    const initialUrl = new URL(`${baseUrl}/docs/`);
    initialUrl.searchParams.set("page", "1");
    initialUrl.searchParams.set("include_signers", "true");
    let nextUrl: string | null = initialUrl.toString();

    while (nextUrl !== null) {
      const page = yield* http
        .requestJson({
          provider: PROVIDER,
          method: "GET",
          url: nextUrl,
          headers: {
            Authorization: bearerAuthorization(options.apiToken),
          },
        })
        .pipe(
          Effect.flatMap((body) =>
            decodeRemoteShape(
              ZapSignDocumentsResultSchema,
              SignatureKitSchemaNameValue.zapSignDocumentsResult,
              PROVIDER,
              body,
            ),
          ),
        );

      requests.push(...page.results.map((item) => toRemoteSignatureRequest(item)));
      nextUrl = resolveZapSignListNextUrl(baseUrl, page.next);
    }

    return requests;
  });

const cancelZapSignSignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: ZapSignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<void, SignatureKitError> =>
  http.requestVoid({
    provider: PROVIDER,
    method: "POST",
    url: `${baseUrl}/refuse/`,
    headers: {
      "Content-Type": "application/json",
      Authorization: bearerAuthorization(options.apiToken),
    },
    body: JSON.stringify({
      doc_token: id,
      rejected_reason: "Cancelled by SignatureKit provider lifecycle action.",
      notify_signer: false,
    }),
  });

const deleteZapSignSignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: ZapSignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<void, SignatureKitError> =>
  http
    .requestVoid({
      provider: PROVIDER,
      method: "DELETE",
      url: `${baseUrl}/docs/${id}/`,
      headers: {
        Authorization: bearerAuthorization(options.apiToken),
      },
    })
    .pipe(
      Effect.catchTag("SignatureKitError", (error) => {
        if (error.code === SignatureKitErrorCodeValue.http && error.status === 404)
          return Effect.void;
        return Effect.fail(error);
      }),
    );

const downloadZapSignSignedDocumentInternal = (
  http: SignatureHttpClientService,
  options: ZapSignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  getZapSignSignatureRequestInternal(http, options, baseUrl, id).pipe(
    Effect.flatMap((request) => {
      const signedFile = request.downloadUrl;
      if (signedFile !== undefined) {
        return http.requestBytes({
          provider: PROVIDER,
          method: "GET",
          url: signedFile,
        });
      }
      return Effect.fail(
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.unsupportedOperation,
          retryable: false,
          provider: PROVIDER,
          operation: SignatureKitOperationValue.remoteDownload,
          reason: "No signed-file URL is available for this ZapSign request.",
        }),
      );
    }),
  );

export const ZapSignSignatureRequestProvider = () =>
  Provider.effect(
    ZapSignSignatureRequest,
    Effect.gen(function* () {
      const options = yield* ZapSignCredentials;
      const http = yield* SignatureHttpClient;
      const baseUrl = zapSignBaseUrl(options);

      return ZapSignSignatureRequest.Provider.of({
        list: () =>
          listZapSignSignatureRequestsInternal(http, options, baseUrl).pipe(
            Effect.map((requests) => Array.from(requests)),
          ),
        reconcile: Effect.fn(function* ({ news, output }) {
          if (output !== undefined) return output;
          const props = yield* decodeRemoteOptions(
            RemoteSignatureRequestPropsSchema,
            SignatureKitSchemaNameValue.remoteSignatureRequestProps,
            PROVIDER,
            news,
          );
          const input = yield* validRemoteSignatureRequest(remoteSignatureInputFromProps(props));
          return yield* createRemoteRequest(http, options, baseUrl, input);
        }),
        delete: Effect.fn(function* ({ output }) {
          if (output === undefined) {
            const requests = yield* listZapSignSignatureRequestsInternal(http, options, baseUrl);
            yield* Effect.forEach(requests, (request) =>
              deleteZapSignSignatureRequestInternal(http, options, baseUrl, request.id),
            );
            return;
          }
          yield* deleteZapSignSignatureRequestInternal(http, options, baseUrl, output.id);
        }),
      });
    }),
  );

export class ZapSignProviders extends Provider.ProviderCollection<ZapSignProviders>()(
  ZAPSIGN_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: ZapSignProviderOptions) =>
  Layer.effect(ZapSignProviders, Provider.collection([ZapSignSignatureRequest])).pipe(
    Layer.provide(ZapSignSignatureRequestProvider()),
    Layer.provideMerge(zapSignCredentialsLayer(options)),
    Layer.provide(signatureHttpClientLive),
  );

export const createZapSignSignatureRequest = (
  options: ZapSignProviderOptions,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    ZapSignProviderOptionsSchema,
    SignatureKitSchemaNameValue.zapSignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: zapSignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      validRemoteSignatureRequest(input).pipe(
        Effect.flatMap((checked) =>
          SignatureHttpClient.use((http) => createRemoteRequest(http, valid, baseUrl, checked)),
        ),
      ),
    ),
  );

export const getZapSignSignatureRequest = (
  options: ZapSignProviderOptions,
  id: string,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    ZapSignProviderOptionsSchema,
    SignatureKitSchemaNameValue.zapSignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: zapSignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) =>
        getZapSignSignatureRequestInternal(http, valid, baseUrl, id),
      ),
    ),
  );

export const listZapSignSignatureRequests = (
  options: ZapSignProviderOptions,
): Effect.Effect<readonly RemoteSignatureRequest[], SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    ZapSignProviderOptionsSchema,
    SignatureKitSchemaNameValue.zapSignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: zapSignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) => listZapSignSignatureRequestsInternal(http, valid, baseUrl)),
    ),
  );

export const cancelZapSignSignatureRequest = (
  options: ZapSignProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    ZapSignProviderOptionsSchema,
    SignatureKitSchemaNameValue.zapSignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: zapSignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) =>
        cancelZapSignSignatureRequestInternal(http, valid, baseUrl, id),
      ),
    ),
  );

export const deleteZapSignSignatureRequest = (
  options: ZapSignProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    ZapSignProviderOptionsSchema,
    SignatureKitSchemaNameValue.zapSignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: zapSignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) =>
        deleteZapSignSignatureRequestInternal(http, valid, baseUrl, id),
      ),
    ),
  );

export const downloadZapSignSignedDocument = (
  options: ZapSignProviderOptions,
  id: string,
): Effect.Effect<Uint8Array, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    ZapSignProviderOptionsSchema,
    SignatureKitSchemaNameValue.zapSignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: zapSignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) =>
        downloadZapSignSignedDocumentInternal(http, valid, baseUrl, id),
      ),
    ),
  );
