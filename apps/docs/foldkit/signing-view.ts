import * as Domain from "@alchemy.run/domain";
import type { A1CertificateProfile } from "@signature-kit/a1/config";
import { isSafePdfStampPng } from "@signature-kit/pdf/stamp";
import { errorMessage } from "@signature-kit/i18n";
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  signatureKitErrorMessages,
} from "@signature-kit/signatures";
import { loadPdfSignatureDocument, readPdfBlobBytes } from "@signature-kit/pdf/workflow";
import { createPdfSignatureBuilderStateFromTemplate } from "@signature-kit/pdf/builder";
import {
  createPdfSignatureBuilderStore,
  placePdfSignatureFieldsBatch,
} from "@signature-kit/pdf/builder-store";
import {
  liteParseWorkerBrowserLayer,
  pdfHandwritingBrowserLayer,
  PdfHandwriting,
  renderPdfPagesBrowser,
} from "@signature-kit/pdf/liteparse-browser";
import type {
  PdfPrepareAndSignInput,
  PdfSignatureBadge,
  PdfSignatureDocument,
  PdfSignatureFieldDraft,
  PdfSignatureRect,
} from "@signature-kit/pdf/config";
import {
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  pdfErrorMessages,
} from "@signature-kit/pdf/config";
import { cmsErrorMessages } from "@signature-kit/cms/config";
import { SigningModel } from "@signature-kit/signing-domain";
import { Effect, Fiber, Layer, Result, Schema } from "effect";
import type { HtmlBuilder } from "foldkit/html";
import * as Mount from "foldkit/mount";
import { captureDocsEvent } from "../lib/posthog/client";
import { makeSigningBatch, makeSigningWorkerSession } from "./signing-runtime";

export const SigningMounted = Schema.TaggedStruct("SigningMounted", {});
const cleanups = new Set<() => void>();
if (import.meta.hot !== undefined)
  import.meta.hot.dispose(() => {
    for (const cleanup of cleanups) cleanup();
  });

const SigningMount = Mount.define("SigningMount", {
  messages: [SigningMounted],
  execute: ({ element }) =>
    Effect.gen(function* () {
      const context = yield* Layer.build(
        SigningModel.layer(Layer.empty).pipe(Layer.provide(Domain.InMemory)),
      );
      const batch = yield* makeSigningBatch.pipe(Effect.provideContext(context));
      const runtimeContext = yield* Effect.context<never>();
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const form = element.querySelector("form");
          const pfx = element.querySelector<HTMLInputElement>("[name=pfx]");
          const password = element.querySelector<HTMLInputElement>("[name=password]");
          const pdf = element.querySelector<HTMLInputElement>("[name=pdf]");
          const cancel = element.querySelector<HTMLButtonElement>("[data-cancel]");
          const status = element.querySelector<HTMLElement>("[data-status]");
          const downloads = element.querySelector<HTMLElement>("[data-downloads]");
          const preview = element.querySelector<HTMLElement>("[data-preview]");
          const previous = element.querySelector<HTMLButtonElement>("[data-previous]");
          const next = element.querySelector<HTMLButtonElement>("[data-next]");
          const auto = element.querySelector<HTMLButtonElement>("[data-auto]");
          const rubric = element.querySelector<HTMLInputElement>("[name=rubric]");
          const title = element.querySelector<HTMLInputElement>("[name=stampTitle]");
          const color = element.querySelector<HTMLInputElement>("[name=stampColor]");
          const identity = element.querySelector<HTMLInputElement>("[name=stampIdentity]");
          const date = element.querySelector<HTMLInputElement>("[name=stampDate]");
          const logo = element.querySelector<HTMLInputElement>("[name=stampLogo]");
          const removeLogo = element.querySelector<HTMLButtonElement>("[data-remove-logo]");
          const loadIdentity = element.querySelector<HTMLButtonElement>("[data-load-identity]");
          const identityStatus = element.querySelector<HTMLElement>("[data-identity]");
          const rubricSource = element.querySelector<HTMLSelectElement>("[name=rubricSource]");
          const rubricText = element.querySelector<HTMLInputElement>("[name=rubricText]");
          const pt = element.getAttribute("data-locale") === "pt-BR";
          const locale = pt ? "pt-BR" : "en-US";
          const message = (error: { readonly _tag: string; readonly code?: string }) =>
            error._tag === "RpcClientError"
              ? pt
                ? "Não foi possível comunicar com o serviço de assinatura. Tente novamente."
                : "Could not communicate with the signing service. Please try again."
              : errorMessage(error, {
                  locale,
                  catalogs: [signatureKitErrorMessages, pdfErrorMessages, cmsErrorMessages],
                });
          let closed = false;
          let controlsLocked = false;
          let cancelling = false;
          let batchId = 0;
          let active: Fiber.Fiber<unknown, unknown> | undefined;
          let session: Effect.Success<typeof makeSigningWorkerSession> | undefined;
          const fibers = new Set<Fiber.Fiber<unknown, unknown>>();
          const urls = new Set<string>();
          const previewUrls = new Set<string>();
          const visualUrls = new Set<string>();
          let profile: A1CertificateProfile | undefined;
          let profileFile: File | undefined;
          let profileDate = "";
          let visualGeneration = 0;
          let visualFiber: Fiber.Fiber<unknown, unknown> | undefined;
          let visualAppearance: Pick<PdfPrepareAndSignInput, "badge" | "rubric"> | undefined;
          let logoBytes: Uint8Array | undefined;
          let logoFile: File | undefined;
          let logoGeneration = 0;
          let logoLoading = false;
          let previewGeneration = 0;
          let previewFiber: Fiber.Fiber<unknown, unknown> | undefined;
          let selectedPage = 0;
          let selectedDocument = 0;
          let entries: Array<{
            file: File;
            document: PdfSignatureDocument;
            images: ReadonlyArray<string>;
            visualImages?: ReadonlyArray<string>;
            rect: PdfSignatureRect | undefined;
          }> = [];
          const clearPreview = () => {
            for (const url of previewUrls) URL.revokeObjectURL(url);
            previewUrls.clear();
            preview?.replaceChildren();
            entries = [];
          };
          const drawPreview = () => {
            if (preview === null) return;
            const focused = preview.querySelector(".signing-page") === document.activeElement;
            preview.replaceChildren();
            const entry = entries[selectedDocument];
            const page = entry?.document.pages[selectedPage];
            const image = entry?.visualImages?.[selectedPage] ?? entry?.images[selectedPage];
            if (entry === undefined || page === undefined || image === undefined) return;
            const select = document.createElement("select");
            select.setAttribute("aria-label", pt ? "Documento" : "Document");
            entries.forEach((item, index) => {
              const option = document.createElement("option");
              option.value = String(index);
              option.textContent = item.file.name;
              option.selected = index === selectedDocument;
              select.append(option);
            });
            select.disabled = controlsLocked || cancelling;
            select.addEventListener("change", () => {
              if (controlsLocked || cancelling) return;
              selectedDocument = Number(select.value);
              selectedPage = entries[selectedDocument]?.rect?.pageIndex ?? 0;
              drawPreview();
            });
            const label = document.createElement("p");
            label.textContent = `${pt ? "Página" : "Page"} ${selectedPage + 1} / ${entry.document.pages.length}`;
            const canvas = document.createElement("div");
            canvas.className = "signing-page";
            canvas.tabIndex = 0;
            canvas.setAttribute("role", "button");
            canvas.setAttribute(
              "aria-label",
              pt
                ? `Posicionar assinatura — ${label.textContent}. Use Enter ou espaço para posicionar e as setas para mover.`
                : `Place signature — ${label.textContent}. Use Enter or Space to place and arrow keys to move.`,
            );
            canvas.setAttribute("aria-disabled", String(controlsLocked || cancelling));
            const img = document.createElement("img");
            img.src = image;
            img.alt = `${entry.file.name} — ${label.textContent}`;
            canvas.append(img);
            if (entry.rect !== undefined && entry.rect.pageIndex === selectedPage) {
              const marker = document.createElement("div");
              marker.className = "signing-rectangle";
              marker.style.left = `${(entry.rect.x / page.width) * 100}%`;
              marker.style.top = `${(entry.rect.y / page.height) * 100}%`;
              marker.style.width = `${(entry.rect.width / page.width) * 100}%`;
              marker.style.height = `${(entry.rect.height / page.height) * 100}%`;
              marker.setAttribute(
                "aria-label",
                pt ? "Posição da assinatura" : "Signature placement",
              );
              canvas.append(marker);
            }
            const place = (x: number, y: number) => {
              if (controlsLocked || cancelling) return;
              const width = Math.min(320, page.width);
              const height = Math.min(128, page.height);
              entry.rect = {
                pageIndex: selectedPage,
                width,
                height,
                x: Math.max(0, Math.min(page.width - width, x * page.width - width / 2)),
                y: Math.max(0, Math.min(page.height - height, y * page.height - height / 2)),
              };
              captureDocsEvent("pdf_signer_signature_placed", {
                document_count: entries.length,
                placed_count: entries.filter((item) => item.rect !== undefined).length,
              });
              refreshVisual();
              drawPreview();
            };
            canvas.addEventListener("click", (event) => {
              const bounds = canvas.getBoundingClientRect();
              place(
                (event.clientX - bounds.left) / bounds.width,
                (event.clientY - bounds.top) / bounds.height,
              );
            });
            canvas.addEventListener("keydown", (event) => {
              if (controlsLocked || cancelling) return;
              const rect = entry.rect?.pageIndex === selectedPage ? entry.rect : undefined;
              const x = rect === undefined ? 0.5 : (rect.x + rect.width / 2) / page.width;
              const y = rect === undefined ? 0.5 : (rect.y + rect.height / 2) / page.height;
              switch (event.key) {
                case "Enter":
                case " ":
                  event.preventDefault();
                  place(x, y);
                  break;
                case "ArrowLeft":
                case "ArrowRight":
                  event.preventDefault();
                  place(x + (event.key === "ArrowLeft" ? -0.02 : 0.02), y);
                  break;
                case "ArrowUp":
                case "ArrowDown":
                  event.preventDefault();
                  place(x, y + (event.key === "ArrowUp" ? -0.02 : 0.02));
                  break;
              }
            });
            const remove = document.createElement("button");
            remove.type = "button";
            remove.disabled = controlsLocked || cancelling;
            remove.textContent = pt ? "Remover documento" : "Remove document";
            remove.addEventListener("click", () => {
              if (controlsLocked || cancelling || pdf === null) return;
              const remaining = new DataTransfer();
              Array.from(pdf.files ?? []).forEach((file, index) => {
                if (index !== selectedDocument) remaining.items.add(file);
              });
              pdf.files = remaining.files;
              captureDocsEvent("pdf_signer_document_removed", {
                remaining_count: remaining.files.length,
              });
              loadPreview();
            });
            preview.append(select, remove, label, canvas);
            if (focused) canvas.focus();
          };
          const say = (text: string) => {
            if (!closed && status !== null) status.textContent = text;
          };
          const run = (effect: Effect.Effect<unknown, unknown>) => {
            const fiber = Effect.runForkWith(runtimeContext)(effect);
            fibers.add(fiber);
            Effect.runForkWith(runtimeContext)(
              Fiber.await(fiber).pipe(Effect.map(() => fibers.delete(fiber))),
            );
            return fiber;
          };
          const decodePreviewImage = (url: string) =>
            Effect.scoped(
              Effect.gen(function* () {
                const image = yield* Effect.acquireRelease(
                  Effect.sync(() => {
                    const element = new Image();
                    element.src = url;
                    return element;
                  }),
                  (element) =>
                    Effect.sync(() => {
                      element.removeAttribute("src");
                    }),
                );
                yield* Effect.tryPromise({
                  try: () => image.decode(),
                  catch: () =>
                    new PdfError({
                      code: PdfErrorCodeValue.pdfLoadFailed,
                      retryable: false,
                      operation: PdfOperationValue.parse,
                      reason: "PDF preview image could not be decoded.",
                    }),
                });
              }),
            );
          const loadPreview = () => {
            if (controlsLocked || cancelling) return;
            invalidateVisual();
            const generation = ++previewGeneration;
            if (previewFiber !== undefined) run(Fiber.interrupt(previewFiber));
            const previousEntries = entries;
            clearPreview();
            selectedDocument = 0;
            selectedPage = 0;
            const files = pdf?.files == null ? [] : Array.from(pdf.files);
            captureDocsEvent("pdf_signer_pdfs_selected", { document_count: files.length });
            if (files.length === 0 || files.length > 100) return;
            previewFiber = run(
              Effect.scoped(
                Effect.gen(function* () {
                  const staged = yield* Effect.acquireRelease(
                    Effect.sync(() => ({ urls: new Set<string>(), accepted: false })),
                    (state) =>
                      Effect.sync(() => {
                        if (!state.accepted) for (const url of state.urls) URL.revokeObjectURL(url);
                      }),
                  );
                  const loaded = yield* Effect.forEach(files, (file, index) =>
                    Effect.gen(function* () {
                      const bytes = yield* readPdfBlobBytes(file);
                      const document = yield* loadPdfSignatureDocument({
                        id: String(index),
                        name: file.name,
                        pdf: bytes,
                      });
                      const pages = yield* renderPdfPagesBrowser(bytes, document.pages.length).pipe(
                        Effect.provide(liteParseWorkerBrowserLayer),
                      );
                      const images = yield* Effect.forEach(pages, (image) =>
                        Effect.gen(function* () {
                          const url = yield* Effect.sync(() => {
                            const created = URL.createObjectURL(
                              new Blob([new Uint8Array(image.imageBytes)], { type: "image/png" }),
                            );
                            staged.urls.add(created);
                            return created;
                          });
                          yield* decodePreviewImage(url);
                          return url;
                        }),
                      );
                      return { file, document, images };
                    }),
                  );
                  yield* Effect.sync(() => {
                    if (closed || generation !== previewGeneration) return;
                    entries = loaded.map((item) => ({
                      ...item,
                      rect: previousEntries.find((entry) => entry.file === item.file)?.rect,
                    }));
                    for (const url of staged.urls) previewUrls.add(url);
                    staged.accepted = true;
                    captureDocsEvent("pdf_signer_pdfs_loaded", {
                      failed_count: 0,
                      loaded_count: entries.length,
                      selected_count: files.length,
                    });
                    selectedPage = entries[0]?.rect?.pageIndex ?? 0;
                    refreshVisual();
                    drawPreview();
                  });
                }),
              ).pipe(
                Effect.catch((error) =>
                  Effect.sync(() => {
                    if (generation === previewGeneration) {
                      captureDocsEvent("pdf_signer_pdfs_loaded", {
                        failed_count: files.length,
                        loaded_count: 0,
                        selected_count: files.length,
                      });
                      say(message(error));
                    }
                  }),
                ),
                Effect.ensuring(
                  Effect.sync(() => {
                    if (generation === previewGeneration) previewFiber = undefined;
                  }),
                ),
              ),
            );
          };
          const showPrevious = () => {
            if (controlsLocked || cancelling) return;
            selectedPage = Math.max(0, selectedPage - 1);
            drawPreview();
          };
          const showNext = () => {
            if (controlsLocked || cancelling) return;
            selectedPage = Math.min(
              (entries[selectedDocument]?.document.pages.length ?? 1) - 1,
              selectedPage + 1,
            );
            drawPreview();
          };
          const certificateSelected = () => {
            if (controlsLocked || cancelling) return;
            profile = undefined;
            profileFile = undefined;
            if (identityStatus !== null) identityStatus.textContent = "";
            invalidateVisual();
            drawPreview();
            if (pfx?.files?.item(0) != null) captureDocsEvent("pdf_signer_certificate_selected");
          };
          const placeAutomatically = () => {
            if (controlsLocked || cancelling || entries.length === 0) return;
            const current = entries;
            captureDocsEvent("pdf_signer_auto_place_started", {
              document_count: current.length,
              unplaced_count: current.filter((entry) => entry.rect === undefined).length,
            });
            setLocked(true);
            run(
              Effect.forEach(current, (entry, index) =>
                Effect.gen(function* () {
                  const page = entry.document.pages[entry.document.pages.length - 1];
                  if (page === undefined) return undefined;
                  const draft: PdfSignatureFieldDraft = {
                    id: "signature",
                    type: "signature",
                    roleId: "signer",
                    width: Math.min(320, page.width),
                    height: Math.min(128, page.height),
                    required: true,
                  };
                  const id = String(index);
                  const state = yield* createPdfSignatureBuilderStateFromTemplate({
                    template: {
                      id: "signing-view",
                      name: "Signing",
                      documents: [entry.document],
                      roles: [
                        {
                          id: "signer",
                          label: "Signer",
                          email: "signer@example.com",
                          required: true,
                        },
                      ],
                    },
                    draft,
                  });
                  return {
                    id,
                    documentId: entry.document.id,
                    store: createPdfSignatureBuilderStore(state),
                    draft,
                  };
                }),
              ).pipe(
                Effect.flatMap((queue) =>
                  placePdfSignatureFieldsBatch(queue.filter((item) => item !== undefined)),
                ),
                Effect.tap((results) =>
                  Effect.sync(() => {
                    if (closed || entries !== current) return;
                    for (const result of results) {
                      const entry = current[Number(result.id)];
                      if (result.ok && entry !== undefined) entry.rect = result.field.rect;
                    }
                    captureDocsEvent("pdf_signer_auto_place_completed", {
                      placed_count: current.filter((entry) => entry.rect !== undefined).length,
                      total_count: current.length,
                    });
                    selectedPage = current[selectedDocument]?.rect?.pageIndex ?? 0;
                    refreshVisual();
                    drawPreview();
                  }),
                ),
                Effect.catch((error) => Effect.sync(() => say(message(error)))),
                Effect.ensuring(
                  Effect.sync(() => {
                    setLocked(false);
                  }),
                ),
              ),
            );
          };
          const loadLogo = () => {
            if (controlsLocked || cancelling) return;
            const generation = ++logoGeneration;
            invalidateVisual();
            drawPreview();
            logoBytes = undefined;
            logoFile = undefined;
            const file = logo?.files?.item(0);
            if (file == null) {
              logoLoading = false;
              refreshVisual();
              drawPreview();
              return;
            }
            logoLoading = true;
            run(
              Effect.tryPromise({
                try: () => file.arrayBuffer(),
                catch: () =>
                  new PdfError({
                    code: PdfErrorCodeValue.stampFailed,
                    retryable: false,
                    operation: PdfOperationValue.stamp,
                    reason: "Logo PNG could not be read.",
                  }),
              }).pipe(
                Effect.map((bytes) => new Uint8Array(bytes)),
                Effect.flatMap((bytes) =>
                  isSafePdfStampPng(bytes).pipe(Effect.map((valid) => ({ bytes, valid }))),
                ),
                Effect.tap(({ bytes, valid }) =>
                  Effect.sync(() => {
                    if (generation !== logoGeneration || closed) return;
                    logoBytes = valid ? bytes : undefined;
                    logoFile = valid ? file : undefined;
                    if (!valid) say(pt ? "Selecione um PNG válido." : "Select a valid PNG.");
                  }),
                ),
                Effect.catch((error) =>
                  Effect.sync(() => {
                    if (generation === logoGeneration) say(message(error));
                  }),
                ),
                Effect.ensuring(
                  Effect.sync(() => {
                    if (generation === logoGeneration) {
                      logoLoading = false;
                      if (logoBytes !== undefined && !closed) refreshVisual();
                    }
                  }),
                ),
              ),
            );
          };
          const clearLogo = () => {
            if (controlsLocked || cancelling) return;
            logoGeneration++;
            logoLoading = false;
            logoBytes = undefined;
            logoFile = undefined;
            if (logo !== null) logo.value = "";
            say("");
            refreshVisual();
            drawPreview();
          };
          const invalidateVisual = () => {
            visualGeneration++;
            visualAppearance = undefined;
            if (visualFiber !== undefined) run(Fiber.interrupt(visualFiber));
            visualFiber = undefined;
            for (const url of visualUrls) URL.revokeObjectURL(url);
            visualUrls.clear();
            for (const entry of entries) delete entry.visualImages;
            if (preview !== null) preview.dataset.visualReady = "false";
          };
          const refreshVisual = () => {
            invalidateVisual();
            const currentProfile = profile;
            const current = entries;
            const placements = current.flatMap((entry) =>
              entry.rect === undefined ? [] : [{ entry, rect: entry.rect }],
            );
            if (
              currentProfile === undefined ||
              placements.length !== current.length ||
              current.length === 0 ||
              logoLoading ||
              (logo?.files?.item(0) != null &&
                (logoBytes === undefined || logo.files.item(0) !== logoFile))
            )
              return;
            const generation = visualGeneration;
            const inputText =
              rubricSource?.value === "text"
                ? (rubricText?.value.trim() ?? "")
                : currentProfile.subject;
            if (inputText.length === 0) return;
            const stampTitle =
              title?.value.trim() || (pt ? "ASSINADO DIGITALMENTE" : "DIGITALLY SIGNED");
            const stampColor = color?.value ?? "#3B5BDB";
            const includeIdentity = identity?.checked === true;
            const includeDate = date?.checked === true;
            const useRubric = rubric?.checked === true;
            const stampLogo = logoBytes;
            visualFiber = run(
              Effect.scoped(
                Effect.gen(function* () {
                  const handwriting = yield* PdfHandwriting;
                  const ink = yield* handwriting.render(inputText);
                  const badge: PdfSignatureBadge = {
                    header: { text: stampTitle },
                    rows: [
                      ...(includeIdentity
                        ? [
                            [{ label: pt ? "Assinante" : "Signer", value: currentProfile.subject }],
                            [
                              {
                                label: pt ? "Organização" : "Organization",
                                value: currentProfile.organization ?? currentProfile.subject,
                              },
                            ],
                            [
                              {
                                label: currentProfile.document.length === 14 ? "CNPJ" : "CPF",
                                value: currentProfile.document,
                              },
                            ],
                            [
                              {
                                label: pt ? "Certificado" : "Certificate",
                                value: "ICP-Brasil (A1)",
                              },
                            ],
                          ]
                        : []),
                      ...(includeDate
                        ? [[{ label: pt ? "Data" : "Date", value: profileDate }]]
                        : []),
                    ],
                    signaturePng: ink,
                    theme: { borderColor: stampColor, headerColor: stampColor },
                    ...(stampLogo === undefined ? {} : { logoPng: stampLogo }),
                    footer: [
                      { text: "MP 2.200-2/2001" },
                      { text: "Lei 14.063/2020" },
                      { text: "Portaria ITI nº 22/2023" },
                      { text: "validar.iti.gov.br", link: "https://validar.iti.gov.br" },
                      { text: "SignatureKit" },
                    ],
                    qr: { text: "https://validar.iti.gov.br" },
                  };
                  const appearance: Pick<PdfPrepareAndSignInput, "badge" | "rubric"> = {
                    badge,
                    ...(useRubric ? { rubric: { imagePng: ink, border: false } } : {}),
                  };
                  const worker = yield* makeSigningWorkerSession;
                  const staged = yield* Effect.acquireRelease(
                    Effect.sync(() => ({ urls: new Set<string>(), accepted: false })),
                    (state) =>
                      Effect.sync(() => {
                        if (!state.accepted) for (const url of state.urls) URL.revokeObjectURL(url);
                      }),
                  );
                  const rendered = yield* Effect.forEach(placements, ({ entry, rect }) =>
                    Effect.gen(function* () {
                      const bytes = yield* readPdfBlobBytes(entry.file);
                      const visualPdf = yield* worker.client.Preview({
                        pdf: bytes,
                        signing: {},
                        stampRects: [rect],
                        ...appearance,
                      });
                      const images = yield* renderPdfPagesBrowser(
                        visualPdf,
                        entry.document.pages.length,
                      ).pipe(Effect.provide(liteParseWorkerBrowserLayer));
                      const urls = yield* Effect.forEach(images, (image) =>
                        Effect.gen(function* () {
                          const url = yield* Effect.sync(() => {
                            const created = URL.createObjectURL(
                              new Blob([new Uint8Array(image.imageBytes)], { type: "image/png" }),
                            );
                            staged.urls.add(created);
                            return created;
                          });
                          yield* decodePreviewImage(url);
                          return url;
                        }),
                      );
                      return { entry, images: urls };
                    }),
                  );
                  yield* Effect.sync(() => {
                    if (
                      closed ||
                      generation !== visualGeneration ||
                      entries !== current ||
                      profile !== currentProfile
                    )
                      return;
                    for (const item of rendered) item.entry.visualImages = item.images;
                    for (const url of staged.urls) visualUrls.add(url);
                    staged.accepted = true;
                    visualAppearance = appearance;
                    if (preview !== null) preview.dataset.visualReady = "true";
                    say(pt ? "Prévia pronta." : "Preview ready.");
                    drawPreview();
                  });
                }).pipe(Effect.provide(pdfHandwritingBrowserLayer("600 64px 'Caveat Variable'"))),
              ).pipe(
                Effect.catch((error) =>
                  Effect.sync(() => {
                    if (generation === visualGeneration && !closed) say(message(error));
                  }),
                ),
                Effect.ensuring(
                  Effect.sync(() => {
                    if (generation === visualGeneration) visualFiber = undefined;
                  }),
                ),
              ),
            );
          };
          const optionsChanged = () => {
            if (!controlsLocked && !cancelling) {
              refreshVisual();
              drawPreview();
            }
          };
          const readIdentity = () => {
            if (controlsLocked || cancelling) return;
            const file = pfx?.files?.item(0);
            const secret = password?.value ?? "";
            if (file == null || secret.length === 0) {
              say(
                pt
                  ? "Selecione o certificado e informe a senha."
                  : "Select a certificate and enter its password.",
              );
              return;
            }
            setLocked(true);
            profile = undefined;
            profileFile = undefined;
            if (identityStatus !== null) identityStatus.textContent = "";
            invalidateVisual();
            drawPreview();
            captureDocsEvent("pdf_signer_certificate_profile_started");
            say(pt ? "Carregando identidade…" : "Loading identity…");
            run(
              Effect.scoped(
                Effect.gen(function* () {
                  const worker = yield* makeSigningWorkerSession;
                  const pfxBytes = yield* Effect.tryPromise({
                    try: async () => new Uint8Array(await file.arrayBuffer()),
                    catch: () =>
                      new SignatureKitError({
                        code: SignatureKitErrorCodeValue.unsupportedOperation,
                        retryable: true,
                        reason: "Certificate file could not be read.",
                      }),
                  }).pipe(
                    Effect.tapError(() =>
                      Effect.sync(() =>
                        captureDocsEvent("pdf_signer_certificate_failed", { phase: "read_file" }),
                      ),
                    ),
                  );
                  captureDocsEvent("pdf_signer_certificate_loaded");
                  return yield* worker.client.Initialize({ pfx: pfxBytes, password: secret });
                }),
              ).pipe(
                Effect.tap((loaded) =>
                  Effect.sync(() => {
                    if (closed) return;
                    profile = loaded.profile;
                    profileFile = file;
                    profileDate = new Date().toLocaleString(locale);
                    if (identityStatus !== null)
                      identityStatus.textContent = loaded.profile.subject;
                    captureDocsEvent("pdf_signer_certificate_profile_loaded");
                    say(pt ? "Identidade carregada." : "Identity loaded.");
                    refreshVisual();
                    drawPreview();
                  }),
                ),
                Effect.catch((error) =>
                  Effect.sync(() => {
                    captureDocsEvent("pdf_signer_certificate_profile_failed");
                    say(message(error));
                  }),
                ),
                Effect.ensuring(
                  Effect.sync(() => {
                    if (!closed) setLocked(false);
                  }),
                ),
              ),
            );
          };
          const setLocked = (locked: boolean) => {
            controlsLocked = locked;
            form
              ?.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
                "input, button, select",
              )
              .forEach((control) => {
                if (control !== cancel) control.disabled = locked;
              });
            if (preview !== null) preview.inert = locked;
            preview?.querySelector(".signing-page")?.setAttribute("aria-disabled", String(locked));
          };
          const submit = (event: Event) => {
            event.preventDefault();
            const certificate = pfx?.files?.item(0);
            const files = pdf?.files != null ? Array.from(pdf.files) : [];
            const secret = password?.value ?? "";
            if (
              certificate == null ||
              secret.length === 0 ||
              files.length === 0 ||
              files.length > 100
            ) {
              captureDocsEvent("pdf_signer_sign_blocked", {
                reason:
                  certificate == null
                    ? "missing_certificate"
                    : secret.length === 0
                      ? "missing_password"
                      : "no_signature_placement",
              });
              say(
                pt
                  ? "Selecione o certificado, a senha e de 1 a 100 PDFs."
                  : "Select a certificate, password, and 1 to 100 PDFs.",
              );
              return;
            }
            if (controlsLocked || cancelling) return;
            const ready =
              profile !== undefined &&
              profileFile === certificate &&
              visualAppearance !== undefined &&
              !logoLoading &&
              (logo?.files?.item(0) == null ||
                (logoBytes !== undefined && logo.files.item(0) === logoFile)) &&
              entries.length === files.length &&
              entries.every((entry, index) => {
                const rect = entry.rect;
                const page = rect === undefined ? undefined : entry.document.pages[rect.pageIndex];
                return (
                  entry.file === files[index] &&
                  rect !== undefined &&
                  page !== undefined &&
                  Number.isFinite(rect.x) &&
                  Number.isFinite(rect.y) &&
                  Number.isFinite(rect.width) &&
                  Number.isFinite(rect.height) &&
                  rect.x >= 0 &&
                  rect.y >= 0 &&
                  rect.width > 0 &&
                  rect.height > 0 &&
                  rect.x + rect.width <= page.width &&
                  rect.y + rect.height <= page.height
                );
              });
            if (!ready) {
              captureDocsEvent("pdf_signer_sign_blocked", { reason: "no_signature_placement" });
              const hasPositions =
                entries.length === files.length &&
                entries.every((entry) => entry.rect !== undefined);
              say(
                profile === undefined || profileFile !== certificate
                  ? pt
                    ? "Carregue a identidade do certificado."
                    : "Load the certificate identity."
                  : hasPositions && visualAppearance === undefined
                    ? pt
                      ? "Aguarde a prévia da assinatura."
                      : "Wait for the signature preview."
                    : pt
                      ? "Aguarde os PDFs e posicione a assinatura em cada documento."
                      : "Wait for the PDFs and place a signature on each document.",
              );
              return;
            }
            setLocked(true);
            captureDocsEvent("pdf_signer_sign_started", {
              document_count: files.length,
              rubric_every_page: rubric?.checked === true,
            });
            if (password !== null) password.value = "";
            for (const url of urls) URL.revokeObjectURL(url);
            urls.clear();
            downloads?.replaceChildren();
            const placements = entries.flatMap((entry) =>
              entry.rect === undefined ? [] : [{ file: entry.file, rect: entry.rect }],
            );
            const appearance = visualAppearance;
            const expectedProfile = profile;
            if (appearance === undefined || expectedProfile === undefined) return;
            const current = ++batchId;
            say(pt ? "Preparando assinatura…" : "Preparing signature…");
            active = run(
              Effect.scoped(
                Effect.gen(function* () {
                  const results = yield* batch.run({
                    target: "signing-view",
                    batchId: current,
                    documentIds: placements.map((_, index) => String(index)),
                    onState: (state) => {
                      if (status !== null) {
                        status.dataset.total = String(state.documents.length);
                        status.dataset.completed = String(
                          state.documents.filter(
                            (item) => item.status === "completed" || item.status === "failed",
                          ).length,
                        );
                      }
                      if (state.status === "running") {
                        say(
                          state.mode === "prepare"
                            ? pt
                              ? "Preparando assinatura…"
                              : "Preparing signature…"
                            : pt
                              ? "Assinando documentos…"
                              : "Signing documents…",
                        );
                      }
                    },
                    prepare: Effect.gen(function* () {
                      const worker = yield* makeSigningWorkerSession;
                      session = worker;
                      const certificateBytes = yield* Effect.tryPromise({
                        try: async () => new Uint8Array(await certificate.arrayBuffer()),
                        catch: () =>
                          new SignatureKitError({
                            code: SignatureKitErrorCodeValue.unsupportedOperation,
                            retryable: true,
                            reason: "Certificate file could not be read.",
                          }),
                      }).pipe(
                        Effect.tapError(() =>
                          Effect.sync(() =>
                            captureDocsEvent("pdf_signer_certificate_failed", {
                              phase: "read_file",
                            }),
                          ),
                        ),
                      );
                      const initialized = yield* worker.client
                        .Initialize({
                          pfx: certificateBytes,
                          password: secret,
                        })
                        .pipe(
                          Effect.tapError(() =>
                            Effect.sync(() => {
                              captureDocsEvent("pdf_signer_identity_failed", {
                                phase: "sign_start",
                              });
                            }),
                          ),
                        );
                      if (initialized.profile.fingerprint !== expectedProfile.fingerprint) {
                        return yield* new SignatureKitError({
                          code: SignatureKitErrorCodeValue.unsupportedOperation,
                          retryable: false,
                          reason: "Certificate changed since preview.",
                        });
                      }
                      const documents = yield* Effect.forEach(placements, (entry, index) =>
                        readPdfBlobBytes(entry.file).pipe(
                          Effect.map((bytes) => ({
                            id: String(index),
                            input: {
                              pdf: bytes,
                              signing: {},
                              stampRects: [entry.rect],
                              ...appearance,
                            },
                          })),
                        ),
                      );
                      return {
                        generation: initialized.generation,
                        documents,
                        sign: worker.client.Sign,
                      };
                    }),
                  });
                  captureDocsEvent("pdf_signer_sign_completed", {
                    attempted_count: results.length,
                    failed_count: results.filter((item) => Result.isFailure(item.result)).length,
                    signed_count: results.filter((item) => Result.isSuccess(item.result)).length,
                  });
                  if (!closed && downloads !== null)
                    for (const result of results) {
                      if (Result.isSuccess(result.result)) {
                        const url = URL.createObjectURL(
                          new Blob([new Uint8Array(result.result.success)], {
                            type: "application/pdf",
                          }),
                        );
                        urls.add(url);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = `${pt ? "assinado" : "signed"}-${files[Number(result.id)]?.name ?? "document.pdf"}`;
                        link.textContent = link.download;
                        link.addEventListener("click", () =>
                          captureDocsEvent("pdf_signer_signed_pdf_downloaded", {
                            document_count: 1,
                          }),
                        );
                        downloads.append(link, document.createElement("br"));
                      } else {
                        const failure = document.createElement("p");
                        failure.textContent = `${files[Number(result.id)]?.name ?? result.id}: ${message(result.result.failure)}`;
                        downloads.append(failure);
                      }
                    }
                  say(
                    results.some((item) => Result.isFailure(item.result))
                      ? pt
                        ? "Alguns documentos não puderam ser assinados."
                        : "Some documents could not be signed."
                      : pt
                        ? "Assinatura concluída."
                        : "Signing complete.",
                  );
                }).pipe(
                  Effect.ensuring(
                    Effect.gen(function* () {
                      if (session !== undefined) {
                        yield* session.close;
                        session = undefined;
                      }
                      active = undefined;
                      if (!cancelling) setLocked(false);
                    }),
                  ),
                  Effect.catch((error) =>
                    Effect.sync(() => {
                      captureDocsEvent("pdf_signer_sign_failed", {
                        attempted_count: files.length,
                        phase: "sign_batch",
                        prepared_count: 0,
                      });
                      say(message(error));
                    }),
                  ),
                ),
              ),
            );
          };
          const stop = () => {
            if (!controlsLocked || cancelling || active === undefined) return;
            cancelling = true;
            say(pt ? "Cancelando…" : "Cancelling…");
            const current = active;
            run(
              Fiber.interrupt(current).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    cancelling = false;
                    setLocked(false);
                    say(pt ? "Operação cancelada." : "Operation cancelled.");
                  }),
                ),
              ),
            );
          };
          loadIdentity?.addEventListener("click", readIdentity);
          for (const control of [title, color, identity, date, rubric, rubricSource, rubricText]) {
            control?.addEventListener("input", optionsChanged);
            control?.addEventListener("change", optionsChanged);
          }
          logo?.addEventListener("change", loadLogo);
          removeLogo?.addEventListener("click", clearLogo);
          pfx?.addEventListener("change", certificateSelected);
          pdf?.addEventListener("change", loadPreview);
          previous?.addEventListener("click", showPrevious);
          next?.addEventListener("click", showNext);
          auto?.addEventListener("click", placeAutomatically);
          form?.addEventListener("submit", submit);
          cancel?.addEventListener("click", stop);
          const cleanup = () => {
            if (closed) return;
            closed = true;
            previewGeneration++;
            logoGeneration++;
            invalidateVisual();
            profile = undefined;
            profileFile = undefined;
            logoBytes = undefined;
            logoFile = undefined;
            if (password !== null) password.value = "";
            clearPreview();
            loadIdentity?.removeEventListener("click", readIdentity);
            for (const control of [
              title,
              color,
              identity,
              date,
              rubric,
              rubricSource,
              rubricText,
            ]) {
              control?.removeEventListener("input", optionsChanged);
              control?.removeEventListener("change", optionsChanged);
            }
            logo?.removeEventListener("change", loadLogo);
            removeLogo?.removeEventListener("click", clearLogo);
            pfx?.removeEventListener("change", certificateSelected);
            pdf?.removeEventListener("change", loadPreview);
            previous?.removeEventListener("click", showPrevious);
            next?.removeEventListener("click", showNext);
            auto?.removeEventListener("click", placeAutomatically);
            form?.removeEventListener("submit", submit);
            cancel?.removeEventListener("click", stop);
            for (const fiber of fibers) Effect.runForkWith(runtimeContext)(Fiber.interrupt(fiber));
            for (const url of urls) URL.revokeObjectURL(url);
            urls.clear();
            cleanups.delete(cleanup);
          };
          cleanups.add(cleanup);
          return cleanup;
        }),
        (cleanup) => Effect.sync(cleanup),
      );
      return { _tag: "SigningMounted" };
    }),
});

export const signingView = <Message>(
  h: HtmlBuilder<Message>,
  mounted: Message,
  locale: "pt-BR" | "en-US",
) => {
  const pt = locale === "pt-BR";
  return h.section(
    [
      h.Class("docs-content"),
      h.Attribute("data-locale", locale),
      h.Attribute("data-ph-no-capture", ""),
      h.Attribute("data-analytics-sensitive", ""),
      h.OnMount(Mount.mapMessage(SigningMount(), () => mounted)),
    ],
    [
      h.h1([], [pt ? "Assine documentos grátis" : "Sign documents for free"]),
      h.p(
        [],
        [
          pt
            ? "Assine PDFs no seu navegador com certificado A1."
            : "Sign PDFs in your browser with an A1 certificate.",
        ],
      ),
      h.form(
        [],
        [
          h.label(
            [],
            [
              pt ? "Certificado PFX ou P12" : "PFX or P12 certificate",
              h.input([h.Type("file"), h.Name("pfx"), h.Accept(".pfx,.p12")]),
            ],
          ),
          h.label(
            [],
            [
              pt ? "Senha do certificado" : "Certificate password",
              h.input([h.Type("password"), h.Name("password")]),
            ],
          ),
          h.button(
            [h.Type("button"), h.Attribute("data-load-identity", "")],
            [pt ? "Carregar identidade" : "Load identity"],
          ),
          h.p([h.Attribute("data-identity", "")], []),
          h.label(
            [],
            [
              "PDF",
              h.input([
                h.Type("file"),
                h.Name("pdf"),
                h.Accept("application/pdf,.pdf"),
                h.Multiple(true),
              ]),
            ],
          ),
          h.label(
            [],
            [
              pt ? "Título da assinatura" : "Signature title",
              h.input([h.Type("text"), h.Name("stampTitle")]),
            ],
          ),
          h.label(
            [],
            [
              pt ? "Cor" : "Color",
              h.input([h.Type("color"), h.Name("stampColor"), h.Value("#3B5BDB")]),
            ],
          ),
          h.label(
            [],
            [
              pt ? "Logo PNG" : "PNG logo",
              h.input([h.Type("file"), h.Name("stampLogo"), h.Accept("image/png,.png")]),
            ],
          ),
          h.button(
            [h.Type("button"), h.Attribute("data-remove-logo", "")],
            [pt ? "Remover logo" : "Remove logo"],
          ),
          h.label(
            [],
            [
              h.input([h.Type("checkbox"), h.Name("stampIdentity"), h.Checked(true)]),
              pt ? "Exibir identidade" : "Show identity",
            ],
          ),
          h.label(
            [],
            [
              h.input([h.Type("checkbox"), h.Name("stampDate"), h.Checked(true)]),
              pt ? "Exibir data" : "Show date",
            ],
          ),
          h.label(
            [],
            [
              h.input([h.Type("checkbox"), h.Name("rubric")]),
              pt ? "Rubricar demais páginas" : "Initial other pages",
            ],
          ),
          h.label(
            [],
            [
              pt ? "Origem da rubrica" : "Handwriting source",
              h.select(
                [h.Name("rubricSource")],
                [
                  h.option(
                    [h.Value("certificate")],
                    [pt ? "Nome do certificado" : "Certificate name"],
                  ),
                  h.option([h.Value("text")], [pt ? "Texto digitado" : "Typed text"]),
                ],
              ),
            ],
          ),
          h.label(
            [],
            [
              pt ? "Texto manuscrito" : "Handwritten text",
              h.input([h.Type("text"), h.Name("rubricText"), h.Attribute("maxlength", "120")]),
            ],
          ),
          h.div([h.Attribute("data-preview", "")], []),
          h.button(
            [h.Type("button"), h.Attribute("data-previous", "")],
            [pt ? "Página anterior" : "Previous page"],
          ),
          h.button(
            [h.Type("button"), h.Attribute("data-next", "")],
            [pt ? "Próxima página" : "Next page"],
          ),
          h.button(
            [h.Type("button"), h.Attribute("data-auto", "")],
            [pt ? "Posicionar automaticamente" : "Place automatically"],
          ),
          h.button([h.Type("submit")], [pt ? "Assinar" : "Sign"]),
          h.button(
            [h.Type("button"), h.Attribute("data-cancel", "")],
            [pt ? "Cancelar" : "Cancel"],
          ),
        ],
      ),
      h.p([h.Attribute("data-status", ""), h.Attribute("role", "status")], []),
      h.div([h.Attribute("data-downloads", "")], []),
    ],
  );
};
