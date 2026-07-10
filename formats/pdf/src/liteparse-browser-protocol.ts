import { Schema } from "effect";

export const MAX_LITEPARSE_PAGE_COUNT = 10_000;

const liteParsePageCountSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(MAX_LITEPARSE_PAGE_COUNT),
);

export const LiteParseWorkerRequestSchema = Schema.Struct({
  pdf: Schema.Uint8Array,
  pageCount: liteParsePageCountSchema,
});
export type LiteParseWorkerRequest = (typeof LiteParseWorkerRequestSchema)["Type"];

export const LiteParseWorkerSuccessSchema = Schema.Struct({
  kind: Schema.Literal("success"),
  result: Schema.Unknown,
});
export type LiteParseWorkerSuccess = (typeof LiteParseWorkerSuccessSchema)["Type"];
