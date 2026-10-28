import { Effect } from "effect";
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
