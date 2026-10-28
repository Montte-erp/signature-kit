import { pipe, Schema } from "effect";
import {
  defineRouteUnion,
  mapTo,
  oneOf,
  parseUrlWithFallback,
  restString,
  schemaSegment,
  slash,
} from "foldkit/route";

import { locales } from "../paraglide/runtime.js";

export const SiteLocale = Schema.Literals(locales);
export const freeSigningPath = "assine-documentos-gratis";

export const SiteRoute = defineRouteUnion({
  Home: { locale: SiteLocale },
  Page: { locale: SiteLocale, path: Schema.String },
  NotFound: { path: Schema.String },
});

const localeSegment = schemaSegment("locale", SiteLocale);
const homeRouter = pipe(localeSegment, mapTo(SiteRoute.Home));
const pageRouter = pipe(localeSegment, slash(restString("path")), mapTo(SiteRoute.Page));

export const localizedSitePath = (path: string, locale: typeof SiteLocale.Type): string => {
  if (path === "" || path === "/") return homeRouter({ locale });
  return pageRouter({ locale, path: path.startsWith("/") ? path.slice(1) : path });
};

export const parseSiteUrl = parseUrlWithFallback(oneOf(pageRouter, homeRouter), SiteRoute.NotFound);
