import { getLocale } from "@/paraglide/runtime";

/**
 * Prefix an internal path with the active locale segment, e.g.
 * `localePath("/docs")` → `/pt-BR/docs` when the request locale is pt-BR.
 *
 * Reads the active Paraglide locale (overwritten in both the RSC and client
 * graphs from the `[lang]` route param). The locale IS the URL segment (one
 * canonical set), so no mapping. Use it for every internal `<Link>` on the
 * landing so navigation stays inside the current locale instead of bouncing
 * through the proxy's Accept-Language redirect.
 */
export function localePath(path: string): string {
  const suffix = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `/${getLocale()}${suffix}`;
}
