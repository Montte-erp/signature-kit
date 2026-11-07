import { Option, Schema, pipe } from "effect";
import * as Url from "foldkit/url";
import * as Route from "foldkit/route";

export const Locale = Schema.Literals(["en-US", "pt-BR"]);
export type Locale = typeof Locale.Type;
const Home = Schema.TaggedStruct("Home", { locale: Locale });
const Page = Schema.TaggedStruct("Page", { locale: Locale, path: Schema.String });
const locale = Route.schemaSegment("locale", Locale);
export const homeRoute = pipe(locale, Route.mapTo(Home));
export const pageRoute = pipe(locale, Route.slash(Route.restString("path")), Route.mapTo(Page));
export const publicRoutes = Route.oneOf(homeRoute, pageRoute);

const NotFound = Schema.TaggedStruct("NotFound", { path: Schema.String });
const parseUrl = Route.parseUrlWithFallback(publicRoutes, NotFound);
export const parsePublicUrl = (input: string) => {
  const parsed = Url.fromString(input);
  if (Option.isNone(parsed)) return undefined;
  const route = parseUrl(parsed.value);
  if (route._tag === "NotFound") return undefined;
  const path = route._tag === "Home" ? homeRoute(route) : pageRoute(route);
  return path === parsed.value.pathname ? route : undefined;
};
