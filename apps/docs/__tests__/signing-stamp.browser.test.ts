import { PDFDocument } from "@cantoo/pdf-lib";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { verifyPdfSignatures } from "@signature-kit/pdf/verify";
import { Effect, Redacted } from "effect";
import * as PdfJs from "pdfjs-dist";
import { expect, it } from "vitest";

import { readA1FixtureFromBrowser } from "../../../tooling/testing/fixtures.browser.ts";
import { SigningSession, signingSessionLayer } from "../src/site/signing-session.ts";

it("exports a visible signature and rubrics only on the other pages", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* SigningSession;
        const pdf = yield* Effect.promise(() => PDFDocument.create());
        pdf.addPage([600, 800]);
        pdf.addPage([600, 800]);
        const bytes = yield* Effect.promise(() => pdf.save());
        const document = yield* session.addDocument(
          new Blob([new Uint8Array(bytes)]),
          "stamped.pdf",
        );
        yield* session.placeDocument(document.id, { pageIndex: 0, x: 60, y: 600 });
        const pfx = yield* readA1FixtureFromBrowser("ecpf");
        yield* session
          .signDocument(
            document.id,
            { policy: "pades-ades" },
            {
              lines: ["Visible signer"],
              rubricLines: ["Other page rubric"],
              rubricEveryPage: true,
            },
          )
          .pipe(Effect.provide(a1SignaturesLayer({ pfx, password: Redacted.make("changeit") })));
        const blob = yield* session.exportDocument(document.id);
        const signed = new Uint8Array(yield* Effect.promise(() => blob.arrayBuffer()));
        expect((yield* verifyPdfSignatures({ pdf: signed }))[0]?.valid).toBe(true);
        const port = yield* Effect.acquireRelease(
          Effect.sync(
            () =>
              new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), {
                type: "module",
              }),
          ),
          (port) => Effect.sync(() => port.terminate()),
        );
        const worker = yield* Effect.acquireRelease(
          Effect.sync(() => PdfJs.PDFWorker.create({ port })),
          (worker) => Effect.sync(() => worker.destroy()),
        );
        const loading = yield* Effect.acquireRelease(
          Effect.sync(() => PdfJs.getDocument({ data: signed, worker })),
          (loading) => Effect.promise(() => loading.destroy()),
        );
        const rendered = yield* Effect.promise(() => loading.promise);
        const texts = yield* Effect.forEach([1, 2], (number) =>
          Effect.gen(function* () {
            const page = yield* Effect.promise(() => rendered.getPage(number));
            const content = yield* Effect.promise(() => page.getTextContent());
            return content.items.flatMap((item) => ("str" in item ? [item.str] : [])).join(" ");
          }),
        );
        expect(texts[0]).toContain("Visible signer");
        expect(texts[0]).not.toContain("Other page rubric");
        expect(texts[1]).toContain("Other page rubric");
        expect(texts[1]).not.toContain("Visible signer");
      }).pipe(Effect.provide(signingSessionLayer)),
    ),
  );
});
