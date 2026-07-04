"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type SigningProgressRow = {
  readonly id: string;
  readonly name: string;
  readonly status: "pending" | "signing" | "signed" | "failed";
  readonly error?: unknown;
};

export type SigningProgressListProps = {
  readonly rows: ReadonlyArray<SigningProgressRow>;
  readonly formatError?: (error: unknown) => string;
  readonly emptyLabel?: string;
  readonly className?: string;
};

const statusLabel = (status: SigningProgressRow["status"]): string => {
  if (status === "pending") return "Pending";
  if (status === "signing") return "Signing";
  if (status === "signed") return "Signed";
  return "Failed";
};

const statusVariant = (status: SigningProgressRow["status"]): "secondary" | "outline" =>
  status === "signed" || status === "signing" ? "secondary" : "outline";

export function SigningProgressList({
  rows,
  formatError,
  emptyLabel = "No documents queued yet.",
  className,
}: SigningProgressListProps) {
  return (
    <div data-slot="signing-progress-list" className={cn("flex flex-col gap-2", className)}>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          {emptyLabel}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li
              key={row.id}
              data-slot="signing-progress-row"
              data-status={row.status}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-card-foreground">{row.name}</p>
                {row.status === "failed" && row.error !== undefined ? (
                  <p className="mt-0.5 line-clamp-2 text-xs text-destructive">
                    {formatError?.(row.error) ?? "Could not sign this document."}
                  </p>
                ) : null}
              </div>
              <Badge variant={statusVariant(row.status)} className="shrink-0 gap-1.5">
                {row.status === "signing" ? (
                  <Loader2 aria-hidden className="size-3 animate-spin" />
                ) : row.status === "signed" ? (
                  <CheckCircle2 aria-hidden className="size-3" />
                ) : row.status === "failed" ? (
                  <XCircle aria-hidden className="size-3" />
                ) : null}
                {statusLabel(row.status)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
