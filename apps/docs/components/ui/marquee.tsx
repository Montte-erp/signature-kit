"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Reusable marquee. The sequence is rendered twice into one `w-max` track that
 * animates `translateX(0 → -50%)` on a linear CSS loop, so it wraps seamlessly.
 * CSS owns pause/reduced-motion behavior; React only renders data.
 */

export interface MarqueeItem {
  readonly key: string;
  readonly node: ReactNode;
}

interface MarqueeProps {
  readonly items: readonly MarqueeItem[];
  /** Seconds for one full loop. Lower = faster. */
  readonly durationSeconds?: number;
  readonly reverse?: boolean;
  readonly className?: string;
  /** Tailwind gap utility for the track spacing. */
  readonly gapClassName?: string;
  /** Edge fade mask. On by default; turn off to bleed to the edges. */
  readonly fade?: boolean;
}

export function Marquee({
  items,
  durationSeconds = 40,
  reverse = false,
  className,
  gapClassName = "gap-4 sm:gap-6",
  fade = true,
}: MarqueeProps) {

  const animation = `${durationSeconds}s linear infinite signaturekit-marquee`;

  const sequence = [
    ...items.map((item) => ({ ...item, uid: `a-${item.key}`, dup: false })),
    ...items.map((item) => ({ ...item, uid: `b-${item.key}`, dup: true })),
  ];

  return (
    <div
      className={cn(
        "overflow-x-clip",
        fade &&
          "[mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)]",
        className,
      )}
    >
      <style>{`@keyframes signaturekit-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}`}</style>
      <ul
        className={cn(
          "flex w-max items-center motion-reduce:[animation:none] hover:[animation-play-state:paused] focus-within:[animation-play-state:paused]",
          gapClassName,
        )}
        style={{ animation, animationDirection: reverse ? "reverse" : "normal" }}
      >
        {sequence.map((item) => (
          <li key={item.uid} aria-hidden={item.dup} className="shrink-0">
            {item.node}
          </li>
        ))}
      </ul>
    </div>
  );
}
