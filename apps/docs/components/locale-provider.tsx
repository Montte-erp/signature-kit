"use client";

import "@/instrumentation-client";

import type { ReactNode } from "react";

import type { Locale } from "@/lib/locale";
import { setClientLocale } from "@/lib/client-locale";

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  setClientLocale(locale);
  return children;
}
