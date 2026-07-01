import type {
  RemoteSignatureRequestInput,
  RemoteSignatureRequestProps,
} from "@signature-kit/core/config";
import { Effect } from "effect";

const noopPlanStatusSession = {
  emit: () => Effect.void,
  done: () => Effect.void,
  note: () => Effect.void,
};

const remoteSignatureRequestProps = (
  input: RemoteSignatureRequestInput,
): RemoteSignatureRequestProps => {
  const [firstDocument, ...restDocuments] = input.documents;
  return {
    title: input.title,
    documents: [
      {
        fileName: firstDocument.fileName,
        mimeType: firstDocument.mimeType,
        contentBase64: Buffer.from(firstDocument.content).toString("base64"),
      },
      ...restDocuments.map((document) => ({
        fileName: document.fileName,
        mimeType: document.mimeType,
        contentBase64: Buffer.from(document.content).toString("base64"),
      })),
    ],
    recipients: input.recipients,
    ...(input.subject === undefined ? {} : { subject: input.subject }),
    ...(input.message === undefined ? {} : { message: input.message }),
    ...(input.send === undefined ? {} : { send: input.send }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    ...(input.redirectUrl === undefined ? {} : { redirectUrl: input.redirectUrl }),
  };
};

export const reconcileInput = (id: string, input: RemoteSignatureRequestInput) => ({
  id,
  instanceId: `${id}-instance`,
  news: remoteSignatureRequestProps(input),
  olds: undefined,
  output: undefined,
  session: noopPlanStatusSession,
  bindings: [],
});
