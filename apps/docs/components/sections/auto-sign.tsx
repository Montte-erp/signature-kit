"use client";

import { useInView } from "motion/react";
import * as React from "react";

import { ClientOnly } from "@/components/client-only";

import { FadeIn } from "@/components/fade-in";
import type { Locale } from "@/lib/locale";
import { m } from "@/lib/client-messages";

import { Container, Section, SectionHeading } from "./_shared";

const AutoSignInner = React.lazy(() =>
  import("./auto-sign-inner").then((mod) => ({ default: mod.AutoSignInner })),
);

function AutoSignSkeleton({ locale }: { readonly locale: Locale }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={m.autosign_running({}, { locale })}
      className="mt-10 grid min-w-0 gap-6 lg:grid-cols-[1fr_22rem]"
    >
      <span className="sr-only">{m.autosign_running({}, { locale })}</span>
      <div
        aria-hidden="true"
        className="h-[30rem] min-w-0 animate-pulse rounded-xl border border-border bg-muted/30 motion-reduce:animate-none"
      />
      <div aria-hidden="true" className="flex min-w-0 flex-col gap-4">
        <div className="h-9 w-40 min-w-0 animate-pulse rounded-md bg-muted/30 motion-reduce:animate-none" />
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="h-10 min-w-0 animate-pulse rounded-md border border-border bg-muted/30 motion-reduce:animate-none" />
          <div className="h-10 min-w-0 animate-pulse rounded-md border border-border bg-muted/30 motion-reduce:animate-none" />
          <div className="h-10 min-w-0 animate-pulse rounded-md border border-border bg-muted/30 motion-reduce:animate-none" />
        </div>
        <div className="h-12 w-full min-w-0 animate-pulse rounded-md bg-muted/30 motion-reduce:animate-none" />
      </div>
    </div>
  );
}

const AUTO_SIGN_HEADING_ID = "auto-sign-heading";

export function AutoSign({ locale }: { readonly locale: Locale }) {
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(bodyRef, { once: true, margin: "400px 0px" });

  return (
    <Section className="border-t border-border" aria-labelledby={AUTO_SIGN_HEADING_ID}>
      <Container>
        <FadeIn>
          <SectionHeading
            id={AUTO_SIGN_HEADING_ID}
            eyebrow={m.autosign_eyebrow({}, { locale })}
            title={m.autosign_title({}, { locale })}
            lead={m.autosign_lead({}, { locale })}
          />
        </FadeIn>
        <FadeIn delay={0.05}>
          <div ref={bodyRef}>
            {inView ? (
              <ClientOnly fallback={<AutoSignSkeleton locale={locale} />}>
                <React.Suspense fallback={<AutoSignSkeleton locale={locale} />}>
                  <AutoSignInner />
                </React.Suspense>
              </ClientOnly>
            ) : (
              <AutoSignSkeleton locale={locale} />
            )}
          </div>
        </FadeIn>
      </Container>
    </Section>
  );
}
