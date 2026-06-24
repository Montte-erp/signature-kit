/**
 * A1 signer adapter options.
 */

import { Schema } from "effect";
import type { Redacted } from "effect";

const redactedString: Schema.ConstraintDecoder<Redacted.Redacted<string>> = Schema.Redacted(
  Schema.String,
);

export const A1SignerOptionsSchema = Schema.Struct({
  pfx: Schema.Uint8Array,
  password: redactedString,
});
export type A1SignerOptions = (typeof A1SignerOptionsSchema)["Type"];
export const a1SignerOptionsSchema: Schema.ConstraintDecoder<A1SignerOptions> =
  A1SignerOptionsSchema;

export const A1CertificateProfileSchema = Schema.Struct({
  document: Schema.NonEmptyString,
  subject: Schema.NonEmptyString,
  organization: Schema.NullOr(Schema.String),
  issuer: Schema.NonEmptyString,
  serialNumber: Schema.NonEmptyString,
  fingerprint: Schema.NonEmptyString,
  validFrom: Schema.Date,
  validTo: Schema.Date,
  daysUntilExpiry: Schema.Number,
});
export type A1CertificateProfile = (typeof A1CertificateProfileSchema)["Type"];
export const a1CertificateProfileSchema: Schema.ConstraintDecoder<A1CertificateProfile> =
  A1CertificateProfileSchema;
