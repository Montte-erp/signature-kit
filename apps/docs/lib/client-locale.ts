import { assertIsLocale, baseLocale, overwriteGetLocale } from "@/paraglide/runtime";
import type { Locale } from "@/lib/locale";

/**
 * Locale for the *client* Paraglide runtime instance.
 *
 * "use client" components render in a separate Paraglide runtime module from the
 * RSC graph, so `lib/server-locale.ts` does not reach them. They DO execute on
 * the server during SSR, where their `getLocale()` must return the request
 * locale.
 *
 * We use a plain module-global (NOT React `cache()`): `cache()` is an RSC-graph
 * feature and is NOT request-scoped during the client-component SSR pass, so it
 * handed back a fresh `baseLocale` on every read. The global is primed by
 * <LocaleProvider> right before its children render; client-component SSR is
 * synchronous per request (no awaits between provider-set and child-read), so
 * there is no interleaving window for a concurrent request.
 *
 * `overwriteGetLocale` runs in BOTH server and browser here: with Paraglide on
 * the `baseLocale` strategy there is no cookie/URL fallback, so the browser
 * runtime must also read this global (primed on hydration + every navigation by
 * <LocaleProvider>) rather than defaulting to the base locale.
 */
let ssrLocale: string = baseLocale;

overwriteGetLocale(() => assertIsLocale(ssrLocale));

export function setClientLocale(locale: Locale): void {
  ssrLocale = locale;
}
