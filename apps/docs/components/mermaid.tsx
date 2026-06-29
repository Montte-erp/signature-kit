"use client";

import mermaid from "mermaid";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";

type MermaidProps = {
  readonly chart: string;
  readonly className?: string;
};

type RenderState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly svg: string }
  | { readonly status: "error"; readonly message: string };


export function Mermaid({ chart, className }: MermaidProps) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const [theme, setTheme] = useState<"dark" | "default">(() =>
    typeof document === "undefined"
      ? "default"
      : document.documentElement.classList.contains("dark")
        ? "dark"
        : "default",
  );
  const [state, setState] = useState<RenderState>({ status: "loading" });

  useEffect(() => {
    const observer = new MutationObserver(() =>
      setTheme(document.documentElement.classList.contains("dark") ? "dark" : "default"),
    );
    observer.observe(document.documentElement, { attributeFilter: ["class"], attributes: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    mermaid.initialize({
      securityLevel: "strict",
      startOnLoad: false,
      theme,
      themeVariables: {
        fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
      },
    });

    mermaid
      .render(id, chart)
      .then((result) => {
        if (!cancelled) setState({ status: "ready", svg: result.svg });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Unable to render Mermaid diagram." });
      });

    return () => {
      cancelled = true;
    };
  }, [chart, id, theme]);

  return (
    <figure
      className={cn(
        "not-prose my-6 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
        className,
      )}
    >
      <div className="overflow-x-auto p-4 md:p-6">
        {state.status === "ready" ? (
          <div
            className="mx-auto min-w-fit [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: state.svg }}
          />
        ) : state.status === "error" ? (
          <pre className="whitespace-pre-wrap rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
            {state.message}
          </pre>
        ) : (
          <div className="h-48 animate-pulse rounded-lg bg-muted" />
        )}
      </div>
    </figure>
  );
}
