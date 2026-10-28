import { Effect } from "effect";
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream } from "@cantoo/pdf-lib";
import { verifyPdfSignatures } from "@signature-kit/pdf/verify";
import { expect, it } from "vitest";
import { readA1FixtureFromBrowser } from "../../../tooling/testing/fixtures.browser.ts";

it("reads a real A1 identity, renders its handwritten mark and clears authentication on close", async ({
  signal,
}) => {
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
        if (page === null) expect.fail("The signing page must load");
        page.querySelector<HTMLButtonElement>("#home-open-signer")?.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => page.querySelector<HTMLDialogElement>("#site-signing-dialog")?.open)
            .toBe(true),
        );
        const file = page.querySelector<HTMLInputElement>("#signing-certificate-input");
        const password = page.querySelector<HTMLInputElement>("#signing-password");
        if (file === null || password === null)
          expect.fail("The signer must accept its A1 certificate and password");
        const pfx = yield* readA1FixtureFromBrowser("ecpf");
        const selected = new DataTransfer();
        selected.items.add(new File([new Uint8Array(pfx)], "identity.p12"));
        file.files = selected.files;
        file.dispatchEvent(new Event("change", { bubbles: true }));
        yield* Effect.promise(() =>
          expect
            .poll(() =>
              page.getElementById("signing-certificate-status")?.getAttribute("data-loaded"),
            )
            .toBe("true"),
        );
        const read = page.querySelector<HTMLButtonElement>("#signing-read-identity");
        if (read === null)
          expect.fail("The native signer must read the A1 identity before signing");
        password.value = "wrong-password";
        read.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => page.querySelector('#site-signing-dialog [role="alert"]')?.textContent)
            .toBe("Senha do certificado incorreta."),
        );
        expect(password.value).toBe("");
        expect(page.querySelector("#stamp-ink-preview")).toBeNull();
        password.value = "changeit";
        read.click();
        yield* Effect.promise(() =>
          expect
            .poll(() =>
              page.getElementById("signing-identity-status")?.getAttribute("data-verified"),
            )
            .toBe("true"),
        );
        expect(password.value).toBe("");
        yield* Effect.promise(() =>
          expect
            .poll(
              () => page.querySelector<HTMLImageElement>("#stamp-ink-preview")?.naturalWidth ?? 0,
            )
            .toBeGreaterThan(100),
        );
        page.querySelector<HTMLButtonElement>("#stamp-source-type")?.click();
        yield* Effect.promise(() =>
          expect.poll(() => page.getElementById("stamp-handwriting")).not.toBeNull(),
        );
        page.querySelector<HTMLButtonElement>("#stamp-source-certificate")?.click();
        yield* Effect.promise(() =>
          expect
            .poll(
              () => page.querySelector<HTMLImageElement>("#stamp-ink-preview")?.naturalWidth ?? 0,
            )
            .toBeGreaterThan(100),
        );
        const ink = page.querySelector<HTMLImageElement>("#stamp-ink-preview");
        if (ink === null) expect.fail("The certificate name must render before signing");
        const inkDimensions = [ink.naturalWidth, ink.naturalHeight];
        const input = page.querySelector<HTMLInputElement>("#signing-documents-input");
        if (input === null) expect.fail("The signer must accept a real PDF");
        const pdf = yield* Effect.promise(() => PDFDocument.create());
        pdf.addPage([600, 800]);
        const pdfBytes = yield* Effect.promise(() => pdf.save());
        const documents = new DataTransfer();
        documents.items.add(
          new File([new Uint8Array(pdfBytes)], "identity.pdf", { type: "application/pdf" }),
        );
        input.files = documents.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        yield* Effect.promise(() =>
          expect
            .poll(() => page.getElementById("signing-documents")?.textContent)
            .toContain("identity.pdf"),
        );
        const place = page.querySelector<HTMLButtonElement>("#signing-place-all");
        if (place === null) expect.fail("The signer must offer automatic placement");
        yield* Effect.promise(() => expect.poll(() => place.disabled).toBe(false));
        place.click();
        const sign = page.querySelector<HTMLButtonElement>("#signing-sign");
        if (sign === null) expect.fail("The signer must expose its signing action");
        yield* Effect.promise(() => expect.poll(() => sign.disabled).toBe(false));
        expect(password.value).toBe("");
        sign.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => page.querySelector('#signing-documents [data-signed="true"]')?.textContent)
            .toContain("identity.pdf"),
        );
        const downloaded = Promise.withResolvers<Response>();
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const observe = () => {
              const link = page.querySelector<HTMLAnchorElement>("a[download]");
              if (link !== null) void fetch(link.href).then(downloaded.resolve, downloaded.reject);
            };
            page.addEventListener("click", observe);
            return observe;
          }),
          (observe) => Effect.sync(() => page.removeEventListener("click", observe)),
        );
        page
          .querySelector<HTMLButtonElement>('#signing-documents button[data-action="download"]')
          ?.click();
        const response = yield* Effect.promise(() => downloaded.promise);
        const signed = new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()));
        expect((yield* verifyPdfSignatures({ pdf: signed }))[0]?.valid).toBe(true);
        const parsed = yield* Effect.promise(() => PDFDocument.load(signed));
        const embeddedImages = parsed.getPages().flatMap((pdfPage) => {
          const objects = pdfPage.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
          return (
            objects?.entries().flatMap(([, reference]) => {
              const object = parsed.context.lookup(reference, PDFStream);
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
        page.querySelector<HTMLButtonElement>("#signing-close")?.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => page.querySelector<HTMLDialogElement>("#site-signing-dialog")?.open)
            .toBe(false),
        );
        page.querySelector<HTMLButtonElement>("#home-open-signer")?.click();
        yield* Effect.promise(() =>
          expect
            .poll(() => page.querySelector<HTMLDialogElement>("#site-signing-dialog")?.open)
            .toBe(true),
        );
        expect(page.getElementById("signing-identity-status")?.getAttribute("data-verified")).toBe(
          "false",
        );
        expect(page.querySelector("#stamp-ink-preview")).toBeNull();
      }),
    ),
    { signal },
  );
}, 20000);
