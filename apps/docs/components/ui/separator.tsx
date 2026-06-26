import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Minimal, dependency-free Separator with the shadcn API (orientation +
 * decorative). A hairline rule on the `--border` token; vertical variant for
 * inline dividers (e.g. the provider marquee).
 */
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<"div"> & {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
}) {
  return (
    <div
      data-slot="separator"
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      className={cn(
        "bg-border shrink-0",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
