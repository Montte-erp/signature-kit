"use client";

import { Check, Copy } from "lucide-react";
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
        className="text-muted-foreground transition-colors group-hover/button:text-foreground"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </span>
    </Button>
  );
};
