"use client";

import { Effect, Redacted } from "effect";
import type { ChangeEvent } from "react";
import { useForm } from "@tanstack/react-form";
import { Store, useStore } from "@tanstack/react-store";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import {
  createBrowserPdfSignatureBuilderState,
  readBrowserFileBytes,
  signBrowserPdf,
} from "@signature-kit/react/browser-pdf";
import {
  SignatureBuilderSurface,
  createSignatureBuilderStore,
  type SignatureBuilderStore,
} from "@signature-kit/react/components";
import type {
  ReactSignatureFieldDraft,
  ReactSignatureFieldPlacement,
  ReactSignerRole,
} from "@signature-kit/react/config";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SIGNATURE_FIELD_ID = "a1-signature";

const SIGNER_ROLE: ReactSignerRole = {
  id: "signer",
  label: "A1 signer",
  required: true,
};

const SIGNATURE_DRAFT: ReactSignatureFieldDraft = {
  id: SIGNATURE_FIELD_ID,
  type: "signature",
  roleId: SIGNER_ROLE.id,
  width: 168,
  height: 48,
  label: "A1 signature",
  required: true,
};

type MessageState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "error"; readonly message: string };

type A1BrowserSigningFormValues = {
  readonly password: string;
};

type A1BrowserSigningState = {
  readonly store?: SignatureBuilderStore;
  readonly pdfBytes?: Uint8Array;
  readonly pdfName?: string;
  readonly pfxBytes?: Uint8Array;
  readonly pfxName?: string;
  readonly status: MessageState;
  readonly signedPdf?: Uint8Array;
};

const signerState = new Store<A1BrowserSigningState>({
  status: { kind: "idle" },
});

const patchSignerState = (patch: Partial<A1BrowserSigningState>): void => {
  signerState.setState((state) => ({ ...state, ...patch }));
};

const errorMessage = (error: unknown, fallback: string): string => {
  const message =
    typeof error === "object" && error !== null
      ? Reflect.get(error, "message")
      : undefined;
  return typeof message === "string" ? message : fallback;
};

const downloadBytes = (bytes: Uint8Array, name: string): void => {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name.replace(/\.pdf$/i, "") + "-signed.pdf";
  anchor.click();
  URL.revokeObjectURL(url);
};

export function A1BrowserSigningBlock() {
  const form = useForm<A1BrowserSigningFormValues>({
    defaultValues: { password: "" },
  });

  const store = useStore(signerState, (state) => state.store);
  const pdfBytes = useStore(signerState, (state) => state.pdfBytes);
  const pdfName = useStore(signerState, (state) => state.pdfName);
  const pfxBytes = useStore(signerState, (state) => state.pfxBytes);
  const pfxName = useStore(signerState, (state) => state.pfxName);
  const status = useStore(signerState, (state) => state.status);
  const signedPdf = useStore(signerState, (state) => state.signedPdf);
  const password = form.useStore((state) => state.values.password);

  const setError = (error: unknown): void => {
    patchSignerState({
      status: {
        kind: "error",
        message: errorMessage(error, "Operation failed."),
      },
    });
  };

  const loadPdf = (file: File): void => {
    patchSignerState({
      status: { kind: "busy" },
      store: undefined,
      pdfBytes: undefined,
      pdfName: undefined,
      pfxBytes: undefined,
      pfxName: undefined,
      signedPdf: undefined,
    });

    Effect.runPromise(
      Effect.gen(function* () {
        const bytes = yield* readBrowserFileBytes(file);
        const state = yield* createBrowserPdfSignatureBuilderState({
          id: "a1-browser-signing",
          name: file.name,
          documentId: "document",
          documentName: file.name,
          pdf: bytes,
          role: SIGNER_ROLE,
          draft: SIGNATURE_DRAFT,
        });
        return { bytes, state };
      }),
    )
      .then(({ bytes, state }) => {
        patchSignerState({
          pdfBytes: bytes,
          pdfName: file.name,
          store: createSignatureBuilderStore(state),
          status: { kind: "idle" },
        });
      })
      .catch(setError);
  };

  const loadPfx = (file: File): void => {
    patchSignerState({ status: { kind: "busy" } });
    Effect.runPromise(readBrowserFileBytes(file))
      .then((nextPfxBytes) => {
        patchSignerState({
          pfxBytes: nextPfxBytes,
          pfxName: file.name,
          status: { kind: "idle" },
          signedPdf: undefined,
        });
      })
      .catch(setError);
  };

  const onPdfSelected = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (file !== undefined) {
      loadPdf(file);
    }
  };

  const onPfxSelected = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (file !== undefined) {
      loadPfx(file);
    }
  };

  const onFieldPlacement = (placement: ReactSignatureFieldPlacement): void => {
    if (store === undefined) {
      return;
    }

    patchSignerState({ status: { kind: "busy" }, signedPdf: undefined });
    Effect.runPromise(store.placeField(placement))
      .then(() => patchSignerState({ status: { kind: "idle" } }))
      .catch(setError);
  };

  const hasField =
    store?.getSnapshot().template.fields.some((field) => field.id === SIGNATURE_FIELD_ID) ??
    false;

  const onSign = (): void => {
    if (
      store === undefined ||
      pdfBytes === undefined ||
      pfxBytes === undefined ||
      password.length === 0
    ) {
      patchSignerState({
        status: {
          kind: "error",
          message: "Load a PDF, upload the PKCS#12 file, and enter the password.",
        },
      });
      return;
    }

    if (!hasField) {
      patchSignerState({
        status: {
          kind: "error",
          message: "Place the signature field on the document first.",
        },
      });
      return;
    }

    patchSignerState({ status: { kind: "busy" }, signedPdf: undefined });

    Effect.runPromise(
      signBrowserPdf({
        pdf: pdfBytes,
        template: store.getSnapshot().template,
        fieldId: SIGNATURE_FIELD_ID,
        reason: "Signed locally with A1",
        signatureLength: 16384,
        policy: "pades-ades",
      }).pipe(
        Effect.provide(
          a1SignaturesLayer({
            pfx: pfxBytes,
            password: Redacted.make(password),
          }),
        ),
      ),
    )
      .then((nextSignedPdf) => {
        patchSignerState({
          signedPdf: nextSignedPdf,
          status: { kind: "idle" },
        });
      })
      .catch(setError);
  };

  return (
    <form.Provider>
      <section className="w-full space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Label className="flex flex-col gap-2 text-sm">
            <span>PDF</span>
            <Input type="file" accept=".pdf" onChange={onPdfSelected} />
          </Label>
          <Label className="flex flex-col gap-2 text-sm">
            <span>A1 certificate (.pfx/.p12)</span>
            <Input type="file" accept=".p12,.pfx" onChange={onPfxSelected} />
          </Label>
        </div>

        <form.Field
          name="password"
          children={(field) => (
            <Label className="flex flex-col gap-2 text-sm">
              <span>Certificate password</span>
              <Input
                type="password"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Secret"
              />
            </Label>
          )}
        />

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {pdfName === undefined
              ? "Upload a PDF to enable placement."
              : `${pdfName} loaded${pfxName === undefined ? " • upload an A1 certificate" : ""}`}
          </p>
          {store === undefined ? (
            <p className="rounded border border-dashed border-input bg-muted/30 p-4 text-sm text-muted-foreground">
              No PDF loaded yet.
            </p>
          ) : (
            <SignatureBuilderSurface
              store={store}
              onFieldPlacement={onFieldPlacement}
              className="rounded border border-input bg-background p-3"
            />
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={onSign}
            disabled={
              status.kind === "busy" ||
              store === undefined ||
              pfxBytes === undefined ||
              password.length === 0
            }
          >
            {status.kind === "busy" ? "Signing..." : "Sign PDF in browser"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={signedPdf === undefined}
            onClick={() => {
              if (signedPdf !== undefined) {
                downloadBytes(signedPdf, pdfName ?? "document.pdf");
              }
            }}
          >
            Download signed PDF
          </Button>
        </div>

        {status.kind === "error" ? (
          <p className="text-sm text-red-600">{status.message}</p>
        ) : null}
      </section>
    </form.Provider>
  );
}
