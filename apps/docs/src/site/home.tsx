import { unstable_notFound as notFound } from "waku/router/server";
import { Hero } from "@/components/sections/hero";
import { Integrations } from "@/components/sections/integrations";
import { Signer } from "@/components/sections/signer";
import { AutoSign } from "@/components/sections/auto-sign";
import { ProvidersShowcase } from "@/components/sections/providers-showcase";
import { Capabilities } from "@/components/sections/capabilities";
import { GetStarted } from "@/components/sections/get-started";
import { Sponsors } from "@/components/sections/sponsors";
import { FinalCta } from "@/components/sections/final-cta";
import type { Locale } from "@/lib/locale";
import { parseLocale } from "@/lib/locale";
import { i18n, localizedPath, localizedPaths } from "@/lib/i18n";
import { absoluteUrl, OG_LOCALE, SITE_NAME } from "@/lib/site";

const homeCopy: Record<
  Locale,
  {
    readonly title: string;
    readonly description: string;
    readonly ogTitle: string;
    readonly ogDescription: string;
  }
> = {
  "en-US": {
    title: `${SITE_NAME} — Effect-native digital signatures for TypeScript`,
    description:
      "One typed signing boundary for A1/PKCS#12 certificates, PDF/PAdES, XML-DSig, and remote providers.",
    ogTitle: `${SITE_NAME} — Digital signatures for TypeScript`,
    ogDescription:
      "Effect-native digital signatures for local certificates, PDF, XML, and remote providers.",
  },
  "pt-BR": {
    title: `${SITE_NAME} — Assinaturas digitais nativas em Effect para TypeScript`,
    description:
      "Uma fronteira tipada para certificados A1/PKCS#12, PDF/PAdES, XML-DSig e provedores remotos.",
    ogTitle: `${SITE_NAME} — Assinaturas digitais para TypeScript`,
    ogDescription:
      "Assinaturas digitais nativas em Effect para certificados locais, PDF, XML e provedores remotos.",
  },
};

export default function HomePage({ lang }: { readonly lang?: string }) {
  const locale = parseLocale(lang ?? "");
  if (locale === undefined) return notFound();
  const copy = homeCopy[locale];
  const url = absoluteUrl(localizedPath("", locale));

  return (
    <>
      <title>{copy.title}</title>
      <meta name="description" content={copy.description} />
      <link rel="canonical" href={url} />
      {localizedPaths("").map(({ locale: alternateLocale, path }) => (
        <link
          key={alternateLocale}
          rel="alternate"
          hrefLang={alternateLocale}
          href={absoluteUrl(path)}
        />
      ))}
      <link
        rel="alternate"
        hrefLang="x-default"
        href={absoluteUrl(localizedPath("", i18n.defaultLanguage))}
      />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={copy.ogTitle} />
      <meta property="og:description" content={copy.ogDescription} />
      <meta property="og:url" content={url} />
      <meta property="og:locale" content={OG_LOCALE[locale]} />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={copy.ogTitle} />
      <meta name="twitter:description" content={copy.ogDescription} />
      <div className="flex flex-col">
        <Hero />
        <Integrations />
        <Signer />
        <AutoSign />
        <ProvidersShowcase />
        <Capabilities />
        <GetStarted />
        <Sponsors />
        <FinalCta />
      </div>
    </>
  );
}
