import { Duration, Effect, Schema } from "effect";
import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as Command from "foldkit/command";
import * as Runtime from "foldkit/runtime";
import * as Submodel from "foldkit/submodel";
import type * as Update from "foldkit/update";
import { defineMessageUnion } from "foldkit/message";

import { PackageManager, packageInstallCommand } from "../../lib/package-install.ts";
import { SiteLocale } from "../../lib/site-route.ts";
import { m } from "../../paraglide/messages.js";

const Kind = Schema.Literals(["code", "package-install"]);
const Flags = Schema.Struct({ kind: Kind, source: Schema.String, locale: SiteLocale });
const Model = Schema.Struct({
  ...Flags.fields,
  manager: PackageManager,
  revision: Schema.Int,
  copied: Schema.Boolean,
  failed: Schema.Boolean,
});
type Model = typeof Model.Type;
const Message = defineMessageUnion({
  SelectedManager: { manager: PackageManager },
  ClickedCopy: {},
  CopiedText: { revision: Schema.Int },
  RejectedCopy: { revision: Schema.Int },
  ClearedCopy: { revision: Schema.Int },
});
type Message = typeof Message.Type;

const CopyText = Command.define("CopyDocumentationExample", {
  args: { text: Schema.String, revision: Schema.Int },
  messages: [Message.CopiedText, Message.RejectedCopy],
  execute: Effect.fn(function* ({ text, revision }) {
    const clipboard = yield* Clipboard.Clipboard;
    return yield* clipboard.writeString(text).pipe(
      Effect.match({
        onSuccess: () => Message.CopiedText({ revision }),
        onFailure: () => Message.RejectedCopy({ revision }),
      }),
    );
  }),
});
const ClearCopy = Command.define("ClearDocumentationCopyFeedback", {
  args: { revision: Schema.Int },
  messages: [Message.ClearedCopy],
  execute: ({ revision }) =>
    Effect.sleep(Duration.millis(1800)).pipe(Effect.as(Message.ClearedCopy({ revision }))),
});

const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message, Clipboard.Clipboard> =>
  Message.match<Update.Return<Model, Message, Clipboard.Clipboard>>(message, {
    SelectedManager: ({ manager }) => ({
      model: { ...model, manager, copied: false, failed: false, revision: model.revision + 1 },
    }),
    ClickedCopy: () => {
      const revision = model.revision + 1;
      const text =
        model.kind === "package-install"
          ? packageInstallCommand(model.manager, model.source)
          : model.source;
      return {
        model: { ...model, revision, copied: false, failed: false },
        commands: [CopyText({ text, revision })],
      };
    },
    CopiedText: ({ revision }) =>
      revision !== model.revision
        ? { model }
        : { model: { ...model, copied: true, failed: false }, commands: [ClearCopy({ revision })] },
    RejectedCopy: ({ revision }) => ({
      model: revision !== model.revision ? model : { ...model, copied: false, failed: true },
    }),
    ClearedCopy: ({ revision }) => ({
      model: revision !== model.revision ? model : { ...model, copied: false },
    }),
  });

const view = Submodel.defineView<Model, Message>((model, h) => {
  const options = { locale: model.locale };
  return h.div(
    [h.Class("content-code-widget"), h.Attribute("data-code-widget", model.kind)],
    [
      ...(model.kind === "package-install"
        ? [
            h.div(
              [
                h.Class("content-code-managers"),
                h.Attribute("role", "group"),
                h.Attribute("aria-label", m.site_package_manager({}, options)),
              ],
              PackageManager.literals.map((manager) =>
                h.button(
                  [
                    h.Class("site-action"),
                    h.Type("button"),
                    h.Attribute("data-manager", manager),
                    h.Attribute("aria-pressed", String(manager === model.manager)),
                    h.OnClick(Message.SelectedManager({ manager })),
                  ],
                  [manager],
                ),
              ),
            ),
            h.pre([], [h.code([], [packageInstallCommand(model.manager, model.source)])]),
          ]
        : []),
      h.button(
        [
          h.Class("site-action"),
          h.Type("button"),
          h.Attribute("data-code-action", "copy"),
          h.OnClick(Message.ClickedCopy()),
        ],
        [
          model.copied
            ? m.install_copied_label({}, options)
            : model.kind === "package-install"
              ? m.install_copy_label({}, options)
              : m.showcase_copy({}, options),
        ],
      ),
      model.failed
        ? h.p([h.Attribute("role", "alert")], [m.site_copy_error({}, options)])
        : h.empty,
    ],
  );
});

export const mountCodeBlocks = Effect.fn(function* (root: Element, locale: typeof SiteLocale.Type) {
  const sources = [
    ...root.querySelectorAll<HTMLElement>(
      "figure.code-block pre code, code.language-package-install",
    ),
  ];
  yield* Effect.forEach(
    sources,
    (source) =>
      Effect.gen(function* () {
        const isInstallation = source.matches("code.language-package-install");
        const original = isInstallation
          ? source.parentElement
          : source.closest("figure.code-block");
        if (original === null)
          return yield* Effect.die("Published code requires its owning code block.");
        const slot = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const element = document.createElement("div");
            if (isInstallation) original.replaceWith(element);
            else original.prepend(element);
            return element;
          }),
          (element) =>
            Effect.sync(() => {
              if (isInstallation) element.replaceWith(original);
              else element.remove();
            }),
        );
        const flags = yield* Schema.decodeUnknownEffect(Flags)({
          kind: isInstallation ? Kind.literals[1] : Kind.literals[0],
          source: isInstallation
            ? (source.textContent ?? "").trim().split(/\s+/u).join(" ")
            : (source.textContent ?? ""),
          locale,
        }).pipe(Effect.orDie);
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            Runtime.embed(
              Runtime.makeElement({
                Flags,
                Model,
                update,
                view,
                flags: Effect.succeed(flags),
                init: (flags) => ({
                  model: { ...flags, manager: "bun", revision: 0, copied: false, failed: false },
                }),
                container: slot,
                resources: Clipboard.layer,
                devTools: false,
              }),
            ),
          ),
          (runtime) => Effect.sync(() => runtime.dispose()),
        );
      }),
    { discard: true },
  );
});
