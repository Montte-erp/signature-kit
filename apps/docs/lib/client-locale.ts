import { assertIsLocale, baseLocale, overwriteGetLocale } from "@/paraglide/runtime";
import type { Locale } from "@/lib/locale";

let ssrLocale: string = baseLocale;

overwriteGetLocale(() => assertIsLocale(ssrLocale));

export function setClientLocale(locale: Locale): void {
  ssrLocale = locale;
}
