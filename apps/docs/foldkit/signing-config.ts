import { A1CertificateProfileSchema } from "@signature-kit/a1/config";
import { PdfError, PdfPrepareAndSignInputSchema } from "@signature-kit/pdf/config";
import { CmsError } from "@signature-kit/cms/config";
import { SignatureKitError } from "@signature-kit/signatures";
import { Schema, SchemaTransformation } from "effect";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

export const SigningInitializeSchema = Schema.Struct({
  pfx: Schema.Uint8Array,
  password: Schema.String,
});

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

export const SigningWorkerRequests = RpcGroup.make(
  Rpc.make("Initialize", {
    payload: SigningInitializeSchema,
    success: Schema.Struct({
      generation: Schema.Int.check(Schema.isGreaterThan(0)),
      profile: A1CertificateProfileSchema,
    }),
    error: WorkerSignatureKitErrorSchema,
  }),
  Rpc.make("Preview", {
    payload: PdfPrepareAndSignInputSchema,
    success: Schema.Uint8Array,
    error: PdfError,
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
