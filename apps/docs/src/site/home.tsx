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
import { setServerLocale } from "@/lib/server-locale";
import { parseLocale } from "@/lib/locale";
import { SITE_NAME, absoluteUrl } from "@/lib/site";

export default function HomePage({ lang }: { readonly lang?: string }) {
  const locale = parseLocale(lang ?? "");
  if (locale === undefined) return notFound();
  setServerLocale(locale);

  return (
    <>
      <title>{`${SITE_NAME} — Effect-native digital signatures for TypeScript`}</title>
      <meta
        name="description"
        content="One typed signing boundary for A1/PKCS#12 certificates, PDF/PAdES, XML-DSig, and remote providers."
      />
      <link rel="canonical" href={absoluteUrl(`/${locale}`)} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={`${SITE_NAME} — Digital signatures for TypeScript`} />
      <meta
        property="og:description"
        content="Effect-native digital signatures for local certificates, PDF, XML, and remote providers."
      />
      <meta property="og:url" content={absoluteUrl(`/${locale}`)} />
      <main className="flex flex-col">
        <Hero />
        <Integrations />
        <Signer />
        <AutoSign />
        <ProvidersShowcase />
        <Capabilities />
        <GetStarted />
        <Sponsors />
        <FinalCta />
      </main>
    </>
  );
}
