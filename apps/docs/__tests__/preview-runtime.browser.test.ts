import { PDFDocument, rgb } from "@cantoo/pdf-lib";
import { Effect, Layer } from "effect";
import * as Runtime from "foldkit/runtime";
import { expect, it } from "vitest";

import { contentApplication, ContentFlags } from "../src/site/application.ts";
import {
  autoPreviewBrowserLayer,
  pdfPreviewBrowserLayer,
} from "../src/site/pdf-preview-browser.ts";

it("renders real PDF pixels in a scoped Foldkit runtime", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const host = document.createElement("div");
            const root = document.createElement("div");
            root.id = "preview-runtime-" + crypto.randomUUID();
            host.append(root);
            document.body.append(host);
            return host;
          }),
          (host) => Effect.sync(() => host.remove()),
        );
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            Runtime.embed(
              Runtime.makeApplication({
                ...contentApplication,
                container: host.querySelector<HTMLElement>("div"),
                resources: Layer.merge(pdfPreviewBrowserLayer, autoPreviewBrowserLayer).pipe(
                  Layer.provideMerge(contentApplication.resources),
                ),
              }),
              {
                flags: Effect.succeed(
                  ContentFlags.make({
                    locale: "pt-BR",
                    path: "",
                    siteUrl: "https://signaturekit.dev",
                    alternates: ["pt-BR"],
                    navigation: [],
                    page: { title: "Sign", html: "", text: "", headings: [] },
                  }),
                ),
              },
            ),
          ),
          (runtime) => Effect.sync(() => runtime.dispose()),
        );
        yield* Effect.promise(() =>
          expect
            .poll(() => host.querySelector<HTMLSelectElement>("#site-theme")?.disabled)
            .toBe(false),
        );
        host.querySelector<HTMLButtonElement>("#home-open-signer")?.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => host.querySelector<HTMLDialogElement>("#site-signing-dialog")?.open)
            .toBe(true),
        );
        const pdf = yield* Effect.promise(() => PDFDocument.create());
        const page = pdf.addPage([600, 800]);
        page.drawRectangle({ x: 0, y: 700, width: 600, height: 100, color: rgb(1, 0, 0) });
        const bytes = yield* Effect.promise(() => pdf.save());
        const input = host.querySelector<HTMLInputElement>("#signing-documents-input");
        if (input === null) expect.fail("The native signing input must mount");
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(bytes)], "preview.pdf"));
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        yield* Effect.promise(() =>
          expect
            .poll(
              () => host.querySelector<HTMLCanvasElement>("#signing-preview-canvas")?.dataset.state,
              { timeout: 10000 },
            )
            .toBe("ready"),
        );
        const canvas = host.querySelector<HTMLCanvasElement>("#signing-preview-canvas");
        expect(canvas?.getContext("2d")?.getImageData(10, 10, 1, 1).data[0]).toBe(255);
        expect(canvas?.getContext("2d")?.getImageData(10, 10, 1, 1).data[1]).toBe(0);
      }),
    ),
  );
});
