import { Match, Schema } from "effect";

export const SignatureVariant = Schema.Literals(["line", "field", "witnessed", "initials"]);
export type SignatureVariant = typeof SignatureVariant.Type;
export const SignedMark = Schema.Struct({
  name: Schema.String,
  document: Schema.String,
  date: Schema.String,
});
export type SignedMark = typeof SignedMark.Type;
export const FormalContractOptions = Schema.Struct({
  title: Schema.String,
  paragraphs: Schema.Array(Schema.String),
  variant: SignatureVariant,
  signed: Schema.optional(SignedMark),
});
export type FormalContractOptions = typeof FormalContractOptions.Type;

export const formalContractSignatureRect = (variant: SignatureVariant) =>
  Match.value(variant).pipe(
    Match.when("line", () => ({ x: (595.28 - 260) / 2, y: 841.89 - 196, width: 260, height: 32 })),
    Match.when("field", () => ({
      x: 595.28 - 56 - 224,
      y: 841.89 - 196 - 4,
      width: 224,
      height: 40,
    })),
    Match.when("witnessed", () => ({
      x: 56,
      y: 841.89 - 196,
      width: (595.28 - 112) * 0.42,
      height: 32,
    })),
    Match.when("initials", () => ({
      x: 595.28 - 56 - 208,
      y: 841.89 - 196,
      width: 208,
      height: 32,
    })),
    Match.exhaustive,
  );
