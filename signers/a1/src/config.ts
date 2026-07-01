/**
 * A1 signer adapter options.
 */

import { redactedStringSchema } from "@signature-kit/core/config";
import { SignatureHttpHeadersSchema } from "@signature-kit/core/http";
import { Schema } from "effect";

export const A1SignerOptionsSchema = Schema.Struct({
  pfx: Schema.Uint8Array,
  password: redactedStringSchema,
});
export type A1SignerOptions = (typeof A1SignerOptionsSchema)["Type"];

const A1RemoteLocationFields = {
  /** The (presigned) URL the PKCS#12 bytes are fetched from with a GET. */
  url: Schema.NonEmptyString,
  /** Extra request headers (for auth not already baked into the URL). */
  headers: Schema.optional(SignatureHttpHeadersSchema),
};

export const A1RemoteFetchSchema = Schema.Struct(A1RemoteLocationFields);
export type A1RemoteFetch = (typeof A1RemoteFetchSchema)["Type"];

export const A1RemoteSourceSchema = Schema.Struct({
  ...A1RemoteLocationFields,
  password: redactedStringSchema,
});
export type A1RemoteSource = (typeof A1RemoteSourceSchema)["Type"];

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
