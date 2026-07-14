"use client";

import { baseLocale, overwriteGetLocale } from "@/paraglide/runtime";
import type { Locale } from "@/lib/locale";
import { parseLocale } from "@/lib/locale";

const readDocumentLocale = (): Locale => {
  if (typeof document === "undefined") return baseLocale;
  return parseLocale(document.documentElement.lang) ?? baseLocale;
};

if (typeof document !== "undefined") {
  overwriteGetLocale(readDocumentLocale);
}

export function setClientLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  if (document.documentElement.lang !== locale) {
    document.documentElement.lang = locale;
  }
}
