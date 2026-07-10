import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { a1SignaturesLayer, parseA1CertificateProfile } from "@signature-kit/a1/signer";
import {
  addPdfSignatureField,
  createPdfSignatureTemplate,
  pdfSignatureFieldFromPlacement,
} from "@signature-kit/pdf/builder";
import { signPdfSignatureField } from "@signature-kit/pdf/workflow";
import {
  LiteParseWorkerFactory,
  liteParseWorkerBrowserLayer,
  parsePdfTextBoxesBrowser,
} from "../src/liteparse-browser";
import type { LiteParseWorker } from "../src/liteparse-browser";
import {
  MAX_LITEPARSE_PAGE_COUNT,
  LiteParseWorkerRequestSchema,
} from "../src/liteparse-browser-protocol";
import { resolveSignatureWidgetPlacement } from "../src/placement";
import { Effect, Layer, Redacted, Result, Schema } from "effect";

const PASSWORD = Redacted.make("changeit");
const latin1 = new TextDecoder("latin1");

const readA1FixtureFromBrowser = (name: "ecpf" | "ecnpj"): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const fixtureUrl = new URL(
      `../../../signers/a1/__tests__/fixtures/${name}.p12`,
      import.meta.url,
    );
    const response = await fetch(fixtureUrl);
    expect(response.ok).toBe(true);
    return new Uint8Array(await response.arrayBuffer());
  });

const createPdf: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 180]);
  page.drawText("SignatureKit PDF signing", { x: 32, y: 118, size: 14 });
  return pdf.save({ useObjectStreams: false });
});

const createTemplate = () =>
  createPdfSignatureTemplate({
    id: "browser-template",
    name: "Browser A1 template",
    documents: [
      {
        id: "uploaded",
        name: "uploaded.pdf",
        source: { type: "uploaded" },
        pages: [{ index: 0, width: 320, height: 180, label: "Página 1" }],
      },
    ],
    roles: [{ id: "signer-1", label: "Cliente", email: "ana@example.com", required: true }],
  });

const blockingLiteParseWorkerLayer = (onStart: () => void, onTerminate: () => void) =>
  Layer.succeed(LiteParseWorkerFactory, {
    timeoutMillis: 100,
    create: () =>
      Effect.sync((): LiteParseWorker => {
        const script = [
          'self.addEventListener("message", (event) => {',
          '  event.ports[0].postMessage("started");',
          "  const deadline = Date.now() + 10000;",
          "  while (Date.now() < deadline) {}",
          '  self.postMessage({ kind: "success", result: { pages: [] } });',
          "});",
        ].join("\n");
        const url = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
        const worker = new Worker(url);
        const channel = new MessageChannel();
        channel.port1.addEventListener("message", onStart, { once: true });
        channel.port1.start();
        return {
          post: (request) => worker.postMessage(request, [channel.port2]),
          subscribe: (onMessage, onError) => {
            const messageListener = (event: MessageEvent<unknown>): void => onMessage(event.data);
            const errorListener = (): void => onError();
            worker.addEventListener("message", messageListener);
            worker.addEventListener("error", errorListener);
            return () => {
              worker.removeEventListener("message", messageListener);
              worker.removeEventListener("error", errorListener);
            };
          },
          terminate: () => {
            onTerminate();
            channel.port1.close();
            worker.terminate();
            URL.revokeObjectURL(url);
          },
        };
      }),
  });

const successfulLiteParseWorkerLayer = (onCreate: () => void, onTerminate: () => void) =>
  Layer.succeed(LiteParseWorkerFactory, {
    timeoutMillis: 100,
    create: () =>
      Effect.sync((): LiteParseWorker => {
        onCreate();
        let onMessage: ((message: unknown) => void) | undefined;
        return {
          post: (request) => {
            queueMicrotask(() =>
              onMessage?.({
                kind: "success",
                result: {
                  pages: Array.from({ length: request.pageCount }, (_, pageIndex) => ({
                    pageNum: pageIndex + 1,
                    textItems: [],
                  })),
                },
              }),
            );
          },
          subscribe: (nextMessage) => {
            onMessage = nextMessage;
            return () => {
              if (onMessage === nextMessage) onMessage = undefined;
            };
          },
          terminate: onTerminate,
        };
      }),
  });

if (typeof document === "undefined") {
  describe.skip("PDF signing package", () => {
    it("runs only through `bun run test:integration:browser`", () => {});
  });
} else {
  describe("PDF signing package", () => {
    it("loads an A1 certificate and signs a PDF in Chromium", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const pfx = yield* readA1FixtureFromBrowser("ecpf");
          const pdf = yield* createPdf;
          const profile = yield* parseA1CertificateProfile({ pfx, password: PASSWORD });
          const template = yield* createTemplate();
          const field = yield* pdfSignatureFieldFromPlacement({
            documentId: "uploaded",
            pageIndex: 0,
            x: 40,
            y: 110,
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
            reason: "Chromium browser A1 test",
            name: "Pessoa CPF:12345678901",
            location: "BR",
            signatureLength: 16384,
          }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));
          const text = latin1.decode(signed);
          const reason = yield* Effect.promise(async () => {
            const signedPdf = await PDFDocument.load(signed);
            const acroForm = signedPdf.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
            const fields = acroForm?.lookupMaybe(PDFName.of("Fields"), PDFArray);
            const field =
              fields === undefined
                ? undefined
                : signedPdf.context.lookupMaybe(fields.get(0), PDFDict);
            return field
              ?.lookupMaybe(PDFName.of("V"), PDFDict)
              ?.lookupMaybe(PDFName.of("Reason"), PDFHexString)
              ?.decodeText();
          });

          expect(profile.document).toBe("12345678901");
          expect(signed.byteLength).toBeGreaterThan(pdf.byteLength);
          expect(text).toContain("/ByteRange");
          expect(text).toContain("/SubFilter /adbe.pkcs7.detached");
          expect(reason).toBe("Chromium browser A1 test");
        }),
      ));

    it("parses text boxes in a browser worker", async () => {
      const pdf = await Effect.runPromise(createPdf);
      const boxes = await Effect.runPromise(
        parsePdfTextBoxesBrowser(pdf, 1).pipe(Effect.provide(liteParseWorkerBrowserLayer)),
      );

      expect(boxes).toHaveLength(1);
      expect(boxes[0]?.map((box) => box.text).join(" ")).toContain("SignatureKit");
    }, 20_000);

    it("rejects invalid LiteParse page counts in the worker protocol", async () => {
      for (const pageCount of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        -1,
        0.5,
        MAX_LITEPARSE_PAGE_COUNT + 1,
        1_000_000_000,
      ]) {
        const result = await Effect.runPromise(
          Effect.result(
            Schema.decodeUnknownEffect(LiteParseWorkerRequestSchema)({
              pdf: new Uint8Array([1]),
              pageCount,
            }),
          ),
        );
        expect(Result.isFailure(result)).toBe(true);
      }
    });

    it("rejects invalid LiteParse page counts before worker startup and supports the cap", async () => {
      let creations = 0;
      let terminations = 0;
      const layer = successfulLiteParseWorkerLayer(
        () => {
          creations += 1;
        },
        () => {
          terminations += 1;
        },
      );

      for (const pageCount of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        -1,
        0.5,
        MAX_LITEPARSE_PAGE_COUNT + 1,
        1_000_000_000,
      ]) {
        const result = await Effect.runPromise(
          Effect.result(
            parsePdfTextBoxesBrowser(new Uint8Array([1]), pageCount).pipe(Effect.provide(layer)),
          ),
        );
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("pdf.INVALID_PDF");
          expect(result.failure.operation).toBe("pdf.parse");
        }
      }
      expect(creations).toBe(0);

      const boxes = await Effect.runPromise(
        parsePdfTextBoxesBrowser(new Uint8Array([1]), MAX_LITEPARSE_PAGE_COUNT).pipe(
          Effect.provide(layer),
        ),
      );
      expect(boxes).toHaveLength(MAX_LITEPARSE_PAGE_COUNT);
      expect(creations).toBe(1);
      expect(terminations).toBe(1);
    });

    it("resolves normal placement and rejects non-advancing automatic grids", async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage([320, 180]);
      const normal = await Effect.runPromise(
        resolveSignatureWidgetPlacement(pdf, {
          placement: {
            kind: "auto",
            pageIndex: 0,
            width: 120,
            height: 40,
            margin: 20,
            gap: 8,
            anchor: "bottom-right",
          },
        }),
      );
      expect(normal.widgetRect).toEqual([180, 20, 300, 60]);

      const result = await Effect.runPromise(
        Effect.result(
          resolveSignatureWidgetPlacement(pdf, {
            placement: {
              kind: "auto",
              pageIndex: 0,
              width: Number.MIN_VALUE,
              height: 40,
              margin: 20,
              gap: 0,
            },
          }),
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("pdf.SIGNATURE_PLACEMENT_FAILED");
      }

      const denseGridResult = await Effect.runPromise(
        Effect.result(
          resolveSignatureWidgetPlacement(pdf, {
            placement: {
              kind: "auto",
              pageIndex: 0,
              width: Number.MIN_VALUE,
              height: 40,
              margin: 0,
              gap: 0,
            },
          }),
        ),
      );
      expect(Result.isFailure(denseGridResult)).toBe(true);
      if (Result.isFailure(denseGridResult)) {
        expect(denseGridResult.failure.code).toBe("pdf.SIGNATURE_PLACEMENT_FAILED");
      }
    });

    it("terminates a blocking LiteParse worker at the timeout", async () => {
      let started = false;
      let terminations = 0;
      const startedAt = performance.now();
      const result = await Effect.runPromise(
        Effect.result(
          parsePdfTextBoxesBrowser(new Uint8Array([1]), 1).pipe(
            Effect.provide(
              blockingLiteParseWorkerLayer(
                () => {
                  started = true;
                },
                () => {
                  terminations += 1;
                },
              ),
            ),
          ),
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("pdf.PDF_LOAD_FAILED");
        expect(result.failure.retryable).toBe(true);
      }
      expect(performance.now() - startedAt).toBeLessThan(1000);
      expect(started).toBe(true);
      expect(terminations).toBe(1);
    }, 10_000);
  });
}
