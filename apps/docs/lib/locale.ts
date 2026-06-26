import { locales } from "@/paraglide/runtime";

/**
 * One canonical locale set for the whole app. The URL segment, the Fumadocs
 * `language`, the MDX filename suffix, and the Paraglide locale are all the SAME
 * BCP-47 string ("en-US" | "pt-BR") — there is no casing-mapping layer to
 * desync. Canonical casing is also exactly what `@formatjs/intl-localematcher`
 * (the matcher inside Fumadocs' i18n middleware) emits, so a negotiated locale
 * round-trips through the URL without re-triggering the prefix redirect (the
 * lowercase-vs-canonical mismatch is what caused the `/en-US/en-US/...` loop).
 */
export type Locale = (typeof locales)[number];

/** Alias kept for the route layer, which reads the segment as `lang`. */
export type Lang = Locale;
