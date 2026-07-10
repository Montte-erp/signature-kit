import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { decode, encode } from "../src/asn1";

const expectDecodeError = (bytes: Uint8Array) =>
  Effect.gen(function* () {
    const outcome = yield* Effect.result(decode(bytes));

    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) {
      expect(outcome.failure._tag).toBe("Asn1Error");
      expect(outcome.failure.code).toBe("asn1.DECODE_ERROR");
    }
  });

const assertRoundTrip = (bytes: Uint8Array) =>
  Effect.gen(function* () {
    const decoded = yield* decode(bytes);
    expect(encode(decoded)).toEqual(bytes);
  });

describe("ASN.1 decoder DER hardening", () => {
  it.effect("rejects a child TLV that crosses its definite-length parent", () =>
    expectDecodeError(Uint8Array.of(0x30, 0x06, 0x30, 0x02, 0x04, 0x02, 0x05, 0x00)),
  );

  it.effect("rejects high-tag numbers outside the supported encoder range", () =>
    expectDecodeError(Uint8Array.of(0x1f, 0x88, 0x80, 0x80, 0x80, 0x00, 0x00)),
  );

  it.effect("rejects a long-form length for a short value", () =>
    expectDecodeError(Uint8Array.of(0x02, 0x81, 0x01, 0x00)),
  );

  it.effect("rejects a long-form length with a leading zero", () =>
    expectDecodeError(new Uint8Array([0x04, 0x82, 0x00, 0x80, ...new Uint8Array(128)])),
  );

  it.effect("rejects high-tag form for tags below 31", () =>
    expectDecodeError(Uint8Array.of(0x1f, 0x1e, 0x00)),
  );

  it.effect("rejects high-tag numbers with a leading zero base-128 group", () =>
    expectDecodeError(Uint8Array.of(0x1f, 0x80, 0x1f, 0x00)),
  );

  it.effect("round-trips canonical short, long, and high-tag DER", () =>
    Effect.gen(function* () {
      yield* assertRoundTrip(Uint8Array.of(0x02, 0x01, 0x00));
      yield* assertRoundTrip(new Uint8Array([0x04, 0x81, 0x80, ...new Uint8Array(128)]));
      yield* assertRoundTrip(Uint8Array.of(0x1f, 0x1f, 0x00));
    }),
  );

  it.effect("continues to decode constructed indefinite-length BER", () =>
    Effect.gen(function* () {
      const decoded = yield* decode(Uint8Array.of(0x30, 0x80, 0x02, 0x01, 0x01, 0x00, 0x00));
      expect(decoded).toEqual({
        kind: "constructed",
        class: "universal",
        tag: 0x10,
        children: [
          {
            kind: "primitive",
            class: "universal",
            tag: 0x02,
            bytes: Uint8Array.of(0x01),
          },
        ],
      });
    }),
  );
});
