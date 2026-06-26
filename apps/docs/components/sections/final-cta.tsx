import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { FadeIn } from "@/components/fade-in";
import { InstallCommand } from "@/components/install-command";
import { Button } from "@/components/ui/button";
import { localePath } from "@/lib/links";
import { m } from "@/paraglide/messages";

import { Container, Eyebrow, Section } from "./_shared";

/**
 * Centered closing CTA — pure monochrome, the page's quietest section.
 *
 * A bordered panel with a top hairline + subtle radial backdrop holds a mono
 * eyebrow, a big medium-weight headline, a muted line (open source / MIT /
 * Effect-native), then the solid quickstart Button followed by the install
 * pill. Server component; the only motion is the <FadeIn> scroll-reveal.
 */
export function FinalCta() {
  return (
    <Section className="border-t border-border">
      <Container className="py-20 sm:py-28">
        <FadeIn>
          <div className="relative mx-auto max-w-3xl overflow-hidden rounded-3xl border border-border bg-card/40 px-6 py-14 text-center sm:px-12 sm:py-20">
            {/* top hairline */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent" />
            {/* subtle radial backdrop */}
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--foreground)_5%,transparent),transparent)]" />
            <Eyebrow className="text-center">{m.final_eyebrow()}</Eyebrow>
            <h2 className="mx-auto mt-3 max-w-[20ch] text-[2.5rem]/[1.05] font-medium tracking-tight text-balance text-foreground sm:text-5xl lg:text-6xl">
              {m.final_title()}
            </h2>
            <p className="mx-auto mt-5 max-w-[52ch] text-base leading-relaxed text-pretty text-muted-foreground sm:text-base">
              {m.final_lead()}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href={localePath("/docs/quickstart")}>
                  {m.final_cta()}
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <InstallCommand />
            </div>
          </div>
        </FadeIn>
      </Container>
    </Section>
  );
}
