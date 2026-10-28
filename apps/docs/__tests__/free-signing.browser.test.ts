import { PDFDocument } from "@cantoo/pdf-lib";
import { Effect, Schema } from "effect";
import { expect, it } from "vitest";

it("hydrates the Portuguese free signer inline and clears its local session", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const frame = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const element = document.createElement("iframe");
            element.src = "/pt-BR/assine-documentos-gratis";
            element.style.width = "390px";
            element.style.height = "800px";
            document.body.append(element);
            return element;
          }),
          (element) => Effect.sync(() => element.remove()),
        );
        yield* Effect.promise(() =>
          expect
            .poll(
              () =>
                frame.contentDocument?.querySelector<HTMLSelectElement>("#site-theme")?.disabled,
              { timeout: 10000 },
            )
            .toBe(false),
        );
        const page = frame.contentDocument;
        if (page === null) return yield* Effect.die("The Portuguese free signing page must load");
        expect(page.documentElement.lang).toBe("pt-BR");
        const structured = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
          page.getElementById("assine-documentos-gratis-json-ld")?.textContent,
        );
        expect(structured).toMatchObject({
          "@context": "https://schema.org",
          "@graph": expect.arrayContaining([
            {
              "@type": "SoftwareApplication",
              url: "https://signaturekit.dev/pt-BR/assine-documentos-gratis",
              offers: { "@type": "Offer", price: "0", priceCurrency: "BRL" },
              name: "SignatureKit — Assinador de PDF grátis",
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web",
              description: expect.any(String),
            },
            expect.objectContaining({
              "@type": "HowTo",
              step: expect.arrayContaining([
                expect.objectContaining({ position: 4, name: "Baixe assinado" }),
              ]),
            }),
            expect.objectContaining({ "@type": "FAQPage" }),
          ]),
        });
        const input = page.querySelector<HTMLInputElement>("#signing-documents-input");
        if (input === null) return yield* Effect.die("The inline signer must expose its PDF input");
        expect(input.closest("dialog")).toBeNull();
        expect(input.getClientRects().length).toBeGreaterThan(0);
        expect(page.getElementById("home-open-signer")).toBeNull();
        expect(page.querySelector<HTMLElement>(".site-header")?.inert).toBe(false);
        const pdf = yield* Effect.promise(() => PDFDocument.create());
        pdf.addPage([600, 800]);
        const bytes = yield* Effect.promise(() => pdf.save());
        const files = new DataTransfer();
        files.items.add(
          new File([new Uint8Array(bytes)], "free-document.pdf", { type: "application/pdf" }),
        );
        input.files = files.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        yield* Effect.promise(() =>
          expect
            .poll(() => page.getElementById("signing-documents")?.textContent, { timeout: 10000 })
            .toContain("free-document.pdf"),
        );
        yield* Effect.promise(() =>
          expect
            .poll(
              () => page.querySelector<HTMLCanvasElement>("#signing-preview-canvas")?.dataset.state,
              { timeout: 10000 },
            )
            .toBe("ready"),
        );
        const password = page.querySelector<HTMLInputElement>("#signing-password");
        const reset = page.querySelector<HTMLButtonElement>("#signing-close");
        if (password === null || reset === null)
          return yield* Effect.die("The inline signer must expose password and reset controls");
        password.value = "discard-this-value";
        reset.click();
        yield* Effect.promise(() =>
          expect.poll(() => page.querySelectorAll("#signing-documents li").length).toBe(0),
        );
        expect(password.value).toBe("");
        expect(page.querySelector<HTMLCanvasElement>("#signing-preview-canvas")).toBeNull();
        expect(input.getClientRects().length).toBeGreaterThan(0);
        expect(page.querySelector<HTMLElement>(".site-header")?.inert).toBe(false);
      }),
    ),
    { signal },
  );
}, 30000);
