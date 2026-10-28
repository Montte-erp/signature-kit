import type { Locale } from "@/lib/locale";
import { localizedSitePath } from "@/lib/site-route";

import { getLocale } from "@/paraglide/runtime";

export function localePath(path: string, locale: Locale = getLocale()): string {
  return localizedSitePath(path, locale);
}
