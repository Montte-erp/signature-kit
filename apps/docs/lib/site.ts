import type { Lang } from "@/lib/locale";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://signaturekit.dev"
).replace(/\/+$/, "");

export const SITE_NAME = "SignatureKit";

export const OG_LOCALE: Record<Lang, string> = {
  "en-US": "en_US",
  "pt-BR": "pt_BR",
};

export const absoluteUrl = (path: string): string =>
  `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
