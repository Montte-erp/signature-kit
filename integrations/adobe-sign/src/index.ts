import {
  ProviderHttpClient,
  SignatureProvider,
  appendDocumentFile,
  bearerAuthorization,
  createSignatureProviderService,
  decodeProviderOptions,
  decodeProviderShape,
  jsonBody,
  jsonContentHeaders,
  normalizeSignatureRequestInput,
  normalizedBaseUrl,
} from "@signature-kit/signature-gateway";
import type {
  ProviderHttpClientService,
  SignatureDocument,
  SignatureProviderAdapter,
  SignatureProviderFactory,
  SignatureProviderError,
  SignatureRecipient,
} from "@signature-kit/signature-gateway";
import { Effect, Layer, Schema } from "effect";
import type { Redacted } from "effect";

const PROVIDER = "adobe-sign";

const redactedString: Schema.Decoder<Redacted.Redacted<string>> = Schema.Redacted(Schema.String);

export const AdobeSignProviderOptionsSchema = Schema.Struct({
  baseUrl: Schema.NonEmptyString,
  accessToken: redactedString,
});
export type AdobeSignProviderOptions = (typeof AdobeSignProviderOptionsSchema)["Type"];
export const adobeSignProviderOptionsSchema = AdobeSignProviderOptionsSchema;

const ADOBE_TRANSIENT_DOCUMENT_SCHEMA = "AdobeTransientDocumentResult";
const ADOBE_AGREEMENT_SCHEMA = "AdobeAgreementResult";
const ADOBE_OPTIONS_SCHEMA = "AdobeSignProviderOptions";

const AdobeTransientDocumentResultSchema = Schema.Struct({
  transientDocumentId: Schema.NonEmptyString,
});

const AdobeAgreementResultSchema = Schema.Struct({
  id: Schema.NonEmptyString,
});

const agreementState = (send: boolean | undefined): "DRAFT" | "IN_PROCESS" =>
  send === false ? "DRAFT" : "IN_PROCESS";

const recipientRole = (recipient: SignatureRecipient): "APPROVER" | "SIGNER" =>
  recipient.role === "approver" ? "APPROVER" : "SIGNER";

const recipientOrder = (recipient: SignatureRecipient, index: number): number =>
  recipient.routingOrder ?? index + 1;

const uploadDocument = (
  http: ProviderHttpClientService,
  baseUrl: string,
  authorization: string,
  document: SignatureDocument,
): Effect.Effect<string, SignatureProviderError> => {
  const formData = new FormData();
  formData.set("File-Name", document.fileName);
  appendDocumentFile(formData, "File", document);

  return http
    .requestJson({
      provider: PROVIDER,
      method: "POST",
      url: `${baseUrl}/transientDocuments`,
      headers: { Authorization: authorization },
      body: formData,
    })
    .pipe(
      Effect.flatMap((body) =>
        decodeProviderShape(
          AdobeTransientDocumentResultSchema,
          ADOBE_TRANSIENT_DOCUMENT_SCHEMA,
          PROVIDER,
          body,
        ),
      ),
      Effect.map((result) => result.transientDocumentId),
    );
};

export const createAdobeSignProviderAdapter = (
  options: AdobeSignProviderOptions,
  http: ProviderHttpClientService,
): SignatureProviderAdapter => {
  const baseUrl = normalizedBaseUrl(options.baseUrl);
  const authorization = bearerAuthorization(options.accessToken);

  return {
    id: PROVIDER,
    createSignatureRequest: (input) =>
      normalizeSignatureRequestInput(input).pipe(
        Effect.flatMap((valid) =>
          Effect.forEach(valid.documents, (document) =>
            uploadDocument(http, baseUrl, authorization, document),
          ).pipe(Effect.map((transientDocumentIds) => ({ valid, transientDocumentIds }))),
        ),
        Effect.flatMap(({ valid, transientDocumentIds }) =>
          http.requestJson({
            provider: PROVIDER,
            method: "POST",
            url: `${baseUrl}/agreements`,
            headers: jsonContentHeaders(authorization),
            body: jsonBody({
              fileInfos: transientDocumentIds.map((transientDocumentId) => ({
                transientDocumentId,
              })),
              name: valid.title,
              participantSetsInfo: valid.recipients.map((recipient, index) => ({
                memberInfos: [{ email: recipient.email }],
                order: recipientOrder(recipient, index),
                role: recipientRole(recipient),
              })),
              signatureType: "ESIGN",
              state: agreementState(valid.send),
            }),
          }),
        ),
        Effect.flatMap((body) =>
          decodeProviderShape(AdobeAgreementResultSchema, ADOBE_AGREEMENT_SCHEMA, PROVIDER, body),
        ),
        Effect.map((result) => ({
          provider: PROVIDER,
          id: result.id,
          state: input.send === false ? "draft" : "sent",
        })),
      ),
    raw: { provider: PROVIDER, baseUrl },
  };
};

export const adobeSign =
  (options: AdobeSignProviderOptions): SignatureProviderFactory =>
  (http) =>
    createAdobeSignProviderAdapter(options, http);

export const adobeSignProviderLayer = (options: AdobeSignProviderOptions) =>
  Layer.effect(
    SignatureProvider,
    ProviderHttpClient.use((http) =>
      decodeProviderOptions(
        adobeSignProviderOptionsSchema,
        ADOBE_OPTIONS_SCHEMA,
        PROVIDER,
        options,
      ).pipe(
        Effect.map((valid) =>
          createSignatureProviderService(createAdobeSignProviderAdapter(valid, http)),
        ),
      ),
    ),
  );
