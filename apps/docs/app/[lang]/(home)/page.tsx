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
import type { Lang } from "@/lib/locale";

export default async function HomePage({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  // Prime the request locale for this page segment: Next renders layout/page
  // segments independently, so the layout's prime doesn't reach the server
  // sections rendered here (hero is client + primed via LocaleProvider; the rest
  // are server components reading the cache()d store).
  setServerLocale(lang as Lang);

  return (
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
  );
}
