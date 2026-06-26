"use client";

import dynamic from "next/dynamic";

import { FadeIn } from "@/components/fade-in";
import { m } from "@/paraglide/messages";

import { Container, Section, SectionHeading } from "./_shared";

/**
 * Auto-signature showcase — SSR-safe shell.
 *
 * The heavy interactive body (`@react-pdf/renderer` + `pdfjs-dist`, ~1MB) lives
 * in `./auto-sign-inner` and is code-split out via `next/dynamic({ ssr: false })`
 * so it never runs during the home page's static prerender. While the chunk
 * loads (and during SSR) a static, monochrome skeleton stands in. The demo owns
 * its state in a module-level store, so "Reset" lives there — no remount needed.
 */

const AutoSignInner = dynamic(
  () => import("./auto-sign-inner").then((mod) => mod.AutoSignInner),
  { ssr: false, loading: () => <AutoSignSkeleton /> },
);

/** Static stand-in mirroring the inner two-column layout (SSR + chunk load). */
function AutoSignSkeleton() {
  return (
    <div
      aria-hidden
      className="mt-10 grid gap-6 lg:grid-cols-[1fr_22rem]"
    >
      <div className="h-[30rem] animate-pulse rounded-xl border border-border bg-muted/30" />
      <div className="flex flex-col gap-4">
        <div className="h-9 w-40 animate-pulse rounded-md bg-muted/30" />
        <div className="flex flex-col gap-1.5">
          <div className="h-10 animate-pulse rounded-md border border-border bg-muted/30" />
          <div className="h-10 animate-pulse rounded-md border border-border bg-muted/30" />
          <div className="h-10 animate-pulse rounded-md border border-border bg-muted/30" />
        </div>
        <div className="h-12 w-full animate-pulse rounded-md bg-muted/30" />
      </div>
    </div>
  );
}

export function AutoSign() {
  return (
    <Section className="border-t border-border">
      <Container>
        <FadeIn>
          <SectionHeading
            eyebrow={m.autosign_eyebrow()}
            title={m.autosign_title()}
            lead={m.autosign_lead()}
          />
        </FadeIn>
        <FadeIn delay={0.05}>
          <AutoSignInner />
        </FadeIn>
      </Container>
    </Section>
  );
}
