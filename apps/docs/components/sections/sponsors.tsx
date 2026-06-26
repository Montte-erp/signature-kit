import { LiciteiLogo } from "@/components/brand/licitei-logo";
import { m } from "@/paraglide/messages";

import { Container, Section } from "./_shared";
import { Marquee } from "@/components/ui/marquee";

/**
 * Backers band. SignatureKit runs in production at Licitei; this strip marquees
 * the real Licitei wordmark, linked out. Server component — pure-monochrome
 * shadcn tokens (the Licitei "L" keeps its brand orange).
 */
export function Sponsors() {
  const items = Array.from({ length: 4 }, (_, i) => ({
    key: `licitei-${i}`,
    node: (
      <a
        href="https://licitei.com.br"
        target="_blank"
        rel="noreferrer"
        aria-label="Licitei"
        className="inline-flex items-center px-8 text-foreground/75 transition-colors hover:text-foreground sm:px-12"
      >
        <LiciteiLogo className="h-6 w-auto sm:h-7" />
      </a>
    ),
  }));

  return (
    <Section className="border-t border-border">
      <Container className="flex flex-col items-center gap-7 py-14 text-center sm:py-16">
        <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground/70 uppercase">
          {m.sponsors_eyebrow()}
        </p>
        <Marquee items={items} durationSeconds={24} className="w-full" gapClassName="gap-0" />
      </Container>
    </Section>
  );
}
