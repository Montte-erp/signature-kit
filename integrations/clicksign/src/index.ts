import { bytesToBase64 } from "@signature-kit/crypto";
import {
  ProviderHttpClient,
  SignatureProvider,
  SignatureProviderError,
  SignatureProviderErrorCodeValue,
  SignatureProviderOperationValue,
  createSignatureProviderService,
  decodeProviderOptions,
  decodeProviderShape,
  jsonBody,
  jsonHeaders,
  normalizeSignatureRequestInput,
  normalizedBaseUrl,
} from "@signature-kit/signature-gateway";
import type {
  ProviderHttpClientService,
  SignatureDocument,
  SignatureProviderAdapter,
  SignatureProviderFactory,
  SignatureRecipient,
  SignatureRequestInput,
} from "@signature-kit/signature-gateway";
import { Effect, Layer, Redacted, Schema } from "effect";

const PROVIDER = "clicksign";
const SANDBOX_BASE_URL = "https://sandbox.clicksign.com/api/v1";
const PRODUCTION_BASE_URL = "https://app.clicksign.com/api/v1";

const redactedString: Schema.Decoder<Redacted.Redacted<string>> = Schema.Redacted(Schema.String);

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

const CLICKSIGN_DOCUMENT_SCHEMA = "ClicksignDocumentResult";
const CLICKSIGN_SIGNER_SCHEMA = "ClicksignSignerResult";
const CLICKSIGN_LIST_SCHEMA = "ClicksignListResult";
const CLICKSIGN_OPTIONS_SCHEMA = "ClicksignProviderOptions";

const ClicksignDocumentResultSchema = Schema.Struct({
  document: Schema.Struct({
    key: Schema.NonEmptyString,
    status: Schema.optional(Schema.String),
  }),
});

const ClicksignSignerResultSchema = Schema.Struct({
  signer: Schema.Struct({
    key: Schema.NonEmptyString,
  }),
});

const ClicksignListResultSchema = Schema.Struct({
  list: Schema.Struct({
    request_signature_key: Schema.NonEmptyString,
  }),
});

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

const documentPath = (document: SignatureDocument): string =>
  document.fileName.startsWith("/") ? document.fileName : `/${document.fileName}`;

const recipientGroup = (recipient: SignatureRecipient, index: number): number =>
  recipient.routingOrder ?? index + 1;

const oneDocument = (
  input: SignatureRequestInput,
): Effect.Effect<SignatureDocument, SignatureProviderError> => {
  const document = input.documents[0];
  if (input.documents.length === 1 && document !== undefined) return Effect.succeed(document);
  return Effect.fail(
    new SignatureProviderError({
      code: SignatureProviderErrorCodeValue.unsupportedOperation,
      retryable: false,
      provider: PROVIDER,
      operation: SignatureProviderOperationValue.create,
      reason: "Clicksign API v1 adapter supports one uploaded document per signature request.",
    }),
  );
};

const createDocument = (
  http: ProviderHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  input: SignatureRequestInput,
  document: SignatureDocument,
): Effect.Effect<string, SignatureProviderError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      url: withAccessToken(baseUrl, "/documents", options.accessToken),
      headers: jsonHeaders,
      body: jsonBody({
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
        decodeProviderShape(
          ClicksignDocumentResultSchema,
          CLICKSIGN_DOCUMENT_SCHEMA,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => result.document.key),
    );

const createSigner = (
  http: ProviderHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  recipient: SignatureRecipient,
): Effect.Effect<string, SignatureProviderError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      url: withAccessToken(baseUrl, "/signers", options.accessToken),
      headers: jsonHeaders,
      body: jsonBody({
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
        decodeProviderShape(ClicksignSignerResultSchema, CLICKSIGN_SIGNER_SCHEMA, PROVIDER, body),
      ),
      Effect.map((result) => result.signer.key),
    );

const linkRecipient = (
  http: ProviderHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  documentKey: string,
  signerKey: string,
  recipient: SignatureRecipient,
  index: number,
  message: string | undefined,
): Effect.Effect<string, SignatureProviderError> =>
  http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      url: withAccessToken(baseUrl, "/lists", options.accessToken),
      headers: jsonHeaders,
      body: jsonBody({
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
        decodeProviderShape(ClicksignListResultSchema, CLICKSIGN_LIST_SCHEMA, PROVIDER, body),
      ),
      Effect.map((result) => result.list.request_signature_key),
    );

const notifyRecipient = (
  http: ProviderHttpClientService,
  options: ClicksignProviderOptions,
  baseUrl: string,
  requestSignatureKey: string,
  input: SignatureRequestInput,
): Effect.Effect<void, SignatureProviderError> =>
  http.requestVoid({
    provider: PROVIDER,
    method: "POST",
    url: withAccessToken(baseUrl, "/notifications", options.accessToken),
    headers: jsonHeaders,
    body: jsonBody({
      request_signature_key: requestSignatureKey,
      message: input.message,
      url: input.redirectUrl,
    }),
  });

export const createClicksignProviderAdapter = (
  options: ClicksignProviderOptions,
  http: ProviderHttpClientService,
): SignatureProviderAdapter => {
  const baseUrl = clicksignBaseUrl(options);

  return {
    id: PROVIDER,
    createSignatureRequest: (input) =>
      normalizeSignatureRequestInput(input).pipe(
        Effect.flatMap((valid) =>
          oneDocument(valid).pipe(Effect.map((document) => ({ valid, document }))),
        ),
        Effect.flatMap(({ valid, document }) =>
          createDocument(http, options, baseUrl, valid, document).pipe(
            Effect.map((documentKey) => ({ valid, documentKey })),
          ),
        ),
        Effect.flatMap(({ valid, documentKey }) =>
          Effect.forEach(valid.recipients, (recipient, index) =>
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
                  valid.message,
                ),
              ),
            ),
          ).pipe(
            Effect.map((requestSignatureKeys) => ({ valid, documentKey, requestSignatureKeys })),
          ),
        ),
        Effect.flatMap(({ valid, documentKey, requestSignatureKeys }) => {
          if (valid.send === false) {
            return Effect.succeed({ valid, documentKey });
          }
          return Effect.forEach(requestSignatureKeys, (requestSignatureKey) =>
            notifyRecipient(http, options, baseUrl, requestSignatureKey, valid),
          ).pipe(Effect.map(() => ({ valid, documentKey })));
        }),
        Effect.map(({ valid, documentKey }) => ({
          provider: PROVIDER,
          id: documentKey,
          state: valid.send === false ? "draft" : "sent",
        })),
      ),
    raw: { provider: PROVIDER, baseUrl },
  };
};

export const clicksign =
  (options: ClicksignProviderOptions): SignatureProviderFactory =>
  (http) =>
    createClicksignProviderAdapter(options, http);

export const clicksignProviderLayer = (options: ClicksignProviderOptions) =>
  Layer.effect(
    SignatureProvider,
    ProviderHttpClient.use((http) =>
      decodeProviderOptions(
        clicksignProviderOptionsSchema,
        CLICKSIGN_OPTIONS_SCHEMA,
        PROVIDER,
        options,
      ).pipe(
        Effect.map((valid) =>
          createSignatureProviderService(createClicksignProviderAdapter(valid, http)),
        ),
      ),
    ),
  );
