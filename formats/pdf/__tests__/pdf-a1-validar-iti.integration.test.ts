import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "@effect/vitest";
import { readFile } from "node:fs/promises";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { verifyPdf } from "@signature-kit/pdf/verify";
import {
  createPdfSignatureTemplateFromBytes,
  signPdfSignatureField,
} from "@signature-kit/pdf/workflow";
import { addPdfSignatureField, pdfSignatureFieldFromPlacement } from "@signature-kit/pdf/builder";
import { Config, Effect, Redacted } from "effect";
import { readA1Fixture, toArrayBufferView } from "../../../tooling/testing/fixtures";
import { loadFlaggedConfig, optionalEnv, optionalIntEnv } from "../../../tooling/testing/env";

const DEFAULT_EXPECTED_STATUS_WITH_FIXTURE = 406;
const DEFAULT_EXPECTED_STATUS_WITH_EXTERNAL_CERTIFICATE = 200;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const parseJson = (text: string): Effect.Effect<unknown> => Effect.sync(() => JSON.parse(text));

const readStringField = (input: unknown, field: string): string | undefined => {
  if (input === null || typeof input !== "object") return undefined;
  const value = Reflect.get(input, field);
  return typeof value === "string" ? value : undefined;
};

const readNumberField = (input: unknown, field: string): number | undefined => {
  if (input === null || typeof input !== "object") return undefined;
  const value = Reflect.get(input, field);
  return typeof value === "number" ? value : undefined;
};

const readObjectField = (input: unknown, field: string): object | undefined => {
  if (input === null || typeof input !== "object") return undefined;
  const value = Reflect.get(input, field);
  return value !== null && typeof value === "object" ? value : undefined;
};

const config = loadFlaggedConfig(
  "SIGNATURE_KIT_ITI_VALIDATE",
  Config.all({
    externalCertificatePath: optionalEnv("SIGNATURE_KIT_ITI_P12_PATH"),
    expectedStatus: optionalIntEnv("SIGNATURE_KIT_ITI_EXPECT_STATUS"),
    password: Config.redacted("SIGNATURE_KIT_ITI_P12_PASSWORD").pipe(
      Config.withDefault(Redacted.make("changeit")),
    ),
  }),
);

const readCertificate = (externalCertificatePath: string | undefined): Effect.Effect<Uint8Array> =>
  externalCertificatePath === undefined
    ? readA1Fixture("ecpf")
    : Effect.promise(async () => new Uint8Array(await readFile(externalCertificatePath)));

const expectedStatus = (
  externalCertificatePath: string | undefined,
  expectedStatusOverride: number | undefined,
): number => {
  const defaultStatus =
    externalCertificatePath === undefined
      ? DEFAULT_EXPECTED_STATUS_WITH_FIXTURE
      : DEFAULT_EXPECTED_STATUS_WITH_EXTERNAL_CERTIFICATE;
  return expectedStatusOverride ?? defaultStatus;
};

const createPdf: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 180]);
  page.drawText("SignatureKit PDF ITI VALIDAR integration", { x: 34, y: 120, size: 14 });
  const bytes = await pdf.save({ useObjectStreams: false });
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
});

describe("PDF ITI Validar integration", () => {
  it.effect.runIf(config !== undefined)(
    "submits the PDF signing flow to the real validar.iti.gov.br endpoint",
    () =>
      Effect.gen(function* () {
        const liveConfig = config;
        if (liveConfig === undefined) {
          return yield* Effect.die("ITI validation config was not loaded.");
        }
        const pfx = yield* readCertificate(liveConfig.externalCertificatePath);
        const password = liveConfig.password;
        const expectedHttpStatus = expectedStatus(
          liveConfig.externalCertificatePath,
          liveConfig.expectedStatus,
        );
        const pdf = yield* createPdf;

        expect(Number.isNaN(expectedHttpStatus)).toBe(false);

        const template = yield* createPdfSignatureTemplateFromBytes({
          id: "pdf-iti-template",
          name: "PDF ITI VALIDAR template",
          documentId: "uploaded",
          documentName: "react-validar-iti.pdf",
          pdf,
          role: { id: "signer-1", label: "Cliente", required: true },
        });
        const field = yield* pdfSignatureFieldFromPlacement({
          documentId: "uploaded",
          pageIndex: 0,
          x: 40,
          y: 112,
          draft: {
            id: "signature-1",
            type: "signature",
            roleId: "signer-1",
            width: 120,
            height: 32,
            label: "Assinatura A1",
            required: true,
          },
        });
        const withField = yield* addPdfSignatureField(template, field);
        const signed = yield* signPdfSignatureField({
          pdf,
          template: withField,
          fieldId: "signature-1",
          policy: "pades-icp-brasil",
          policyTimeoutMillis: 10_000,
          reason: "SignatureKit PDF real ITI integration test",
          name: "SignatureKit PDF signer",
          location: "BR",
          signatureLength: 32768,
        }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password })));
        const localVerification = yield* verifyPdf({ pdf: signed });
        const digest = yield* Effect.promise(
          async () =>
            new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBufferView(signed))),
        );
        const signedHash = toHex(digest);

        expect(localVerification.valid).toBe(true);
        expect(localVerification.signatureCount).toBe(1);

        const formData = new FormData();
        formData.append(
          "signature_files[]",
          new File([toArrayBufferView(signed)], "signature-kit-react-validar-iti.pdf", {
            type: "application/pdf",
          }),
        );
        const response = yield* Effect.promise(() =>
          fetch("https://validar.iti.gov.br/arquivo", {
            method: "POST",
            body: formData,
            headers: {
              Origin: "https://validar.iti.gov.br",
              Referer: "https://validar.iti.gov.br/",
              "User-Agent": "Mozilla/5.0 SignatureKit React integration test",
            },
          }),
        );
        const text = yield* Effect.promise(() => response.text());
        const body = yield* parseJson(text);

        expect(response.status).toBe(expectedHttpStatus);

        if (expectedHttpStatus === DEFAULT_EXPECTED_STATUS_WITH_FIXTURE) {
          expect(readNumberField(body, "errorCode")).toBe(DEFAULT_EXPECTED_STATUS_WITH_FIXTURE);
          expect(readStringField(body, "hash")).toBe(signedHash);
          expect(readStringField(body, "nome")).toBe("Verificador de Conformidade");
        }

        if (expectedHttpStatus === DEFAULT_EXPECTED_STATUS_WITH_EXTERNAL_CERTIFICATE) {
          expect(readObjectField(body, "verifierReport")).not.toBeUndefined();
        }
      }),
    180_000,
  );
});
