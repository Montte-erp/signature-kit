import { loadA1SignerAdapter, parseA1CertificateProfile } from "@signature-kit/a1/signer";
import { A1CertificateProfileSchema } from "@signature-kit/a1/config";
import { PdfError, PdfPrepareAndSignInputSchema } from "@signature-kit/pdf/config";
import { CmsError } from "@signature-kit/cms/config";
import { prepareAndSignPdf } from "@signature-kit/pdf/workflow";
import { Signatures, SignatureKitError } from "@signature-kit/signatures";
import { Effect, Layer, Redacted, Schema, SchemaTransformation } from "effect";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { A1CertificateLoadInputSchema } from "./config.js";
import { SignatureSession, signatureSessionLayer } from "@signature-kit/signatures/session";

const WorkerSignatureKitErrorSchema = SignatureKitError.mapFields((fields) => ({
  ...fields,
  operation: Schema.optional(Schema.String),
})).pipe(
  Schema.decodeTo(
    Schema.instanceOf(SignatureKitError),
    SchemaTransformation.transform({
      decode: (value) => new SignatureKitError(value),
      encode: (value) => value,
    }),
  ),
);

export const A1WorkerRequests = RpcGroup.make(
  Rpc.make("Initialize", {
    payload: A1CertificateLoadInputSchema,
    success: Schema.Struct({
      generation: Schema.Int.check(Schema.isGreaterThan(0)),
      profile: A1CertificateProfileSchema,
    }),
    error: WorkerSignatureKitErrorSchema,
  }),
  Rpc.make("Sign", {
    payload: Schema.Struct({
      generation: Schema.Int.check(Schema.isGreaterThan(0)),
      input: PdfPrepareAndSignInputSchema,
    }),
    success: Schema.Uint8Array,
    error: Schema.Union([PdfError, CmsError, WorkerSignatureKitErrorSchema]),
  }),
  Rpc.make("Dispose", { success: Schema.Void }),
);

export const a1WorkerHandlersLayer = A1WorkerRequests.toLayer(
  Effect.gen(function* () {
    const session = yield* SignatureSession;
    return A1WorkerRequests.of({
      Initialize: Effect.fn(function* (input) {
        const options = { pfx: input.pfx, password: Redacted.make(input.password) };
        const loaded = yield* session.initialize(
          Effect.gen(function* () {
            const profile = yield* parseA1CertificateProfile(options);
            const adapter = yield* loadA1SignerAdapter(options);
            return { adapter, value: profile };
          }),
        );
        return { generation: loaded.generation, profile: loaded.value };
      }),
      Sign: ({ generation, input }) =>
        session.use(generation, (adapter) =>
          // effect-boundary: worker signing assembly [allow-provide: session supplies the active signer]
          prepareAndSignPdf(input).pipe(Effect.provideService(Signatures, adapter)),
        ),
      Dispose: session.dispose,
    });
  }),
).pipe(
  // effect-boundary: worker runtime assembly [allow-provide: worker handler owns the signing session lifetime]
  Layer.provide(
    signatureSessionLayer({
      initialization: "A1 worker session was replaced or disposed.",
      unavailableReason: "A1 worker session is not initialized or has been replaced.",
    }),
  ),
);
