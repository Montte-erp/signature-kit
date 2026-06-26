import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Landing section primitives — dark, pure-monochrome.
 *
 * Server components. They carry ONLY the shadcn tokens mapped in app/global.css
 * (bg-background, text-foreground, text-muted-foreground, border-border, …) —
 * no coral, no fd-* tokens (those belong to the MDX docs surface only).
 *
 * Every landing section is:
 *   <Section><Container>…</Container></Section>
 * and opens with <SectionHeading eyebrow=… title=… lead=… />.
 */

interface SectionProps {
  children: ReactNode;
  className?: string;
  id?: string;
}

/**
 * Full-bleed section band. The `py-12 sm:py-16` vertical rhythm lives on the inner
 * <Container>, so a Section can host its own full-width backdrop if needed.
 */
export function Section({ children, className, id }: SectionProps) {
  return (
    <section id={id} className={cn("relative", className)}>
      {children}
    </section>
  );
}

interface ContainerProps {
  children: ReactNode;
  className?: string;
}

/**
 * Centered content column with the standard `max-w-6xl px-6 py-12 sm:py-16` rhythm.
 * Pass a className to override the padding (e.g. the hero's asymmetric pt/pb).
 */
export function Container({ children, className }: ContainerProps) {
  return (
    <div className={cn("mx-auto max-w-6xl px-6 py-12 sm:py-16", className)}>
      {children}
    </div>
  );
}

interface EyebrowProps {
  children: ReactNode;
  className?: string;
}

/** Mono micro-label that sits above every heading. */
export function Eyebrow({ children, className }: EyebrowProps) {
  return (
    <p className={cn("font-mono text-xs text-muted-foreground", className)}>
      {children}
    </p>
  );
}

interface SectionHeadingProps {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  className?: string;
}

/**
 * Section header: mono eyebrow + tight medium-weight h2 + optional muted lead.
 * Every section opens identically: mono eyebrow, tight medium h2, muted lead.
 */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("max-w-3xl", className)}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="mt-3 text-3xl font-medium tracking-tight text-balance text-foreground sm:text-4xl">
        {title}
      </h2>
      {lead ? (
        <p className="mt-4 max-w-[60ch] text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
          {lead}
        </p>
      ) : null}
    </div>
  );
}
