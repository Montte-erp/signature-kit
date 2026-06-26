import { FadeIn } from "@/components/fade-in";
import { LiciteiLogo } from "@/components/brand/licitei-logo";
import { m } from "@/paraglide/messages";

import { Container, Section } from "./_shared";

/**
 * Sponsors / launch-partner band. SignatureKit was built by Montte and runs in
 * production at Licitei; this section shows the real Licitei wordmark, linked out,
 * with a one-line attribution. Server component — pure-monochrome shadcn tokens
 * (the Licitei "L" keeps its brand orange).
 */
export function Sponsors() {
  return (
    <Section className="border-t border-border">
      <Container className="py-14 sm:py-16">
        <FadeIn>
          <div className="flex flex-col items-center gap-7 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
              {m.sponsors_eyebrow()}
            </p>

            <a
              href="https://licitei.com.br"
              target="_blank"
              rel="noreferrer"
              aria-label="Licitei"
              className="text-foreground/85 transition-colors hover:text-foreground"
            >
              <LiciteiLogo className="h-7 w-auto sm:h-8" />
            </a>

            <p className="max-w-[58ch] text-sm leading-relaxed text-pretty text-muted-foreground">
              {m.sponsors_lead()}
            </p>
          </div>
        </FadeIn>
      </Container>
    </Section>
  );
}
