"use client";

import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Effect, Result } from "effect";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/locale";
import { m } from "@/lib/client-messages";
import { captureDocsEvent } from "@/lib/posthog/client";
import { cn } from "@/lib/utils";

const DEFAULT_COMMAND = "bun add @signature-kit/signatures @signature-kit/a1";

type InstallCommandProps = {
  readonly command?: string;
  readonly analyticsLocation?: string;
  readonly className?: string;
  readonly locale?: Locale;
};

export const InstallCommand = ({
  command = DEFAULT_COMMAND,
  className,
  analyticsLocation,
  locale,
}: InstallCommandProps) => {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  const handleCopy = async () => {
    const copiedToClipboard = await Effect.runPromise(
      Effect.result(
        Effect.tryPromise({
          try: () => navigator.clipboard.writeText(command),
          catch: () => "clipboard-copy-failed",
        }),
      ),
    );
    if (Result.isSuccess(copiedToClipboard)) {
      if (!mountedRef.current) return;
      setCopied(true);
      captureDocsEvent("install_command_copied", {
        analytics_location: analyticsLocation,
        command,
      });
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        if (mountedRef.current) setCopied(false);
      }, 1800);
    } else {
      captureDocsEvent("install_command_copy_failed", {
        analytics_location: analyticsLocation,
      });
    }
  };

  const copiedLabel =
    locale === undefined ? m.install_copied_label() : m.install_copied_label({}, { locale });
  const copyLabel =
    locale === undefined ? m.install_copy_label() : m.install_copy_label({}, { locale });

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      aria-label={copied ? copiedLabel : copyLabel}
      onClick={handleCopy}
      className={cn("max-w-full min-w-0 shrink gap-3 font-mono text-foreground", className)}
    >
      <span aria-hidden className="shrink-0 text-muted-foreground/60">
        $
      </span>
      <span className="min-w-0 truncate">{command}</span>
      <span
        aria-hidden
        className="relative grid size-4 shrink-0 place-items-center text-muted-foreground transition-colors group-hover/button:text-foreground"
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
