import { bytesToBase64 } from "@signature-kit/crypto";
import {
  ProviderHttpClient,
  SignatureProvider,
  bearerAuthorization,
  createSignatureProviderService,
  decodeProviderOptions,
  decodeProviderShape,
  fileExtension,
  jsonBody,
  jsonContentHeaders,
  normalizeSignatureRequestInput,
  normalizedBaseUrl,
} from "@signature-kit/signature-gateway";
import type {
  ProviderHttpClientService,
  RemoteSignatureRequest,
  SignatureProviderAdapter,
  SignatureProviderFactory,
} from "@signature-kit/signature-gateway";
import { Effect, Layer, Schema } from "effect";
import type { Redacted } from "effect";

const redactedString: Schema.Decoder<Redacted.Redacted<string>> = Schema.Redacted(Schema.String);

export const DocuSignProviderOptionsSchema = Schema.Struct({
  baseUrl: Schema.NonEmptyString,
  accountId: Schema.NonEmptyString,
  accessToken: redactedString,
});
export type DocuSignProviderOptions = (typeof DocuSignProviderOptionsSchema)["Type"];
export const docuSignProviderOptionsSchema = DocuSignProviderOptionsSchema;

const DOCUSIGN_ENVELOPE_SCHEMA = "DocuSignEnvelopeResult";
const DOCUSIGN_OPTIONS_SCHEMA = "DocuSignProviderOptions";
const PROVIDER = "docusign";

const DocuSignEnvelopeResultSchema = Schema.Struct({
  envelopeId: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
  uri: Schema.optional(Schema.String),
});

const documentId = (index: number): string => (index + 1).toString();
const routingOrder = (value: number | undefined, index: number): string =>
  (value ?? index + 1).toString();

const envelopeState = (send: boolean | undefined): "created" | "sent" =>
  send === false ? "created" : "sent";

const toRemoteState = (status: string | undefined): RemoteSignatureRequest["state"] =>
  status === "created" ? "draft" : "sent";

export const createDocuSignProviderAdapter = (
  options: DocuSignProviderOptions,
  http: ProviderHttpClientService,
): SignatureProviderAdapter => {
  const baseUrl = normalizedBaseUrl(options.baseUrl);
  const endpoint = `${baseUrl}/v2.1/accounts/${options.accountId}/envelopes`;

  return {
    id: PROVIDER,
    createSignatureRequest: (input) =>
      normalizeSignatureRequestInput(input).pipe(
        Effect.flatMap((valid) =>
          http.requestJson({
            provider: PROVIDER,
            method: "POST",
            url: endpoint,
            headers: jsonContentHeaders(bearerAuthorization(options.accessToken)),
            body: jsonBody({
              emailSubject: valid.subject ?? valid.title,
              emailBlurb: valid.message,
              status: envelopeState(valid.send),
              documents: valid.documents.map((document, index) => ({
                documentBase64: bytesToBase64(document.content),
                documentId: documentId(index),
                fileExtension: fileExtension(document.fileName),
                name: document.fileName,
              })),
              recipients: {
                signers: valid.recipients.map((recipient, index) => ({
                  email: recipient.email,
                  name: recipient.name,
                  recipientId: documentId(index),
                  routingOrder: routingOrder(recipient.routingOrder, index),
                })),
              },
            }),
          }),
        ),
        Effect.flatMap((body) =>
          decodeProviderShape(
            DocuSignEnvelopeResultSchema,
            DOCUSIGN_ENVELOPE_SCHEMA,
            PROVIDER,
            body,
          ),
        ),
        Effect.map((result) => ({
          provider: PROVIDER,
          id: result.envelopeId,
          state: toRemoteState(result.status),
          providerStatus: result.status,
          detailsUrl: result.uri,
        })),
      ),
    raw: { provider: PROVIDER, baseUrl },
  };
};

export const docusign =
  (options: DocuSignProviderOptions): SignatureProviderFactory =>
  (http) =>
    createDocuSignProviderAdapter(options, http);

export const docuSignProviderLayer = (options: DocuSignProviderOptions) =>
  Layer.effect(
    SignatureProvider,
    ProviderHttpClient.use((http) =>
      decodeProviderOptions(
        docuSignProviderOptionsSchema,
        DOCUSIGN_OPTIONS_SCHEMA,
        PROVIDER,
        options,
      ).pipe(
        Effect.map((valid) =>
          createSignatureProviderService(createDocuSignProviderAdapter(valid, http)),
        ),
      ),
    ),
  );

export const docuSignBearerToken = (token: Redacted.Redacted<string>): string =>
  bearerAuthorization(token);
