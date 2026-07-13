"use client";

import type { A1CertificateProfile } from "@signature-kit/a1/config";
import { useA1Certificate } from "@signature-kit/react/a1";
import { Loader2, UploadCloud } from "lucide-react";
import * as React from "react";
import { useForm, useSelector } from "@tanstack/react-form";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type CertificateUploadFormProps = {
  readonly onUpload: (profile: A1CertificateProfile, file: File) => void | Promise<void>;
  readonly submitLabel?: string;
  readonly fileLabel?: string;
  readonly passwordLabel?: string;
  readonly className?: string;
};

type CertificateUploadFormValues = {
  readonly file: File | null;
  readonly password: string;
};

const certificateUploadFormDefaults: CertificateUploadFormValues = {
  file: null,
  password: "",
};

const formatDate = (date: Date): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);

export function CertificateUploadForm({
  onUpload,
  submitLabel = "Validate certificate",
  fileLabel = "A1 certificate (.pfx or .p12)",
  passwordLabel = "Certificate password",
  className,
}: CertificateUploadFormProps) {
  const certificate = useA1Certificate();
  const form = useForm({ defaultValues: certificateUploadFormDefaults });
  const file = useSelector(form.store, (state) => state.values.file);
  const password = useSelector(form.store, (state) => state.values.password);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (file === null || password.length === 0) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await certificate.load(bytes, password);
    if (result.ok) void onUpload(result.profile, file);
  };

  return (
    <form
      data-slot="certificate-upload-form"
      className={cn("flex flex-col gap-4", className)}
      onSubmit={submit}
    >
      <form.Field name="file">
        {(field) => (
          <div className="grid gap-2" data-slot="certificate-file-field">
            <Label htmlFor="certificate-upload-file">{fileLabel}</Label>
            <Button
              asChild
              variant="outline"
              className="h-auto justify-start gap-3 border-dashed px-3 py-3 font-normal"
            >
              <Label htmlFor="certificate-upload-file" className="min-w-0 cursor-pointer">
                <UploadCloud aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {field.state.value?.name ?? "Choose a .pfx or .p12 file"}
                </span>
              </Label>
            </Button>
            <Input
              id="certificate-upload-file"
              type="file"
              accept=".pfx,.p12,application/x-pkcs12"
              className="sr-only"
              onChange={(event) => field.handleChange(event.currentTarget.files?.item(0) ?? null)}
            />
          </div>
        )}
      </form.Field>
      <form.Field name="password">
        {(field) => (
          <div className="grid gap-2" data-slot="certificate-upload-password-field">
            <Label htmlFor="certificate-upload-password">{passwordLabel}</Label>
            <Input
              id="certificate-upload-password"
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
      {certificate.error !== null ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {certificate.error.message}
        </p>
      ) : null}
      {certificate.profile !== null ? (
        <Card data-slot="certificate-profile-preview" className="grid gap-3 p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-card-foreground">
                {certificate.profile.subject}
              </p>
              <p className="truncate text-muted-foreground">{certificate.profile.issuer}</p>
            </div>
            <Badge variant="secondary" className="shrink-0">
              Ready
            </Badge>
          </div>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">CPF/CNPJ</dt>
              <dd className="font-mono text-xs text-foreground">{certificate.profile.document}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Valid until</dt>
              <dd className="text-foreground">{formatDate(certificate.profile.validTo)}</dd>
            </div>
          </dl>
        </Card>
      ) : null}
      <Button
        type="submit"
        disabled={certificate.status === "loading" || file === null || password.length === 0}
      >
        {certificate.status === "loading" ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : null}
        {submitLabel}
      </Button>
    </form>
  );
}
