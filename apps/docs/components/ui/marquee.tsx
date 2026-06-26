"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Reusable marquee — Motion-driven (no CSS keyframes). The sequence is rendered
 * twice into one `w-max` track that animates `translateX(0 → -50%)` on a linear
 * loop (Emil: constant motion = `linear`), so it wraps seamlessly. Driven with the
 * full `transform` string for hardware acceleration (Motion's `x` shorthand runs on
 * the main thread and drops frames under load). Pauses on hover/focus via the
 * playback controls; fully still under `prefers-reduced-motion`.
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
  const reduceMotion = useReducedMotion();
  const trackRef = useRef<HTMLUListElement>(null);
  const controls = useRef<ReturnType<typeof animate> | null>(null);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || reduceMotion) return;
    const from = reverse ? "-50%" : "0%";
    const to = reverse ? "0%" : "-50%";
    controls.current = animate(
      el,
      { transform: [`translateX(${from})`, `translateX(${to})`] },
      { duration: durationSeconds, ease: "linear", repeat: Infinity },
    );
    return () => controls.current?.stop();
  }, [durationSeconds, reverse, reduceMotion]);

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
      onPointerEnter={() => controls.current?.pause()}
      onPointerLeave={() => controls.current?.play()}
      onFocusCapture={() => controls.current?.pause()}
      onBlurCapture={() => controls.current?.play()}
    >
      <ul ref={trackRef} className={cn("flex w-max items-center", gapClassName)}>
        {sequence.map((item) => (
          <li key={item.uid} aria-hidden={item.dup} className="shrink-0">
            {item.node}
          </li>
        ))}
      </ul>
    </div>
  );
}
