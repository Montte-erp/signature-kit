import "server-only";

import { cache } from "react";

import { assertIsLocale, baseLocale, overwriteGetLocale } from "@/paraglide/runtime";
import type { Locale } from "@/lib/locale";

const ssrLocale = cache((): { locale: string } => ({ locale: baseLocale }));

overwriteGetLocale(() => assertIsLocale(ssrLocale().locale));

export function setServerLocale(locale: Locale): Locale {
  ssrLocale().locale = locale;
  return locale;
}
