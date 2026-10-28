import { Clock, Effect, Match, Option, Redacted, Result, Schema } from "effect";
import * as Command from "foldkit/command";
import * as Dom from "foldkit/dom";
import * as Mount from "foldkit/mount";
import { PdfPreview } from "./pdf-preview.ts";
import * as File from "foldkit/file";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { CmsErrorCodeSchema, cmsErrorMessages } from "@signature-kit/cms/config";
import {
  SignatureKitError,
  SignatureKitErrorCodeSchema,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
  signatureKitErrorMessages,
} from "@signature-kit/signatures";
import { defineMessageUnion } from "foldkit/message";
import * as Submodel from "foldkit/submodel";
import * as Subscription from "foldkit/subscription";
import * as Update from "foldkit/update";
import * as Stamp from "./stamp.ts";
import { SigningImages } from "./signing-images.ts";
import { SigningIdentity } from "./signing-identity.ts";
import { maxStampPngBytes } from "@signature-kit/pdf/stamp";
import { errorMessage } from "@signature-kit/i18n";
import {
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfErrorCodeSchema,
  PdfSignaturePlacementInputSchema,
  pdfErrorMessages,
} from "@signature-kit/pdf/config";

import { SiteLocale } from "../../lib/site-route.ts";
import { m } from "../../paraglide/messages.js";
import { SigningDocument, SigningSession } from "./signing-session.ts";

const SigningIssue = Schema.Struct({
  _tag: Schema.Literals(["PdfError", "SignatureKitError", "CmsError"]),
  code: Schema.Literals([
    ...PdfErrorCodeSchema.literals,
    ...SignatureKitErrorCodeSchema.literals,
    ...CmsErrorCodeSchema.literals,
  ]),
});

const PlacementKey = Schema.Literals([
  "Enter",
  " ",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
]);

const PreviewPage = Schema.Struct({
  id: Schema.NonEmptyString,
  pageIndex: PdfSignaturePlacementInputSchema.fields.pageIndex,
});

const PlacementDrag = Schema.Struct({
  ...PreviewPage.fields,
  startX: Schema.Finite,
  startY: Schema.Finite,
  x: Schema.Finite,
  y: Schema.Finite,
});

export const Presentation = Schema.Literals(["dialog", "inline"]);
export type Presentation = typeof Presentation.Type;

export const Model = Schema.Struct({
  presentation: Presentation,
  locale: SiteLocale,
  open: Schema.Boolean,
  busy: Schema.Boolean,
  activity: Schema.Literals(["idle", "reading", "placing", "certificate", "signing"]),
  placementQueue: Schema.Array(Schema.String),
  closing: Schema.Boolean,
  documents: Schema.Array(SigningDocument),
  error: Schema.optional(SigningIssue),
  activeDocumentId: Schema.optional(Schema.String),
  previewPageIndex: PdfSignaturePlacementInputSchema.fields.pageIndex,
  previewState: Schema.Literals(["idle", "loading", "ready", "failed"]),
  drag: Schema.optional(PlacementDrag),
  stamp: Stamp.Model,
  certificateReady: Schema.Boolean,
  identityReady: Schema.Boolean,
  passwordRequired: Schema.Boolean,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  PickedCertificate: {},
  LoadedCertificate: {},
  ClickedReadIdentity: {},
  ReadIdentity: { source: Stamp.InkSource, inkId: Schema.optional(Schema.NonEmptyString) },
  CompletedCancelReadIdentityForClose: {},
  ClickedSign: {},
  GotStampMessage: { message: Stamp.Message },
  LoadedLogo: { id: Schema.NonEmptyString },
  RejectedLogo: { code: PdfErrorCodeSchema },
  RemovedLogo: {},
  UnchangedLogo: {},
  CompletedCancelLoadStampLogo: {},
  CompletedCancelLoadHandwriting: {},
  CompletedCancelLoadCertificateHandwriting: {},
  CompletedCancelHandwritingForClose: {},
  LoadedInk: { source: Stamp.InkSource, id: Schema.optional(Schema.NonEmptyString) },
  RejectedInk: {},
  RequiredPassword: {},
  SignedDocuments: {
    documents: Schema.Array(SigningDocument),
    source: Stamp.InkSource,
    inkId: Schema.optional(Schema.NonEmptyString),
  },
  FailedSignature: { documents: Schema.Array(SigningDocument), issue: SigningIssue },
  ClickedDownload: { id: Schema.NonEmptyString },
  DownloadedDocument: {},
  CompletedCancelLoadSigningCertificate: {},
  CompletedCancelSignSessionDocuments: {},
  PickedPlacementPoint: { ...PreviewPage.fields, clientX: Schema.Finite, clientY: Schema.Finite },
  StartedPlacementDrag: { ...PreviewPage.fields, x: Schema.Finite, y: Schema.Finite },
  MovedPlacementDrag: { x: Schema.Finite, y: Schema.Finite },
  EndedPlacementDrag: { x: Schema.Finite, y: Schema.Finite },
  CancelledPlacementDrag: {},
  PressedPlacementKey: { ...PreviewPage.fields, key: PlacementKey, largeStep: Schema.Boolean },
  CompletedManualPlacement: {
    documents: Schema.Array(SigningDocument),
    code: Schema.optional(PdfErrorCodeSchema),
  },
  SelectedPreviewDocument: { id: Schema.NonEmptyString },
  SelectedPreviewPage: { pageIndex: PdfSignaturePlacementInputSchema.fields.pageIndex },
  MountedPreview: PreviewPage.fields,
  UnmountedPreview: PreviewPage.fields,
  RenderedPreview: PreviewPage.fields,
  FailedPreview: { ...PreviewPage.fields, code: PdfErrorCodeSchema },
  CompletedCancelRenderSigningPage: {},
  CompletedCancelRenderSigningPageForClose: {},
  CompletedCancelRenderSigningPageForRemoval: { id: Schema.NonEmptyString },
  ClickedOpen: {},
  ClickedClose: {},
  PickedDocuments: {},
  ClickedPlaceAll: {},
  CompletedPlacement: {
    documents: Schema.Array(SigningDocument),
    code: Schema.optional(PdfErrorCodeSchema),
  },
  CompletedCancelPlaceSigningDocument: {},
  ClickedRemove: { id: Schema.NonEmptyString },
  LoadedDocuments: { documents: Schema.Array(SigningDocument) },
  FailedDocuments: { documents: Schema.Array(SigningDocument), code: PdfErrorCodeSchema },
  OpenedDialog: {},
  ClosedSession: {},
  CompletedCancelLoadSigningDocuments: {},
});
export type Message = typeof Message.Type;

const OpenDialog = Command.define("OpenSigningDialog", {
  messages: [Message.OpenedDialog],
  execute: Effect.gen(function* () {
    yield* Dom.showDialog("#site-signing-dialog", {
      isModal: true,
      focusSelector: "#signing-documents-input",
    }).pipe(Effect.orDie);
    yield* Dom.lockScroll;
    return Message.OpenedDialog();
  }),
});

const CloseSession = Command.define("CloseSigningSession", {
  args: { presentation: Presentation },
  messages: [Message.ClosedSession],
  execute: Effect.fn(function* ({ presentation }) {
    const session = yield* SigningSession;
    const preview = yield* PdfPreview;
    const images = yield* SigningImages;
    const identity = yield* SigningIdentity;
    yield* preview.clear;
    yield* session.clear;
    yield* identity.clear;
    yield* images.clearLogo;
    yield* images.clearInk;
    yield* Effect.sync(() => {
      const password = document.querySelector<HTMLInputElement>("#signing-password");
      if (password !== null) password.value = "";
    });
    if (presentation === "dialog") {
      yield* Dom.closeDialog("#site-signing-dialog").pipe(Effect.orDie);
      yield* Dom.unlockScroll;
    }
    return Message.ClosedSession();
  }),
});

const LoadHandwriting = Command.define("LoadStampHandwriting", {
  messages: [Message.LoadedInk, Message.RejectedInk],
  interrupt: true,
  execute: Effect.gen(function* () {
    const images = yield* SigningImages;
    const text = yield* Effect.sync(
      () => document.querySelector<HTMLInputElement>("#stamp-handwriting")?.value,
    );
    if (text === undefined) return Message.LoadedInk({ source: "typed" });
    return yield* images.setHandwriting(Redacted.make(text)).pipe(
      Effect.match({
        onSuccess: (id) => Message.LoadedInk({ source: "typed", id }),
        onFailure: () => Message.RejectedInk(),
      }),
    );
  }),
});

const LoadCertificateHandwriting = Command.define("LoadCertificateHandwriting", {
  messages: [Message.LoadedInk, Message.RejectedInk],
  execute: Effect.gen(function* () {
    const images = yield* SigningImages;
    const identity = yield* SigningIdentity;
    const cached = yield* identity.credentials;
    if (Option.isNone(cached)) {
      yield* images.clearInk;
      return Message.LoadedInk({ source: "certificate" });
    }
    return yield* images.setHandwriting(Redacted.make(cached.value.profile.subject)).pipe(
      Effect.match({
        onSuccess: (id) => Message.LoadedInk({ source: "certificate", id }),
        onFailure: () => Message.RejectedInk(),
      }),
    );
  }),
});

const LoadLogo = Command.define("LoadStampLogo", {
  messages: [Message.LoadedLogo, Message.RejectedLogo, Message.UnchangedLogo],
  interrupt: true,
  execute: Effect.gen(function* () {
    const images = yield* SigningImages;
    const file = yield* Effect.sync(() => {
      const input = document.querySelector<HTMLInputElement>("#stamp-logo");
      const file = input?.files?.[0];
      if (input !== null) input.value = "";
      return file;
    });
    if (file === undefined) return Message.UnchangedLogo();
    if (file.size > maxStampPngBytes)
      return yield* new PdfError({
        code: PdfErrorCodeValue.stampFailed,
        retryable: false,
        operation: PdfOperationValue.stamp,
        reason: "The selected logo exceeds the PNG input limit.",
      });
    const bytes = yield* File.readAsArrayBuffer(file).pipe(
      Effect.mapError(
        () =>
          new PdfError({
            code: PdfErrorCodeValue.fileReadFailed,
            retryable: true,
            operation: PdfOperationValue.readBlobBytes,
            reason: "The browser could not read the selected PNG logo.",
          }),
      ),
    );
    const id = yield* images.setLogo(Redacted.make(new Uint8Array(bytes)));
    return Message.LoadedLogo({ id });
  }).pipe(
    Effect.catchTag("PdfError", (issue) =>
      Effect.succeed(Message.RejectedLogo({ code: issue.code })),
    ),
  ),
});

const RemoveLogo = Command.define("RemoveStampLogo", {
  messages: [Message.RemovedLogo],
  execute: Effect.gen(function* () {
    const images = yield* SigningImages;
    yield* images.clearLogo;
    return Message.RemovedLogo();
  }),
});

const LoadDocuments = Command.define("LoadSigningDocuments", {
  messages: [Message.LoadedDocuments, Message.FailedDocuments],
  interrupt: true,
  execute: Effect.gen(function* () {
    const session = yield* SigningSession;
    const files = yield* Effect.sync(() => {
      const input = document.querySelector<HTMLInputElement>("#signing-documents-input");
      if (input === null) return undefined;
      const selected = [...(input.files ?? [])];
      input.value = "";
      return selected;
    });
    if (files === undefined) return yield* Effect.die("The signing document input must be mounted");
    const results = yield* Effect.forEach(files, (file) =>
      session.addDocument(file, file.name).pipe(Effect.result),
    );
    const failed = results.find(Result.isFailure);
    const documents = yield* session.documents;
    return failed === undefined
      ? Message.LoadedDocuments({ documents })
      : Message.FailedDocuments({ documents, code: failed.failure.code });
  }),
});

const PlaceDocument = Command.define("PlaceSigningDocument", {
  args: { id: Schema.NonEmptyString },
  messages: [Message.CompletedPlacement],
  interrupt: true,
  execute: Effect.fn(function* ({ id }) {
    const session = yield* SigningSession;
    const placed = yield* session.placeDocument(id).pipe(Effect.result);
    const documents = yield* session.documents;
    return Message.CompletedPlacement({
      documents,
      code: Result.isFailure(placed) ? placed.failure.code : undefined,
    });
  }),
});

const RemoveDocument = Command.define("RemoveSigningDocument", {
  args: { id: Schema.NonEmptyString },
  messages: [Message.LoadedDocuments],
  execute: Effect.fn(function* ({ id }) {
    const session = yield* SigningSession;
    const preview = yield* PdfPreview;
    yield* preview.remove(id);
    yield* session.removeDocument(id);
    const documents = yield* session.documents;
    return Message.LoadedDocuments({ documents });
  }),
});

const MountPreview = Mount.define("MountSigningPreview", {
  args: PreviewPage.fields,
  messages: [Message.MountedPreview],
  execute: ({ id, pageIndex }) => Effect.succeed(Message.MountedPreview({ id, pageIndex })),
});

const RenderPreview = Command.define("RenderSigningPage", {
  args: PreviewPage.fields,
  messages: [Message.RenderedPreview, Message.FailedPreview],
  interrupt: { keyFields: ["id", "pageIndex"], toKey: ({ id, pageIndex }) => `${id}:${pageIndex}` },
  execute: ({ id, pageIndex }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const preview = yield* PdfPreview;
        const canvas = document.querySelector<HTMLCanvasElement>("#signing-preview-canvas");
        if (canvas === null)
          return yield* Effect.die("The mounted PDF preview canvas must be available");
        yield* preview.render(id, pageIndex, canvas);
        return Message.RenderedPreview({ id, pageIndex });
      }),
    ).pipe(
      Effect.catchTag("PdfError", (issue) =>
        Effect.succeed(Message.FailedPreview({ id, pageIndex, code: issue.code })),
      ),
    ),
});

const PlaceAtPointer = Command.define("PlaceSigningSignatureAtPointer", {
  args: { ...PreviewPage.fields, clientX: Schema.Finite, clientY: Schema.Finite },
  messages: [Message.CompletedManualPlacement],
  execute: Effect.fn(function* ({ id, pageIndex, clientX, clientY }) {
    const session = yield* SigningSession;
    const documents = yield* session.documents;
    const page = documents
      .find((document) => document.id === id)
      ?.pages.find((page) => page.index === pageIndex);
    const element = document.querySelector<HTMLElement>("#signing-placement");
    if (page === undefined || element === null)
      return yield* Effect.die("Manual placement requires the selected PDF page");
    const bounds = element.getBoundingClientRect();
    const result = yield* session
      .placeDocument(id, {
        pageIndex,
        x: ((clientX - bounds.left) / bounds.width) * page.width,
        y: ((clientY - bounds.top) / bounds.height) * page.height,
        anchor: "center",
      })
      .pipe(Effect.result);
    const updated = yield* session.documents;
    return Message.CompletedManualPlacement({
      documents: updated,
      code: Result.isFailure(result) ? result.failure.code : undefined,
    });
  }),
});

const DragPlacement = Command.define("DragSigningSignature", {
  args: { ...PreviewPage.fields, deltaX: Schema.Finite, deltaY: Schema.Finite },
  messages: [Message.CompletedManualPlacement],
  execute: Effect.fn(function* ({ id, pageIndex, deltaX, deltaY }) {
    const session = yield* SigningSession;
    const documents = yield* session.documents;
    const selected = documents.find((entry) => entry.id === id);
    const page = selected?.pages.find((page) => page.index === pageIndex);
    const rect = selected?.rect;
    const element = document.querySelector<HTMLElement>("#signing-placement");
    if (
      page === undefined ||
      rect === undefined ||
      rect.pageIndex !== pageIndex ||
      element === null
    )
      return yield* Effect.die("Dragging requires a placed signature on the selected PDF page");
    const bounds = element.getBoundingClientRect();
    const result = yield* session
      .placeDocument(id, {
        pageIndex,
        x: rect.x + (deltaX * page.width) / bounds.width,
        y: rect.y + (deltaY * page.height) / bounds.height,
      })
      .pipe(Effect.result);
    return Message.CompletedManualPlacement({
      documents: yield* session.documents,
      code: Result.isFailure(result) ? result.failure.code : undefined,
    });
  }),
});

const PlaceUsingKeyboard = Command.define("PlaceSigningSignatureUsingKeyboard", {
  args: { ...PreviewPage.fields, key: PlacementKey, largeStep: Schema.Boolean },
  messages: [Message.CompletedManualPlacement],
  execute: Effect.fn(function* ({ id, pageIndex, key, largeStep }) {
    const session = yield* SigningSession;
    const documents = yield* session.documents;
    const document = documents.find((document) => document.id === id);
    const page = document?.pages.find((page) => page.index === pageIndex);
    if (document === undefined || page === undefined)
      return yield* Effect.die("Keyboard placement requires the selected PDF page");
    const rect = document.rect;
    const x =
      rect !== undefined && rect.pageIndex === pageIndex ? rect.x + rect.width / 2 : page.width / 2;
    const y =
      rect !== undefined && rect.pageIndex === pageIndex
        ? rect.y + rect.height / 2
        : page.height / 2;
    const step = largeStep ? 20 : 4;
    const position = Match.value(key).pipe(
      Match.when("Enter", () => ({ x: page.width / 2, y: page.height / 2 })),
      Match.when(" ", () => ({ x: page.width / 2, y: page.height / 2 })),
      Match.when("ArrowLeft", () => ({ x: x - step, y })),
      Match.when("ArrowRight", () => ({ x: x + step, y })),
      Match.when("ArrowUp", () => ({ x, y: y - step })),
      Match.when("ArrowDown", () => ({ x, y: y + step })),
      Match.exhaustive,
    );
    const result = yield* session
      .placeDocument(id, { ...position, pageIndex, anchor: "center" })
      .pipe(Effect.result);
    const updated = yield* session.documents;
    return Message.CompletedManualPlacement({
      documents: updated,
      code: Result.isFailure(result) ? result.failure.code : undefined,
    });
  }),
});

const LoadCertificate = Command.define("LoadSigningCertificate", {
  messages: [Message.LoadedCertificate, Message.FailedSignature],
  interrupt: true,
  execute: Effect.gen(function* () {
    const session = yield* SigningSession;
    const file = yield* Effect.sync(() => {
      const input = document.querySelector<HTMLInputElement>("#signing-certificate-input");
      const file = input?.files?.[0];
      if (input !== null) input.value = "";
      return file;
    });
    if (file === undefined)
      return yield* Effect.die("The selected certificate file must be available");
    return yield* File.readAsArrayBuffer(file).pipe(
      Effect.mapError(
        () =>
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidFormat,
            retryable: true,
            operation: SignatureKitOperationValue.pkcs12Parse,
            reason: "The selected A1 certificate file could not be read.",
          }),
      ),
      Effect.flatMap((bytes) =>
        Effect.gen(function* () {
          const identity = yield* SigningIdentity;
          yield* identity.clear;
          yield* session.setCertificate(Redacted.make(new Uint8Array(bytes)));
        }),
      ),
      Effect.matchEffect({
        onSuccess: () => Effect.succeed(Message.LoadedCertificate()),
        onFailure: (issue) =>
          session.documents.pipe(
            Effect.map((documents) =>
              Message.FailedSignature({ documents, issue: { _tag: issue._tag, code: issue.code } }),
            ),
          ),
      }),
    );
  }),
});

const ReadIdentity = Command.define("ReadSigningIdentity", {
  args: { source: Stamp.InkSource },
  messages: [Message.ReadIdentity, Message.FailedSignature, Message.RequiredPassword],
  interrupt: true,
  execute: Effect.fn(function* ({ source }) {
    const session = yield* SigningSession;
    const identity = yield* SigningIdentity;
    const images = yield* SigningImages;
    const certificate = yield* session.certificate;
    if (Option.isNone(certificate))
      return yield* Effect.die("Reading an identity requires the selected certificate");
    const password = yield* Effect.sync(() => {
      const input = document.querySelector<HTMLInputElement>("#signing-password");
      if (input === null) return undefined;
      const value = input.value;
      input.value = "";
      return value.length === 0 ? undefined : Redacted.make(value);
    });
    if (password === undefined) return Message.RequiredPassword();
    return yield* Effect.gen(function* () {
      const authenticated = yield* identity.authenticate(certificate.value, password);
      const inkId =
        source === "certificate"
          ? yield* images.setHandwriting(Redacted.make(authenticated.profile.subject))
          : undefined;
      return Message.ReadIdentity({ source, inkId });
    }).pipe(
      Effect.catch((issue) =>
        session.documents.pipe(
          Effect.map((documents) =>
            Message.FailedSignature({ documents, issue: { _tag: issue._tag, code: issue.code } }),
          ),
        ),
      ),
    );
  }),
});

const SignDocuments = Command.define("SignSessionDocuments", {
  args: { preferences: Stamp.Model },
  messages: [Message.SignedDocuments, Message.FailedSignature, Message.RequiredPassword],
  interrupt: true,
  execute: Effect.fn(function* ({ preferences }) {
    const session = yield* SigningSession;
    const identity = yield* SigningIdentity;
    const certificate = yield* session.certificate;
    if (Option.isNone(certificate))
      return yield* Effect.die("A signing session must have its selected certificate");
    const password = yield* Effect.sync(() => {
      const input = document.querySelector<HTMLInputElement>("#signing-password");
      if (input === null) return undefined;
      const value = input.value;
      input.value = "";
      return value.length === 0 ? undefined : Redacted.make(value);
    });
    const cached = yield* identity.credentials;
    if (password === undefined && Option.isNone(cached)) return Message.RequiredPassword();
    return yield* Effect.gen(function* () {
      const authenticated =
        password === undefined
          ? yield* Option.match(cached, {
              onNone: () => Effect.die("A password or validated identity must be available"),
              onSome: Effect.succeed,
            })
          : yield* identity.authenticate(certificate.value, password);
      const profile = authenticated.profile;
      const options = {
        pfx: Redacted.value(authenticated.certificate),
        password: authenticated.password,
      };
      const time = yield* Clock.currentTimeMillis;
      const signingTime = new Date(time);
      const images = yield* SigningImages;
      const logo = yield* images.logo;
      const name =
        preferences.inkSource === "certificate"
          ? profile.subject
          : yield* Effect.sync(
              () => document.querySelector<HTMLInputElement>("#stamp-handwriting")?.value,
            );
      if (name === undefined)
        return yield* Effect.die("The selected handwritten source must be available at signing");
      const inkId = yield* images.setHandwriting(Redacted.make(name));
      const ink = yield* images.ink;
      const baseBadge = Stamp.signatureBadge(preferences, profile, signingTime);
      const badge = Option.isNone(logo)
        ? baseBadge
        : { ...baseBadge, logoPng: Redacted.value(logo.value.bytes) };
      const documents = yield* session.documents;
      const results = yield* Effect.forEach(
        documents.filter((document) => document.rect !== undefined),
        (document) =>
          session
            .signDocument(
              document.id,
              { policy: "pades-ades", name: profile.subject, signingTime },
              {
                badge,
                ...(Option.isNone(ink) ? {} : { inkPng: Redacted.value(ink.value.bytes) }),
                rubricInitials: Option.isNone(ink)
                  ? profile.subject
                  : Redacted.value(ink.value.name),
                rubricEveryPage: preferences.rubricEveryPage,
                border: false,
              },
            )
            .pipe(Effect.result),
      ).pipe(Effect.provide(a1SignaturesLayer(options)));
      const updated = yield* session.documents;
      const failed = results.find(Result.isFailure);
      return failed === undefined
        ? Message.SignedDocuments({ documents: updated, source: preferences.inkSource, inkId })
        : Message.FailedSignature({
            documents: updated,
            issue: { _tag: failed.failure._tag, code: failed.failure.code },
          });
    }).pipe(
      Effect.catch((issue) =>
        session.documents.pipe(
          Effect.map((documents) =>
            Message.FailedSignature({ documents, issue: { _tag: issue._tag, code: issue.code } }),
          ),
        ),
      ),
    );
  }),
});

const DownloadDocument = Command.define("DownloadSigningDocument", {
  args: { id: Schema.NonEmptyString },
  messages: [Message.DownloadedDocument, Message.FailedSignature],
  execute: Effect.fn(function* ({ id }) {
    const session = yield* SigningSession;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const blob = yield* session.exportDocument(id);
        const documents = yield* session.documents;
        const selected = documents.find((document) => document.id === id);
        if (selected === undefined)
          return yield* Effect.die("The exported signing document must exist");
        const url = yield* Effect.acquireRelease(
          Effect.sync(() => URL.createObjectURL(blob)),
          (url) => Effect.sync(() => URL.revokeObjectURL(url)),
        );
        yield* Effect.sync(() => {
          const link = document.createElement("a");
          link.href = url;
          link.download = selected.name.replace(/\.pdf$/iu, "") + "-signed.pdf";
          document.body.append(link);
          link.click();
          link.remove();
        });
        yield* Effect.yieldNow;
        return Message.DownloadedDocument();
      }),
    ).pipe(
      Effect.catch((issue) =>
        session.documents.pipe(
          Effect.map((documents) =>
            Message.FailedSignature({ documents, issue: { _tag: issue._tag, code: issue.code } }),
          ),
        ),
      ),
    );
  }),
});

export const init = (
  locale: typeof SiteLocale.Type,
  presentation: Presentation = "dialog",
): Model => ({
  presentation,
  locale,
  open: presentation === "inline",
  busy: false,
  activity: "idle",
  placementQueue: [],
  closing: false,
  documents: [],
  activeDocumentId: undefined,
  previewPageIndex: 0,
  previewState: "idle",
  stamp: Stamp.init(locale),
  certificateReady: false,
  identityReady: false,
  passwordRequired: false,
});

const updateDocuments = (model: Model, documents: readonly SigningDocument[]): Model => {
  if (documents.some((document) => document.id === model.activeDocumentId))
    return { ...model, documents };
  const first = documents[0];
  return {
    ...model,
    documents,
    activeDocumentId: first?.id,
    previewPageIndex: 0,
    previewState: first === undefined ? "idle" : "loading",
  };
};

const foldStamp = Update.foldChild({
  update: Stamp.update,
  read: (model: Model) => Option.some(model.stamp),
  write: (model, stamp) => ({ ...model, stamp }),
  toParentMessage: (message) => Message.GotStampMessage({ message }),
  foldOutMessage:
    (outMessage: Stamp.OutMessage): Update.Step<Model, Message, SigningImages | SigningIdentity> =>
    (model) =>
      Stamp.OutMessage.match(outMessage, {
        PickedLogo: () => ({ model: { ...model, busy: true }, commands: [LoadLogo()] }),
        RemovedLogo: () => ({ model: { ...model, busy: true }, commands: [RemoveLogo()] }),
        RequestedTypedHandwriting: () => ({
          model,
          commands: [LoadHandwriting.Interrupt(() => Message.CompletedCancelLoadHandwriting())],
        }),
        RequestedCertificateHandwriting: () => ({
          model,
          commands: [
            LoadHandwriting.Interrupt(() => Message.CompletedCancelLoadCertificateHandwriting()),
          ],
        }),
      }),
});

export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message, SigningSession | PdfPreview | SigningImages | SigningIdentity> => {
  if (!model.open && message._tag !== "ClickedOpen") return { model };
  if (
    model.closing &&
    message._tag !== "CompletedCancelLoadSigningDocuments" &&
    message._tag !== "CompletedCancelLoadStampLogo" &&
    message._tag !== "CompletedCancelHandwritingForClose" &&
    message._tag !== "CompletedCancelPlaceSigningDocument" &&
    message._tag !== "CompletedCancelLoadSigningCertificate" &&
    message._tag !== "CompletedCancelReadIdentityForClose" &&
    message._tag !== "CompletedCancelSignSessionDocuments" &&
    message._tag !== "ClosedSession" &&
    message._tag !== "UnmountedPreview" &&
    message._tag !== "CompletedCancelRenderSigningPage" &&
    message._tag !== "CompletedCancelRenderSigningPageForClose"
  )
    return { model };
  return Message.match(message, {
    ClickedOpen: () =>
      model.open || model.closing
        ? { model }
        : { model: { ...model, open: true }, commands: [OpenDialog()] },
    ClickedClose: () => ({
      model: { ...model, closing: true, busy: true },
      commands: [LoadDocuments.Interrupt(() => Message.CompletedCancelLoadSigningDocuments())],
    }),
    CompletedCancelLoadSigningDocuments: () => ({
      model,
      commands: [LoadLogo.Interrupt(() => Message.CompletedCancelLoadStampLogo())],
    }),
    CompletedCancelLoadStampLogo: () => ({
      model,
      commands: [LoadHandwriting.Interrupt(() => Message.CompletedCancelHandwritingForClose())],
    }),
    CompletedCancelHandwritingForClose: () => ({
      model,
      commands: [PlaceDocument.Interrupt(() => Message.CompletedCancelPlaceSigningDocument())],
    }),
    CompletedCancelPlaceSigningDocument: () => ({
      model,
      commands: [LoadCertificate.Interrupt(() => Message.CompletedCancelLoadSigningCertificate())],
    }),
    CompletedCancelLoadSigningCertificate: () => ({
      model,
      commands: [ReadIdentity.Interrupt(() => Message.CompletedCancelReadIdentityForClose())],
    }),
    CompletedCancelReadIdentityForClose: () => ({
      model,
      commands: [SignDocuments.Interrupt(() => Message.CompletedCancelSignSessionDocuments())],
    }),
    CompletedCancelSignSessionDocuments: () => ({
      model,
      commands:
        model.activeDocumentId === undefined
          ? [CloseSession({ presentation: model.presentation })]
          : [
              RenderPreview.Interrupt(
                { id: model.activeDocumentId, pageIndex: model.previewPageIndex },
                () => Message.CompletedCancelRenderSigningPageForClose(),
              ),
            ],
    }),
    CompletedCancelRenderSigningPageForClose: () => ({
      model,
      commands: [CloseSession({ presentation: model.presentation })],
    }),
    CompletedCancelRenderSigningPage: () => ({ model }),
    CompletedCancelRenderSigningPageForRemoval: ({ id }) => ({
      model,
      commands: [RemoveDocument({ id })],
    }),
    StartedPlacementDrag: ({ id, pageIndex, x, y }) =>
      model.busy || model.previewState !== "ready"
        ? { model }
        : { model: { ...model, drag: { id, pageIndex, startX: x, startY: y, x, y } } },
    MovedPlacementDrag: ({ x, y }) =>
      model.drag === undefined ? { model } : { model: { ...model, drag: { ...model.drag, x, y } } },
    CancelledPlacementDrag: () => ({ model: { ...model, drag: undefined } }),
    EndedPlacementDrag: ({ x, y }) =>
      model.drag === undefined
        ? { model }
        : {
            model: { ...model, drag: undefined, busy: true, error: undefined },
            commands: [
              DragPlacement({
                id: model.drag.id,
                pageIndex: model.drag.pageIndex,
                deltaX: x - model.drag.startX,
                deltaY: y - model.drag.startY,
              }),
            ],
          },
    PickedPlacementPoint: ({ id, pageIndex, clientX, clientY }) =>
      model.busy || model.previewState !== "ready"
        ? { model }
        : {
            model: { ...model, busy: true, error: undefined },
            commands: [PlaceAtPointer({ id, pageIndex, clientX, clientY })],
          },
    PressedPlacementKey: ({ id, pageIndex, key, largeStep }) =>
      model.busy || model.previewState !== "ready"
        ? { model }
        : {
            model: { ...model, busy: true, error: undefined },
            commands: [PlaceUsingKeyboard({ id, pageIndex, key, largeStep })],
          },
    CompletedManualPlacement: ({
      documents,
      code,
    }): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > => ({
      model: {
        ...updateDocuments(model, documents),
        busy: false,
        error: code === undefined ? undefined : { _tag: "PdfError", code },
      },
    }),
    SelectedPreviewDocument: ({
      id,
    }): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > =>
      model.busy || model.activeDocumentId === id
        ? { model }
        : {
            model: { ...model, activeDocumentId: id, previewPageIndex: 0, previewState: "loading" },
          },
    SelectedPreviewPage: ({
      pageIndex,
    }): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > =>
      model.busy || model.previewPageIndex === pageIndex
        ? { model }
        : { model: { ...model, previewPageIndex: pageIndex, previewState: "loading" } },
    MountedPreview: ({ id, pageIndex }) =>
      model.activeDocumentId === id && model.previewPageIndex === pageIndex
        ? { model, commands: [RenderPreview({ id, pageIndex })] }
        : { model },
    UnmountedPreview: ({ id, pageIndex }) => ({
      model,
      commands: [
        RenderPreview.Interrupt({ id, pageIndex }, () =>
          Message.CompletedCancelRenderSigningPage(),
        ),
      ],
    }),
    RenderedPreview: ({
      id,
      pageIndex,
    }): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > =>
      model.activeDocumentId === id && model.previewPageIndex === pageIndex
        ? { model: { ...model, previewState: "ready" } }
        : { model },
    FailedPreview: ({
      id,
      pageIndex,
      code,
    }): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > =>
      model.activeDocumentId === id && model.previewPageIndex === pageIndex
        ? { model: { ...model, previewState: "failed", error: { _tag: "PdfError", code } } }
        : { model },
    ClickedPlaceAll: (): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > => {
      if (model.busy) return { model };
      const [first, ...remaining] = model.documents;
      return first === undefined
        ? { model }
        : {
            model: {
              ...model,
              busy: true,
              activity: "placing",
              error: undefined,
              placementQueue: remaining.map((document) => document.id),
            },
            commands: [PlaceDocument({ id: first.id })],
          };
    },
    CompletedPlacement: ({
      documents,
      code,
    }): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > => {
      const [next, ...remaining] = model.placementQueue;
      const updated: Model = {
        ...model,
        documents,
        error: code === undefined ? model.error : { _tag: "PdfError", code },
        placementQueue: remaining,
      };
      return next === undefined
        ? { model: { ...updated, busy: false, activity: "idle" } }
        : { model: updated, commands: [PlaceDocument({ id: next })] };
    },
    PickedDocuments: (): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > =>
      model.busy || !model.open
        ? { model }
        : {
            model: { ...model, busy: true, activity: "reading", error: undefined },
            commands: [LoadDocuments()],
          },
    ClickedRemove: ({ id }) =>
      model.busy
        ? { model }
        : {
            model: { ...model, busy: true },
            commands:
              model.activeDocumentId === id
                ? [
                    RenderPreview.Interrupt({ id, pageIndex: model.previewPageIndex }, () =>
                      Message.CompletedCancelRenderSigningPageForRemoval({ id }),
                    ),
                  ]
                : [RemoveDocument({ id })],
          },
    LoadedDocuments: ({
      documents,
    }): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > => ({
      model: { ...updateDocuments(model, documents), busy: false, activity: "idle" },
    }),
    FailedDocuments: ({
      documents,
      code,
    }): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > => ({
      model: {
        ...updateDocuments(model, documents),
        error: { _tag: "PdfError", code },
        busy: false,
        activity: "idle",
      },
    }),
    PickedCertificate: (): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > =>
      model.busy
        ? { model }
        : {
            model: {
              ...model,
              busy: true,
              activity: "certificate",
              certificateReady: false,
              identityReady: false,
              error: undefined,
            },
            commands: [LoadCertificate()],
          },
    LoadedCertificate: (): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > => ({
      model: { ...model, busy: false, activity: "idle", certificateReady: true },
    }),
    ClickedReadIdentity: (): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > =>
      model.busy || !model.certificateReady
        ? { model }
        : {
            model: {
              ...model,
              busy: true,
              activity: "certificate",
              identityReady: false,
              error: undefined,
              passwordRequired: false,
            },
            commands: [ReadIdentity({ source: model.stamp.inkSource })],
          },
    ReadIdentity: ({ source, inkId }) => {
      const next: Model = { ...model, busy: false, activity: "idle", identityReady: true };
      return source === "certificate"
        ? foldStamp(next, Stamp.Message.LoadedInk({ source, id: inkId }))
        : { model: next };
    },
    ClickedSign: (): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > =>
      model.busy ||
      !model.certificateReady ||
      !model.documents.some((document) => document.rect !== undefined)
        ? { model }
        : {
            model: {
              ...model,
              busy: true,
              activity: "signing",
              error: undefined,
              passwordRequired: false,
            },
            commands: [SignDocuments({ preferences: model.stamp })],
          },
    LoadedLogo: ({ id }) => foldStamp({ ...model, busy: false }, Stamp.Message.LoadedLogo({ id })),
    CompletedCancelLoadHandwriting: () =>
      model.stamp.inkSource !== "typed" ? { model } : { model, commands: [LoadHandwriting()] },
    CompletedCancelLoadCertificateHandwriting: () =>
      model.stamp.inkSource !== "certificate"
        ? { model }
        : { model, commands: [LoadCertificateHandwriting()] },
    LoadedInk: ({ source, id }) => foldStamp(model, Stamp.Message.LoadedInk({ source, id })),
    RejectedInk: () => foldStamp(model, Stamp.Message.RejectedInk()),
    RejectedLogo: ({ code }) =>
      foldStamp({ ...model, busy: false }, Stamp.Message.RejectedLogo({ code })),
    RemovedLogo: () => foldStamp({ ...model, busy: false }, Stamp.Message.RemovedLogo()),
    UnchangedLogo: () => ({ model: { ...model, busy: false } }),
    GotStampMessage: ({ message }) =>
      model.busy &&
      message._tag !== "MountedInk" &&
      message._tag !== "LostInk" &&
      message._tag !== "InkPreviewLoaded" &&
      message._tag !== "InkPreviewFailed" &&
      message._tag !== "MountedLogo" &&
      message._tag !== "LostLogo" &&
      message._tag !== "LogoPreviewLoaded" &&
      message._tag !== "LogoPreviewFailed"
        ? { model }
        : foldStamp(model, message),
    RequiredPassword: (): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > => ({
      model: { ...model, busy: false, activity: "idle", passwordRequired: true },
    }),
    SignedDocuments: ({
      documents,
      source,
      inkId,
    }): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > =>
      foldStamp(
        {
          ...updateDocuments(model, documents),
          busy: false,
          activity: "idle",
          identityReady: true,
        },
        Stamp.Message.LoadedInk({ source, id: inkId }),
      ),
    FailedSignature: ({
      documents,
      issue,
    }): Update.Return<
      Model,
      Message,
      SigningSession | PdfPreview | SigningImages | SigningIdentity
    > => ({
      model: {
        ...model,
        documents,
        error: issue,
        busy: false,
        activity: "idle",
        identityReady: issue._tag === "SignatureKitError" ? false : model.identityReady,
      },
    }),
    ClickedDownload: ({ id }) =>
      model.busy
        ? { model }
        : { model: { ...model, busy: true }, commands: [DownloadDocument({ id })] },
    DownloadedDocument: () => ({ model: { ...model, busy: false } }),
    OpenedDialog: () => ({ model }),
    ClosedSession: () => ({ model: init(model.locale, model.presentation) }),
  });
};

export const subscriptions = Subscription.lift(Stamp.subscriptions)<Model, Message>({
  read: (model) => Option.some(model.stamp),
  toParentMessage: (message) => Message.GotStampMessage({ message }),
  when: (model) => model.open && !model.closing,
});

export const view = Submodel.defineView<Model, Message>((model, h) => {
  const options = { locale: model.locale };
  const active = model.documents.find((document) => document.id === model.activeDocumentId);
  const activePage = active?.pages.find((page) => page.index === model.previewPageIndex);
  const panel = model.presentation === "inline" ? h.div : h.dialog;
  return h.section(
    [h.Class("landing-section")],
    [
      model.presentation === "inline"
        ? h.empty
        : h.p([h.Class("eyebrow")], [m.signer_eyebrow({}, options)]),
      model.presentation === "inline" ? h.empty : h.h2([], [m.signer_title({}, options)]),
      model.presentation === "inline" ? h.empty : h.p([], [m.signer_lead({}, options)]),
      model.presentation === "inline"
        ? h.empty
        : h.button(
            [
              h.Id("home-open-signer"),
              h.Type("button"),
              h.Attribute("aria-expanded", String(model.open)),
              h.Attribute("aria-controls", "site-signing-dialog"),
              h.OnClick(Message.ClickedOpen()),
            ],
            [m.signer_open({}, options)],
          ),
      panel(
        [
          h.Id(model.presentation === "inline" ? "site-signing-panel" : "site-signing-dialog"),
          h.Class(model.presentation === "inline" ? "signing-inline" : "signing-dialog"),
          ...(model.presentation === "dialog"
            ? [h.Open(model.open), h.OnCancelPreventDefault(Message.ClickedClose())]
            : []),
          h.Attribute("aria-labelledby", "signing-title"),
          h.Attribute("aria-describedby", "signing-description"),
        ],
        [
          h.div(
            [h.Class("signing-heading")],
            [
              h.h2([h.Id("signing-title")], [m.signer_dialog_title({}, options)]),
              h.button(
                [
                  h.Id("signing-close"),
                  h.Type("button"),
                  h.Disabled(model.closing),
                  h.OnClick(Message.ClickedClose()),
                ],
                [
                  model.presentation === "inline"
                    ? m.autosign_reset({}, options)
                    : m.signer_close({}, options),
                ],
              ),
            ],
          ),
          h.p([h.Id("signing-description")], [m.signer_dialog_desc({}, options)]),
          h.label(
            [h.Attribute("for", "signing-documents-input")],
            [m.signer_dropzone({}, options)],
          ),
          h.input([
            h.Id("signing-documents-input"),
            h.Type("file"),
            h.Accept("application/pdf,.pdf"),
            h.Multiple(true),
            h.Disabled(model.busy),
            h.OnChange(() => Message.PickedDocuments()),
          ]),
          h.p(
            [h.Attribute("role", "status")],
            [
              Match.value(model.activity).pipe(
                Match.when("idle", () => ""),
                Match.when("reading", () => m.signer_status_reading_pdfs({}, options)),
                Match.when("placing", () => m.signer_place_running({}, options)),
                Match.when("certificate", () => m.signer_status_reading_cert({}, options)),
                Match.when("signing", () => m.signer_status_signing({}, options)),
                Match.exhaustive,
              ),
            ],
          ),
          model.error === undefined
            ? h.empty
            : h.p(
                [h.Attribute("role", "alert")],
                [
                  errorMessage(model.error, {
                    locale: model.locale,
                    catalogs: [pdfErrorMessages, signatureKitErrorMessages, cmsErrorMessages],
                  }),
                ],
              ),
          h.button(
            [
              h.Id("signing-place-all"),
              h.Type("button"),
              h.Disabled(model.busy || model.documents.length === 0),
              h.OnClick(Message.ClickedPlaceAll()),
            ],
            [m.signer_place_all({ count: model.documents.length }, options)],
          ),
          model.open && !model.closing && active !== undefined && activePage !== undefined
            ? h.div(
                [h.Class("signing-preview")],
                [
                  h.div(
                    [
                      h.Attribute("role", "group"),
                      h.Attribute("aria-label", m.signer_doc_label({}, options)),
                    ],
                    model.documents.map((document) =>
                      h.button(
                        [
                          h.Type("button"),
                          h.Disabled(model.busy),
                          h.Attribute(
                            "aria-pressed",
                            String(document.id === model.activeDocumentId),
                          ),
                          h.OnClick(Message.SelectedPreviewDocument({ id: document.id })),
                        ],
                        [document.name],
                      ),
                    ),
                  ),
                  h.div(
                    [h.Attribute("role", "group"), h.Attribute("aria-label", active.name)],
                    active.pages.map((page) =>
                      h.button(
                        [
                          h.Type("button"),
                          h.Disabled(model.busy),
                          h.DataAttribute("preview-page", String(page.index)),
                          h.Attribute(
                            "aria-pressed",
                            String(page.index === model.previewPageIndex),
                          ),
                          h.OnClick(Message.SelectedPreviewPage({ pageIndex: page.index })),
                        ],
                        [m.signer_doc_page({ page: page.index + 1 }, options)],
                      ),
                    ),
                  ),
                  h.div(
                    [
                      h.Id("signing-placement"),
                      h.Class("signing-placement"),
                      h.Attribute("role", "button"),
                      h.Tabindex(model.busy ? -1 : 0),
                      h.Attribute(
                        "aria-disabled",
                        String(model.busy || model.previewState !== "ready"),
                      ),
                      h.Attribute(
                        "aria-label",
                        m.signer_aria_page_placement({ page: activePage.index + 1 }, options),
                      ),
                      h.OnPointerDown(
                        (
                          _pointerType,
                          button,
                          _screenX,
                          _screenY,
                          _time,
                          clientX,
                          clientY,
                          _pointerId,
                          target,
                        ) =>
                          button === 0 &&
                          !model.busy &&
                          target !== document.getElementById("signing-placement-mark")
                            ? Option.some(
                                Message.PickedPlacementPoint({
                                  id: active.id,
                                  pageIndex: activePage.index,
                                  clientX,
                                  clientY,
                                }),
                              )
                            : Option.none(),
                      ),
                      h.OnPointerMove((x, y) => Option.some(Message.MovedPlacementDrag({ x, y }))),
                      h.OnPointerUp((x, y) => Option.some(Message.EndedPlacementDrag({ x, y }))),
                      h.OnPointerLeave(() => Option.some(Message.CancelledPlacementDrag())),
                      h.OnTouchCancel(Message.CancelledPlacementDrag()),
                      h.OnKeyDownSelfPreventDefault((key, modifiers) =>
                        !model.busy &&
                        !modifiers.ctrlKey &&
                        !modifiers.altKey &&
                        !modifiers.metaKey &&
                        Schema.is(PlacementKey)(key)
                          ? Option.some(
                              Message.PressedPlacementKey({
                                id: active.id,
                                pageIndex: activePage.index,
                                key,
                                largeStep: modifiers.shiftKey,
                              }),
                            )
                          : Option.none(),
                      ),
                    ],
                    [
                      h.canvas([
                        h.Key(`${active.id}:${activePage.index}`),
                        h.Id("signing-preview-canvas"),
                        h.DataAttribute("page", String(activePage.index)),
                        h.DataAttribute("state", model.previewState),
                        h.Attribute("role", "img"),
                        h.Attribute(
                          "aria-label",
                          active.name +
                            " · " +
                            m.signer_doc_page({ page: activePage.index + 1 }, options),
                        ),
                        h.Style({ width: `${activePage.width}px` }),
                        h.OnMount(MountPreview({ id: active.id, pageIndex: activePage.index })),
                        h.OnUnmount(
                          Message.UnmountedPreview({ id: active.id, pageIndex: activePage.index }),
                        ),
                      ]),
                      active.rect !== undefined && active.rect.pageIndex === activePage.index
                        ? h.div(
                            [
                              h.Id("signing-placement-mark"),
                              h.Class("signing-placement-mark"),
                              h.Attribute("aria-hidden", "true"),
                              h.OnPointerDown((_pointerType, button, x, y) =>
                                button === 0 && !model.busy
                                  ? Option.some(
                                      Message.StartedPlacementDrag({
                                        id: active.id,
                                        pageIndex: activePage.index,
                                        x,
                                        y,
                                      }),
                                    )
                                  : Option.none(),
                              ),
                              h.Style({
                                left: `${(active.rect.x / activePage.width) * 100}%`,
                                top: `${(active.rect.y / activePage.height) * 100}%`,
                                width: `${(active.rect.width / activePage.width) * 100}%`,
                                height: `${(active.rect.height / activePage.height) * 100}%`,
                                transform:
                                  model.drag === undefined
                                    ? "none"
                                    : `translate(${model.drag.x - model.drag.startX}px, ${model.drag.y - model.drag.startY}px)`,
                              }),
                            ],
                            ["A1"],
                          )
                        : h.empty,
                    ],
                  ),
                ],
              )
            : h.empty,
          h.label(
            [h.Attribute("for", "signing-certificate-input")],
            [m.signer_upload_pfx({}, options)],
          ),
          h.input([
            h.Id("signing-certificate-input"),
            h.Type("file"),
            h.Accept(".pfx,.p12"),
            h.Disabled(model.busy),
            h.OnChange(() => Message.PickedCertificate()),
          ]),
          h.p(
            [
              h.Id("signing-certificate-status"),
              h.DataAttribute("loaded", String(model.certificateReady)),
            ],
            [model.certificateReady ? m.signer_status_cert_loaded({}, options) : ""],
          ),
          h.label([h.Attribute("for", "signing-password")], [m.signer_cert_password({}, options)]),
          h.input([
            h.Id("signing-password"),
            h.Type("password"),
            h.Autocomplete("off"),
            h.Disabled(model.busy),
          ]),
          h.button(
            [
              h.Id("signing-read-identity"),
              h.Type("button"),
              h.Disabled(model.busy || !model.certificateReady),
              h.OnClick(Message.ClickedReadIdentity()),
            ],
            [m.signer_continue({}, options)],
          ),
          h.p(
            [
              h.Id("signing-identity-status"),
              h.DataAttribute("verified", String(model.identityReady)),
            ],
            [model.identityReady ? m.signer_identity_ready({}, options) : ""],
          ),
          model.passwordRequired
            ? h.p([h.Attribute("role", "alert")], [m.signer_error_password_required({}, options)])
            : h.empty,
          h.submodel({
            slotId: "signing-stamp",
            model: model.stamp,
            view: Stamp.view,
            viewInputs: { disabled: model.busy },
            toParentMessage: (message) => Message.GotStampMessage({ message }),
          }),
          h.button(
            [
              h.Id("signing-sign"),
              h.Type("button"),
              h.Disabled(
                model.busy ||
                  !model.certificateReady ||
                  !model.documents.some((document) => document.rect !== undefined),
              ),
              h.OnClick(Message.ClickedSign()),
            ],
            [
              m.signer_sign_button(
                {
                  count: model.documents.filter((document) => document.rect !== undefined).length,
                  noun:
                    model.documents.length === 1
                      ? m.signer_doc_one({}, options)
                      : m.signer_doc_many({}, options),
                },
                options,
              ),
            ],
          ),
          h.ul(
            [h.Id("signing-documents")],
            model.documents.map((document) =>
              h.li(
                [
                  h.DataAttribute("placed", String(document.rect !== undefined)),
                  h.DataAttribute("signed", String(document.signed)),
                ],
                [
                  h.span([], [document.name]),
                  h.span(
                    [h.Class("signing-document-status")],
                    [
                      Match.value(document).pipe(
                        Match.when({ signed: true }, () =>
                          m.signer_step4_summary_signed({}, options),
                        ),
                        Match.when({ rect: Match.defined }, ({ rect }) =>
                          m.signer_doc_page({ page: rect.pageIndex + 1 }, options),
                        ),
                        Match.orElse(() => m.signer_doc_not_placed({}, options)),
                      ),
                    ],
                  ),
                  h.button(
                    [
                      h.Type("button"),
                      h.Disabled(model.busy),
                      h.Attribute(
                        "aria-label",
                        m.signer_aria_remove({ name: document.name }, options),
                      ),
                      h.DataAttribute("action", "remove"),
                      h.OnClick(Message.ClickedRemove({ id: document.id })),
                    ],
                    ["×"],
                  ),
                  document.signed
                    ? h.button(
                        [
                          h.Type("button"),
                          h.Disabled(model.busy),
                          h.DataAttribute("action", "download"),
                          h.Attribute(
                            "aria-label",
                            m.signer_aria_download({ name: document.name }, options),
                          ),
                          h.OnClick(Message.ClickedDownload({ id: document.id })),
                        ],
                        [m.signer_aria_download({ name: document.name }, options)],
                      )
                    : h.empty,
                ],
              ),
            ),
          ),
        ],
      ),
    ],
  );
});
