import { locales } from "@/paraglide/runtime";

export type Locale = (typeof locales)[number];

export type Lang = Locale;

export const isLocale = (value: string): value is Locale =>
  locales.some((locale) => locale === value);

export const parseLocale = (value: string): Locale | undefined =>
  isLocale(value) ? value : undefined;
