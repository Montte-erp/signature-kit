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
  RemoteSignatureDocument,
  RemoteSignatureProvider,
  RemoteSignatureRecipient,
  RemoteSignatureRequest,
  RemoteSignatureRequestInput,
  RemoteSignatureRequestProps,
} from "@signature-kit/core/config";
import {
  SignatureHttpClient,
  decodeRemoteOptions,
  decodeRemoteShape,
  signatureHttpClientLive,
  normalizedBaseUrl,
} from "@signature-kit/core/http";
import type { SignatureHttpClientService, SignatureHttpRequest } from "@signature-kit/core/http";
import { Resource } from "alchemy/Resource";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

const PROVIDER: RemoteSignatureProvider = "clicksign";
const CLICKSIGN_SIGNATURE_REQUEST_RESOURCE = "SignatureKit.ClicksignSignatureRequest";
const CLICKSIGN_PROVIDER_COLLECTION_ID = "@signature-kit/clicksign/Providers";
const SANDBOX_BASE_URL = "https://sandbox.clicksign.com/api/v1";
const PRODUCTION_BASE_URL = "https://app.clicksign.com/api/v1";

const ClicksignEnvironmentSchema = Schema.Literals(["production", "sandbox"]);
export type ClicksignEnvironment = (typeof ClicksignEnvironmentSchema)["Type"];

const ClicksignLocaleSchema = Schema.Literals(["en-US", "pt-BR"]);
export type ClicksignLocale = (typeof ClicksignLocaleSchema)["Type"];

export const ClicksignProviderOptionsSchema = Schema.Struct({
  accessToken: redactedStringSchema,
  environment: Schema.optional(ClicksignEnvironmentSchema),
  baseUrl: Schema.optional(Schema.NonEmptyString),
  locale: Schema.optional(ClicksignLocaleSchema),
  autoClose: Schema.optional(Schema.Boolean),
});
export type ClicksignProviderOptions = (typeof ClicksignProviderOptionsSchema)["Type"];

const ClicksignDocumentResultSchema = Schema.Struct({
  document: Schema.Struct({
    key: Schema.NonEmptyString,
    status: Schema.optional(Schema.String),
  }),
});

const ClicksignSignerResultSchema = Schema.Struct({
  signer: Schema.Struct({ key: Schema.NonEmptyString }),
});

const ClicksignListResultSchema = Schema.Struct({
  list: Schema.Struct({ request_signature_key: Schema.NonEmptyString }),
});

const ClicksignDocumentSchema = Schema.Struct({
  key: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
  download_url: Schema.optional(Schema.String),
  downloadUrl: Schema.optional(Schema.String),
});

const ClicksignGetDocumentResponseSchema = Schema.Struct({
  document: ClicksignDocumentSchema,
});

const ClicksignDocumentsResultSchema = Schema.Struct({
  documents: Schema.Array(ClicksignDocumentSchema),
});

type ClicksignDocumentInfo = (typeof ClicksignDocumentSchema)["Type"];

const toRemoteSignatureRequestState = (
  status: string | undefined,
): RemoteSignatureRequest["state"] => {
  if (status === undefined) return "sent";
  const normalized = status.toLowerCase();
  if (normalized.includes("draft")) return "draft";
  if (normalized.includes("completed") || normalized.includes("signed")) return "completed";
  if (normalized.includes("cancel")) return "cancelled";
  if (normalized.includes("delete")) return "deleted";
  if (normalized.includes("declined")) return "declined";
  if (normalized.includes("expired")) return "expired";
  return "sent";
};

const toRemoteSignatureRequest = (
  baseUrl: string,
  document: ClicksignDocumentInfo,
): RemoteSignatureRequest => ({
  provider: PROVIDER,
  id: document.key,
  state: toRemoteSignatureRequestState(document.status),
  providerStatus: document.status,
  detailsUrl: `${baseUrl}/documents/${document.key}`,
  downloadUrl:
    document.download_url ??
    document.downloadUrl ??
    `${baseUrl}/documents/${document.key}/download`,
});

const getClicksignSignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "GET",
      ...withAccessToken(baseUrl, `/documents/${id}`, options.accessToken),
      headers: { "Content-Type": "application/json" },
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          ClicksignGetDocumentResponseSchema,
          SignatureKitSchemaNameValue.clicksignDocumentResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => toRemoteSignatureRequest(baseUrl, result.document)),
    );

const listClicksignSignatureRequestsInternal = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
): Effect.Effect<readonly RemoteSignatureRequest[], SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "GET",
      ...withAccessToken(baseUrl, "/documents", options.accessToken),
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          ClicksignDocumentsResultSchema,
          SignatureKitSchemaNameValue.clicksignDocumentsResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) =>
        result.documents.map((document) => toRemoteSignatureRequest(baseUrl, document)),
      ),
    );

const cancelClicksignSignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<void, SignatureKitError> =>
  http.requestVoid({
    provider: PROVIDER,
    method: "POST",
    ...withAccessToken(baseUrl, `/documents/${id}/cancel`, options.accessToken),
  });

const deleteClicksignSignatureRequestInternal = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<void, SignatureKitError> =>
  http
    .requestVoid({
      provider: PROVIDER,
      method: "DELETE",
      ...withAccessToken(baseUrl, `/documents/${id}`, options.accessToken),
    })
    .pipe(
      Effect.catchTag("SignatureKitError", (error) =>
        error.code === SignatureKitErrorCodeValue.http && error.status === 404
          ? Effect.void
          : Effect.fail(error),
      ),
    );

const downloadClicksignSignedDocumentInternal = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  id: string,
): Effect.Effect<Uint8Array, SignatureKitError> =>
  getClicksignSignatureRequestInternal(http, options, baseUrl, id).pipe(
    Effect.flatMap((request) => {
      const signedDocumentUrl = request.downloadUrl;
      if (
        signedDocumentUrl !== undefined &&
        (signedDocumentUrl.startsWith("http://") || signedDocumentUrl.startsWith("https://"))
      ) {
        return http.requestBytes({
          provider: PROVIDER,
          method: "GET",
          url: signedDocumentUrl,
        });
      }
      if (signedDocumentUrl !== undefined) {
        return http.requestBytes({
          provider: PROVIDER,
          method: "GET",
          ...withAccessToken(
            baseUrl,
            signedDocumentUrl.startsWith("/") ? signedDocumentUrl : `/${signedDocumentUrl}`,
            options.accessToken,
          ),
        });
      }
      return http.requestBytes({
        provider: PROVIDER,
        method: "GET",
        ...withAccessToken(baseUrl, `/documents/${id}/download`, options.accessToken),
      });
    }),
  );
export type ClicksignSignatureRequest = Resource<
  typeof CLICKSIGN_SIGNATURE_REQUEST_RESOURCE,
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const ClicksignSignatureRequest = Resource<ClicksignSignatureRequest>(
  CLICKSIGN_SIGNATURE_REQUEST_RESOURCE,
  { defaultRemovalPolicy: "retain" },
);

export class ClicksignCredentials extends Context.Service<
  ClicksignCredentials,
  ClicksignProviderOptions
>()("@signature-kit/clicksign/Credentials") {}

export const clicksignCredentialsLayer = (
  options: ClicksignProviderOptions,
): Layer.Layer<ClicksignCredentials, SignatureKitError> =>
  Layer.effect(
    ClicksignCredentials,
    decodeRemoteOptions(
      ClicksignProviderOptionsSchema,
      SignatureKitSchemaNameValue.clicksignProviderOptions,
      PROVIDER,
      options,
    ),
  );

const clicksignBaseUrl = (options: ClicksignProviderOptions): string => {
  if (options.baseUrl !== undefined) return normalizedBaseUrl(options.baseUrl);
  if (options.environment !== undefined) {
    return options.environment === "production" ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
  }
  return typeof process !== "undefined" && process.env.NODE_ENV === "production"
    ? PRODUCTION_BASE_URL
    : SANDBOX_BASE_URL;
};

const withAccessToken = (
  baseUrl: string,
  path: string,
  token: Redacted.Redacted<string>,
): Pick<SignatureHttpRequest, "diagnosticUrl" | "url"> => {
  const url = new URL(`${baseUrl}${path}`);
  const diagnosticUrl = new URL(`${baseUrl}${path}`);
  url.searchParams.set("access_token", Redacted.value(token));
  diagnosticUrl.searchParams.set("access_token", "<redacted>");
  return { url: url.toString(), diagnosticUrl: diagnosticUrl.toString() };
};

const documentPath = (document: RemoteSignatureDocument): string =>
  document.fileName.startsWith("/") ? document.fileName : `/${document.fileName}`;

const recipientGroup = (recipient: RemoteSignatureRecipient, index: number): number =>
  recipient.routingOrder ?? index + 1;

const createDocument = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
  document: RemoteSignatureDocument,
): Effect.Effect<string, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      ...withAccessToken(baseUrl, "/documents", options.accessToken),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document: {
          path: documentPath(document),
          content_base64: `data:${document.mimeType};base64,${bytesToBase64(document.content)}`,
          deadline_at: input.expiresAt?.toISOString(),
          auto_close: options.autoClose ?? true,
          locale: options.locale ?? "pt-BR",
          sequence_enabled:
            input.recipients.length > 1 ||
            input.recipients.some((recipient) => recipient.routingOrder !== undefined),
        },
      }),
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          ClicksignDocumentResultSchema,
          SignatureKitSchemaNameValue.clicksignDocumentResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => result.document.key),
    );

const createSigner = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  recipient: RemoteSignatureRecipient,
): Effect.Effect<string, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      ...withAccessToken(baseUrl, "/signers", options.accessToken),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signer: {
          email: recipient.email,
          name: recipient.name,
          auths: ["email"],
          has_documentation: false,
        },
      }),
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          ClicksignSignerResultSchema,
          SignatureKitSchemaNameValue.clicksignSignerResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => result.signer.key),
    );

const linkRecipient = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  documentKey: string,
  signerKey: string,
  recipient: RemoteSignatureRecipient,
  index: number,
  message: string | undefined,
): Effect.Effect<string, SignatureKitError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      ...withAccessToken(baseUrl, "/lists", options.accessToken),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        list: {
          document_key: documentKey,
          signer_key: signerKey,
          sign_as: recipient.role === "approver" ? "approve" : "sign",
          group: recipientGroup(recipient, index),
          message,
        },
      }),
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeRemoteShape(
          ClicksignListResultSchema,
          SignatureKitSchemaNameValue.clicksignListResult,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => result.list.request_signature_key),
    );

const notifyRecipient = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  requestSignatureKey: string,
  input: RemoteSignatureRequestInput,
): Effect.Effect<void, SignatureKitError> =>
  http.requestVoid({
    provider: PROVIDER,
    method: "POST",
    ...withAccessToken(baseUrl, "/notifications", options.accessToken),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request_signature_key: requestSignatureKey,
      message: input.message,
      url: input.redirectUrl,
    }),
  });

const createRemoteRequest = (
  http: SignatureHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> => {
  const document = input.documents[0];
  if (input.documents.length !== 1 || document === undefined) {
    return Effect.fail(
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.unsupportedOperation,
        retryable: false,
        provider: PROVIDER,
        operation: SignatureKitOperationValue.remoteCreate,
        reason: "Clicksign API v1 supports one uploaded document per signature request.",
      }),
    );
  }

  return createDocument(http, options, baseUrl, input, document).pipe(
    Effect.map((documentKey) => ({ documentKey })),
    Effect.flatMap(({ documentKey }) =>
      Effect.forEach(input.recipients, (recipient, index) =>
        createSigner(http, options, baseUrl, recipient).pipe(
          Effect.flatMap((signerKey) =>
            linkRecipient(
              http,
              options,
              baseUrl,
              documentKey,
              signerKey,
              recipient,
              index,
              input.message,
            ),
          ),
        ),
      ).pipe(Effect.map((requestSignatureKeys) => ({ documentKey, requestSignatureKeys }))),
    ),
    Effect.flatMap(({ documentKey, requestSignatureKeys }) => {
      if (input.send === false) return Effect.succeed({ documentKey });
      return Effect.forEach(requestSignatureKeys, (requestSignatureKey) =>
        notifyRecipient(http, options, baseUrl, requestSignatureKey, input),
      ).pipe(Effect.map(() => ({ documentKey })));
    }),
    Effect.map(({ documentKey }) => ({
      provider: PROVIDER,
      id: documentKey,
      state: input.send === false ? "draft" : "sent",
    })),
  );
};

export const ClicksignSignatureRequestProvider = () =>
  Provider.effect(
    ClicksignSignatureRequest,
    Effect.gen(function* () {
      const options = yield* ClicksignCredentials;
      const http = yield* SignatureHttpClient;
      const baseUrl = clicksignBaseUrl(options);

      return ClicksignSignatureRequest.Provider.of({
        list: () =>
          listClicksignSignatureRequestsInternal(http, options, baseUrl).pipe(
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
            const requests = yield* listClicksignSignatureRequestsInternal(http, options, baseUrl);
            yield* Effect.forEach(requests, (request) =>
              deleteClicksignSignatureRequestInternal(http, options, baseUrl, request.id),
            );
            return;
          }
          yield* deleteClicksignSignatureRequestInternal(http, options, baseUrl, output.id);
        }),
      });
    }),
  );

export class ClicksignProviders extends Provider.ProviderCollection<ClicksignProviders>()(
  CLICKSIGN_PROVIDER_COLLECTION_ID,
) {}

export const providers = (options: ClicksignProviderOptions) =>
  Layer.effect(ClicksignProviders, Provider.collection([ClicksignSignatureRequest])).pipe(
    Layer.provide(ClicksignSignatureRequestProvider()),
    Layer.provideMerge(clicksignCredentialsLayer(options)),
    Layer.provide(signatureHttpClientLive),
  );

export const createClicksignSignatureRequest = (
  options: ClicksignProviderOptions,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    ClicksignProviderOptionsSchema,
    SignatureKitSchemaNameValue.clicksignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: clicksignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      validRemoteSignatureRequest(input).pipe(
        Effect.flatMap((checked) =>
          SignatureHttpClient.use((http) => createRemoteRequest(http, valid, baseUrl, checked)),
        ),
      ),
    ),
  );
export const getClicksignSignatureRequest = (
  options: ClicksignProviderOptions,
  id: string,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    ClicksignProviderOptionsSchema,
    SignatureKitSchemaNameValue.clicksignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: clicksignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) =>
        getClicksignSignatureRequestInternal(http, valid, baseUrl, id),
      ),
    ),
  );

export const listClicksignSignatureRequests = (
  options: ClicksignProviderOptions,
): Effect.Effect<readonly RemoteSignatureRequest[], SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    ClicksignProviderOptionsSchema,
    SignatureKitSchemaNameValue.clicksignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: clicksignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) =>
        listClicksignSignatureRequestsInternal(http, valid, baseUrl),
      ),
    ),
  );

export const cancelClicksignSignatureRequest = (
  options: ClicksignProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    ClicksignProviderOptionsSchema,
    SignatureKitSchemaNameValue.clicksignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: clicksignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) =>
        cancelClicksignSignatureRequestInternal(http, valid, baseUrl, id),
      ),
    ),
  );

export const deleteClicksignSignatureRequest = (
  options: ClicksignProviderOptions,
  id: string,
): Effect.Effect<void, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    ClicksignProviderOptionsSchema,
    SignatureKitSchemaNameValue.clicksignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: clicksignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) =>
        deleteClicksignSignatureRequestInternal(http, valid, baseUrl, id),
      ),
    ),
  );

export const downloadClicksignSignedDocument = (
  options: ClicksignProviderOptions,
  id: string,
): Effect.Effect<Uint8Array, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    ClicksignProviderOptionsSchema,
    SignatureKitSchemaNameValue.clicksignProviderOptions,
    PROVIDER,
    options,
  ).pipe(
    Effect.map((valid) => ({ valid, baseUrl: clicksignBaseUrl(valid) })),
    Effect.flatMap(({ valid, baseUrl }) =>
      SignatureHttpClient.use((http) =>
        downloadClicksignSignedDocumentInternal(http, valid, baseUrl, id),
      ),
    ),
  );
