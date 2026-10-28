import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, rgb } from "@cantoo/pdf-lib";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { readA1FixtureFromBrowser } from "../../../tooling/testing/fixtures.browser.ts";
import { verifyPdfSignatures } from "@signature-kit/pdf/verify";
import { inspectPdf } from "./pdf-inspection.browser.ts";

describe("Foldkit signing dialog", () => {
  it("customizes a visible mark, signs real PDFs and clears its session", async ({ signal }) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const frame = yield* Effect.acquireRelease(
            Effect.sync(() => {
              const element = document.createElement("iframe");
              element.src = "/pt-BR";
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
              )
              .toBe(false),
          );
          const page = frame.contentDocument;
          if (page === null) expect.fail("The signing home must load");
          const runtimeIssues: unknown[] = [];
          const frameWindow = page.defaultView;
          if (frameWindow === null) expect.fail("The signing frame must have a window");
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const onError = (event: ErrorEvent) =>
                runtimeIssues.push(event.error ?? event.message);
              const onRejection = (event: PromiseRejectionEvent) =>
                runtimeIssues.push(event.reason);
              frameWindow.addEventListener("error", onError);
              frameWindow.addEventListener("unhandledrejection", onRejection);
              return { onError, onRejection };
            }),
            (listeners) =>
              Effect.sync(() => {
                frameWindow.removeEventListener("error", listeners.onError);
                frameWindow.removeEventListener("unhandledrejection", listeners.onRejection);
              }),
          );
          const open = page.querySelector<HTMLButtonElement>("#home-open-signer");
          if (open === null) expect.fail("The native home must expose its signing dialog");
          open.focus();
          open.click();
          yield* Effect.promise(() =>
            expect
              .poll(() => page.querySelector<HTMLDialogElement>("#site-signing-dialog")?.open)
              .toBe(true),
          );
          yield* Effect.promise(() =>
            expect.poll(() => page.querySelector<HTMLElement>(".site-header")?.inert).toBe(true),
          );
          const input = page.querySelector<HTMLInputElement>("#signing-documents-input");
          if (input === null) expect.fail("The native signer must accept PDFs");
          const pdf = yield* Effect.promise(() => PDFDocument.create());
          const firstPage = pdf.addPage([600, 800]);
          firstPage.drawRectangle({ x: 0, y: 700, width: 600, height: 100, color: rgb(1, 0, 0) });
          pdf.addPage([400, 500]);
          const bytes = yield* Effect.promise(() => pdf.save());
          const files = new DataTransfer();
          files.items.add(
            new File([new Uint8Array(bytes)], "agreement.pdf", { type: "application/pdf" }),
          );
          input.files = files.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          yield* Effect.promise(() =>
            expect
              .poll(() => page.querySelector("#signing-documents")?.textContent)
              .toContain("agreement.pdf"),
          );
          expect(input.value).toBe("");
          yield* Effect.promise(() =>
            expect
              .poll(
                () =>
                  runtimeIssues.length > 0
                    ? runtimeIssues
                    : page.querySelector<HTMLCanvasElement>("#signing-preview-canvas")?.dataset
                        .state,
                { timeout: 10000 },
              )
              .toBe("ready"),
          );
          const canvas = page.querySelector<HTMLCanvasElement>("#signing-preview-canvas");
          if (canvas === null) expect.fail("The native signer must render its PDF preview");
          const pixel = canvas.getContext("2d")?.getImageData(10, 10, 1, 1).data;
          expect(pixel?.[0]).toBe(255);
          expect(pixel?.[1]).toBe(0);
          const secondPage = page.querySelector<HTMLButtonElement>('[data-preview-page="1"]');
          if (secondPage === null)
            expect.fail("The native preview must allow selecting another page");
          secondPage.click();
          yield* Effect.promise(() =>
            expect
              .poll(
                () => {
                  const current = page.querySelector<HTMLCanvasElement>("#signing-preview-canvas");
                  return [current?.dataset.page, current?.dataset.state, current?.height];
                },
                { timeout: 10000 },
              )
              .toEqual(["1", "ready", 500]),
          );

          const placement = page.querySelector<HTMLElement>("#signing-placement");
          if (placement === null) expect.fail("The PDF preview must support manual placement");
          const bounds = placement.getBoundingClientRect();
          const centerX = bounds.left + bounds.width / 2;
          const centerY = bounds.top + bounds.height / 2;
          placement.dispatchEvent(
            new PointerEvent("pointerdown", {
              button: 0,
              pointerType: "mouse",
              clientX: centerX,
              clientY: centerY,
              bubbles: true,
            }),
          );
          yield* Effect.promise(() =>
            expect.poll(() => page.querySelector("#signing-placement-mark")).not.toBeNull(),
          );
          const mark = page.querySelector<HTMLElement>("#signing-placement-mark");
          if (mark === null) expect.fail("Manual placement must show the signature rectangle");
          const rectangle = mark.getBoundingClientRect();
          expect(Math.abs(rectangle.left + rectangle.width / 2 - centerX)).toBeLessThan(2);
          expect(Math.abs(rectangle.top + rectangle.height / 2 - centerY)).toBeLessThan(2);
          placement.focus();
          placement.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
          );
          yield* Effect.promise(() =>
            expect.poll(() => mark.getBoundingClientRect().left).toBeGreaterThan(rectangle.left),
          );
          const beforeDrag = mark.getBoundingClientRect();
          const dragX = beforeDrag.left + beforeDrag.width / 2;
          const dragY = beforeDrag.top + beforeDrag.height / 2;
          mark.dispatchEvent(
            new PointerEvent("pointerdown", {
              button: 0,
              pointerType: "mouse",
              clientX: dragX,
              clientY: dragY,
              screenX: 100,
              screenY: 100,
              bubbles: true,
            }),
          );
          placement.dispatchEvent(
            new PointerEvent("pointermove", {
              pointerType: "mouse",
              clientX: dragX,
              clientY: dragY - 40,
              screenX: 100,
              screenY: 60,
              bubbles: true,
            }),
          );
          placement.dispatchEvent(
            new PointerEvent("pointerup", {
              pointerType: "mouse",
              clientX: dragX,
              clientY: dragY - 40,
              screenX: 100,
              screenY: 60,
              bubbles: true,
            }),
          );
          yield* Effect.promise(() =>
            expect.poll(() => mark.getBoundingClientRect().top).toBeLessThan(beforeDrag.top - 30),
          );
          const beforeCancel = mark.getBoundingClientRect();
          mark.dispatchEvent(
            new PointerEvent("pointerdown", {
              button: 0,
              pointerType: "mouse",
              screenX: 100,
              screenY: 100,
              bubbles: true,
            }),
          );
          placement.dispatchEvent(
            new PointerEvent("pointermove", {
              pointerType: "mouse",
              screenX: 100,
              screenY: 140,
              bubbles: true,
            }),
          );
          yield* Effect.promise(() =>
            expect
              .poll(() => mark.getBoundingClientRect().top)
              .toBeGreaterThan(beforeCancel.top + 30),
          );
          placement.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
          yield* Effect.promise(() =>
            expect.poll(() => mark.getBoundingClientRect().top).toBe(beforeCancel.top),
          );
          placement.dispatchEvent(
            new PointerEvent("pointerup", {
              pointerType: "mouse",
              screenX: 100,
              screenY: 140,
              bubbles: true,
            }),
          );
          expect(mark.getBoundingClientRect().top).toBe(beforeCancel.top);
          const place = page.querySelector<HTMLButtonElement>("#signing-place-all");
          if (place === null)
            expect.fail("The native signer must offer geometric best-guess placement");
          place.click();
          yield* Effect.promise(() =>
            expect
              .poll(
                () => page.querySelector('#signing-documents [data-placed="true"]')?.textContent,
              )
              .toContain("agreement.pdf"),
          );
          const certificate = page.querySelector<HTMLInputElement>("#signing-certificate-input");
          const password = page.querySelector<HTMLInputElement>("#signing-password");
          if (certificate === null || password === null)
            expect.fail("The native signer must accept an A1 certificate and password");
          const pfx = yield* readA1FixtureFromBrowser("ecpf");
          const certificateFiles = new DataTransfer();
          certificateFiles.items.add(new File([new Uint8Array(pfx)], "certificate.p12"));
          certificate.files = certificateFiles.files;
          certificate.dispatchEvent(new Event("change", { bubbles: true }));
          yield* Effect.promise(() =>
            expect
              .poll(() =>
                page.querySelector("#signing-certificate-status")?.getAttribute("data-loaded"),
              )
              .toBe("true"),
          );
          expect(certificate.value).toBe("");
          const logo = page.querySelector<HTMLInputElement>("#stamp-logo");
          if (logo === null) expect.fail("The native stamp must accept a company logo");
          const invalidLogo = new DataTransfer();
          invalidLogo.items.add(
            new File([Uint8Array.of(1, 2, 3)], "invalid.png", { type: "image/png" }),
          );
          logo.files = invalidLogo.files;
          logo.dispatchEvent(new Event("change", { bubbles: true }));
          yield* Effect.promise(() =>
            expect
              .poll(() => page.getElementById("stamp-logo-error")?.textContent)
              .toBe("Escolha um PNG válido de até 16 MB e 16 megapixels."),
          );
          expect(logo.value).toBe("");
          const logoCanvas = yield* Effect.acquireRelease(
            Effect.sync(() => document.createElement("canvas")),
            (canvas) =>
              Effect.sync(() => {
                canvas.width = 0;
                canvas.height = 0;
              }),
          );
          logoCanvas.width = 16;
          logoCanvas.height = 16;
          const logoContext = logoCanvas.getContext("2d");
          if (logoContext === null)
            return yield* Effect.die("The logo fixture needs a canvas 2D context");
          logoContext.fillStyle = "#db2777";
          logoContext.fillRect(0, 0, 16, 16);
          const logoBlob = yield* Effect.promise(
            () => new Promise<Blob | null>((resolve) => logoCanvas.toBlob(resolve, "image/png")),
          );
          if (logoBlob === null)
            return yield* Effect.die("The browser must encode the PNG logo fixture");
          const validLogo = new DataTransfer();
          validLogo.items.add(new File([logoBlob], "company.png", { type: "image/png" }));
          logo.files = validLogo.files;
          logo.dispatchEvent(new Event("change", { bubbles: true }));
          yield* Effect.promise(() =>
            expect
              .poll(
                () => {
                  const preview = page.querySelector<HTMLImageElement>("#stamp-logo-preview");
                  return {
                    width: preview?.naturalWidth,
                    html: preview?.outerHTML,
                    issues: runtimeIssues,
                  };
                },
                { timeout: 10000 },
              )
              .toMatchObject({ width: 16 }),
          );
          const logoUrl = page.querySelector<HTMLImageElement>("#stamp-logo-preview")?.src;
          if (logoUrl === undefined)
            return yield* Effect.die("A loaded logo must have a scoped preview URL");
          const invalidReplacement = new DataTransfer();
          invalidReplacement.items.add(
            new File([Uint8Array.of(1, 2, 3)], "invalid-again.png", { type: "image/png" }),
          );
          logo.files = invalidReplacement.files;
          logo.dispatchEvent(new Event("change", { bubbles: true }));
          yield* Effect.promise(() =>
            expect
              .poll(() => page.getElementById("stamp-logo-error")?.textContent)
              .toBe("Escolha um PNG válido de até 16 MB e 16 megapixels."),
          );
          expect(page.querySelector<HTMLImageElement>("#stamp-logo-preview")?.src).toBe(logoUrl);
          page.querySelector<HTMLButtonElement>("#stamp-source-type")?.click();
          yield* Effect.promise(() =>
            expect.poll(() => page.getElementById("stamp-handwriting")).not.toBeNull(),
          );
          const handwriting = page.querySelector<HTMLInputElement>("#stamp-handwriting");
          if (handwriting === null)
            expect.fail("The signer must accept the typed handwritten name");
          handwriting.value = "Maria da Costa";
          handwriting.dispatchEvent(new InputEvent("input", { bubbles: true }));
          yield* Effect.promise(() =>
            expect
              .poll(
                () => page.querySelector<HTMLImageElement>("#stamp-ink-preview")?.naturalWidth ?? 0,
              )
              .toBeGreaterThan(100),
          );
          const inkPreview = page.querySelector<HTMLImageElement>("#stamp-ink-preview");
          if (inkPreview === null) expect.fail("The handwritten mark must render before signing");
          const inkDimensions = [inkPreview.naturalWidth, inkPreview.naturalHeight];
          const title = page.querySelector<HTMLInputElement>("#stamp-title");
          const color = page.querySelector<HTMLInputElement>("#stamp-color");
          const identity = page.querySelector<HTMLInputElement>("#stamp-name");
          const date = page.querySelector<HTMLInputElement>("#stamp-date");
          if (title === null || color === null || identity === null || date === null)
            expect.fail("The signer must expose visible stamp customization");
          title.value = "Reviewed locally";
          title.dispatchEvent(new Event("input", { bubbles: true }));
          color.value = "#14532d";
          color.dispatchEvent(new Event("input", { bubbles: true }));
          identity.click();
          date.click();
          yield* Effect.promise(() =>
            expect.poll(() => [identity.checked, date.checked]).toEqual([false, false]),
          );
          const rubric = page.querySelector<HTMLInputElement>("#signing-rubric");
          if (rubric === null) expect.fail("The native signer must expose rubric options");
          rubric.click();
          yield* Effect.promise(() => expect.poll(() => rubric.checked).toBe(true));
          password.value = "incorrect-password";
          page.querySelector<HTMLButtonElement>("#signing-sign")?.click();
          yield* Effect.promise(() =>
            expect
              .poll(() => page.querySelector('#site-signing-dialog [role="alert"]')?.textContent)
              .toBe("Senha do certificado incorreta."),
          );
          expect(password.value).toBe("");
          expect(
            page.querySelector("#signing-certificate-status")?.getAttribute("data-loaded"),
          ).toBe("true");
          password.value = "changeit";
          page.querySelector<HTMLButtonElement>("#signing-sign")?.click();
          yield* Effect.promise(() =>
            expect
              .poll(
                () => page.querySelector('#signing-documents [data-signed="true"]')?.textContent,
              )
              .toContain("agreement.pdf"),
          );
          expect(password.value).toBe("");
          const downloaded = Promise.withResolvers<Response>();
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const observe = () => {
                const link = page.querySelector<HTMLAnchorElement>("a[download]");
                if (link !== null)
                  void fetch(link.href).then(downloaded.resolve, downloaded.reject);
              };
              page.addEventListener("click", observe);
              return observe;
            }),
            (observe) => Effect.sync(() => page.removeEventListener("click", observe)),
          );
          const download = page.querySelector<HTMLButtonElement>(
            '#signing-documents button[data-action="download"]',
          );
          if (download === null) expect.fail("A signed document must be downloadable");
          download.click();
          const artifact = yield* Effect.promise(() => downloaded.promise);
          const signedPdf = new Uint8Array(yield* Effect.promise(() => artifact.arrayBuffer()));
          const verification = yield* verifyPdfSignatures({ pdf: signedPdf });
          expect(verification[0]?.valid).toBe(true);
          const parsedPdf = yield* Effect.promise(() => PDFDocument.load(signedPdf));
          const embeddedImages = parsedPdf.getPages().flatMap((pdfPage) => {
            const objects = pdfPage.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
            return (
              objects?.entries().flatMap(([, reference]) => {
                const object = parsedPdf.context.lookup(reference, PDFRawStream);
                return object.dict.lookupMaybe(PDFName.of("Subtype"), PDFName)?.toString() ===
                  "/Image"
                  ? [
                      [
                        object.dict.lookupMaybe(PDFName.of("Width"), PDFNumber)?.asNumber(),
                        object.dict.lookupMaybe(PDFName.of("Height"), PDFNumber)?.asNumber(),
                      ],
                    ]
                  : [];
              }) ?? []
            );
          });
          expect(embeddedImages).toContainEqual(inkDimensions);
          const inspected = yield* inspectPdf(signedPdf);
          const visibleText = inspected.map((page) => page.text).join("\n");
          expect(visibleText).toContain("Reviewed locally");
          expect(visibleText).not.toContain("Signatário");
          expect(visibleText).not.toContain("Data");
          expect(
            inspected.some((page) => {
              const pixels = page.image.data;
              for (let index = 0; index < pixels.length; index += 4) {
                if (pixels[index] === 20 && pixels[index + 1] === 83 && pixels[index + 2] === 45)
                  return true;
              }
              return false;
            }),
          ).toBe(true);
          yield* Effect.promise(() => expect(fetch(artifact.url)).rejects.toThrow());
          expect(
            inspected.some((page) => {
              const pixels = page.image.data;
              for (let index = 0; index < pixels.length; index += 4) {
                if (pixels[index] === 219 && pixels[index + 1] === 39 && pixels[index + 2] === 119)
                  return true;
              }
              return false;
            }),
          ).toBe(true);
          const remove = page.querySelector<HTMLButtonElement>(
            '#signing-documents button[data-action="remove"]',
          );
          if (remove === null) expect.fail("Imported documents must be removable");
          remove.click();
          yield* Effect.promise(() =>
            expect
              .poll(() => page.querySelector("#signing-documents")?.textContent)
              .not.toContain("agreement.pdf"),
          );
          expect(page.querySelector("#signing-documents-input")).toBe(input);
          const selectedAgain = new DataTransfer();
          selectedAgain.items.add(
            new File([new Uint8Array(bytes)], "agreement.pdf", { type: "application/pdf" }),
          );
          input.files = selectedAgain.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          yield* Effect.promise(() =>
            expect
              .poll(() => page.querySelector("#signing-documents")?.textContent)
              .toContain("agreement.pdf"),
          );
          const mixedSelection = new DataTransfer();
          mixedSelection.items.add(
            new File(["not a PDF"], "invalid.pdf", { type: "application/pdf" }),
          );
          mixedSelection.items.add(
            new File([new Uint8Array(bytes)], "second.pdf", { type: "application/pdf" }),
          );
          input.files = mixedSelection.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          yield* Effect.promise(() =>
            expect
              .poll(() => page.querySelector("#signing-documents")?.textContent)
              .toContain("second.pdf"),
          );
          expect(page.querySelector('#site-signing-dialog [role="alert"]')?.textContent).toBe(
            "Não foi possível carregar o documento PDF.",
          );
          place.click();
          yield* Effect.promise(() =>
            expect
              .poll(() => page.querySelectorAll('#signing-documents [data-placed="true"]').length)
              .toBe(2),
          );
          password.value = "changeit";
          page.querySelector<HTMLButtonElement>("#signing-sign")?.click();
          page.querySelector<HTMLButtonElement>("#signing-close")?.click();
          yield* Effect.promise(() =>
            expect
              .poll(() => page.querySelector<HTMLDialogElement>("#site-signing-dialog")?.open)
              .toBe(false),
          );
          expect(page.querySelector<HTMLElement>(".site-header")?.inert).toBe(false);
          expect(page.activeElement).toBe(open);
          yield* Effect.promise(() => expect(fetch(logoUrl)).rejects.toThrow());
          open.click();
          yield* Effect.promise(() =>
            expect
              .poll(() => page.querySelector<HTMLDialogElement>("#site-signing-dialog")?.open)
              .toBe(true),
          );
          expect(page.querySelector("#signing-documents")?.textContent).not.toContain(
            "agreement.pdf",
          );
          expect(
            page.querySelector("#signing-certificate-status")?.getAttribute("data-loaded"),
          ).toBe("false");
          expect(password.value).toBe("");
          expect(runtimeIssues).toEqual([]);
          expect(page.querySelector("#stamp-logo-preview")).toBeNull();
        }),
      ),
      { signal },
    );
  }, 30000);
});
