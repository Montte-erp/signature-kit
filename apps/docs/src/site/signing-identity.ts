import { Context, Effect, Layer, Option, Redacted, Ref, Schema, Semaphore } from "effect";
import { A1CertificateProfileSchema } from "@signature-kit/a1/config";
import { parseA1CertificateProfile } from "@signature-kit/a1/signer";
import type { SignatureKitError } from "@signature-kit/signatures";

const AuthenticatedIdentity = Schema.Struct({
  certificate: Schema.Redacted(Schema.Uint8Array, { disallowJsonEncode: true }),
  password: Schema.Redacted(Schema.String, { disallowJsonEncode: true }),
  profile: A1CertificateProfileSchema,
});
type AuthenticatedIdentity = typeof AuthenticatedIdentity.Type;

export class SigningIdentity extends Context.Service<
  SigningIdentity,
  {
    readonly credentials: Effect.Effect<Option.Option<AuthenticatedIdentity>>;
    readonly authenticate: (
      certificate: Redacted.Redacted<Uint8Array>,
      password: Redacted.Redacted<string>,
    ) => Effect.Effect<AuthenticatedIdentity, SignatureKitError>;
    readonly clear: Effect.Effect<void>;
  }
>()("@signature-kit/docs/SigningIdentity") {}

export const signingIdentityLayer = Layer.effect(
  SigningIdentity,
  Effect.gen(function* () {
    const credentials = yield* Effect.acquireRelease(
      Ref.make<Option.Option<AuthenticatedIdentity>>(Option.none()),
      (state) => Ref.set(state, Option.none()),
    );
    const mutations = yield* Semaphore.make(1);
    return SigningIdentity.of({
      credentials: Ref.get(credentials),
      clear: mutations.withPermit(Ref.set(credentials, Option.none())),
      authenticate: Effect.fn(function* (certificate, password) {
        return yield* mutations.withPermit(
          Effect.gen(function* () {
            yield* Ref.set(credentials, Option.none());
            const profile = yield* parseA1CertificateProfile({
              pfx: Redacted.value(certificate),
              password,
            });
            const identity = AuthenticatedIdentity.make({ certificate, password, profile });
            yield* Ref.set(credentials, Option.some(identity));
            return identity;
          }),
        );
      }),
    });
  }),
);
