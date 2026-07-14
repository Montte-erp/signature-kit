"use client";

import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Effect, Result } from "effect";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "fumadocs-ui/components/tabs.unstyled";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Locale } from "@/lib/locale";
import { m } from "@/lib/client-messages";
import { captureDocsEvent } from "@/lib/posthog/client";
import { cn } from "@/lib/utils";

export type ProviderCarouselItem = {
  readonly name: string;
  readonly filename: string;
  readonly logo: string;
  readonly code: string;
};

type ProviderCarouselProps = {
  readonly items: ProviderCarouselItem[];
  readonly panels: ReactNode[];
  readonly locale: Locale;
};

const providerIdPart = (filename: string, index: number): string =>
  `${filename.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`;

function ProviderLogo({ src, name }: { src: string; name: string }) {
  const [bad, setBad] = useState(false);

  if (bad) {
    return <span className="font-mono text-sm font-medium text-muted-foreground">{name[0]}</span>;
  }

  return (
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

export function ProviderCarousel({ items, panels, locale }: ProviderCarouselProps) {
  const [index, setIndex] = useState(0);
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

  const values = items.map((item, itemIndex) => `${item.filename}-${itemIndex}`);
  const panelIds = items.map(
    (item, itemIndex) => `provider-panel-${providerIdPart(item.filename, itemIndex)}`,
  );
  const tabIds = items.map(
    (item, itemIndex) => `provider-tab-${providerIdPart(item.filename, itemIndex)}`,
  );

  const selectProvider = (nextIndex: number, method: string) => {
    const item = items[nextIndex];
    setIndex(nextIndex);
    captureDocsEvent("provider_showcase_selected", {
      method,
      provider: item?.name,
    });
  };

  const handleCopy = async () => {
    const copiedToClipboard = await Effect.runPromise(
      Effect.result(
        Effect.tryPromise({
          try: () => navigator.clipboard.writeText(items[index].code),
          catch: () => "clipboard-copy-failed",
        }),
      ),
    );
    if (Result.isSuccess(copiedToClipboard)) {
      if (!mountedRef.current) return;
      setCopied(true);
      captureDocsEvent("provider_snippet_copied", {
        filename: items[index].filename,
        provider: items[index].name,
      });
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        if (mountedRef.current) setCopied(false);
      }, 1800);
    } else {
      captureDocsEvent("provider_snippet_copy_failed", {
        filename: items[index].filename,
        provider: items[index].name,
      });
    }
  };

  const active = items[index];

  return (
    <Tabs
      value={values[index]}
      onValueChange={(value) => {
        const nextIndex = values.indexOf(value);
        if (nextIndex >= 0) selectProvider(nextIndex, "tab");
      }}
      className="min-w-0"
    >
      <Card className="min-w-0 gap-0 overflow-hidden p-0">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-border px-4 py-3">
          <span className="font-mono text-[10px] tracking-[0.11em] text-foreground uppercase">
            {m.showcase_card_provider({}, { locale })}
          </span>
          <Badge variant="outline" className="justify-self-center">
            {active.name}
          </Badge>
          <span className="hidden justify-self-end text-right font-mono text-[10px] tracking-[0.11em] text-foreground uppercase sm:inline">
            {m.showcase_card_hint({}, { locale })}
          </span>
        </div>

        <div className="flex items-center gap-3 border-b border-border px-4 py-4">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0 rounded-full"
            aria-label={m.showcase_prev({}, { locale })}
            onClick={() => selectProvider((index - 1 + items.length) % items.length, "previous")}
          >
            <ChevronLeft />
          </Button>

          <TabsList
            aria-label={m.showcase_card_provider({}, { locale })}
            className="flex min-w-0 flex-1 items-center justify-center gap-2 overflow-x-auto rounded-full outline-none"
          >
            {items.map((item, itemIndex) => (
              <TabsTrigger
                key={item.filename}
                value={values[itemIndex]}
                id={tabIds[itemIndex]}
                aria-controls={panelIds[itemIndex]}
                aria-label={item.name}
                className={cn(
                  "size-11 shrink-0 rounded-full border bg-input/30 p-0 focus-visible:outline-3 focus-visible:outline-ring focus-visible:outline-offset-2",
                  itemIndex === index
                    ? "border-foreground/70 ring-2 ring-foreground/20"
                    : "opacity-60 hover:opacity-100",
                )}
              >
                <ProviderLogo src={item.logo} name={item.name} />
              </TabsTrigger>
            ))}
          </TabsList>

          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0 rounded-full"
            aria-label={m.showcase_next({}, { locale })}
            onClick={() => selectProvider((index + 1) % items.length, "next")}
          >
            <ChevronRight />
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {active.filename}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            aria-label={
              copied ? m.showcase_copied({}, { locale }) : m.showcase_copy({}, { locale })
            }
            className="min-h-11 min-w-11 shrink-0 text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check /> : <Copy />}
            {copied ? m.showcase_copied({}, { locale }) : m.showcase_copy({}, { locale })}
          </Button>
        </div>

        <div className="max-h-[22rem] min-w-0 overflow-auto px-1 py-1 text-[13px]">
          {items.map((item, itemIndex) => (
            <TabsContent
              key={item.filename}
              value={values[itemIndex]}
              forceMount
              id={panelIds[itemIndex]}
              aria-labelledby={tabIds[itemIndex]}
              className="m-0 min-w-0 p-0"
            >
              {panels[itemIndex]}
            </TabsContent>
          ))}
        </div>
      </Card>
    </Tabs>
  );
}
