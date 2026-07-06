import { createI18nMiddleware } from "fumadocs-core/i18n/middleware";

import { i18n } from "@/lib/i18n";

export const proxy = createI18nMiddleware(i18n);

export const config = {
  matcher: ["/((?!api|registry|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
