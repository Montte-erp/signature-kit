"use client";

import { Loader2 } from "lucide-react";
import * as React from "react";
import { useForm } from "@tanstack/react-form";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type SignatureCertificateConfirmPayload = {
  readonly password: string;
  readonly rememberPassword: boolean;
};

export type SignatureCertificateFormProps = {
  readonly onConfirm: (payload: SignatureCertificateConfirmPayload) => void | Promise<void>;
  readonly getSavedPassword?: () => string | null;
  readonly onSavePassword?: (password: string | null) => void;
  readonly defaultRemember?: boolean;
  readonly submitLabel?: string;
  readonly passwordLabel?: string;
  readonly rememberLabel?: string;
  readonly isSubmitting?: boolean;
  readonly className?: string;
};

type SignatureCertificateFormValues = {
  readonly password: string;
  readonly rememberPassword: boolean;
};

export function SignatureCertificateForm({
  onConfirm,
  getSavedPassword,
  onSavePassword,
  defaultRemember = false,
  submitLabel = "Confirm certificate",
  passwordLabel = "Certificate password",
  rememberLabel = "Remember password in this app",
  isSubmitting = false,
  className,
}: SignatureCertificateFormProps) {
  const savedPassword = getSavedPassword?.() ?? "";
  const form = useForm<SignatureCertificateFormValues>({
    defaultValues: {
      password: savedPassword,
      rememberPassword: defaultRemember || savedPassword.length > 0,
    },
  });
  const password = form.useStore((state) => state.values.password);
  const rememberPassword = form.useStore((state) => state.values.rememberPassword);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (rememberPassword) onSavePassword?.(password);
    if (!rememberPassword) onSavePassword?.(null);
    void onConfirm({ password, rememberPassword });
  };

  return (
    <form
      data-slot="signature-certificate-form"
      className={cn("flex flex-col gap-4", className)}
      onSubmit={submit}
    >
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
          <div className="grid gap-2" data-slot="certificate-password-field">
            <Label htmlFor="signature-certificate-password">{passwordLabel}</Label>
            <Input
              id="signature-certificate-password"
              type="password"
              data-ph-no-autocapture
              data-analytics-sensitive
              autoComplete="current-password"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              disabled={isSubmitting}
            />
          </div>
        )}
      </form.Field>
      <form.Field name="rememberPassword">
        {(field) => (
          <Label
            htmlFor="signature-certificate-remember"
            className="flex items-center gap-2 text-sm font-normal text-muted-foreground"
          >
            <Checkbox
              id="signature-certificate-remember"
              checked={field.state.value}
              onCheckedChange={(checked) => field.handleChange(checked === true)}
              disabled={isSubmitting}
            />
            {rememberLabel}
          </Label>
        )}
      </form.Field>
      <Button type="submit" disabled={isSubmitting || password.length === 0} className="w-full">
        {isSubmitting ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
        {submitLabel}
      </Button>
    </form>
  );
}
