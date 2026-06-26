import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "@effect/vitest";
import { readFile } from "node:fs/promises";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { verifyPdf } from "@signature-kit/pdf/verify";
import { createBrowserPdfTemplate, signBrowserPdf } from "@signature-kit/react/browser-pdf";
import { addReactSignatureField, fieldFromPlacement } from "@signature-kit/react/builder";
import { Effect, Redacted } from "effect";
import { readA1Fixture, toArrayBufferView } from "../../../tooling/testing/fixtures";

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

const readCertificate = (): Effect.Effect<Uint8Array> => {
  const externalCertificatePath = process.env.SIGNATURE_KIT_ITI_P12_PATH;
  return externalCertificatePath === undefined
    ? readA1Fixture("ecpf")
    : Effect.promise(async () => new Uint8Array(await readFile(externalCertificatePath)));
};

const expectedStatus = (): number => {
  const externalCertificatePath = process.env.SIGNATURE_KIT_ITI_P12_PATH;
  const defaultStatus =
    externalCertificatePath === undefined
      ? DEFAULT_EXPECTED_STATUS_WITH_FIXTURE
      : DEFAULT_EXPECTED_STATUS_WITH_EXTERNAL_CERTIFICATE;
  return Number.parseInt(process.env.SIGNATURE_KIT_ITI_EXPECT_STATUS ?? `${defaultStatus}`, 10);
};

const createPdf: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 180]);
  page.drawText("SignatureKit React ITI VALIDAR integration", { x: 34, y: 120, size: 14 });
  const bytes = await pdf.save({ useObjectStreams: false });
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
});

describe("React A1 ITI Validar integration", () => {
  it.effect.runIf(process.env.SIGNATURE_KIT_ITI_VALIDATE === "1")(
    "submits the React browser-PDF signing flow to the real validar.iti.gov.br endpoint",
    () =>
      Effect.gen(function* () {
        const pfx = yield* readCertificate();
        const password = Redacted.make(process.env.SIGNATURE_KIT_ITI_P12_PASSWORD ?? "changeit");
        const expectedHttpStatus = expectedStatus();
        const pdf = yield* createPdf;

        expect(Number.isNaN(expectedHttpStatus)).toBe(false);

        const template = yield* createBrowserPdfTemplate({
          id: "react-iti-template",
          name: "React ITI VALIDAR template",
          documentId: "uploaded",
          documentName: "react-validar-iti.pdf",
          pdf,
          role: { id: "signer-1", label: "Cliente", required: true },
        });
        const field = yield* fieldFromPlacement({
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
        const withField = yield* addReactSignatureField(template, field);
        const signed = yield* signBrowserPdf({
          pdf,
          template: withField,
          fieldId: "signature-1",
          policy: "pades-icp-brasil",
          policyTimeoutMillis: 10_000,
          reason: "SignatureKit React real ITI integration test",
          name: "SignatureKit React signer",
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
