"use client";

import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";

import { InstallCommand } from "@/components/install-command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { localePath } from "@/lib/links";
import { m } from "@/paraglide/messages";

type CubicBezier = readonly [number, number, number, number];
const EASE: CubicBezier = [0.23, 1, 0.32, 1];

/**
 * Landing hero. Centered column, monochrome rhythm: a generic open-source pill,
 * a tight medium headline, a muted subhead, the install pill + ghost docs link.
 *
 * "use client" for the staggered motion entrance only — the copy is plain markup.
 */
export function Hero() {
  const reduce = useReducedMotion();
  const offset = reduce ? 0 : 12;
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto flex max-w-5xl flex-col items-center px-6 pt-20 pb-14 text-center sm:pt-24 sm:pb-16 lg:pt-28 lg:pb-20">
        <Badge
          asChild
          variant="outline"
          className="gap-2 px-3 py-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <a href="https://github.com/Montte-erp/signature-kit" rel="noreferrer" target="_blank">
            {m.hero_badge()}
            <ArrowRight data-icon="inline-end" />
          </a>
        </Badge>

        <motion.h1
          className="mt-6 max-w-[20ch] text-[2.5rem]/[1.05] font-medium tracking-tight text-balance text-foreground sm:text-7xl lg:text-8xl"
          initial={{ opacity: 0, transform: `translateY(${offset}px)` }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ delay: 0.08, duration: 0.7, ease: EASE }}
        >
          {m.hero_title()}
        </motion.h1>

        <motion.p
          className="mt-5 max-w-[60ch] text-base leading-relaxed text-pretty text-muted-foreground sm:text-xl"
          initial={{ opacity: 0, transform: `translateY(${offset}px)` }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ delay: 0.18, duration: 0.6, ease: EASE }}
        >
          {m.hero_subhead()}
        </motion.p>

        <motion.div
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
          initial={{ opacity: 0, transform: `translateY(${offset}px)` }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ delay: 0.26, duration: 0.6, ease: EASE }}
        >
          <InstallCommand analyticsLocation="hero" />
          <Button asChild size="lg" variant="ghost">
            <Link href={localePath("/docs")}>
              {m.hero_cta_docs()}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
