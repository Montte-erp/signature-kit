import { Context, Effect, Layer, Option, Redacted, Ref, Schema, Semaphore } from "effect";
import { PdfError, PdfErrorCodeValue, PdfOperationValue } from "@signature-kit/pdf/config";
import { isSafePdfStampPng } from "@signature-kit/pdf/stamp";

const SigningImage = Schema.Struct({
  id: Schema.NonEmptyString,
  bytes: Schema.Redacted(Schema.Uint8Array, { disallowJsonEncode: true }),
});
type SigningImage = typeof SigningImage.Type;

export class SigningImages extends Context.Service<
  SigningImages,
  {
    readonly logo: Effect.Effect<Option.Option<SigningImage>>;
    readonly setLogo: (bytes: Redacted.Redacted<Uint8Array>) => Effect.Effect<string, PdfError>;
    readonly clearLogo: Effect.Effect<void>;
  }
>()("@signature-kit/docs/SigningImages") {}

export const signingImagesLayer = Layer.effect(
  SigningImages,
  Effect.gen(function* () {
    const logo = yield* Effect.acquireRelease(
      Ref.make<Option.Option<SigningImage>>(Option.none()),
      (state) => Ref.set(state, Option.none()),
    );
    const mutations = yield* Semaphore.make(1);
    return SigningImages.of({
      logo: Ref.get(logo),
      clearLogo: mutations.withPermit(Ref.set(logo, Option.none())),
      setLogo: Effect.fn(function* (bytes) {
        return yield* mutations.withPermit(
          Effect.gen(function* () {
            if (!(yield* isSafePdfStampPng(Redacted.value(bytes))))
              return yield* new PdfError({
                code: PdfErrorCodeValue.stampFailed,
                operation: PdfOperationValue.stamp,
                retryable: false,
                reason: "The selected logo is not a safe PNG image.",
              });
            const id = yield* Effect.sync(() => crypto.randomUUID());
            yield* Ref.set(logo, Option.some({ id, bytes }));
            return id;
          }),
        );
      }),
    });
  }),
);
