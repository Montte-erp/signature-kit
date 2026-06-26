"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Honors the OS "reduce motion" setting for every motion/react entrance on the
 * landing (Hero, FadeIn, etc.) in one place. motion/react does not auto-disable
 * JS-driven motion on its own — this wrapper makes `reducedMotion="user"` apply
 * site-wide so reduced-motion users get no slide/fade.
 */
export function ReducedMotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
