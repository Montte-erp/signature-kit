import { Effect } from "effect";
import { defineBrowserCommand } from "@vitest/browser-playwright";

export const feedbackBfcache = defineBrowserCommand(async ({ context, page }, prefix: string) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const tab = yield* Effect.acquireRelease(
          Effect.promise(() => context.newPage()),
          (tab) => Effect.promise(() => tab.close()),
        );
        const failures: unknown[] = [];
        const diagnostic = yield* Effect.acquireRelease(
          Effect.promise(() => context.newCDPSession(tab)),
          (diagnostic) => Effect.promise(() => diagnostic.detach()),
        );
        diagnostic.on("Page.backForwardCacheNotUsed", (event) => failures.push(event));
        yield* Effect.promise(() => diagnostic.send("Page.enable"));
        const origin = new URL(page.url()).origin;
        yield* Effect.promise(() => tab.goto(`${origin}${prefix}/bfcache`));
        yield* Effect.promise(() => tab.locator("[data-feedback-content] p").first().waitFor());
        const beforeTextSelection = yield* Effect.promise(() =>
          tab.evaluate(async () => {
            const block = document.querySelector("[data-feedback-content] p");
            if (block === null) return;
            const textNode = document.createTreeWalker(block, NodeFilter.SHOW_TEXT).nextNode();
            if (textNode === null || (textNode.textContent?.length ?? 0) === 0) return false;
            const range = document.createRange();
            range.setStart(textNode, 0);
            range.setEnd(textNode, textNode.textContent?.length ?? 0);
            const changed = new Promise<void>((resolve) =>
              document.addEventListener("selectionchange", () => resolve(), { once: true }),
            );
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);
            await changed;
            return window.getSelection()?.anchorNode?.nodeType === Node.TEXT_NODE;
          }),
        );
        yield* Effect.promise(() => tab.goto(`${origin}${prefix}/away`));
        yield* Effect.promise(() => tab.goBack({ waitUntil: "commit", timeout: 10_000 }));
        const restoredInTime = yield* Effect.promise(() =>
          tab
            .waitForFunction(
              () => document.documentElement.dataset.restored === "true",
              undefined,
              { timeout: 3_000 },
            )
            .then(
              () => true,
              () => false,
            ),
        );
        const timing: unknown = yield* Effect.promise(() =>
          tab.evaluate(() => performance.getEntriesByType("navigation")[0]?.toJSON()),
        );
        const navigation = { timing, failures };
        if (!restoredInTime)
          return {
            restored: false,
            text: null,
            navigation,
            beforeTextSelection,
            afterTextSelection: false,
          };
        const text = yield* Effect.promise(() =>
          tab.locator("[data-feedback-content] p").first().textContent(),
        );
        const afterTextSelection = yield* Effect.promise(() =>
          tab.evaluate(async () => {
            const block = document.querySelector("[data-feedback-content] p");
            if (block === null) return;
            const textNode = document.createTreeWalker(block, NodeFilter.SHOW_TEXT).nextNode();
            if (textNode === null || (textNode.textContent?.length ?? 0) === 0) return false;
            const range = document.createRange();
            range.setStart(textNode, 0);
            range.setEnd(textNode, textNode.textContent?.length ?? 0);
            const changed = new Promise<void>((resolve) =>
              document.addEventListener("selectionchange", () => resolve(), { once: true }),
            );
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);
            await changed;
            return window.getSelection()?.anchorNode?.nodeType === Node.TEXT_NODE;
          }),
        );
        yield* Effect.promise(() =>
          tab.locator("[data-feedback-message]").fill("feedback depois do retorno"),
        );
        yield* Effect.promise(() =>
          tab.getByRole("button", { name: "Enviar sobre texto selecionado" }).click(),
        );
        yield* Effect.promise(() =>
          tab
            .getByRole("status")
            .filter({ hasText: "Obrigado pelo feedback!" })
            .waitFor({ timeout: 15_000 }),
        );
        const restored = yield* Effect.promise(() =>
          tab.evaluate(() => document.documentElement.dataset.restored === "true"),
        );
        return { restored, text, navigation, beforeTextSelection, afterTextSelection };
      }),
    ),
  ),
);
