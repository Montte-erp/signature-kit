import { Schema } from "effect";

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
