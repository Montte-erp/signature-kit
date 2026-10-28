import { Context, Effect, Layer, Option, Redacted, Ref, Schema, Semaphore } from "effect";
import { PdfError, PdfErrorCodeValue, PdfOperationValue } from "@signature-kit/pdf/config";
import { isSafePdfStampPng } from "@signature-kit/pdf/stamp";

const SigningImage = Schema.Struct({
  id: Schema.NonEmptyString,
  bytes: Schema.Redacted(Schema.Uint8Array, { disallowJsonEncode: true }),
});
type SigningImage = typeof SigningImage.Type;
const SigningInk = Schema.Struct({
  ...SigningImage.fields,
  name: Schema.Redacted(Schema.String, { disallowJsonEncode: true }),
});
type SigningInk = typeof SigningInk.Type;
const HandwritingText = Schema.String.check(Schema.isMaxLength(100));

export class SigningImages extends Context.Service<
  SigningImages,
  {
    readonly logo: Effect.Effect<Option.Option<SigningImage>>;
    readonly setLogo: (bytes: Redacted.Redacted<Uint8Array>) => Effect.Effect<string, PdfError>;
    readonly clearLogo: Effect.Effect<void>;
    readonly ink: Effect.Effect<Option.Option<SigningInk>>;
    readonly setHandwriting: (
      name: Redacted.Redacted<string>,
    ) => Effect.Effect<string | undefined, PdfError>;
    readonly clearInk: Effect.Effect<void>;
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
    const ink = yield* Effect.acquireRelease(
      Ref.make<Option.Option<SigningInk>>(Option.none()),
      (state) => Ref.set(state, Option.none()),
    );
    return SigningImages.of({
      logo: Ref.get(logo),
      ink: Ref.get(ink),
      clearInk: mutations.withPermit(Ref.set(ink, Option.none())),
      setHandwriting: Effect.fn(function* (name) {
        return yield* mutations.withPermit(
          Effect.scoped(
            Effect.gen(function* () {
              const text = yield* Schema.decodeUnknownEffect(HandwritingText)(
                Redacted.value(name).trim(),
              ).pipe(
                Effect.mapError(
                  (issue) =>
                    new PdfError({
                      code: PdfErrorCodeValue.stampFailed,
                      operation: PdfOperationValue.stamp,
                      retryable: false,
                      reason: "The handwritten name must contain at most 100 characters.",
                      issueMessage: String(issue),
                    }),
                ),
              );
              if (text.length === 0) {
                yield* Ref.set(ink, Option.none());
                return undefined;
              }
              const font = "600 64px 'Caveat Variable'";
              yield* Effect.promise(() => document.fonts.load(font));
              const canvas = yield* Effect.acquireRelease(
                Effect.sync(() => document.createElement("canvas")),
                (canvas) =>
                  Effect.sync(() => {
                    canvas.width = 0;
                    canvas.height = 0;
                  }),
              );
              const context = canvas.getContext("2d");
              if (context === null)
                return yield* Effect.die("Handwriting requires a canvas 2D context");
              context.font = font;
              const metrics = context.measureText(text);
              const ascent = metrics.actualBoundingBoxAscent || 64 * 0.8;
              const descent = metrics.actualBoundingBoxDescent || 64 * 0.3;
              const scale = Math.max(2, Math.min(3, window.devicePixelRatio));
              canvas.width = Math.ceil((metrics.width + 48) * scale);
              canvas.height = Math.ceil((ascent + descent + 36) * scale);
              context.scale(scale, scale);
              context.font = font;
              context.fillStyle = "#111111";
              context.textBaseline = "alphabetic";
              context.fillText(text, 24, 18 + ascent);
              const blob = yield* Effect.promise(
                () => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png")),
              );
              if (blob === null)
                return yield* Effect.die("The browser must encode the handwritten PNG");
              const bytes = new Uint8Array(yield* Effect.promise(() => blob.arrayBuffer()));
              const id = crypto.randomUUID();
              yield* Ref.set(
                ink,
                Option.some({ id, bytes: Redacted.make(bytes), name: Redacted.make(text) }),
              );
              return id;
            }),
          ),
        );
      }),
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
