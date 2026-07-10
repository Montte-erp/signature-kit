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
import { useForm } from "@tanstack/react-form";

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

type SignatureDialogFormValues = {
  readonly password: string;
  readonly rememberPassword: boolean;
};

type SignatureDialogActionState =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "failed"; readonly error: unknown };

const catalogs = [pdfErrorMessages, cmsErrorMessages, signatureKitErrorMessages];
const emptyAnchorValues: ReadonlyArray<string> = [];

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
  const [open, setOpen] = React.useState(false);
  const [needsPassword, setNeedsPassword] = React.useState(false);
  const [actionState, setActionState] = React.useState<SignatureDialogActionState>({
    status: "idle",
  });
  const lastSignedRows = signedRows(signer.rows);
  const firstPdfUrl = usePdfObjectUrl(lastSignedRows[0]?.signedPdf ?? null);
  const form = useForm<SignatureDialogFormValues>({
    defaultValues: { password: "", rememberPassword: false },
  });
  const password = form.useStore((state) => state.values.password);
  const rememberPassword = form.useStore((state) => state.values.rememberPassword);

  const formatRowError = (row: A1SignerRow): string =>
    row.status === "failed" ? errorMessage(row.error, { locale, catalogs }) : "";
  const signerError = signer.error === null ? "" : errorMessage(signer.error, { locale, catalogs });
  const actionError =
    actionState.status === "failed" ? errorMessage(actionState.error, { locale, catalogs }) : "";
  const dialogError = actionError.length > 0 ? actionError : signerError;
  const actionRunning = actionState.status === "running";
  const actionFailed = actionState.status === "failed";

  const recoverFromWrongPassword = async () => {
    setNeedsPassword(true);
    const outcomes = await Promise.allSettled([onWrongPassword?.(), onSavePassword?.(null)]);
    const rejectedOutcome = outcomes.find((outcome) => outcome.status === "rejected");
    if (rejectedOutcome?.status === "rejected") throw rejectedOutcome.reason;
  };

  const run = async (
    passwordToUse: string | undefined,
    passwordToSave: string | null | undefined,
  ) => {
    setActionState({ status: "running" });

    try {
      if (passwordToSave !== undefined) await onSavePassword?.(passwordToSave);

      const resolvedPassword = passwordToUse ?? getSavedPassword?.() ?? "";
      if (resolvedPassword.length === 0) {
        setNeedsPassword(true);
        setActionState({ status: "idle" });
        return;
      }

      const matchers = pdfTextAnchorMatchersFromProps(anchorTokens, anchorDigits);
      const anchorSize = anchorStampSize ?? stamp?.stampSize ?? DEFAULT_PDF_ANCHOR_STAMP_SIZE;
      const documents = (await buildDocuments()).map((document) =>
        withAnchorFallback(document, matchers, anchorSize),
      );
      const result = await signer.sign({
        documents,
        credentials: { pfx, password: resolvedPassword },
        signing,
        ...(stamp === undefined ? {} : { stamp }),
      });
      if (!result.ok) {
        if (result.error.code === SignatureKitErrorCodeValue.wrongPassword) {
          await recoverFromWrongPassword();
        }
        setActionState({ status: "idle" });
        return;
      }

      if (result.rows.some(isWrongPasswordRow)) {
        await recoverFromWrongPassword();
        setActionState({ status: "idle" });
        return;
      }

      const signed = signedRows(result.rows);
      if (signed.length > 0) await onSigned(signed);
      setActionState({ status: "idle" });
    } catch (error) {
      setActionState({ status: "failed", error });
    }
  };

  const start = () => {
    setNeedsPassword(false);
    void run(undefined, undefined);
  };

  const submitPassword = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(password, rememberPassword ? password : null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <form.Provider>
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
              <Button
                type="submit"
                disabled={signer.busy || actionRunning || password.length === 0}
              >
                {signer.busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
                {submitLabel}
              </Button>
            </form>
          </form.Provider>
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
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
