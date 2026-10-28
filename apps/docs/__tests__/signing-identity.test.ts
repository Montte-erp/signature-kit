import { Effect, Option, Redacted, Result } from "effect";
import { TestClock } from "effect/testing";
import { expect, it } from "@effect/vitest";
import { parseCertificate } from "@signature-kit/certificates";
import { SignatureKitErrorCodeValue } from "@signature-kit/signatures";
import { readA1Fixture } from "../../../tooling/testing/fixtures.ts";
import { SigningIdentity, signingIdentityLayer } from "../src/site/signing-identity.ts";

it.effect(
  "invalidates rejected credentials and releases validated identities with their scope",
  () =>
    Effect.gen(function* () {
      const bytes = yield* readA1Fixture("ecpf");
      const password = Redacted.make("changeit");
      const certificate = yield* parseCertificate(bytes, password);
      yield* TestClock.setTime(certificate.validity.notBefore.getTime() + 1000);
      const afterScope = yield* Effect.scoped(
        Effect.gen(function* () {
          const identity = yield* SigningIdentity;
          expect(Option.isNone(yield* identity.credentials)).toBe(true);
          const authenticated = yield* identity.authenticate(Redacted.make(bytes), password);
          expect(authenticated.profile.document.length).toBeGreaterThan(0);
          expect(Redacted.value(authenticated.password)).toBe("changeit");
          const rejected = yield* identity
            .authenticate(Redacted.make(bytes), Redacted.make("wrong"))
            .pipe(Effect.result);
          if (Result.isSuccess(rejected))
            return yield* Effect.die("An incorrect password must be rejected");
          expect(rejected.failure.code).toBe(SignatureKitErrorCodeValue.wrongPassword);
          expect(Option.isNone(yield* identity.credentials)).toBe(true);
          yield* identity.authenticate(Redacted.make(bytes), password);
          yield* identity.clear;
          expect(Option.isNone(yield* identity.credentials)).toBe(true);
          yield* identity.authenticate(Redacted.make(bytes), password);
          return { credentials: identity.credentials };
        }).pipe(Effect.provide(signingIdentityLayer)),
      );
      expect(Option.isNone(yield* afterScope.credentials)).toBe(true);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const identity = yield* SigningIdentity;
          expect(Option.isNone(yield* identity.credentials)).toBe(true);
        }).pipe(Effect.provide(signingIdentityLayer)),
      );
    }),
);
