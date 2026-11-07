import { Effect } from "effect";
import { Runtime } from "foldkit";
import { installFeedbackSelection } from "./feedback";
import { Flags, Model, init, update, view } from "./main";

window.addEventListener("pageshow", (event) => {
  document.documentElement.dataset.restored = String(event.persisted);
});
installFeedbackSelection(document, "/__feedback_test__");
const handle = Runtime.embed(
  Runtime.makeApplication({
    Flags,
    Model,
    init,
    update,
    view,
    container: document.querySelector<HTMLElement>("#app"),
  }),
  { flags: Effect.succeed(Flags.make({ locale: "pt-BR", path: "/docs" })) },
);

window.addEventListener("pagehide", (event) => {
  if (!event.persisted) handle.dispose();
});
