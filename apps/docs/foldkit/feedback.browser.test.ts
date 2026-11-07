import { Effect } from "effect";
import { Runtime } from "foldkit";
import { expect, it, onTestFinished } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { installFeedbackSelection } from "./feedback";
import { Flags, Message, Model, init, update, view } from "./main";

declare module "vitest/browser" {
  interface BrowserCommands {
    feedbackBfcache: (prefix: string) => Promise<{
      restored: boolean;
      text: string | null;
      navigation: unknown;
      beforeTextSelection: boolean | undefined;
      afterTextSelection: boolean | undefined;
    }>;
  }
}

const origin = "/__feedback_test__";

it("sends a real selected docs block after focusing the comment and clicking the form", async () => {
  onTestFinished(async () => {
    await fetch(`${origin}/stop`);
  });
  expect((await fetch(`${origin}/start`)).status).toBe(204);
  const host = document.createElement("div");
  const selectionEvents = new AbortController();
  onTestFinished(() => {
    selectionEvents.abort();
    host.remove();
  });
  const container = document.createElement("div");
  container.id = "feedback-browser-test";
  host.append(container);
  document.body.append(host);
  const releaseSelection = installFeedbackSelection(document, origin);
  onTestFinished(releaseSelection);
  const handle = Runtime.embed(
    Runtime.makeApplication({ Flags, Model, init, update, view, container }),
    { flags: Effect.succeed(Flags.make({ locale: "pt-BR", path: "/docs" })) },
  );
  onTestFinished(() => handle.dispose());
  await expect
    .poll(() => host.querySelector("[data-feedback-content] p"), { timeout: 15_000 })
    .not.toBeNull();
  const paragraph = host.querySelector("[data-feedback-content] p");
  expect(paragraph).not.toBeNull();
  expect(paragraph?.firstChild).toBeTruthy();
  if (paragraph === null || paragraph.firstChild === null) return;
  const text = paragraph.textContent ?? "";
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  const textNode = walker.nextNode();
  expect(textNode).not.toBeNull();
  expect(textNode?.textContent?.length).toBeGreaterThan(0);
  if (textNode === null) return;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, textNode.textContent?.length ?? 0);
  const selection = window.getSelection();
  expect(selection).not.toBeNull();
  const selectionChanged = new Promise<void>((resolve) =>
    document.addEventListener("selectionchange", () => resolve(), {
      once: true,
      signal: selectionEvents.signal,
    }),
  );
  selection?.removeAllRanges();
  selection?.addRange(range);
  await selectionChanged;
  expect(selection?.anchorNode?.nodeType).toBe(Node.TEXT_NODE);
  const input = host.querySelector<HTMLTextAreaElement>("[data-feedback-message]");
  expect(input).not.toBeNull();
  if (input === null) return;
  await userEvent.fill(input, "comentário privado");
  const button = [...host.querySelectorAll("button")].find((element) =>
    element.textContent?.includes("Enviar sobre texto"),
  );
  expect(button).toBeDefined();
  if (button === undefined) return;
  await userEvent.click(button);
  await expect
    .poll(() => host.querySelector('[role="status"]')?.textContent, { timeout: 15_000 })
    .toContain("Obrigado pelo feedback!");
  const response = await fetch(`${origin}/events`);
  const events: string = await response.text();
  expect(events).toContain("text_feedback_submitted");
  expect(events).toContain(text.slice(0, 80));
  expect(events).toContain("comentário privado");
  const good = [...host.querySelectorAll("button")].find(
    (element) => element.textContent === "Bom",
  );
  expect(good).toBeDefined();
  if (good === undefined) return;
  await userEvent.click(good);
  await expect
    .poll(async () => (await fetch(`${origin}/events`)).text(), { timeout: 15_000 })
    .toContain("page_feedback_submitted");
  await expect
    .poll(() => host.querySelector('[role="status"]')?.textContent, { timeout: 15_000 })
    .toContain("Obrigado pelo feedback!");
  await fetch(`${origin}/reject`);
  const bad = [...host.querySelectorAll("button")].find(
    (element) => element.textContent === "Ruim",
  );
  expect(bad).toBeDefined();
  if (bad === undefined) return;
  await userEvent.click(bad);
  await expect
    .poll(() => host.querySelector('[role="status"]')?.textContent, { timeout: 15_000 })
    .toContain("Não foi possível enviar");
  await fetch(`${origin}/offline`);
  const retry = [...host.querySelectorAll("button")].find(
    (element) => element.textContent === "Bom",
  );
  expect(retry).toBeDefined();
  if (retry === undefined) return;
  await userEvent.click(retry);
  await expect
    .poll(() => host.querySelector('[role="status"]')?.textContent, { timeout: 15_000 })
    .toContain("Não foi possível enviar");
  expect(
    JSON.stringify(
      update(init({ locale: "pt-BR", path: "/docs" }).model, Message.TextFeedbackSubmitted()).model,
    ),
  ).not.toContain("comentário privado");
  expect(JSON.stringify(Message.TextFeedbackSubmitted())).not.toContain("comentário privado");
  expect(JSON.stringify(init({ locale: "pt-BR", path: "/docs" }).model)).not.toContain(
    text.slice(0, 80),
  );
}, 30_000);

it("retains feedback selection ownership after a real BFCache restoration", async () => {
  onTestFinished(async () => {
    await fetch(`${origin}/stop`);
  });
  expect((await fetch(`${origin}/start`)).status).toBe(204);
  const result = await commands.feedbackBfcache(origin);
  expect(result.restored, JSON.stringify(result.navigation)).toBe(true);
  expect(result.beforeTextSelection).toBe(true);
  expect(result.afterTextSelection).toBe(true);
  expect(result.text).not.toBeNull();
  const events = await (await fetch(`${origin}/events`)).text();
  expect(events).toContain("text_feedback_submitted");
  expect(events).toContain("feedback depois do retorno");
  if (result.text !== null) expect(events).toContain(result.text.slice(0, 80));
}, 40_000);
