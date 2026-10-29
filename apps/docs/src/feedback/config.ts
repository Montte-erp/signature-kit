import { Schema } from "effect";

export const PageFeedback = Schema.Struct({
  route: Schema.NonEmptyString,
  opinion: Schema.Literals(["good", "bad"]),
  message: Schema.String,
});

export const FeedbackErrorCode = Schema.Literals(["unavailable"]);
const feedbackErrorMessages = Schema.Record(FeedbackErrorCode, Schema.String).make({
  unavailable: "Feedback is not configured.",
});

export class FeedbackError extends Schema.TaggedError<
  FeedbackError,
  { readonly brand: unique symbol }
>()("FeedbackError", { code: FeedbackErrorCode }) {
  get message(): string {
    return feedbackErrorMessages[this.code];
  }
}
