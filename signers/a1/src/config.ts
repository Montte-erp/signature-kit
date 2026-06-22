/**
 * A1 signer adapter options.
 */

import { Schema } from "effect";
import type { Redacted } from "effect";

const redactedString: Schema.Decoder<Redacted.Redacted<string>> = Schema.Redacted(Schema.String);

export type A1SignerOptions = {
  readonly pfx: Uint8Array;
  readonly password: Redacted.Redacted<string>;
};

const A1SignerOptionsSchema: Schema.Decoder<A1SignerOptions> = Schema.Struct({
  pfx: Schema.Uint8Array,
  password: redactedString,
});
export const a1SignerOptionsSchema: Schema.Decoder<A1SignerOptions> = A1SignerOptionsSchema;
