import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted, Result } from "effect";
import { PdfErrorCodeValue } from "@signature-kit/pdf/config";

import { SigningImages, signingImagesLayer } from "../src/site/signing-images.ts";

const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

it.effect(
  "retains a valid logo after a rejected replacement and releases private images with their scope",
  () =>
    Effect.gen(function* () {
      const readAfterScope = yield* Effect.scoped(
        Effect.gen(function* () {
          const images = yield* SigningImages;
          expect(Option.isNone(yield* images.logo)).toBe(true);
          const id = yield* images.setLogo(Redacted.make(png));
          const rejected = yield* images
            .setLogo(Redacted.make(Uint8Array.of(1, 2, 3)))
            .pipe(Effect.result);
          expect(Result.isFailure(rejected)).toBe(true);
          if (Result.isFailure(rejected))
            expect(rejected.failure.code).toBe(PdfErrorCodeValue.stampFailed);
          const retained = yield* images.logo;
          if (Option.isNone(retained))
            return yield* Effect.die("A rejected replacement must preserve the valid logo");
          expect(retained.value.id).toBe(id);
          expect(Redacted.value(retained.value.bytes)).toEqual(png);
          yield* images.clearLogo;
          expect(Option.isNone(yield* images.logo)).toBe(true);
          yield* images.setLogo(Redacted.make(png));
          return { logo: images.logo };
        }).pipe(Effect.provide(signingImagesLayer)),
      );
      expect(Option.isNone(yield* readAfterScope.logo)).toBe(true);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const isolated = yield* SigningImages;
          expect(Option.isNone(yield* isolated.logo)).toBe(true);
        }).pipe(Effect.provide(signingImagesLayer)),
      );
    }),
);
