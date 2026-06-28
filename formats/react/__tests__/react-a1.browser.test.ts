import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { a1SignaturesLayer, parseA1CertificateProfile } from "@signature-kit/a1/signer";
import { signBrowserPdf } from "@signature-kit/react/browser-pdf";
import {
  addReactSignatureField,
  createReactSignatureTemplate,
  fieldFromPlacement,
} from "@signature-kit/react/builder";
import {
  createSignatureBuilderStore,
  SignatureBuilderSurface,
  signatureBuilderSelectors,
  useSignatureBuilderSelector,
  useSignatureBuilderFieldsForPage,
} from "@signature-kit/react/components";
import type { ReactSignatureFieldPlacement } from "@signature-kit/react/config";
import { Effect, Redacted } from "effect";
import * as React from "react";
import { createRoot } from "react-dom/client";

const PASSWORD = Redacted.make("changeit");
const latin1 = new TextDecoder("latin1");

const nextAnimationFrame: Effect.Effect<void> = Effect.promise(() => {
  const { promise, resolve } = Promise.withResolvers<void>();
  window.requestAnimationFrame(() => resolve());
  return promise;
});

const findBuilderPage = (
  container: HTMLElement,
  remainingAttempts: number,
): Effect.Effect<Element | null> =>
  Effect.gen(function* () {
    const page = container.querySelector('[role="group"]');
    if (page !== null || remainingAttempts <= 0) return page;
    yield* nextAnimationFrame;
    return yield* findBuilderPage(container, remainingAttempts - 1);
  });

const readA1FixtureFromBrowser = (name: "ecpf" | "ecnpj"): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const fixtureUrl = new URL(
      `../../../signers/a1/__tests__/fixtures/${name}.p12`,
      import.meta.url,
    );
    const response = await fetch(fixtureUrl);
    expect(response.ok).toBe(true);
    return new Uint8Array(await response.arrayBuffer());
  });

const createPdf: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 180]);
  page.drawText("SignatureKit React browser signing", { x: 32, y: 118, size: 14 });
  return pdf.save({ useObjectStreams: false });
});

const createTemplate = () =>
  createReactSignatureTemplate({
    id: "browser-template",
    name: "Browser A1 template",
    documents: [
      {
        id: "uploaded",
        name: "uploaded.pdf",
        source: { type: "uploaded" },
        pages: [{ index: 0, width: 320, height: 180, label: "Página 1" }],
      },
    ],
    roles: [{ id: "signer-1", label: "Cliente", email: "ana@example.com", required: true }],
  });

if (typeof document === "undefined") {
  describe.skip("React browser signing package", () => {
    it("runs only through `bun run test:integration:browser`", () => {});
  });
} else {
  describe("React browser signing package", () => {
    it("mounts the React builder surface and emits typed placement", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const template = yield* createTemplate();
          const container = document.createElement("div");
          container.style.width = "320px";
          document.body.append(container);
          const placementRef: { current: ReactSignatureFieldPlacement | undefined } = {
            current: undefined,
          };
          const root = createRoot(container);
          const store = createSignatureBuilderStore({
            template,
            draft: {
              id: "signature-1",
              type: "signature",
              roleId: "signer-1",
              width: 120,
              height: 32,
              label: "Assinatura A1",
              required: true,
            },
          });
          root.render(
            React.createElement(SignatureBuilderSurface, {
              store,
              onFieldPlacement: (next) => {
                placementRef.current = next;
              },
            }),
          );

          const page = yield* findBuilderPage(container, 10);
          expect(page).not.toBeNull();
          if (page === null) {
            root.unmount();
            container.remove();
            return;
          }

          const bounds = page.getBoundingClientRect();
          page.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              clientX: bounds.left + 40,
              clientY: bounds.top + 110,
            }),
          );

          expect(placementRef.current).toBeDefined();
          const placement = placementRef.current;
          if (placement === undefined) {
            root.unmount();
            container.remove();
            return;
          }
          expect(placement.documentId).toBe("uploaded");
          expect(placement.pageIndex).toBe(0);
          expect(placement.x).toBeGreaterThan(39);
          expect(placement.x).toBeLessThan(41);
          expect(placement.y).toBeGreaterThan(108);
          expect(placement.y).toBeLessThan(111);
          expect(placement.anchor).toBe("center");
          root.unmount();
          container.remove();
        }),
      ));

    it("subscribes React components to selected builder state slices", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const template = yield* createTemplate();
          const field = yield* fieldFromPlacement({
            documentId: "uploaded",
            pageIndex: 0,
            x: 40,
            y: 110,
            draft: {
              id: "signature-1",
              type: "signature",
              roleId: "signer-1",
              width: 120,
              height: 32,
            },
          });
          const withField = yield* addReactSignatureField(template, field);
          const store = createSignatureBuilderStore({ template: withField });
          const container = document.createElement("div");
          document.body.append(container);
          const root = createRoot(container);
          const renderCounts = { role: 0, selected: 0, fields: 0 };

          const RoleProbe = (): React.ReactElement | null => {
            useSignatureBuilderSelector(store, signatureBuilderSelectors.roles);
            renderCounts.role += 1;
            return null;
          };
          const SelectedProbe = (): React.ReactElement | null => {
            useSignatureBuilderSelector(store, signatureBuilderSelectors.selectedFieldId);
            renderCounts.selected += 1;
            return null;
          };
          const FieldsProbe = (): React.ReactElement | null => {
            useSignatureBuilderFieldsForPage(store, "uploaded", 0);
            renderCounts.fields += 1;
            return null;
          };

          root.render(
            React.createElement(
              React.Fragment,
              null,
              React.createElement(RoleProbe),
              React.createElement(SelectedProbe),
              React.createElement(FieldsProbe),
            ),
          );
          yield* nextAnimationFrame;

          store.selectField("signature-1");
          yield* nextAnimationFrame;

          store.setDraft({
            id: "signature-2",
            type: "signature",
            roleId: "signer-1",
            width: 120,
            height: 32,
          });
          yield* nextAnimationFrame;

          expect(renderCounts.role).toBe(1);
          expect(renderCounts.selected).toBe(2);
          expect(renderCounts.fields).toBe(1);
          root.unmount();
          container.remove();
        }),
      ));

    it("loads an A1 certificate and signs a PDF in Chromium", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const pfx = yield* readA1FixtureFromBrowser("ecpf");
          const pdf = yield* createPdf;
          const profile = yield* parseA1CertificateProfile({ pfx, password: PASSWORD });
          const template = yield* createTemplate();
          const field = yield* fieldFromPlacement({
            documentId: "uploaded",
            pageIndex: 0,
            x: 40,
            y: 110,
            draft: {
              id: "signature-1",
              type: "signature",
              roleId: "signer-1",
              width: 120,
              height: 32,
              label: "Assinatura A1",
              required: true,
            },
          });
          const withField = yield* addReactSignatureField(template, field);
          const signed = yield* signBrowserPdf({
            pdf,
            template: withField,
            fieldId: "signature-1",
            reason: "Chromium browser A1 test",
            name: "Pessoa CPF:12345678901",
            location: "BR",
            signatureLength: 16384,
          }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));
          const text = latin1.decode(signed);

          expect(profile.document).toBe("12345678901");
          expect(signed.byteLength).toBeGreaterThan(pdf.byteLength);
          expect(text).toContain("/ByteRange");
          expect(text).toContain("/SubFilter /adbe.pkcs7.detached");
          expect(text).toContain("Chromium browser A1 test");
        }),
      ));
  });
}
