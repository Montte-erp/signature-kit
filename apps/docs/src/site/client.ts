import { Layer } from "effect";
import { pdfPreviewBrowserLayer } from "./pdf-preview-browser.ts";
import * as Runtime from "foldkit/runtime";

import { contentApplication } from "./application.ts";
import "./site.css";

declare const __SITE_BUILD_ID__: string;

Runtime.hydrate(
  Runtime.makeApplication({
    ...contentApplication,
    resources: pdfPreviewBrowserLayer.pipe(Layer.provideMerge(contentApplication.resources)),
    container: document.querySelector<HTMLElement>("[data-foldkit-app]"),
  }),
  { buildId: __SITE_BUILD_ID__ },
);
