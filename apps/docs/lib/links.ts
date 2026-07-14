import type { Locale } from "@/lib/locale";

import { getLocale } from "@/paraglide/runtime";

export function localePath(path: string, locale: Locale = getLocale()): string {
  const suffix = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${suffix}`;
}
