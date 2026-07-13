"use client";

import mermaid from "mermaid";

type MermaidTheme = "dark" | "default";

type MermaidRenderResult = {
  readonly svg: string;
};

export const renderMermaidChart = async (
  id: string,
  chart: string,
  theme: MermaidTheme,
): Promise<MermaidRenderResult> => {
  mermaid.initialize({
    securityLevel: "strict",
    startOnLoad: false,
    theme,
    themeVariables: {
      fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
    },
  });

  return mermaid.render(id, chart);
};
