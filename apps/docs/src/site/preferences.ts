import { Effect, Match, Schema } from "effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as Command from "foldkit/command";
import { defineMessageUnion } from "foldkit/message";
import * as Submodel from "foldkit/submodel";
import type * as Update from "foldkit/update";

import { SiteLocale } from "../../lib/site-route.ts";
import { m } from "../../paraglide/messages.js";

export const Theme = Schema.Literals(["system", "light", "dark"]);

export const Model = Schema.Struct({
  locale: SiteLocale,
  theme: Theme,
  ready: Schema.Boolean,
  unavailable: Schema.Boolean,
});

export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  SelectedTheme: { value: Schema.String },
  LoadedTheme: { theme: Theme },
  SavedTheme: { theme: Theme },
  UnstoredTheme: { theme: Theme },
  StorageUnavailable: {},
});

export type Message = typeof Message.Type;

const LoadTheme = Command.define("LoadSiteTheme", {
  messages: [Message.LoadedTheme, Message.StorageUnavailable],
  execute: Effect.gen(function* () {
    const store = yield* KeyValueStore.KeyValueStore;
    const saved = yield* store.get("theme");
    const theme = yield* Schema.decodeUnknownEffect(Theme)(saved ?? "system").pipe(Effect.orDie);
    yield* Effect.sync(() => {
      document.documentElement.dataset.theme = theme;
    });
    return Message.LoadedTheme({ theme });
  }).pipe(
    Effect.catchTag("KeyValueStoreError", () => Effect.succeed(Message.StorageUnavailable())),
  ),
});

const SaveTheme = Command.define("SaveSiteTheme", {
  args: { value: Schema.String },
  messages: [Message.SavedTheme, Message.UnstoredTheme],
  execute: Effect.fn(function* ({ value }) {
    const theme = yield* Schema.decodeUnknownEffect(Theme)(value).pipe(Effect.orDie);
    yield* Effect.sync(() => {
      document.documentElement.dataset.theme = theme;
    });
    const store = yield* KeyValueStore.KeyValueStore;
    return yield* store.set("theme", theme).pipe(
      Effect.match({
        onSuccess: () => Message.SavedTheme({ theme }),
        onFailure: () => Message.UnstoredTheme({ theme }),
      }),
    );
  }),
});

export const init = (
  locale: typeof SiteLocale.Type,
): Update.Return<Model, Message, KeyValueStore.KeyValueStore> => ({
  model: { locale, theme: "system", ready: false, unavailable: false },
  commands: [LoadTheme()],
});

export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message, KeyValueStore.KeyValueStore> =>
  Message.match(message, {
    SelectedTheme: ({ value }) => ({ model, commands: [SaveTheme({ value })] }),
    LoadedTheme: ({ theme }) => ({ model: { ...model, theme, ready: true, unavailable: false } }),
    SavedTheme: ({ theme }) => ({ model: { ...model, theme, unavailable: false } }),
    UnstoredTheme: ({ theme }) => ({ model: { ...model, theme, unavailable: true } }),
    StorageUnavailable: () => ({ model: { ...model, ready: true, unavailable: true } }),
  });

export const view = Submodel.defineView<Model, Message>((model, h) => {
  const options = { locale: model.locale };
  return h.div(
    [h.Class("site-preferences")],
    [
      h.label([h.Attribute("for", "site-theme")], [m.site_theme({}, options)]),
      h.select(
        [
          h.Id("site-theme"),
          h.Value(model.theme),
          h.Disabled(!model.ready),
          h.OnChange((value) => Message.SelectedTheme({ value })),
        ],
        Theme.literals.map((theme) =>
          h.option(
            [h.Value(theme)],
            [
              Match.value(theme).pipe(
                Match.when("system", () => m.site_theme_system({}, options)),
                Match.when("light", () => m.site_theme_light({}, options)),
                Match.when("dark", () => m.site_theme_dark({}, options)),
                Match.exhaustive,
              ),
            ],
          ),
        ),
      ),
      model.unavailable
        ? h.p([h.Attribute("role", "alert")], [m.site_theme_unavailable({}, options)])
        : h.empty,
    ],
  );
});
