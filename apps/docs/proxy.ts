import { createI18nMiddleware } from "fumadocs-core/i18n/middleware";

import { i18n } from "@/lib/i18n";

/**
 * Fumadocs owns locale routing. The middleware prefixes every unprefixed path
 * (including `/`) with the Accept-Language-negotiated locale via a 308 redirect,
 * so there is no unprefixed route. The matcher excludes API routes, Next
 * internals, and any dotted static asset so search + assets are never
 * locale-redirected. (Replaces the former Paraglide cookie proxy — Paraglide no
 * longer resolves the locale from the request; the `[lang]` param does.)
 */
export const proxy = createI18nMiddleware(i18n);

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
