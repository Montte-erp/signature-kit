"use client";

import { PenLine } from "lucide-react";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages";

// The signer imports pdf.js/pdf-lib browser-only code, so keep the island out of
// SSG prerender and show a static skeleton until the client chunk loads.
const PdfSignerIsland = dynamic(() => import("./pdf-signer").then((mod) => mod.PdfSigner), {
  ssr: false,
  loading: () => <PdfSignerSkeleton />,
});


const PdfSignerDialogIsland = dynamic(
  () => import("./pdf-signer").then((mod) => mod.PdfSignerDialog),
  {
    ssr: false,
    // Static stand-in so the CTA exists in the prerendered HTML (no CLS, crawlable)
    // while the heavy pdf-signer chunk loads.
    loading: () => (
      <PdfSignerDialogFallback>
        {m.signer_open()}
        <PenLine data-icon="inline-end" />
      </PdfSignerDialogFallback>
    ),
  },
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
  return <PdfSignerIsland {...props} />;
}


export function PdfSignerDialog({ children }: PdfSignerDialogProps) {
  return (
    <PdfSignerDialogIsland>
      {children}
    </PdfSignerDialogIsland>
  );
}

export function PdfSignerDialogFallback({ children }: PdfSignerDialogProps) {
  return (
    <Button size="lg" disabled>
      {children}
    </Button>
  );
}
