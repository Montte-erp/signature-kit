"use client";

import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { m } from "@/paraglide/messages";
import { captureDocsEvent } from "@/lib/posthog/client";
import { cn } from "@/lib/utils";

export interface ProviderCarouselItem {
  /** Display name, also the logo fallback initial. */
  readonly name: string;
  /** CodeBlock label shown in the panel header (e.g. "clicksign.ts"). */
  readonly filename: string;
  /** Pre-resolved (server-side) brand logo URL — a plain string. */
  readonly logo: string;
  /** Raw snippet copied to the clipboard for this provider. */
  readonly code: string;
}

interface ProviderCarouselProps {
  readonly items: ProviderCarouselItem[];
  /**
   * Parallel, index-matched, pre-highlighted shiki nodes built SERVER-side in
   * providers-showcase.tsx. The carousel only ever renders `panels[index]` —
   * it never calls CodeBlock / highlight itself (that is async-server work).
   */
  readonly panels: ReactNode[];
}

/**
 * A single brand logo, greyscaled to stay pure-monochrome. logo.dev (fallback=404)
 * and DuckDuckGo favicons can 404 — `onError` swaps to the provider initial so a
 * circle never renders a broken-image glyph.
 */
function ProviderLogo({ src, name }: { src: string; name: string }) {
  const [bad, setBad] = useState(false);

  if (bad) {
    return <span className="font-mono text-sm font-medium text-muted-foreground">{name[0]}</span>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      width={20}
      height={20}
      loading="lazy"
      onError={() => setBad(true)}
      className="size-5 rounded-[3px] object-contain grayscale"
    />
  );
}

/**
 * Client carousel for the providers showcase: a strip of circular brand logos
 * over a single code panel. Picking a provider (click or ArrowLeft/ArrowRight)
 * swaps which pre-highlighted `panels[index]` node is shown — no highlighting
 * happens here. Copy mirrors install-command.tsx (writeText + 1800ms reset).
 */
export function ProviderCarousel({ items, panels }: ProviderCarouselProps) {
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  const selectProvider = (nextIndex: number, method: string) => {
    const item = items[nextIndex];
    setIndex(nextIndex);
    captureDocsEvent("provider_showcase_selected", {
      method,
      provider: item?.name,
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectProvider((index + 1) % items.length, "keyboard_next");
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectProvider((index - 1 + items.length) % items.length, "keyboard_previous");
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(items[index].code);
      setCopied(true);
      captureDocsEvent("provider_snippet_copied", {
        filename: items[index].filename,
        provider: items[index].name,
      });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      captureDocsEvent("provider_snippet_copy_failed", {
        filename: items[index].filename,
        provider: items[index].name,
      });
    }
  };

  const active = items[index];

  return (
    <Card className="gap-0 overflow-hidden p-0">
      {/* Header strip: provider micro-label · current provider badge · hint */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border px-4 py-3">
        <span className="font-mono text-[10px] tracking-[0.11em] text-muted-foreground/70 uppercase">
          {m.showcase_card_provider()}
        </span>
        <Badge variant="outline" className="justify-self-center">
          {active.name}
        </Badge>
        <span className="hidden justify-self-end text-right font-mono text-[10px] tracking-[0.11em] text-muted-foreground/70 uppercase sm:inline">
          {m.showcase_card_hint()}
        </span>
      </div>

      {/* Carousel row: prev · logo rail (arrow-keyable) · next */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full"
          aria-label={m.showcase_prev()}
          onClick={() => selectProvider((index - 1 + items.length) % items.length, "previous")}
        >
          <ChevronLeft />
        </Button>

        <div
          role="group"
          aria-label={m.showcase_card_provider()}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="flex min-w-0 flex-1 items-center justify-center gap-2 overflow-x-auto rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {items.map((item, i) => (
            <Button
              key={item.filename}
              type="button"
              variant="outline"
              size="icon"
              aria-pressed={i === index}
              aria-label={item.name}
              onClick={() => selectProvider(i, "logo")}
              className={cn(
                "size-11 shrink-0 rounded-full bg-input/30",
                i === index
                  ? "border-foreground/70 ring-2 ring-foreground/20"
                  : "opacity-60 hover:opacity-100",
              )}
            >
              <ProviderLogo src={item.logo} name={item.name} />
            </Button>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full"
          aria-label={m.showcase_next()}
          onClick={() => selectProvider((index + 1) % items.length, "next")}
        >
          <ChevronRight />
        </Button>
      </div>

      {/* Code panel header: filename · copy */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
          {active.filename}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          aria-label={copied ? m.showcase_copied() : m.showcase_copy()}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check /> : <Copy />}
          {copied ? m.showcase_copied() : m.showcase_copy()}
        </Button>
      </div>

      {/* Code body: render ONLY the selected pre-highlighted panel. */}
      <div className="max-h-[22rem] min-w-0 overflow-auto px-1 py-1 text-[13px]">
        {panels[index]}
      </div>
    </Card>
  );
}
