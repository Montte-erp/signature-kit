import { PDFDocument } from "@cantoo/pdf-lib";
import { Effect } from "effect";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { PdfStampPreview } from "../components/pdf-stamp-preview";
import { m } from "@/paraglide/messages";
import { PdfSigner } from "../components/pdf-signer";

it("accepts real PDFs after React StrictMode replays the mount lifecycle", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const container = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const node = document.createElement("div");
            document.body.appendChild(node);
            return node;
          }),
          (node) => Effect.sync(() => node.remove()),
        );
        const root = yield* Effect.acquireRelease(
          Effect.sync(() => createRoot(container)),
          (value) => Effect.sync(() => value.unmount()),
        );
        root.render(
          <React.StrictMode>
            <PdfSigner />
          </React.StrictMode>,
        );
        yield* Effect.promise(() =>
          expect
            .poll(() =>
              container.querySelector<HTMLInputElement>('input[accept="application/pdf,.pdf"]'),
            )
            .not.toBeNull(),
        );
        const source = yield* Effect.promise(async () => {
          const pdf = await PDFDocument.create();
          pdf.addPage([600, 800]);
          return new Uint8Array(await pdf.save());
        });
        const input = container.querySelector<HTMLInputElement>(
          'input[accept="application/pdf,.pdf"]',
        );
        if (input === null) return yield* Effect.die("PDF file input is missing.");
        const files = new DataTransfer();
        files.items.add(
          new File([new Uint8Array(source)], "strict-mode.pdf", { type: "application/pdf" }),
        );
        input.files = files.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        yield* Effect.promise(() =>
          expect.poll(() => container.textContent).toContain("strict-mode.pdf"),
        );
      }),
    ),
  );
});

it("shows a visible preview failure for invalid image bytes", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const container = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const node = document.createElement("div");
            document.body.appendChild(node);
            return node;
          }),
          (node) => Effect.sync(() => node.remove()),
        );
        const root = yield* Effect.acquireRelease(
          Effect.sync(() => createRoot(container)),
          (value) => Effect.sync(() => value.unmount()),
        );
        root.render(
          <PdfStampPreview
            badge={{
              header: { text: "Company" },
              rows: [],
              footer: [],
              logoPng: Uint8Array.of(1, 2, 3),
            }}
          />,
        );
        yield* Effect.promise(() =>
          expect.poll(() => container.querySelector("canvas")?.dataset.state).toBe("error"),
        );
        expect(container.querySelector("canvas")?.getAttribute("aria-label")).toBe(
          m.signer_stamp_preview_failed(),
        );
      }),
    ),
  );
});
