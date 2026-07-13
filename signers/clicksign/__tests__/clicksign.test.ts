import { describe, expect, it } from "@effect/vitest";
import { signatureHttpClientLive } from "@signature-kit/http";
import * as Provider from "alchemy/Provider";
import { reconcileResourceProps } from "../../__tests__/alchemy-provider";
import { loadFlaggedConfig, optionalEnv, requiredEnv } from "../../../tooling/testing/env";
import { Config, Effect, Redacted, Result } from "effect";
import {
  ClicksignSignatureRequest,
  providers as clicksignProviders,
  ClicksignSignatureRequestStateSchema,
  cancelClicksignSignatureRequest,
  deleteClicksignSignatureRequest,
  getClicksignSignatureRequest,
  listClicksignSignatureRequests,
} from "../src/index";
import type { ClicksignProviderOptions, ClicksignSignatureRequestProps } from "../src/index";

const config = loadFlaggedConfig(
  "SIGNATURE_KIT_LIVE_REMOTE_SIGNERS",
  Config.all({
    accessToken: requiredEnv("CLICKSIGN_TOKEN"),
    recipientEmail: requiredEnv("SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL"),
    baseUrl: optionalEnv("CLICKSIGN_BASE_URL"),
  }),
);

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

const knownStates = new Set<string>(ClicksignSignatureRequestStateSchema.literals);

if (config === undefined) {
  describe.skip("Clicksign live API", () => {
    it("requires SIGNATURE_KIT_LIVE_REMOTE_SIGNERS, CLICKSIGN_TOKEN and SIGNATURE_KIT_LIVE_RECIPIENT_EMAIL", () => {});
  });
} else {
  const options: ClicksignProviderOptions = {
    accessToken: Redacted.make(config.accessToken),
    environment: "sandbox",
    locale: "pt-BR",
    autoClose: false,
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  };

  const createDraft = Effect.gen(function* () {
    const input = {
      title: "SignatureKit live Clicksign draft",
      message: "Created by SignatureKit live test.",
      documents: [
        {
          fileName: "signature-kit-live.pdf",
          mimeType: "application/pdf",
          contentBase64: Buffer.from(livePdf()).toString("base64"),
        },
      ],
      recipients: [
        {
          name: "SignatureKit Live Recipient",
          email: config.recipientEmail,
          role: "signer",
          routingOrder: 1,
        },
      ],
      send: false,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    } satisfies ClicksignSignatureRequestProps;

    const provider = yield* Provider.findProvider(ClicksignSignatureRequest);
    return yield* provider.reconcile(reconcileResourceProps("clicksign-live-request", input));
  }).pipe(Effect.provide(clicksignProviders(options)), Effect.provide(signatureHttpClientLive));

  describe("Clicksign live API", () => {
    it.effect(
      "runs the full create -> get -> list -> cancel -> delete lifecycle on the sandbox",
      () =>
        Effect.gen(function* () {
          const created = yield* createDraft;
          expect(created.provider).toBe("clicksign");
          expect(created.state).toBe("draft");
          expect(created.id.length).toBeGreaterThan(0);

          const id = created.id;

          yield* Effect.gen(function* () {
            const fetched = yield* getClicksignSignatureRequest(options, id).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(fetched.provider).toBe("clicksign");
            expect(fetched.id).toBe(id);
            expect(knownStates.has(fetched.state)).toBe(true);
            expect(typeof fetched.providerStatus).toBe("string");
            expect(fetched.detailsUrl).toContain(id);

            const listed = yield* listClicksignSignatureRequests(options).pipe(
              Effect.provide(signatureHttpClientLive),
            );
            expect(listed.length).toBeGreaterThan(0);
            const match = listed.find((request) => request.id === id);
            expect(match).toBeDefined();
            expect(match?.provider).toBe("clicksign");

            const cancelled = yield* Effect.result(
              cancelClicksignSignatureRequest(options, id).pipe(
                Effect.provide(signatureHttpClientLive),
              ),
            );
            if (Result.isFailure(cancelled)) {
              expect(cancelled.failure.provider).toBe("clicksign");
              expect(typeof cancelled.failure.code).toBe("string");
            } else {
              expect(cancelled.success).toBeUndefined();
            }
          }).pipe(
            Effect.ensuring(
              deleteClicksignSignatureRequest(options, id)
                .pipe(Effect.provide(signatureHttpClientLive))
                .pipe(Effect.orDie),
            ),
          );
        }),
      { timeout: 60_000 },
    );
  });
}
