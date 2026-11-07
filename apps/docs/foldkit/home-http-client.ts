import { Runtime } from "foldkit";
import posthog from "posthog-js";
import { docsPostHogOptions } from "../lib/posthog/client";
import { Flags, Model, init, update, view } from "./main";
import "./site.css";
import "./content.css";
import "./home.css";

posthog.init("local-home-test-token", { ...docsPostHogOptions, opt_out_useragent_filter: true });

Runtime.hydrate(
  Runtime.makeApplication({
    Flags,
    Model,
    init,
    update,
    view,
    container: document.querySelector<HTMLElement>("[data-foldkit-app]"),
  }),
  { buildId: "home-http-test" },
);
