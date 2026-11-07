import * as Domain from "@alchemy.run/domain";
import { Effect, Schema } from "effect";

const DocumentStatus = Schema.Literals(["queued", "working", "completed", "failed", "cancelled"]);
const BatchStatus = Schema.Literals(["idle", "running", "completed", "failed", "cancelled"]);
const Mode = Schema.Literals(["prepare", "sign"]);
const Document = Schema.Struct({ id: Schema.String, status: DocumentStatus });
export const SigningState = Schema.Struct({
  batchId: Schema.Int,
  mode: Schema.NullOr(Mode),
  status: BatchStatus,
  activeDocumentId: Schema.NullOr(Schema.String),
  documents: Schema.Array(Document),
});

export class InvalidTransition extends Domain.Rejection("InvalidTransition") {}
export class BatchStarted extends Domain.Event("BatchStarted", {
  batchId: Schema.Int,
  mode: Mode,
  documentIds: Schema.Array(Schema.String),
}) {}
export class SigningStarted extends Domain.Event("SigningStarted") {}
export class DocumentStarted extends Domain.Event("DocumentStarted", {
  documentId: Schema.String,
}) {}
export class DocumentCompleted extends Domain.Event("DocumentCompleted", {
  documentId: Schema.String,
}) {}
export class DocumentFailed extends Domain.Event("DocumentFailed", { documentId: Schema.String }) {}
export class BatchCompleted extends Domain.Event("BatchCompleted") {}
export class BatchFailed extends Domain.Event("BatchFailed") {}
export class BatchCancelled extends Domain.Event("BatchCancelled") {}

export class StartBatch extends Domain.Command("StartBatch", {
  target: Schema.String,
  input: { batchId: Schema.Int, mode: Mode, documentIds: Schema.Array(Schema.String) },
  events: [BatchStarted],
  rejects: [InvalidTransition],
}) {}
export class StartSigning extends Domain.Command("StartSigning", {
  target: Schema.String,
  input: { batchId: Schema.Int },
  events: [SigningStarted],
  rejects: [InvalidTransition],
}) {}
export class StartDocument extends Domain.Command("StartDocument", {
  target: Schema.String,
  input: { batchId: Schema.Int, documentId: Schema.String },
  events: [DocumentStarted],
  rejects: [InvalidTransition],
}) {}
export class CompleteDocument extends Domain.Command("CompleteDocument", {
  target: Schema.String,
  input: { batchId: Schema.Int, documentId: Schema.String },
  events: [DocumentCompleted],
  rejects: [InvalidTransition],
}) {}
export class FailDocument extends Domain.Command("FailDocument", {
  target: Schema.String,
  input: { batchId: Schema.Int, documentId: Schema.String },
  events: [DocumentFailed],
  rejects: [InvalidTransition],
}) {}
export class CompleteBatch extends Domain.Command("CompleteBatch", {
  target: Schema.String,
  input: { batchId: Schema.Int },
  events: [BatchCompleted],
  rejects: [InvalidTransition],
}) {}
export class FailBatch extends Domain.Command("FailBatch", {
  target: Schema.String,
  input: { batchId: Schema.Int },
  events: [BatchFailed],
  rejects: [InvalidTransition],
}) {}
export class CancelBatch extends Domain.Command("CancelBatch", {
  target: Schema.String,
  input: { batchId: Schema.Int },
  events: [BatchCancelled],
  rejects: [InvalidTransition],
}) {}

export class SigningSession extends Domain.Aggregate("SigningSession", {
  id: Schema.String,
  state: SigningState,
  initial: { batchId: 0, mode: null, status: "idle", activeDocumentId: null, documents: [] },
  commands: [
    StartBatch,
    StartSigning,
    StartDocument,
    CompleteDocument,
    FailDocument,
    CompleteBatch,
    FailBatch,
    CancelBatch,
  ],
  decide: {
    StartBatch: (s, c) =>
      s.status === "running" ||
      c.batchId <= s.batchId ||
      c.documentIds.length === 0 ||
      c.documentIds.length > 100 ||
      c.documentIds.some((id) => id.length === 0) ||
      new Set(c.documentIds).size !== c.documentIds.length
        ? new InvalidTransition()
        : [new BatchStarted({ batchId: c.batchId, mode: c.mode, documentIds: c.documentIds })],
    StartSigning: (s, c) =>
      s.status !== "running" || s.mode !== "prepare" || s.batchId !== c.batchId
        ? new InvalidTransition()
        : [new SigningStarted()],
    StartDocument: (s, c) =>
      s.status !== "running" ||
      s.batchId !== c.batchId ||
      s.activeDocumentId !== null ||
      s.documents.find((d) => d.status === "queued")?.id !== c.documentId
        ? new InvalidTransition()
        : [new DocumentStarted({ documentId: c.documentId })],
    CompleteDocument: (s, c) =>
      s.status !== "running" || s.batchId !== c.batchId || s.activeDocumentId !== c.documentId
        ? new InvalidTransition()
        : [new DocumentCompleted({ documentId: c.documentId })],
    FailDocument: (s, c) =>
      s.status !== "running" || s.batchId !== c.batchId || s.activeDocumentId !== c.documentId
        ? new InvalidTransition()
        : [new DocumentFailed({ documentId: c.documentId })],
    CompleteBatch: (s, c) =>
      s.status !== "running" ||
      s.batchId !== c.batchId ||
      s.documents.some((d) => d.status === "queued" || d.status === "working")
        ? new InvalidTransition()
        : [new BatchCompleted()],
    FailBatch: (s, c) =>
      s.status !== "running" || s.batchId !== c.batchId
        ? new InvalidTransition()
        : [new BatchFailed()],
    CancelBatch: (s, c) =>
      s.status !== "running" || s.batchId !== c.batchId
        ? new InvalidTransition()
        : [new BatchCancelled()],
  },
  evolve: {
    BatchStarted: (_, e): Schema.Schema.Type<typeof SigningState> => ({
      batchId: e.batchId,
      mode: e.mode,
      status: "running",
      activeDocumentId: null,
      documents: e.documentIds.map((id): Schema.Schema.Type<typeof Document> => ({
        id,
        status: "queued",
      })),
    }),
    SigningStarted: (s): Schema.Schema.Type<typeof SigningState> => ({ ...s, mode: "sign" }),
    DocumentStarted: (s, e): Schema.Schema.Type<typeof SigningState> => ({
      ...s,
      activeDocumentId: e.documentId,
      documents: s.documents.map((d): Schema.Schema.Type<typeof Document> =>
        d.id === e.documentId ? { ...d, status: "working" } : d,
      ),
    }),
    DocumentCompleted: (s, e): Schema.Schema.Type<typeof SigningState> => ({
      ...s,
      activeDocumentId: null,
      documents: s.documents.map((d): Schema.Schema.Type<typeof Document> =>
        d.id === e.documentId ? { ...d, status: "completed" } : d,
      ),
    }),
    DocumentFailed: (s, e): Schema.Schema.Type<typeof SigningState> => ({
      ...s,
      activeDocumentId: null,
      documents: s.documents.map((d): Schema.Schema.Type<typeof Document> =>
        d.id === e.documentId ? { ...d, status: "failed" } : d,
      ),
    }),
    BatchCompleted: (s): Schema.Schema.Type<typeof SigningState> => ({ ...s, status: "completed" }),
    BatchFailed: (s): Schema.Schema.Type<typeof SigningState> => ({
      ...s,
      status: "failed",
      activeDocumentId: null,
      documents: s.documents.map((d): Schema.Schema.Type<typeof Document> =>
        d.status === "working" || d.status === "queued" ? { ...d, status: "failed" } : d,
      ),
    }),
    BatchCancelled: (s): Schema.Schema.Type<typeof SigningState> => ({
      ...s,
      status: "cancelled",
      activeDocumentId: null,
      documents: s.documents.map((d): Schema.Schema.Type<typeof Document> =>
        d.status === "working" || d.status === "queued" ? { ...d, status: "cancelled" } : d,
      ),
    }),
  },
  read: { validate: () => Effect.void },
}) {}

export class SigningModel extends Domain.Model("SigningModel", { aggregates: [SigningSession] }) {}
export class SigningApi extends Domain.Api("SigningApi", {
  model: SigningModel,
  commands: [
    "StartBatch",
    "StartSigning",
    "StartDocument",
    "CompleteDocument",
    "FailDocument",
    "CompleteBatch",
    "FailBatch",
    "CancelBatch",
  ],
  aggregates: ["SigningSession"],
}) {}
