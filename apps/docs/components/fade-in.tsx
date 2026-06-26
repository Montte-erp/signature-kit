"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

interface FadeInProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}

/**
 * Scroll-triggered fade-up. Reveals once when it enters the viewport.
 */
export const FadeIn = ({
  children,
  className,
  delay = 0,
  y = 12,
}: FadeInProps) => (
  <motion.div
    className={className}
    initial={{ opacity: 0, y }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ margin: "-80px", once: true }}
    transition={{ delay, duration: 0.55, ease: [0.23, 1, 0.32, 1] }}
  >
    {children}
  </motion.div>
);
