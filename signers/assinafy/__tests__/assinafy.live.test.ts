import { describe, expect, it } from "@effect/vitest";
import type {
  RemoteSignatureRequest,
  RemoteSignatureRequestInput,
} from "@signature-kit/core/config";
import { signatureHttpClientLive } from "@signature-kit/core/http";
import { reconcileInput } from "../../__tests__/alchemy-provider";
import { Effect, Redacted, Schema } from "effect";
import {
  AssinafySignatureRequest,
  AssinafySignatureRequestProvider,
  assinafyCredentialsLayer,
  type AssinafyProviderOptions,
} from "../src/index";

const liveConfig = () => {
  if (process.env.SIGNATURE_KIT_LIVE_REMOTE_SIGNERS !== "1") return undefined;

  const accountId = process.env.ASSINAFY_ACCOUNT_ID;
  const apiKey = process.env.ASSINAFY_API_KEY;
  const recipientEmail = process.env.SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL;

  if (accountId === undefined || apiKey === undefined || recipientEmail === undefined) {
    return undefined;
  }

  return {
    accountId,
    apiKey,
    recipientEmail,
    baseUrl: process.env.ASSINAFY_BASE_URL,
  };
};

const livePdf = (): Uint8Array => {
  const encoder = new TextEncoder();
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object) => {
    const offset = encoder.encode(pdf).byteLength;
    pdf += object;
    return offset;
  });
  const xrefOffset = encoder.encode(pdf).byteLength;
  const entries = offsets
    .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
    .join("");
  return encoder.encode(
    `${pdf}xref\n0 5\n0000000000 65535 f \n${entries}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
};

const AssinafySignerListSchema = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.NonEmptyString,
      email: Schema.String,
    }),
  ),
});
const ASSINAFY_CLEANUP_DELETE_ATTEMPTS = 30;

const cleanupResponse = (operation: string, response: Response): Effect.Effect<void> => {
  if (response.ok || response.status === 404) return Effect.void;
  return Effect.promise(() => response.text()).pipe(
    Effect.flatMap((body) =>
      Effect.die(`${operation} failed with HTTP ${response.status}: ${body.slice(0, 512)}`),
    ),
  );
};

const cleanupJsonResponse = (operation: string, response: Response) => {
  if (response.ok) return Effect.promise(() => response.json());
  return Effect.promise(() => response.text()).pipe(
    Effect.flatMap((body) =>
      Effect.die(`${operation} failed with HTTP ${response.status}: ${body.slice(0, 512)}`),
    ),
  );
};

const deleteAssinafyDocument = (
  documentUrl: string,
  apiKey: string,
  attempt: number,
): Effect.Effect<void> =>
  Effect.promise(() =>
    fetch(documentUrl, {
      method: "DELETE",
      headers: { "X-Api-Key": apiKey },
    }),
  ).pipe(
    Effect.flatMap((response) => {
      if (response.ok || response.status === 404) return Effect.void;
      return Effect.promise(() => response.text()).pipe(
        Effect.flatMap((body) => {
          if (
            response.status === 400 &&
            body.includes("metadata_processing") &&
            attempt < ASSINAFY_CLEANUP_DELETE_ATTEMPTS
          ) {
            return Effect.promise<void>(
              () => new Promise((resolve) => setTimeout(resolve, 2000)),
            ).pipe(Effect.flatMap(() => deleteAssinafyDocument(documentUrl, apiKey, attempt + 1)));
          }
          return Effect.die(
            `Delete Assinafy document failed with HTTP ${response.status}: ${body.slice(0, 512)}`,
          );
        }),
      );
    }),
  );

const liveRecipientEmail = (email: string): string => {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  return `${email.slice(0, at)}+signature-kit-${Date.now()}${email.slice(at)}`;
};

const deleteAssinafyArtifacts = (
  request: RemoteSignatureRequest,
  options: {
    readonly accountId: string;
    readonly apiKey: string;
    readonly recipientEmail: string;
  },
) => {
  const documentUrl = request.detailsUrl;
  if (documentUrl === undefined) {
    return Effect.die("Assinafy live cleanup requires the created document URL.");
  }

  const baseUrl = new URL(documentUrl).origin;

  return Effect.gen(function* () {
    yield* deleteAssinafyDocument(documentUrl, options.apiKey, 1);

    const signersBody = yield* Effect.promise(() =>
      fetch(
        `${baseUrl}/v1/accounts/${options.accountId}/signers?email=${encodeURIComponent(options.recipientEmail)}`,
        { headers: { "X-Api-Key": options.apiKey } },
      ),
    ).pipe(Effect.flatMap((response) => cleanupJsonResponse("List Assinafy signers", response)));
    const signers = yield* Schema.decodeUnknownEffect(AssinafySignerListSchema)(signersBody);

    yield* Effect.forEach(
      signers.data.filter((signer) => signer.email === options.recipientEmail),
      (signer) =>
        Effect.promise(() =>
          fetch(`${baseUrl}/v1/accounts/${options.accountId}/signers/${signer.id}`, {
            method: "DELETE",
            headers: { "X-Api-Key": options.apiKey },
          }),
        ).pipe(Effect.flatMap((response) => cleanupResponse("Delete Assinafy signer", response))),
    );
  });
};

const reconcileAssinafySignatureRequest = (
  options: AssinafyProviderOptions,
  request: RemoteSignatureRequestInput,
) =>
  Effect.gen(function* () {
    const provider = yield* AssinafySignatureRequest.Provider;
    return yield* provider.reconcile(reconcileInput("assinafy-live-request", request));
  }).pipe(
    Effect.provide(AssinafySignatureRequestProvider()),
    Effect.provide(assinafyCredentialsLayer(options)),
    Effect.provide(signatureHttpClientLive),
  );

const config = liveConfig();

if (config === undefined) {
  describe.skip("Assinafy live API", () => {
    it("requires SIGNATURE_KIT_LIVE_REMOTE_SIGNERS, ASSINAFY_ACCOUNT_ID, ASSINAFY_API_KEY and SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL", () => {});
  });
} else {
  describe("Assinafy live API", () => {
    it.effect(
      "creates an assignment on the sandbox API with a dummy PDF",
      () =>
        Effect.gen(function* () {
          const recipientEmail = liveRecipientEmail(config.recipientEmail);
          const input = {
            title: "SignatureKit live Assinafy assignment",
            message: "Created by SignatureKit live test.",
            documents: [
              {
                fileName: "signature-kit-live.pdf",
                mimeType: "application/pdf",
                content: livePdf(),
              },
            ],
            recipients: [
              {
                name: "SignatureKit Live Recipient",
                email: recipientEmail,
                role: "signer",
                routingOrder: 1,
              },
            ],
            send: false,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          } satisfies RemoteSignatureRequestInput;

          yield* Effect.acquireUseRelease(
            reconcileAssinafySignatureRequest(
              {
                accountId: config.accountId,
                apiKey: Redacted.make(config.apiKey),
                environment: "sandbox",
                ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
              },
              input,
            ),
            (request) =>
              Effect.sync(() => {
                expect(request.provider).toBe("assinafy");
                expect(request.state).toBe("draft");
                expect(request.id.length).toBeGreaterThan(0);
              }),
            (request) =>
              deleteAssinafyArtifacts(request, {
                accountId: config.accountId,
                apiKey: config.apiKey,
                recipientEmail,
              }),
          );
        }),
      120_000,
    );
  });
}
