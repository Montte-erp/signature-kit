import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Reusable, dependency-free marquee (shadcn ships none). Pure-CSS infinite
 * scroll: the sequence is rendered twice into one `w-max` track that the
 * `marquee` keyframe (app/global.css) translates `-50%`, so it loops seamlessly.
 * `.marquee-track` (also in global.css) pauses on hover/focus and honors
 * `prefers-reduced-motion`. Server component — no JS, no client bundle.
 *
 * Pass discrete `items` (each with a stable `key`) so the duplicated half keeps
 * position-independent keys and the dup is `aria-hidden` for screen readers.
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
      <ul
        className={cn("marquee-track flex w-max items-center", gapClassName)}
        style={{
          animationName: "marquee",
          animationDuration: `${durationSeconds}s`,
          animationTimingFunction: "linear",
          animationIterationCount: "infinite",
          animationDirection: reverse ? "reverse" : "normal",
        }}
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
