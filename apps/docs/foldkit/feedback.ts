import { Effect, Schema } from "effect";
import { Command } from "foldkit";

const selectedBlocks = new WeakMap<Document, { blockId: string; blockBody: string }>();
const selectionOwners = new WeakMap<Document, () => void>();
const feedbackOrigins = new WeakMap<Document, string>();

export const installFeedbackSelection = (document: Document, endpointOrigin = ""): (() => void) => {
  const existing = selectionOwners.get(document);
  if (existing !== undefined) return existing;
  const remember = () => {
    const selection = document.getSelection();
    const article = document.querySelector<HTMLElement>("[data-feedback-content]");
    if (selection === null || selection.isCollapsed || article === null) return;
    const blocks = [...article.querySelectorAll("p,li,pre,blockquote,h2,h3,h4")];
    const block =
      blocks.find((element) => element === selection.anchorNode) ??
      selection.anchorNode?.parentElement?.closest("p,li,pre,blockquote,h2,h3,h4");
    if (
      block != null &&
      article.contains(block) &&
      selection.focusNode !== null &&
      block.contains(selection.focusNode)
    )
      selectedBlocks.set(document, {
        blockId: block.id || `block-${blocks.indexOf(block)}`,
        blockBody: (block.textContent ?? "").slice(0, 2000),
      });
    else if (
      document.activeElement?.closest("section")?.querySelector("[data-feedback-message]") == null
    )
      selectedBlocks.delete(document);
  };
  const onPageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) dispose();
  };
  const dispose = () => {
    document.removeEventListener("selectionchange", remember);
    document.defaultView?.removeEventListener("pagehide", onPageHide);
    selectedBlocks.delete(document);
    feedbackOrigins.delete(document);
    selectionOwners.delete(document);
  };
  feedbackOrigins.set(document, endpointOrigin);
  document.addEventListener("selectionchange", remember);
  document.defaultView?.addEventListener("pagehide", onPageHide);
  selectionOwners.set(document, dispose);
  return dispose;
};

export const FeedbackFinished = Schema.TaggedStruct("FeedbackFinished", { ok: Schema.Boolean });

export const SubmitFeedback = Command.define("SubmitFeedback", {
  args: { route: Schema.String, opinion: Schema.Literals(["good", "bad"]) },
  messages: [FeedbackFinished],
  execute: ({ route, opinion }) =>
    Effect.tryPromise({
      try: async (): Promise<typeof FeedbackFinished.Type> => {
        const input = document.querySelector<HTMLTextAreaElement>("[data-feedback-message]");
        const response = await fetch(`${feedbackOrigins.get(document) ?? ""}/api/feedback/page`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ route, opinion, message: input?.value ?? "" }),
        });
        return { _tag: "FeedbackFinished", ok: response.ok };
      },
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => FeedbackFinished.make({ ok: false }))),
});

export const SubmitTextFeedback = Command.define("SubmitTextFeedback", {
  args: { route: Schema.String },
  messages: [FeedbackFinished],
  execute: ({ route }) =>
    Effect.tryPromise({
      try: async (): Promise<typeof FeedbackFinished.Type> => {
        const block = selectedBlocks.get(document);
        const article = document.querySelector<HTMLElement>("[data-feedback-content]");
        if (
          block === undefined ||
          article === null ||
          !article.textContent?.includes(block.blockBody)
        )
          return FeedbackFinished.make({ ok: false });
        const input = document.querySelector<HTMLTextAreaElement>("[data-feedback-message]");
        const response = await fetch(`${feedbackOrigins.get(document) ?? ""}/api/feedback/text`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            route,
            blockId: block.blockId,
            blockBody: block.blockBody,
            message: input?.value ?? "",
          }),
        });
        return FeedbackFinished.make({ ok: response.ok });
      },
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => FeedbackFinished.make({ ok: false }))),
});
