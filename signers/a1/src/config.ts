/**
 * A1 signer adapter options.
 */

import { redactedStringSchema } from "@signature-kit/core/config";
import { Schema } from "effect";

export const A1SignerOptionsSchema = Schema.Struct({
  pfx: Schema.Uint8Array,
  password: redactedStringSchema,
});
export type A1SignerOptions = (typeof A1SignerOptionsSchema)["Type"];

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
