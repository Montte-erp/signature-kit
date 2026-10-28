import { ArrowRight } from "lucide-react";
import { Link } from "fumapress/client";

import { CodeBlock } from "@/components/code-block";
import { FadeIn } from "@/components/fade-in";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/locale";
import { localePath } from "@/lib/links";
import { m } from "@/paraglide/messages";

import { Container, Eyebrow, Section } from "./_shared";
import { ProviderCarousel, type ProviderCarouselItem } from "./provider-carousel";
import { brandLogoUrl } from "./provider-marks";

import { providerExamples } from "../../lib/signing-examples.ts";

const FEATURES: ReadonlyArray<{ readonly label: () => string; readonly desc: () => string }> = [
  { label: m.showcase_feature_adapters_label, desc: m.showcase_feature_adapters_desc },
  { label: m.showcase_feature_errors_label, desc: m.showcase_feature_errors_desc },
  { label: m.showcase_feature_redacted_label, desc: m.showcase_feature_redacted_desc },
  { label: m.showcase_feature_shape_label, desc: m.showcase_feature_shape_desc },
];

export function ProvidersShowcase({ locale }: { readonly locale: Locale }) {
  const items: ProviderCarouselItem[] = providerExamples.map((provider) => ({
    name: provider.name,
    filename: provider.filename,
    logo: brandLogoUrl(provider.domain),
    code: provider.code,
  }));

  const panels = providerExamples.map((provider) => (
    <CodeBlock
      key={provider.filename}
      code={provider.code}
      lang="ts"
      className="!my-0 !rounded-none !border-0 bg-transparent text-[13px]"
    />
  ));

  return (
    <Section>
      <Container>
        <FadeIn delay={0.05}>
          <div className="min-w-0 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12">
            <div className="min-w-0 lg:py-2">
              <Eyebrow>{m.showcase_eyebrow()}</Eyebrow>
              <h2 className="mt-3 text-3xl font-medium tracking-tight text-balance text-foreground sm:text-4xl">
                {m.showcase_title()}
              </h2>
              <p className="mt-4 max-w-[58ch] text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
                {m.showcase_lead()}
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link href={localePath("/docs", locale)}>
                    {m.showcase_cta_docs()}
                    <ArrowRight data-icon="inline-end" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href={localePath("/docs/providers/request-shape", locale)}>
                    {m.showcase_cta_browse()}
                  </Link>
                </Button>
              </div>

              <dl className="mt-9 border-t border-border">
                {FEATURES.map((feature) => (
                  <div
                    key={feature.label()}
                    className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4 border-b border-border py-3.5"
                  >
                    <dt className="min-w-0 text-sm font-medium text-foreground">
                      {feature.label()}
                    </dt>
                    <dd className="min-w-0 text-sm leading-relaxed text-pretty text-muted-foreground">
                      {feature.desc()}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="min-w-0">
              <ProviderCarousel items={items} panels={panels} locale={locale} />
            </div>
          </div>
        </FadeIn>
      </Container>
    </Section>
  );
}
