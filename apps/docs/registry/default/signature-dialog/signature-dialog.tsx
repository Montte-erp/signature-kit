"use client";

import type { A1SignerInput, A1SignerRow } from "@signature-kit/react/config";
import { useA1Signer } from "@signature-kit/react/a1";
import { usePdfObjectUrl } from "@signature-kit/react/browser-pdf";
import { cmsErrorMessages } from "@signature-kit/cms/config";
import { errorMessage } from "@signature-kit/i18n";
import {
  DEFAULT_PDF_ANCHOR_STAMP_SIZE,
  type PdfStampSize,
  type PdfTextAnchorMatcher,
  pdfErrorMessages,
  pdfTextAnchorMatchersFromProps,
} from "@signature-kit/pdf/config";
import { SignatureKitErrorCodeValue, signatureKitErrorMessages } from "@signature-kit/signatures";
import { CheckCircle2, Download, Loader2, PenLine } from "lucide-react";
import * as React from "react";
import { Effect } from "effect";
import { useForm, useSelector } from "@tanstack/react-form";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type SignatureDialogSignedRow = Extract<A1SignerRow, { readonly status: "signed" }>;

type SignatureDialogDocument = A1SignerInput["documents"][number];
export type SignatureDialogProps = {
  readonly pfx: Uint8Array;
  readonly buildDocuments: () =>
    | ReadonlyArray<SignatureDialogDocument>
    | Promise<ReadonlyArray<SignatureDialogDocument>>;
  readonly signing: A1SignerInput["signing"];
  readonly stamp?: A1SignerInput["stamp"];
  readonly anchorTokens?: ReadonlyArray<string>;
  readonly anchorDigits?: ReadonlyArray<string>;
  readonly anchorStampSize?: PdfStampSize;
  readonly onSigned: (rows: ReadonlyArray<SignatureDialogSignedRow>) => void | Promise<void>;
  readonly getSavedPassword?: () => string | null;
  readonly onSavePassword?: (password: string | null) => void | Promise<void>;
  readonly onWrongPassword?: () => void | Promise<void>;
  readonly locale?: "en-US" | "pt-BR";
  readonly title?: string;
  readonly description?: string;
  readonly triggerLabel?: string;
  readonly submitLabel?: string;
  readonly success?: (context: {
    readonly rows: ReadonlyArray<SignatureDialogSignedRow>;
    readonly firstPdfUrl: string | null;
  }) => React.ReactNode;
  readonly className?: string;
};

type SignatureDialogActionState =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "failed"; readonly error: unknown };

const catalogs = [pdfErrorMessages, cmsErrorMessages, signatureKitErrorMessages];
const emptyAnchorValues: ReadonlyArray<string> = [];

type SignatureDialogRun = {
  readonly id: number;
  readonly controller: AbortController;
};

type SignatureDialogExecution =
  | { readonly status: "cancelled" }
  | { readonly status: "needs-password" }
  | { readonly status: "completed" }
  | { readonly status: "failed"; readonly error: unknown };

const withAnchorFallback = (
  document: SignatureDialogDocument,
  matchers: ReadonlyArray<PdfTextAnchorMatcher>,
  stampSize: PdfStampSize,
): SignatureDialogDocument =>
  document.anchors !== undefined || matchers.length === 0
    ? document
    : { ...document, anchors: { matchers, stampSize } };

const isWrongPasswordRow = (row: A1SignerRow): boolean =>
  row.status === "failed" && row.error.code === SignatureKitErrorCodeValue.wrongPassword;

const signedRows = (rows: ReadonlyArray<A1SignerRow>): ReadonlyArray<SignatureDialogSignedRow> =>
  rows.filter((row): row is SignatureDialogSignedRow => row.status === "signed");

export function SignatureDialog({
  pfx,
  buildDocuments,
  signing,
  stamp,
  anchorTokens = emptyAnchorValues,
  anchorDigits = emptyAnchorValues,
  anchorStampSize,
  onSigned,
  getSavedPassword,
  onSavePassword,
  onWrongPassword,
  locale = "en-US",
  title = "Sign documents",
  description = "Sign selected PDFs locally with your A1 certificate. The password stays in this browser.",
  triggerLabel = "Sign with A1",
  submitLabel = "Sign now",
  success,
  className,
}: SignatureDialogProps) {
  const signer = useA1Signer();
  const clearSigner = signer.clear;
  const [open, setOpen] = React.useState(false);
  const [needsPassword, setNeedsPassword] = React.useState(false);
  const [actionState, setActionState] = React.useState<SignatureDialogActionState>({
    status: "idle",
  });
  const mounted = React.useRef(true);
  const nextRunId = React.useRef(0);
  const activeRun = React.useRef<SignatureDialogRun | null>(null);
  const lastSignedRows = signedRows(signer.rows);
  const firstPdfUrl = usePdfObjectUrl(lastSignedRows[0]?.signedPdf ?? null);
  const form = useForm({
    defaultValues: { password: "", rememberPassword: false },
  });
  const password = useSelector(form.store, (state) => state.values.password);
  const rememberPassword = useSelector(form.store, (state) => state.values.rememberPassword);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const run = activeRun.current;
      if (run !== null) {
        run.controller.abort();
        activeRun.current = null;
        clearSigner();
      }
    };
  }, [clearSigner]);

  const isOwner = (run: SignatureDialogRun): boolean =>
    mounted.current && activeRun.current === run && !run.controller.signal.aborted;

  const cancelRun = (): boolean => {
    const run = activeRun.current;
    if (run === null) return false;
    if (mounted.current) setActionState({ status: "idle" });
    run.controller.abort();
    activeRun.current = null;
    clearSigner();
    return true;
  };
  const formatRowError = (row: A1SignerRow): string =>
    row.status === "failed" ? errorMessage(row.error, { locale, catalogs }) : "";
  const signerError = signer.error === null ? "" : errorMessage(signer.error, { locale, catalogs });
  const actionError =
    actionState.status === "failed" ? errorMessage(actionState.error, { locale, catalogs }) : "";
  const dialogError = actionError.length > 0 ? actionError : signerError;
  const actionRunning = actionState.status === "running";
  const actionFailed = actionState.status === "failed";

  const run = (passwordToUse: string | undefined, passwordToSave: string | null | undefined) => {
    if (!cancelRun()) clearSigner();
    const currentRun: SignatureDialogRun = {
      id: nextRunId.current + 1,
      controller: new AbortController(),
    };
    nextRunId.current = currentRun.id;
    activeRun.current = currentRun;
    setActionState({ status: "running" });

    const program = Effect.result(
      Effect.tryPromise<SignatureDialogExecution, unknown>({
        try: async (signal) => {
          if (!isOwner(currentRun) || signal.aborted) return { status: "cancelled" };

          if (passwordToSave !== undefined) {
            await Promise.resolve(onSavePassword?.(passwordToSave));
            if (!isOwner(currentRun) || signal.aborted) return { status: "cancelled" };
          }

          const resolvedPassword = passwordToUse ?? getSavedPassword?.() ?? "";
          if (resolvedPassword.length === 0) {
            if (!isOwner(currentRun) || signal.aborted) return { status: "cancelled" };
            return { status: "needs-password" };
          }

          const matchers = pdfTextAnchorMatchersFromProps(anchorTokens, anchorDigits);
          const anchorSize = anchorStampSize ?? stamp?.stampSize ?? DEFAULT_PDF_ANCHOR_STAMP_SIZE;
          const documents = (await buildDocuments()).map((document) =>
            withAnchorFallback(document, matchers, anchorSize),
          );
          if (!isOwner(currentRun) || signal.aborted) return { status: "cancelled" };

          const result = await signer.sign({
            documents,
            credentials: { pfx, password: resolvedPassword },
            signing,
            ...(stamp === undefined ? {} : { stamp }),
          });
          if (!isOwner(currentRun) || signal.aborted) return { status: "cancelled" };

          if (!result.ok) {
            if (result.error.code !== SignatureKitErrorCodeValue.wrongPassword) {
              return { status: "completed" };
            }

            const outcomes = await Promise.allSettled([
              onWrongPassword?.(),
              onSavePassword?.(null),
            ]);
            if (!isOwner(currentRun) || signal.aborted) return { status: "cancelled" };
            const rejectedOutcome = outcomes.find(
              (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
            );
            return rejectedOutcome === undefined
              ? { status: "needs-password" }
              : { status: "failed", error: rejectedOutcome.reason };
          }

          if (result.rows.some(isWrongPasswordRow)) {
            const outcomes = await Promise.allSettled([
              onWrongPassword?.(),
              onSavePassword?.(null),
            ]);
            if (!isOwner(currentRun) || signal.aborted) return { status: "cancelled" };
            const rejectedOutcome = outcomes.find(
              (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
            );
            return rejectedOutcome === undefined
              ? { status: "needs-password" }
              : { status: "failed", error: rejectedOutcome.reason };
          }

          const signed = signedRows(result.rows);
          if (signed.length > 0) {
            if (!isOwner(currentRun) || signal.aborted) return { status: "cancelled" };
            await Promise.resolve(onSigned(signed));
            if (!isOwner(currentRun) || signal.aborted) return { status: "cancelled" };
          }
          return { status: "completed" };
        },
        catch: (error) => error,
      }),
    );

    void Effect.runPromise(Effect.exit(program), { signal: currentRun.controller.signal }).then(
      (exit) => {
        if (!isOwner(currentRun)) return;
        activeRun.current = null;
        if (exit._tag === "Failure") {
          setActionState({ status: "failed", error: exit.cause });
          return;
        }

        if (exit.value._tag === "Failure") {
          setActionState({ status: "failed", error: exit.value.failure });
          return;
        }

        if (exit.value.success.status === "needs-password") setNeedsPassword(true);
        if (exit.value.success.status === "failed") {
          setNeedsPassword(true);
          setActionState({ status: "failed", error: exit.value.success.error });
          return;
        }
        setActionState({ status: "idle" });
      },
      () => undefined,
    );
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) cancelRun();
    setOpen(nextOpen);
  };

  const start = () => {
    setNeedsPassword(false);
    run(undefined, undefined);
  };

  const submitPassword = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(password, rememberPassword ? password : null);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          className={cn("gap-2", className)}
          disabled={signer.busy || actionRunning}
          onClick={start}
        >
          <PenLine aria-hidden className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent data-slot="signature-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {dialogError.length > 0 ? (
          <p className="text-sm text-destructive" role="alert">
            {dialogError}
          </p>
        ) : null}

        {needsPassword ? (
          <form className="grid gap-4" onSubmit={submitPassword}>
            <input
              type="text"
              autoComplete="username"
              value=""
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
            />
            <form.Field name="password">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor="signature-dialog-password">Certificate password</Label>
                  <Input
                    id="signature-dialog-password"
                    type="password"
                    data-ph-no-autocapture
                    data-analytics-sensitive
                    autoComplete="current-password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="rememberPassword">
              {(field) => (
                <Label className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
                  <Checkbox
                    checked={field.state.value}
                    onCheckedChange={(checked) => field.handleChange(checked === true)}
                  />
                  Remember password in this app
                </Label>
              )}
            </form.Field>
            <Button type="submit" disabled={signer.busy || actionRunning || password.length === 0}>
              {signer.busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
              {submitLabel}
            </Button>
          </form>
        ) : null}

        <div data-slot="signature-dialog-progress" className="grid gap-2">
          {signer.rows.map((row) => (
            <div
              key={row.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                {row.status === "failed" ? (
                  <p className="mt-0.5 text-xs text-destructive">{formatRowError(row)}</p>
                ) : null}
              </div>
              <Badge variant={row.status === "failed" ? "outline" : "secondary"}>
                {row.status}
              </Badge>
            </div>
          ))}
        </div>

        {!actionRunning && !actionFailed && signer.error === null && lastSignedRows.length > 0 ? (
          <div data-slot="signature-dialog-success" className="rounded-md border border-border p-3">
            {success?.({ rows: lastSignedRows, firstPdfUrl }) ?? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <CheckCircle2 aria-hidden className="size-4 text-primary" />
                  {lastSignedRows.length} signed document(s)
                </div>
                {firstPdfUrl !== null ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={firstPdfUrl} download={lastSignedRows[0]?.name ?? "signed.pdf"}>
                      <Download aria-hidden className="size-4" />
                      Download first
                    </a>
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
