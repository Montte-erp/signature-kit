"use client";

import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DEFAULT_COMMAND = "bun add @signature-kit/core @signature-kit/a1";

interface InstallCommandProps {
  command?: string;
  className?: string;
}

/**
 * Click-to-copy install command, styled as a mono pill. The `$` prompt is
 * decorative; the copied text is the command only.
 */
export const InstallCommand = ({
  command = DEFAULT_COMMAND,
  className,
}: InstallCommandProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard unavailable — silently ignore
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      aria-label={copied ? "Copied" : "Copy install command"}
      onClick={handleCopy}
      className={cn("gap-3 font-mono text-foreground", className)}
    >
      <span aria-hidden className="text-muted-foreground/60">
        $
      </span>
      <span className="truncate">{command}</span>
      <span
        aria-hidden
        className="relative grid size-4 place-items-center text-muted-foreground transition-colors group-hover/button:text-foreground"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={copied ? "check" : "copy"}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </motion.span>
        </AnimatePresence>
      </span>
    </Button>
  );
};
