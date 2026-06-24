import { bytesToBase64 } from "@signature-kit/crypto/base64";
import {
  RemoteSignatureRequestPropsSchema,
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  SignatureKitSchemaNameValue,
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
  normalizedBaseUrl,
  signatureHttpClientLive,
} from "@signature-kit/core/http";
import type { SignatureHttpClientService } from "@signature-kit/core/http";
import { Resource } from "alchemy";
import * as Provider from "alchemy/Provider";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

const PROVIDER: RemoteSignatureProvider = "clicksign";
const SANDBOX_BASE_URL = "https://sandbox.clicksign.com/api/v1";
const PRODUCTION_BASE_URL = "https://app.clicksign.com/api/v1";

const redactedString: Schema.ConstraintDecoder<Redacted.Redacted<string>> = Schema.Redacted(
  Schema.String,
);

const ClicksignEnvironmentSchema = Schema.Literals(["production", "sandbox"]);
export const clicksignEnvironmentSchema = ClicksignEnvironmentSchema;
export type ClicksignEnvironment = (typeof clicksignEnvironmentSchema)["Type"];

const ClicksignLocaleSchema = Schema.Literals(["en-US", "pt-BR"]);
export const clicksignLocaleSchema = ClicksignLocaleSchema;
export type ClicksignLocale = (typeof clicksignLocaleSchema)["Type"];

export const ClicksignProviderOptionsSchema = Schema.Struct({
  accessToken: redactedString,
  environment: Schema.optional(ClicksignEnvironmentSchema),
  baseUrl: Schema.optional(Schema.NonEmptyString),
  locale: Schema.optional(ClicksignLocaleSchema),
  autoClose: Schema.optional(Schema.Boolean),
});
export type ClicksignProviderOptions = (typeof ClicksignProviderOptionsSchema)["Type"];
export const clicksignProviderOptionsSchema = ClicksignProviderOptionsSchema;

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

export type ClicksignSignatureRequestResource = Resource<
  "SignatureKit.ClicksignSignatureRequest",
  RemoteSignatureRequestProps,
  RemoteSignatureRequest
>;

export const ClicksignSignatureRequest = Resource<ClicksignSignatureRequestResource>(
  "SignatureKit.ClicksignSignatureRequest",
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
      clicksignProviderOptionsSchema,
      SignatureKitSchemaNameValue.clicksignProviderOptions,
      PROVIDER,
      options,
    ),
  );

const clicksignBaseUrl = (options: ClicksignProviderOptions): string => {
  if (options.baseUrl !== undefined) return normalizedBaseUrl(options.baseUrl);
  return options.environment === "production" ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
};

const withAccessToken = (
  baseUrl: string,
  path: string,
  token: Redacted.Redacted<string>,
): string => {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("access_token", Redacted.value(token));
  return url.toString();
};

const documentPath = (document: RemoteSignatureDocument): string =>
  document.fileName.startsWith("/") ? document.fileName : `/${document.fileName}`;

const recipientGroup = (recipient: RemoteSignatureRecipient, index: number): number =>
  recipient.routingOrder ?? index + 1;

const oneDocument = (
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureDocument, SignatureKitError> => {
  const document = input.documents[0];
  if (input.documents.length === 1 && document !== undefined) return Effect.succeed(document);
  return Effect.fail(
    new SignatureKitError({
      code: SignatureKitErrorCodeValue.unsupportedOperation,
      retryable: false,
      provider: PROVIDER,
      operation: SignatureKitOperationValue.remoteCreate,
      reason: "Clicksign API v1 supports one uploaded document per signature request.",
    }),
  );
};

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
      url: withAccessToken(baseUrl, "/documents", options.accessToken),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document: {
          path: documentPath(document),
          content_base64: `data:${document.mimeType};base64,${bytesToBase64(document.content)}`,
          deadline_at: input.expiresAt?.toISOString(),
          auto_close: options.autoClose ?? true,
          locale: options.locale ?? "pt-BR",
          sequence_enabled: input.recipients.length > 1,
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
      url: withAccessToken(baseUrl, "/signers", options.accessToken),
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
      url: withAccessToken(baseUrl, "/lists", options.accessToken),
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
    url: withAccessToken(baseUrl, "/notifications", options.accessToken),
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
): Effect.Effect<RemoteSignatureRequest, SignatureKitError> =>
  oneDocument(input).pipe(
    Effect.flatMap((document) =>
      createDocument(http, options, baseUrl, input, document).pipe(
        Effect.map((documentKey) => ({ documentKey })),
      ),
    ),
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

export const ClicksignSignatureRequestProvider = () =>
  Provider.effect(
    ClicksignSignatureRequest,
    Effect.gen(function* () {
      const options = yield* ClicksignCredentials;
      const http = yield* SignatureHttpClient;
      const baseUrl = clicksignBaseUrl(options);

      return ClicksignSignatureRequest.Provider.of({
        nuke: { skip: true },
        stables: ["provider", "id"],
        list: () => Effect.succeed([]),
        read: ({ output }) => Effect.succeed(output),
        reconcile: Effect.fnUntraced(function* ({ news, output }) {
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
        delete: () => Effect.void,
      });
    }),
  );

export class ClicksignProviders extends Provider.ProviderCollection<ClicksignProviders>()(
  "SignatureKitClicksign",
) {}

export const providers = (options: ClicksignProviderOptions) =>
  Layer.effect(ClicksignProviders, Provider.collection([ClicksignSignatureRequest])).pipe(
    Layer.provide(ClicksignSignatureRequestProvider()),
    Layer.provide(clicksignCredentialsLayer(options)),
    Layer.provide(signatureHttpClientLive),
  );

export const createClicksignSignatureRequest = (
  options: ClicksignProviderOptions,
  input: RemoteSignatureRequestInput,
): Effect.Effect<RemoteSignatureRequest, SignatureKitError, SignatureHttpClient> =>
  decodeRemoteOptions(
    clicksignProviderOptionsSchema,
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
