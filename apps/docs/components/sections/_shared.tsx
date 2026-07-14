import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SectionProps {
  children: ReactNode;
  className?: string;
  id?: string;
  "aria-labelledby"?: string;
}

export function Section({
  children,
  className,
  id,
  "aria-labelledby": ariaLabelledby,
}: SectionProps) {
  return (
    <section id={id} aria-labelledby={ariaLabelledby} className={cn("relative", className)}>
      {children}
    </section>
  );
}

interface ContainerProps {
  children: ReactNode;
  className?: string;
}

export function Container({ children, className }: ContainerProps) {
  return <div className={cn("mx-auto max-w-6xl px-6 py-12 sm:py-16", className)}>{children}</div>;
}

interface EyebrowProps {
  children: ReactNode;
  className?: string;
}

export function Eyebrow({ children, className }: EyebrowProps) {
  return <p className={cn("font-mono text-xs text-muted-foreground", className)}>{children}</p>;
}

interface SectionHeadingProps {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  className?: string;
  id?: string;
}

export function SectionHeading({ eyebrow, title, lead, className, id }: SectionHeadingProps) {
  return (
    <div className={cn("max-w-3xl", className)}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2
        id={id}
        className="mt-3 text-3xl font-medium tracking-tight text-balance text-foreground sm:text-4xl"
      >
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
