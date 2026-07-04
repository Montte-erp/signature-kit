"use client";

import { motion, useAnimationFrame, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useRef } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Reusable marquee. The sequence is rendered twice into one `w-max` track whose
 * `x` is a Motion value advanced by `useAnimationFrame` and wrapped at -50%, so
 * it loops seamlessly. Motion owns the animation; hover/focus pause and reduced
 * motion freeze the frame loop. React only renders data.
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

const TRACK_WRAP_PERCENT = -50;

export function Marquee({
  items,
  durationSeconds = 40,
  reverse = false,
  className,
  gapClassName = "gap-4 sm:gap-6",
  fade = true,
}: MarqueeProps) {
  const reducedMotion = useReducedMotion();
  const paused = useRef(false);
  const trackX = useMotionValue(0);
  const x = useTransform(trackX, (value) => `${value}%`);

  useAnimationFrame((_, deltaMs) => {
    if (reducedMotion || paused.current) return;
    const direction = reverse ? 1 : -1;
    const step = (deltaMs / 1000) * (Math.abs(TRACK_WRAP_PERCENT) / durationSeconds) * direction;
    let next = trackX.get() + step;
    if (next <= TRACK_WRAP_PERCENT) next -= TRACK_WRAP_PERCENT;
    if (next > 0) next += TRACK_WRAP_PERCENT;
    trackX.set(next);
  });

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
      <motion.ul
        className={cn("flex w-max items-center", gapClassName)}
        style={{ x }}
        onPointerEnter={() => {
          paused.current = true;
        }}
        onPointerLeave={() => {
          paused.current = false;
        }}
        onFocusCapture={() => {
          paused.current = true;
        }}
        onBlurCapture={() => {
          paused.current = false;
        }}
      >
        {sequence.map((item) => (
          <li
            key={item.uid}
            aria-hidden={item.dup}
            // inert keeps the duplicated half out of the tab order (links inside
            // an aria-hidden clone must not receive focus).
            inert={item.dup || undefined}
            className="shrink-0"
          >
            {item.node}
          </li>
        ))}
      </motion.ul>
    </div>
  );
}
