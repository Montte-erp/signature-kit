"use client";

import { Effect } from "effect";
import mermaid from "mermaid";
import { useCallback, useId, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

type MermaidProps = {
  readonly chart: string;
  readonly className?: string;
};

type RenderState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly svg: string }
  | { readonly status: "error"; readonly message: string };

type MermaidTheme = "dark" | "default";

type MermaidRenderLifecycle = {
  active: boolean;
};

const currentMermaidTheme = (): MermaidTheme =>
  typeof document !== "undefined" && document.documentElement.classList.contains("dark")
    ? "dark"
    : "default";

const subscribeMermaidTheme = (listener: () => void): (() => void) => {
  if (typeof document === "undefined") return () => {};
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributeFilter: ["class"], attributes: true });
  return () => observer.disconnect();
};

const renderMermaidChart = (
  id: string,
  chart: string,
  theme: MermaidTheme,
): Effect.Effect<RenderState> =>
  Effect.sync(() =>
    mermaid.initialize({
      securityLevel: "strict",
      startOnLoad: false,
      theme,
      themeVariables: {
        fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
      },
    }),
  ).pipe(
    Effect.flatMap(() =>
      Effect.tryPromise({
        try: () => mermaid.render(id, chart),
        catch: () => "mermaid-render-failed",
      }),
    ),
    Effect.match({
      onFailure: (): RenderState => ({
        status: "error",
        message: "Unable to render Mermaid diagram.",
      }),
      onSuccess: (result): RenderState => ({ status: "ready", svg: result.svg }),
    }),
  );


export function Mermaid({ chart, className }: MermaidProps) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const theme = useSyncExternalStore(
    subscribeMermaidTheme,
    currentMermaidTheme,
    (): MermaidTheme => "default",
  );
  const [state, setState] = useState<RenderState>({ status: "loading" });
  const renderTarget = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) return;
      const lifecycle: MermaidRenderLifecycle = { active: true };
      setState({ status: "loading" });
      void Effect.runPromise(renderMermaidChart(id, chart, theme)).then((next) => {
        if (lifecycle.active) setState(next);
      });
      return () => {
        lifecycle.active = false;
      };
    },
    [chart, id, theme],
  );

  return (
    <figure
      className={cn(
        "not-prose my-6 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
        className,
      )}
    >
      <div ref={renderTarget} className="overflow-x-auto p-4 md:p-6">
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
