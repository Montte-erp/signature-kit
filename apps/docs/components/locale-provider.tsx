"use client";

import type { ReactNode } from "react";

import type { Locale } from "@/lib/locale";
import { setClientLocale } from "@/lib/client-locale";

/**
 * Pins the *client* runtime's `getLocale()` to the request locale derived from
 * the Fumadocs `[lang]` route param. Client components ("use client") run in a
 * separate runtime module instance from the RSC graph, so the root layout's
 * server-side `overwriteGetLocale` does not reach them. Without this, client
 * components (hero, signer dialog) would SSR at the base locale and only flip
 * after hydration — a visible flash + hydration mismatch.
 *
 * The `[lang]` root layout passes the mapped locale down as a prop, so a locale
 * change navigates to a new `[lang]` URL and arrives as a fresh prop on the next
 * render — no cookie reaction needed.
 */
export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  setClientLocale(locale);
  return children;
}
