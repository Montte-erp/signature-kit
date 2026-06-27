"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

const PdfSignerIsland = dynamic(() => import("./pdf-signer").then((mod) => mod.PdfSigner), {
  ssr: false,
  loading: () => <PdfSignerSkeleton />,
});


const PdfSignerDialogIsland = dynamic(
  () => import("./pdf-signer").then((mod) => mod.PdfSignerDialog),
  { ssr: false },
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
