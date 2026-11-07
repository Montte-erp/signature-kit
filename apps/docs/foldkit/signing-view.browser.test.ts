import "./site.css";
import { readA1FixtureFromBrowser } from "../../../tooling/testing/fixtures.browser";
import { degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, rgb } from "@cantoo/pdf-lib";
import { pdfErrorMessages, PdfErrorCodeValue } from "@signature-kit/pdf/config";
import { verifyPdfSignatures } from "@signature-kit/pdf/verify";
import { preparePdfVisualPreview } from "@signature-kit/pdf/workflow";
import {
  liteParseWorkerBrowserLayer,
  PdfHandwriting,
  pdfHandwritingBrowserLayer,
  renderPdfPagesBrowser,
} from "@signature-kit/pdf/liteparse-browser";
import { Effect, Layer, Result } from "effect";
import { Runtime } from "foldkit";
import * as Server from "foldkit/experimental/server";
import { expect, it } from "vitest";
import { Flags, Model, init, update, view } from "./main";

const application = Effect.gen(function* () {
  const host = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const element = document.createElement("div");
      document.body.append(element);
      return element;
    }),
    (element) => Effect.sync(() => element.remove()),
  );
  const handle = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const container = document.createElement("div");
      container.id = "signing-view-browser-test";
      host.append(container);
      const program = Runtime.makeApplication({ Flags, Model, init, update, view, container });
      return Runtime.embed(program, {
        flags: Effect.succeed({ locale: "pt-BR", path: "/assine-documentos-gratis" }),
      });
    }),
    (runtime) => Effect.sync(() => runtime.dispose()),
  );
  return { host, dispose: () => handle.dispose() };
});

it("signs a selected PDF after a wrong password and revokes its download on unmount", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* application;
        const pfx = yield* readA1FixtureFromBrowser("ecpf");
        const pdf = yield* Effect.promise(async () => {
          const document = await PDFDocument.create();
          document.addPage([600, 400]).drawText("SignatureKit browser signing", { x: 30, y: 100 });
          return document.save();
        });
        yield* Effect.promise(() =>
          expect.poll(() => app.host.querySelector("form")).not.toBeNull(),
        );
        const form = app.host.querySelector("form");
        const certificate = app.host.querySelector<HTMLInputElement>("[name=pfx]");
        const documentInput = app.host.querySelector<HTMLInputElement>("[name=pdf]");
        const password = app.host.querySelector<HTMLInputElement>("[name=password]");
        expect(form && certificate && documentInput && password).toBeTruthy();
        if (form === null || certificate === null || documentInput === null || password === null)
          return expect.fail("Required signing controls are missing");
        yield* Effect.promise(() =>
          expect
            .poll(() => {
              form.requestSubmit();
              return app.host.querySelector("[data-status]")?.textContent;
            })
            .toBe("Selecione o certificado, a senha e de 1 a 100 PDFs."),
        );
        const certificateFiles = new DataTransfer();
        certificateFiles.items.add(new File([new Uint8Array(pfx)], "certificate.p12"));
        certificate.files = certificateFiles.files;
        certificate.dispatchEvent(new Event("change", { bubbles: true }));
        const pdfFiles = new DataTransfer();
        pdfFiles.items.add(
          new File([new Uint8Array(pdf)], "document.pdf", { type: "application/pdf" }),
        );
        documentInput.files = pdfFiles.files;
        documentInput.dispatchEvent(new Event("change", { bubbles: true }));
        yield* Effect.promise(() =>
          expect
            .poll(
              () => app.host.querySelector<HTMLImageElement>("[data-preview] img")?.naturalWidth,
              { timeout: 30000 },
            )
            .toBeGreaterThan(0),
        );
        const page = app.host.querySelector<HTMLElement>(".signing-page");
        expect(page).not.toBeNull();
        if (page === null) return expect.fail("Signing page missing");
        expect(page.getAttribute("role")).toBe("button");
        expect(page.tabIndex).toBe(0);
        expect(page.getAttribute("aria-label")).toContain("Página 1");
        page.focus();
        for (const [key, x, y] of [
          ["Enter", 140, 136],
          [" ", 140, 136],
          ["ArrowLeft", 128, 136],
          ["ArrowRight", 140, 136],
          ["ArrowUp", 140, 128],
          ["ArrowDown", 140, 136],
          ["ArrowRight", 152, 136],
          ["ArrowDown", 152, 144],
        ] satisfies ReadonlyArray<readonly [string, number, number]>) {
          const focused = app.host.querySelector<HTMLElement>(".signing-page");
          if (focused === null) return expect.fail("Focused signing page missing");
          expect(document.activeElement).toBe(focused);
          const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
          focused.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
          const marker = app.host.querySelector<HTMLElement>(".signing-rectangle");
          if (marker === null) return expect.fail("Signature marker missing");
          expect(Number.parseFloat(marker.style.left) * 6).toBeCloseTo(x, 3);
          expect(Number.parseFloat(marker.style.top) * 4).toBeCloseTo(y, 3);
        }
        const expectedX = 152;
        const expectedY = 144;
        const loadIdentity = app.host.querySelector<HTMLButtonElement>("[data-load-identity]");
        expect(loadIdentity).not.toBeNull();
        if (loadIdentity === null) return expect.fail("Identity control missing");
        password.value = "wrong";
        loadIdentity.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector("[data-status]")?.textContent, { timeout: 30000 })
            .toBe("Senha do certificado incorreta."),
        );
        password.value = "changeit";
        loadIdentity.click();
        yield* Effect.promise(() =>
          expect
            .poll(
              () => app.host.querySelector<HTMLElement>("[data-preview]")?.dataset.visualReady,
              { timeout: 60000 },
            )
            .toBe("true"),
        );
        password.value = "wrong";
        password.dispatchEvent(new Event("input", { bubbles: true }));
        form.requestSubmit();
        expect(password.value).toBe("");
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector("[data-status]")?.textContent, { timeout: 30000 })
            .toBe("Senha do certificado incorreta."),
        );
        password.value = "changeit";
        password.dispatchEvent(new Event("input", { bubbles: true }));
        expect(app.host.querySelector<HTMLElement>("[data-preview]")?.dataset.visualReady).toBe(
          "true",
        );
        form.requestSubmit();
        expect(password.value).toBe("");
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector<HTMLAnchorElement>("[data-downloads] a")?.href, {
              timeout: 60000,
            })
            .toMatch(/^blob:/),
        );
        const progress = app.host.querySelector<HTMLElement>("[data-progress]");
        expect(progress?.hidden).toBe(false);
        expect(progress?.getAttribute("aria-valuenow")).toBe("1");
        expect(progress?.getAttribute("aria-valuemax")).toBe("1");
        const link = app.host.querySelector<HTMLAnchorElement>("[data-downloads] a");
        expect(link?.download).toBe("assinado-document.pdf");
        if (link === null) return expect.fail("Download link missing");
        const url = link.href;
        let urlAtClick = "";
        link.addEventListener("click", (event) => {
          event.preventDefault();
          urlAtClick = link.href;
        });
        link.click();
        expect(urlAtClick).toBe(url);
        const signed = yield* Effect.promise(
          async () => new Uint8Array(await (await fetch(urlAtClick)).arrayBuffer()),
        );
        const signedDocument = yield* Effect.promise(() => PDFDocument.load(signed));
        const annotations = signedDocument.getPages()[0]?.node.Annots();
        const widget =
          annotations === undefined
            ? undefined
            : signedDocument.context.lookupMaybe(annotations.get(annotations.size() - 1), PDFDict);
        const rectangle = widget?.lookupMaybe(PDFName.of("Rect"), PDFArray);
        expect(rectangle).toBeDefined();
        expect(rectangle?.lookup(0, PDFNumber).asNumber()).toBeCloseTo(expectedX, 2);
        expect(rectangle?.lookup(1, PDFNumber).asNumber()).toBeCloseTo(272 - expectedY, 2);
        expect(rectangle?.lookup(2, PDFNumber).asNumber()).toBeCloseTo(expectedX + 320, 2);
        expect(rectangle?.lookup(3, PDFNumber).asNumber()).toBeCloseTo(400 - expectedY, 2);
        const signatures = yield* verifyPdfSignatures({ pdf: signed });
        expect(signatures.length).toBeGreaterThan(0);
        expect(signatures.at(-1)?.cryptographicValid).toBe(true);
        expect(signatures.at(-1)?.coverageValid).toBe(true);
        app.dispose();
        yield* Effect.promise(() =>
          expect
            .poll(async () => {
              try {
                await fetch(url);
                return false;
              } catch {
                return true;
              }
            })
            .toBe(true),
        );
      }),
    ),
  );
}, 100000);

it("cancels and retries a real signing flow and disposes during another active flow", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* application;
        const pfx = yield* readA1FixtureFromBrowser("ecpf");
        const pdfs = yield* Effect.promise(async () => {
          const first = await PDFDocument.create();
          first.setTitle("Cancelled document");
          first.addPage([320, 180]);
          const second = await PDFDocument.create();
          second.setTitle("Retry document");
          second.addPage([400, 200]);
          second.addPage([400, 200]);
          return { first: await first.save(), second: await second.save() };
        });
        yield* Effect.promise(() =>
          expect.poll(() => app.host.querySelector("form")).not.toBeNull(),
        );
        const form = app.host.querySelector("form");
        const certificate = app.host.querySelector<HTMLInputElement>("[name=pfx]");
        const documentInput = app.host.querySelector<HTMLInputElement>("[name=pdf]");
        const password = app.host.querySelector<HTMLInputElement>("[name=password]");
        const cancel = app.host.querySelector<HTMLButtonElement>("[data-cancel]");
        const auto = app.host.querySelector<HTMLButtonElement>("[data-auto]");
        const loadIdentity = app.host.querySelector<HTMLButtonElement>("[data-load-identity]");
        const previous = app.host.querySelector<HTMLButtonElement>("[data-previous]");
        expect(form && certificate && documentInput && password && cancel).toBeTruthy();
        if (
          form === null ||
          certificate === null ||
          documentInput === null ||
          password === null ||
          cancel === null ||
          auto === null ||
          loadIdentity === null ||
          previous === null
        )
          return expect.fail("Required signing controls are missing");
        const certificates = new DataTransfer();
        certificates.items.add(new File([new Uint8Array(pfx)], "certificate.p12"));
        certificate.files = certificates.files;
        certificate.dispatchEvent(new Event("change", { bubbles: true }));
        const documents = new DataTransfer();
        documents.items.add(
          new File([new Uint8Array(pdfs.first)], "old.pdf", { type: "application/pdf" }),
        );
        documentInput.files = documents.files;
        documentInput.dispatchEvent(new Event("change", { bubbles: true }));
        yield* Effect.promise(() =>
          expect
            .poll(
              () => app.host.querySelector<HTMLImageElement>("[data-preview] img")?.naturalWidth,
              { timeout: 30000 },
            )
            .toBeGreaterThan(0),
        );
        auto.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector(".signing-rectangle"), { timeout: 30000 })
            .not.toBeNull(),
        );
        password.value = "changeit";
        loadIdentity.click();
        yield* Effect.promise(() =>
          expect
            .poll(
              () => app.host.querySelector<HTMLElement>("[data-preview]")?.dataset.visualReady,
              { timeout: 60000 },
            )
            .toBe("true"),
        );
        form.requestSubmit();
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector("[data-status]")?.textContent, {
              timeout: 30000,
              interval: 10,
            })
            .toBe("Assinando documentos…"),
        );
        expect(certificate.disabled).toBe(true);
        expect(documentInput.disabled).toBe(true);
        expect(password.disabled).toBe(true);
        expect(app.host.querySelector<HTMLButtonElement>("[data-auto]")?.disabled).toBe(true);
        expect(
          Array.from(
            form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
              "input, select, button",
            ),
          )
            .filter((control) => control !== cancel)
            .every((control) => control.disabled),
        ).toBe(true);
        const positioned = app.host.querySelector<HTMLElement>(".signing-rectangle");
        const lockedPage = app.host.querySelector<HTMLElement>(".signing-page");
        if (positioned === null || lockedPage === null)
          return expect.fail("Positioned page missing");
        const oldPosition = positioned.style.cssText;
        expect(lockedPage.getAttribute("aria-disabled")).toBe("true");
        lockedPage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
        lockedPage.dispatchEvent(
          new MouseEvent("click", { bubbles: true, clientX: 1, clientY: 1 }),
        );
        expect(app.host.querySelector<HTMLElement>(".signing-rectangle")?.style.cssText).toBe(
          oldPosition,
        );
        cancel.click();
        expect(app.host.querySelector("[data-status]")?.textContent).toBe("Cancelando…");
        lockedPage.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(app.host.querySelector<HTMLElement>(".signing-rectangle")?.style.cssText).toBe(
          oldPosition,
        );
        const retry = new DataTransfer();
        retry.items.add(
          new File([new Uint8Array(pdfs.second)], "retry.pdf", { type: "application/pdf" }),
        );
        documentInput.files = retry.files;
        password.value = "changeit";
        form.requestSubmit();
        expect(app.host.querySelector("[data-status]")?.textContent).toBe("Cancelando…");
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector("[data-status]")?.textContent, { timeout: 30000 })
            .toBe("Operação cancelada."),
        );
        expect(app.host.querySelector("[data-downloads] a")).toBeNull();
        documentInput.dispatchEvent(new Event("change", { bubbles: true }));
        yield* Effect.promise(() =>
          expect
            .poll(
              () => app.host.querySelector<HTMLImageElement>("[data-preview] img")?.naturalWidth,
              { timeout: 30000 },
            )
            .toBeGreaterThan(0),
        );
        auto.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector(".signing-rectangle"), { timeout: 30000 })
            .not.toBeNull(),
        );
        yield* Effect.promise(() => expect.poll(() => auto.disabled).toBe(false));
        const rubric = app.host.querySelector<HTMLButtonElement>("[data-rubric]");
        const source = app.host.querySelector<HTMLSelectElement>("[name=rubricSource]");
        const text = app.host.querySelector<HTMLInputElement>("[name=rubricText]");
        if (rubric === null || source === null || text === null)
          return expect.fail("Rubric controls missing");
        source.value = "text";
        text.value = "Rubrica de teste";
        rubric.click();
        yield* Effect.promise(() =>
          expect.poll(() => rubric.getAttribute("aria-checked")).toBe("true"),
        );
        yield* Effect.promise(() =>
          expect
            .poll(
              () => app.host.querySelector<HTMLElement>("[data-preview]")?.dataset.visualReady,
              { timeout: 60000 },
            )
            .toBe("true"),
        );
        const signaturePreview =
          app.host.querySelector<HTMLImageElement>("[data-preview] img")?.src;
        previous.click();
        const rubricPreview = app.host.querySelector<HTMLImageElement>("[data-preview] img")?.src;
        if (signaturePreview === undefined || rubricPreview === undefined)
          return expect.fail("Rubric previews missing");
        const previewPages = yield* Effect.promise(async () =>
          Promise.all(
            [rubricPreview, signaturePreview].map(
              async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer()),
            ),
          ),
        );
        password.value = "changeit";
        form.requestSubmit();
        expect(app.host.querySelector("[data-status]")?.textContent).toBe("Preparando assinatura…");
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector("[data-status]")?.textContent, { timeout: 60000 })
            .toBe("Assinatura concluída."),
        );
        const link = app.host.querySelector<HTMLAnchorElement>("[data-downloads] a");
        expect(link?.download).toBe("assinado-retry.pdf");
        if (link === null) return expect.fail("Download link missing");
        const signed = yield* Effect.promise(
          async () => new Uint8Array(await (await fetch(link.href)).arrayBuffer()),
        );
        const signatures = yield* verifyPdfSignatures({ pdf: signed });
        expect(signatures.at(-1)?.cryptographicValid).toBe(true);
        expect(signatures.at(-1)?.coverageValid).toBe(true);
        const result = yield* Effect.promise(() => PDFDocument.load(signed));
        expect(result.getTitle()).toBe("Retry document");
        expect(result.getPageCount()).toBe(2);
        const signedPages = yield* renderPdfPagesBrowser(signed, 2).pipe(
          Effect.provide(liteParseWorkerBrowserLayer),
        );
        expect(new Uint8Array(signedPages[0]?.imageBytes ?? [])).toEqual(previewPages[0]);
        expect(new Uint8Array(signedPages[1]?.imageBytes ?? [])).toEqual(previewPages[1]);
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 3000)));
        expect(app.host.querySelectorAll("[data-downloads] a")).toHaveLength(1);
        expect(app.host.querySelector<HTMLAnchorElement>("[data-downloads] a")?.href).toBe(
          link.href,
        );
        expect(app.host.querySelector("[data-status]")?.textContent).toBe("Assinatura concluída.");
        password.value = "changeit";
        form.requestSubmit();
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector("[data-status]")?.textContent, {
              timeout: 30000,
              interval: 10,
            })
            .toBe("Assinando documentos…"),
        );
        app.dispose();
        expect(app.host.querySelector("form")).toBeNull();
        const fresh = yield* application;
        yield* Effect.promise(() =>
          expect.poll(() => fresh.host.querySelector("form")).not.toBeNull(),
        );
        expect(fresh.host.querySelector("[data-status]")?.textContent).toBe("");
        expect(fresh.host.querySelector("[data-downloads]")?.children).toHaveLength(0);
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 3000)));
        expect(app.host.querySelector("[data-downloads] a")).toBeNull();
        expect(fresh.host.querySelector("[data-status]")?.textContent).toBe("");
        expect(fresh.host.querySelector("[data-downloads]")?.children).toHaveLength(0);
      }),
    ),
  );
}, 100000);

it("hydrates the server-rendered signing form in its own browser document", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const rendered = yield* Server.renderToString(
          { Flags, init, view },
          {
            flags: { locale: "pt-BR", path: "/assine-documentos-gratis" },
            buildId: "signing-browser-test",
          },
        );
        const frame = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const element = document.createElement("iframe");
            document.body.append(element);
            return element;
          }),
          (element) => Effect.sync(() => element.remove()),
        );
        const mainUrl = new URL("./main.ts", import.meta.url).href;
        const loaded = new Promise<void>((resolve) =>
          frame.addEventListener("load", () => resolve(), { once: true }),
        );
        frame.srcdoc = `<!doctype html><html><head><title>Signing</title></head><body>${rendered.html}<script type="module">
      import { Runtime } from "/@id/foldkit";
      import { Flags, Model, init, update, view } from ${JSON.stringify(mainUrl)};
      const container = document.querySelector("[data-foldkit-app]");
      window.beforeHydrationForm = document.querySelector("form");
      Runtime.hydrate(Runtime.makeApplication({ Flags, Model, init, update, view, container }), { buildId: "signing-browser-test" });
    </script></body></html>`;
        yield* Effect.promise(() => loaded);
        const doc = yield* Effect.sync(() => frame.contentDocument).pipe(
          Effect.filterOrElse(
            (document) => document !== null,
            () => Effect.die("The iframe document is unavailable."),
          ),
        );
        const serverForm = doc.querySelector("form");
        if (serverForm === null) return expect.fail("Server form missing");
        serverForm.addEventListener("submit", (event) => event.preventDefault());
        yield* Effect.promise(() =>
          expect
            .poll(
              () => {
                const form = doc.querySelector("form");
                if (form === null) return "";
                form.requestSubmit();
                return doc.querySelector("[data-status]")?.textContent;
              },
              { timeout: 30000 },
            )
            .toBe("Selecione o certificado, a senha e de 1 a 100 PDFs."),
        );
        expect(doc.body.inert).toBe(false);
        expect(doc.querySelector("form")).toBe(
          frame.contentWindow === null
            ? null
            : Reflect.get(frame.contentWindow, "beforeHydrationForm"),
        );
      }),
    ),
  );
}, 40000);

it("isolates simultaneous signers and releases removed preview URLs", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const first = yield* application;
        const second = yield* application;
        const pdf = yield* Effect.promise(async () => {
          const document = await PDFDocument.create();
          document.addPage([600, 400]);
          return document.save();
        });
        yield* Effect.promise(() =>
          expect.poll(() => first.host.querySelector("[name=pdf]")).not.toBeNull(),
        );
        yield* Effect.promise(() =>
          expect.poll(() => second.host.querySelector("[name=pdf]")).not.toBeNull(),
        );
        for (const [app, name] of [
          [first, "first.pdf"],
          [second, "second.pdf"],
        ] satisfies ReadonlyArray<readonly [typeof first, string]>) {
          const input = app.host.querySelector<HTMLInputElement>("[name=pdf]");
          if (input === null) return expect.fail("PDF input missing");
          const files = new DataTransfer();
          files.items.add(new File([new Uint8Array(pdf)], name, { type: "application/pdf" }));
          input.files = files.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        yield* Effect.promise(() =>
          expect
            .poll(
              () => first.host.querySelector<HTMLImageElement>("[data-preview] img")?.naturalWidth,
              { timeout: 30000 },
            )
            .toBeGreaterThan(0),
        );
        yield* Effect.promise(() =>
          expect
            .poll(
              () => second.host.querySelector<HTMLImageElement>("[data-preview] img")?.naturalWidth,
              { timeout: 30000 },
            )
            .toBeGreaterThan(0),
        );
        const firstImage = first.host.querySelector<HTMLImageElement>("[data-preview] img");
        const secondImage = second.host.querySelector<HTMLImageElement>("[data-preview] img");
        const page = first.host.querySelector<HTMLElement>(".signing-page");
        if (firstImage === null || secondImage === null || page === null)
          return expect.fail("previews missing");
        const firstUrl = firstImage.src;
        const secondUrl = secondImage.src;
        page.focus();
        page.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(first.host.querySelector(".signing-rectangle")).not.toBeNull();
        expect(second.host.querySelector(".signing-rectangle")).toBeNull();
        const remove = Array.from(
          first.host.querySelectorAll<HTMLButtonElement>("[data-preview] button"),
        ).find((button) => button.textContent === "Remover documento");
        if (remove === undefined) return expect.fail("remove button missing");
        remove.click();
        expect(first.host.querySelector("[data-preview] img")).toBeNull();
        expect(first.host.querySelector<HTMLInputElement>("[name=pdf]")?.files?.length).toBe(0);
        const removed = yield* Effect.promise(() =>
          fetch(firstUrl).then(
            () => false,
            () => true,
          ),
        );
        expect(removed).toBe(true);
        expect((yield* Effect.promise(() => fetch(secondUrl))).ok).toBe(true);
        expect(second.host.querySelector<HTMLImageElement>("[data-preview] img")?.alt).toContain(
          "second.pdf",
        );
        first.dispose();
        expect((yield* Effect.promise(() => fetch(secondUrl))).ok).toBe(true);
      }),
    ),
  );
}, 60000);

it("requires a placement for every loaded document and automatically places both", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* application;
        const pfx = yield* readA1FixtureFromBrowser("ecpf");
        const pdf = yield* Effect.promise(async () => {
          const document = await PDFDocument.create();
          document.addPage([600, 400]);
          return document.save();
        });
        yield* Effect.promise(() =>
          expect.poll(() => app.host.querySelector("form")).not.toBeNull(),
        );
        const form = app.host.querySelector<HTMLFormElement>("form");
        const certificate = app.host.querySelector<HTMLInputElement>("[name=pfx]");
        const password = app.host.querySelector<HTMLInputElement>("[name=password]");
        const input = app.host.querySelector<HTMLInputElement>("[name=pdf]");
        const auto = app.host.querySelector<HTMLButtonElement>("[data-auto]");
        const loadIdentity = app.host.querySelector<HTMLButtonElement>("[data-load-identity]");
        if (
          form === null ||
          certificate === null ||
          password === null ||
          input === null ||
          auto === null ||
          loadIdentity === null
        )
          return expect.fail("Required signing controls are missing");
        const certificates = new DataTransfer();
        certificates.items.add(new File([new Uint8Array(pfx)], "certificate.p12"));
        certificate.files = certificates.files;
        const files = new DataTransfer();
        files.items.add(new File([new Uint8Array(pdf)], "one.pdf", { type: "application/pdf" }));
        files.items.add(new File([new Uint8Array(pdf)], "two.pdf", { type: "application/pdf" }));
        input.files = files.files;
        password.value = "changeit";
        input.dispatchEvent(new Event("change", { bubbles: true }));
        form.requestSubmit();
        expect(app.host.querySelector("[data-status]")?.textContent).toBe(
          "Carregue a identidade do certificado.",
        );
        loadIdentity.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector("[data-identity]")?.textContent, { timeout: 30000 })
            .toBeTruthy(),
        );
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector<HTMLButtonElement>("[data-load-identity]")?.disabled)
            .toBe(false),
        );
        yield* Effect.promise(() =>
          expect
            .poll(
              () =>
                app.host.querySelector<HTMLSelectElement>("[data-preview] select")?.options.length,
              { timeout: 30000 },
            )
            .toBe(2),
        );
        form.requestSubmit();
        expect(app.host.querySelector("[data-status]")?.textContent).toBe(
          "Aguarde os PDFs e posicione a assinatura em cada documento.",
        );
        auto.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector(".signing-rectangle"), { timeout: 30000 })
            .not.toBeNull(),
        );
        yield* Effect.promise(() => expect.poll(() => auto.disabled).toBe(false));
        const select = app.host.querySelector<HTMLSelectElement>("[data-preview] select");
        if (select === null) return expect.fail("Document selector missing");
        select.value = "1";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        expect(app.host.querySelector(".signing-rectangle")).not.toBeNull();
      }),
    ),
  );
}, 60000);

it("maps a click on a cropped and rotated page to the signed PDF widget", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* application;
        const pfx = yield* readA1FixtureFromBrowser("ecpf");
        const pdf = yield* Effect.promise(async () => {
          const document = await PDFDocument.create();
          const page = document.addPage([600, 650]);
          page.setCropBox(50, 100, 400, 300);
          page.setRotation(degrees(90));
          page.drawRectangle({ x: 60, y: 110, width: 30, height: 30, color: rgb(1, 0, 0) });
          page.drawText("Cropped and rotated", { x: 100, y: 200 });
          return document.save();
        });
        yield* Effect.promise(() =>
          expect.poll(() => app.host.querySelector("form")).not.toBeNull(),
        );
        const form = app.host.querySelector<HTMLFormElement>("form");
        const certificate = app.host.querySelector<HTMLInputElement>("[name=pfx]");
        const password = app.host.querySelector<HTMLInputElement>("[name=password]");
        const input = app.host.querySelector<HTMLInputElement>("[name=pdf]");
        const loadIdentity = app.host.querySelector<HTMLButtonElement>("[data-load-identity]");
        if (
          form === null ||
          certificate === null ||
          password === null ||
          input === null ||
          loadIdentity === null
        )
          return expect.fail("Required signing controls are missing");
        const certificates = new DataTransfer();
        certificates.items.add(new File([new Uint8Array(pfx)], "certificate.p12"));
        certificate.files = certificates.files;
        certificate.dispatchEvent(new Event("change", { bubbles: true }));
        const files = new DataTransfer();
        files.items.add(
          new File([new Uint8Array(pdf)], "rotated.pdf", { type: "application/pdf" }),
        );
        input.files = files.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        yield* Effect.promise(() =>
          expect
            .poll(
              () => app.host.querySelector<HTMLImageElement>("[data-preview] img")?.naturalWidth,
              { timeout: 30000 },
            )
            .toBeGreaterThan(0),
        );
        const image = app.host.querySelector<HTMLImageElement>("[data-preview] img");
        const page = app.host.querySelector<HTMLElement>(".signing-page");
        if (image === null || page === null) return expect.fail("Cropped page preview missing");
        expect(image.naturalWidth / image.naturalHeight).toBeCloseTo(0.75, 2);
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        expect(context).not.toBeNull();
        if (context === null) return expect.fail("Canvas context missing");
        context.drawImage(image, 0, 0);
        const pixel = context.getImageData(
          Math.floor((image.naturalWidth * 25) / 300),
          Math.floor((image.naturalHeight * 25) / 400),
          1,
          1,
        ).data;
        expect(pixel[0]).toBeGreaterThan(220);
        expect(pixel[1]).toBeLessThan(35);
        expect(pixel[2]).toBeLessThan(35);
        const bounds = page.getBoundingClientRect();
        const click = new MouseEvent("click", {
          bubbles: true,
          clientX: bounds.left + bounds.width * 0.6,
          clientY: bounds.top + bounds.height * 0.55,
        });
        page.dispatchEvent(click);
        const expectedY = Math.max(
          0,
          Math.min(272, ((click.clientY - bounds.top) / bounds.height) * 400 - 64),
        );
        const title = app.host.querySelector<HTMLInputElement>("[name=stampTitle]");
        const color = app.host.querySelector<HTMLInputElement>("[name=stampColor]");
        const identity = app.host.querySelector<HTMLButtonElement>("[data-stamp-identity]");
        const date = app.host.querySelector<HTMLButtonElement>("[data-stamp-date]");
        const logo = app.host.querySelector<HTMLInputElement>("[name=stampLogo]");
        if (title === null || color === null || identity === null || date === null || logo === null)
          return expect.fail("Required signing controls are missing");
        title.value = "Título de teste";
        color.value = "#3266aa";
        expect(identity.getAttribute("aria-checked")).toBe("true");
        expect(date.getAttribute("aria-checked")).toBe("true");
        const logoBytes = yield* Effect.promise(async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 16;
          canvas.height = 16;
          const context = canvas.getContext("2d");
          if (context === null) return expect.fail("Logo canvas context missing");
          context.fillStyle = "#3266aa";
          context.fillRect(0, 0, 16, 16);
          return new Uint8Array(await (await fetch(canvas.toDataURL("image/png"))).arrayBuffer());
        });
        const logos = new DataTransfer();
        logos.items.add(new File([logoBytes], "logo.png", { type: "image/png" }));
        logo.files = logos.files;
        logo.dispatchEvent(new Event("change", { bubbles: true }));
        password.value = "changeit";
        loadIdentity.click();
        yield* Effect.promise(() =>
          expect
            .poll(
              () => app.host.querySelector<HTMLElement>("[data-preview]")?.dataset.visualReady,
              { timeout: 60000 },
            )
            .toBe("true"),
        );
        const previewImage = app.host.querySelector<HTMLImageElement>("[data-preview] img");
        if (previewImage === null) return expect.fail("Visual preview missing");
        const previewBytes = yield* Effect.promise(
          async () => new Uint8Array(await (await fetch(previewImage.src)).arrayBuffer()),
        );
        form.requestSubmit();
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector<HTMLAnchorElement>("[data-downloads] a")?.href, {
              timeout: 60000,
            })
            .toMatch(/^blob:/),
        );
        const link = app.host.querySelector<HTMLAnchorElement>("[data-downloads] a");
        if (link === null) return expect.fail("Download link missing");
        const signed = yield* Effect.promise(
          async () => new Uint8Array(await (await fetch(link.href)).arrayBuffer()),
        );
        const signedDocument = yield* Effect.promise(() => PDFDocument.load(signed));
        const annotations = signedDocument.getPages()[0]?.node.Annots();
        const widget =
          annotations === undefined
            ? undefined
            : signedDocument.context.lookupMaybe(annotations.get(annotations.size() - 1), PDFDict);
        const rect = widget?.lookupMaybe(PDFName.of("Rect"), PDFArray);
        expect(rect).toBeDefined();
        expect(rect?.lookup(0, PDFNumber).asNumber()).toBeCloseTo(50 + expectedY, 2);
        expect(rect?.lookup(1, PDFNumber).asNumber()).toBeCloseTo(100, 2);
        expect(rect?.lookup(2, PDFNumber).asNumber()).toBeCloseTo(178 + expectedY, 2);
        expect(rect?.lookup(3, PDFNumber).asNumber()).toBeCloseTo(400, 2);
        const signatures = yield* verifyPdfSignatures({ pdf: signed });
        expect(signatures.at(-1)?.cryptographicValid).toBe(true);
        expect(signatures.at(-1)?.coverageValid).toBe(true);
        const rendered = yield* renderPdfPagesBrowser(signed, 1).pipe(
          Effect.provide(liteParseWorkerBrowserLayer),
        );
        expect(new Uint8Array(rendered[0]?.imageBytes ?? [])).toEqual(previewBytes);
        const previewUrl = previewImage.src;
        const effectContext = yield* Effect.context<never>();
        app.dispose();
        yield* Effect.promise(() =>
          expect
            .poll(async () => {
              const released = await Effect.runPromiseWith(effectContext)(
                Effect.result(
                  Effect.tryPromise({ try: () => fetch(previewUrl), catch: () => "revoked" }),
                ),
              );
              return Result.isFailure(released);
            })
            .toBe(true),
        );
      }),
    ),
  );
}, 120000);

it("previews rubrics only on pages other than the main signature page", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const handwriting = yield* PdfHandwriting;
      const ink = yield* handwriting.render("Nome de teste");
      const createPdf = (count: number) =>
        Effect.promise(async () => {
          const document = await PDFDocument.create();
          for (let i = 0; i < count; i++) document.addPage([400, 500]);
          return new Uint8Array(await document.save());
        });
      for (const count of [1, 2]) {
        const pdf = yield* createPdf(count);
        const input = {
          pdf,
          signing: {},
          stampRects: [{ pageIndex: count - 1, x: 40, y: 60, width: 300, height: 120 }],
          badge: { header: { text: "Assinado" }, rows: [], footer: [], signaturePng: ink },
        };
        const plain = yield* preparePdfVisualPreview(input);
        const withRubric = yield* preparePdfVisualPreview({
          ...input,
          rubric: { imagePng: ink, border: false },
        });
        const plainPages = yield* renderPdfPagesBrowser(plain, count);
        const rubricPages = yield* renderPdfPagesBrowser(withRubric, count);
        expect(rubricPages).toHaveLength(count);
        expect(plainPages).toHaveLength(count);
        expect(rubricPages[count - 1]?.imageBytes).toEqual(plainPages[count - 1]?.imageBytes);
        if (count === 2) expect(rubricPages[0]?.imageBytes).not.toEqual(plainPages[0]?.imageBytes);
      }
    }).pipe(
      Effect.provide(
        Layer.merge(
          liteParseWorkerBrowserLayer,
          pdfHandwritingBrowserLayer("600 64px 'Caveat Variable'"),
        ),
      ),
    ),
  );
}, 90000);

it("blocks signing after a PDF preview fails", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* application;
        const pfx = yield* readA1FixtureFromBrowser("ecpf");
        yield* Effect.promise(() =>
          expect.poll(() => app.host.querySelector("form")).not.toBeNull(),
        );
        const form = app.host.querySelector<HTMLFormElement>("form");
        const certificate = app.host.querySelector<HTMLInputElement>("[name=pfx]");
        const password = app.host.querySelector<HTMLInputElement>("[name=password]");
        const input = app.host.querySelector<HTMLInputElement>("[name=pdf]");
        const loadIdentity = app.host.querySelector<HTMLButtonElement>("[data-load-identity]");
        if (
          form === null ||
          certificate === null ||
          password === null ||
          input === null ||
          loadIdentity === null
        )
          return expect.fail("Required signing controls are missing");
        const certificates = new DataTransfer();
        certificates.items.add(new File([new Uint8Array(pfx)], "certificate.p12"));
        certificate.files = certificates.files;
        password.value = "changeit";
        loadIdentity.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector("[data-identity]")?.textContent, { timeout: 30000 })
            .toBeTruthy(),
        );
        yield* Effect.promise(() => expect.poll(() => loadIdentity.disabled).toBe(false));
        const files = new DataTransfer();
        files.items.add(new File(["not a PDF"], "bad.pdf", { type: "application/pdf" }));
        input.files = files.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        const status = app.host.querySelector('[data-status][role="status"]');
        if (status === null) return expect.fail("Accessible status missing");
        yield* Effect.promise(() =>
          expect
            .poll(() => status.textContent, { timeout: 30000 })
            .toBe(pdfErrorMessages["pt-BR"][PdfErrorCodeValue.pdfLoadFailed]),
        );
        form.requestSubmit();
        expect(app.host.querySelector("[data-status]")?.textContent).toBe(
          "Aguarde os PDFs e posicione a assinatura em cada documento.",
        );
        expect(app.host.querySelector("[data-downloads] a")).toBeNull();
      }),
    ),
  );
}, 60000);

it("rejects invalid logo PNG data and clears the selection on removal", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* application;
        yield* Effect.promise(() =>
          expect.poll(() => app.host.querySelector("[name=stampLogo]")).not.toBeNull(),
        );
        const input = app.host.querySelector<HTMLInputElement>("[name=stampLogo]");
        const remove = app.host.querySelector<HTMLButtonElement>("[data-remove-logo]");
        if (input === null || remove === null) return expect.fail("Logo controls missing");
        const files = new DataTransfer();
        files.items.add(new File(["invalid PNG"], "logo.png", { type: "image/png" }));
        input.files = files.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        yield* Effect.promise(() =>
          expect
            .poll(() => app.host.querySelector("[data-status]")?.textContent)
            .toBe("Selecione um PNG válido."),
        );
        remove.click();
        expect(input.files?.length).toBe(0);
        expect(app.host.querySelector("[data-status]")?.textContent).toBe("");
      }),
    ),
  );
}, 30000);

it("toggles appearance with the keyboard without resetting sensitive form fields", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* application;
        yield* Effect.promise(() =>
          expect.poll(() => app.host.querySelector("[data-rubric]")).not.toBeNull(),
        );
        const rubric = app.host.querySelector<HTMLButtonElement>("[data-rubric]");
        const password = app.host.querySelector<HTMLInputElement>("[name=password]");
        const certificate = app.host.querySelector<HTMLInputElement>("[name=pfx]");
        if (rubric === null || password === null || certificate === null)
          return expect.fail("Signing controls missing");
        const files = new DataTransfer();
        files.items.add(new File(["certificate"], "certificate.p12"));
        certificate.files = files.files;
        password.value = "private password";
        rubric.focus();
        rubric.dispatchEvent(
          new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true }),
        );
        yield* Effect.promise(() =>
          expect.poll(() => rubric.getAttribute("aria-checked")).toBe("true"),
        );
        expect(document.activeElement).toBe(rubric);
        expect(password.value).toBe("private password");
        expect(certificate.files?.item(0)?.name).toBe("certificate.p12");
      }),
    ),
  );
});
