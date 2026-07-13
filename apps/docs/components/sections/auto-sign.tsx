"use client";

import { useInView } from "motion/react";
import * as React from "react";

import { ClientOnly } from "@/components/client-only";

import { FadeIn } from "@/components/fade-in";
import { m } from "@/paraglide/messages";

import { Container, Section, SectionHeading } from "./_shared";

const AutoSignInner = React.lazy(() =>
  import("./auto-sign-inner").then((mod) => ({ default: mod.AutoSignInner })),
);

function AutoSignSkeleton() {
  return (
    <div aria-hidden className="mt-10 grid gap-6 lg:grid-cols-[1fr_22rem]">
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
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(bodyRef, { once: true, margin: "400px 0px" });

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
          <div ref={bodyRef}>
            {inView ? (
              <ClientOnly fallback={<AutoSignSkeleton />}>
                <React.Suspense fallback={<AutoSignSkeleton />}>
                  <AutoSignInner />
                </React.Suspense>
              </ClientOnly>
            ) : (
              <AutoSignSkeleton />
            )}
          </div>
        </FadeIn>
      </Container>
    </Section>
  );
}
