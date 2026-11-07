import { Runtime } from "foldkit";
import { initDocsPostHog } from "../lib/posthog/client";
import { Flags, Model, init, update, view } from "./main";
import "./site.css";
import "./content.css";
import "./home.css";

initDocsPostHog();

Runtime.hydrate(
  Runtime.makeApplication({
    Flags,
    Model,
    init,
    update,
    view,
    container: document.querySelector<HTMLElement>("[data-foldkit-app]"),
  }),
);
