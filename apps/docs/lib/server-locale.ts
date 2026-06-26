import "server-only";

import { cache } from "react";

import { assertIsLocale, baseLocale, overwriteGetLocale } from "@/paraglide/runtime";
import type { Locale } from "@/lib/locale";

/**
 * Request-scoped Paraglide locale for server components.
 *
 * `cache()` gives every request its own store, so concurrent renders never leak
 * locales. `overwriteGetLocale` (set once at module load) makes the server-side
 * `getLocale()` / `m()` read from it.
 *
 * The locale comes straight from the Fumadocs `[lang]` route param (same
 * canonical string as the Paraglide locale — no mapping). Every `[lang]` layout
 * that renders translated server chrome (nav, footer, sections) calls
 * `setServerLocale(lang)` at the top of its render, before any `m()`. The
 * cache()d store makes repeated calls within one request a cheap no-op.
 */
const ssrLocale = cache(() => ({ locale: baseLocale as string }));

overwriteGetLocale(() => assertIsLocale(ssrLocale().locale));

export function setServerLocale(locale: Locale): Locale {
  ssrLocale().locale = locale;
  return locale;
}
