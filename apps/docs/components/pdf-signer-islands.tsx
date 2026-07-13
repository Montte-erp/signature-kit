"use client";

import { PenLine } from "lucide-react";
import * as React from "react";
import type { ReactNode } from "react";

import { ClientOnly } from "@/components/client-only";

import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages";

const PdfSignerIsland = React.lazy(() =>
  import("./pdf-signer").then((mod) => ({ default: mod.PdfSigner })),
);

const PdfSignerDialogIsland = React.lazy(() =>
  import("./pdf-signer").then((mod) => ({ default: mod.PdfSignerDialog })),
);

type PdfSignerProps = {
  readonly className?: string;
  readonly inDialog?: boolean;
};

type PdfSignerDialogProps = {
  readonly children: ReactNode;
};

function PdfSignerSkeleton() {
  return (
    <div
      aria-hidden
      className="grid min-h-64 gap-4 rounded-xl border border-border bg-muted/30 p-4 md:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="animate-pulse rounded-lg bg-background/70" />
      <div className="flex flex-col gap-3">
        <div className="h-9 animate-pulse rounded-md bg-background/70" />
        <div className="h-9 animate-pulse rounded-md bg-background/70" />
        <div className="h-20 animate-pulse rounded-md bg-background/70" />
      </div>
    </div>
  );
}

export function PdfSigner(props: PdfSignerProps) {
  return (
    <ClientOnly fallback={<PdfSignerSkeleton />}>
      <React.Suspense fallback={<PdfSignerSkeleton />}>
        <PdfSignerIsland {...props} />
      </React.Suspense>
    </ClientOnly>
  );
}

export function PdfSignerDialog({ children }: PdfSignerDialogProps) {
  return (
    <ClientOnly fallback={<PdfSignerDialogLoading />}>
      <React.Suspense fallback={<PdfSignerDialogLoading />}>
        <PdfSignerDialogIsland>{children}</PdfSignerDialogIsland>
      </React.Suspense>
    </ClientOnly>
  );
}

function PdfSignerDialogLoading() {
  return (
    <PdfSignerDialogFallback>
      {m.signer_open()}
      <PenLine data-icon="inline-end" />
    </PdfSignerDialogFallback>
  );
}

export function PdfSignerDialogFallback({ children }: PdfSignerDialogProps) {
  return (
    <Button size="lg" disabled>
      {children}
    </Button>
  );
}
