import type { Lang } from "@/lib/locale";

/**
 * Canonical absolute origin for the site — used by the sitemap, RSS, OG images,
 * and canonical/alternate metadata. Override per-deploy with NEXT_PUBLIC_SITE_URL;
 * the default is the production domain.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://signaturekit.dev"
).replace(/\/+$/, "");

export const SITE_NAME = "SignatureKit";

/** BCP-47 (our canonical locale) → OpenGraph locale (underscored). */
export const OG_LOCALE: Record<Lang, string> = {
  "en-US": "en_US",
  "pt-BR": "pt_BR",
};

/** Absolute URL from a root-relative path. */
export const absoluteUrl = (path: string): string =>
  `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
