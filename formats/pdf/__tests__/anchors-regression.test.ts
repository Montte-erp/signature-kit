import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { findPdfTextAnchors } from "@signature-kit/pdf/anchors";

const page: ReadonlyArray<{ index: number; width: number; height: number }> = [
  { index: 0, width: 220, height: 120 },
];

const stampSize = { width: 80, height: 20 };

const findAnchorsForText = (text: string): ReturnType<typeof findPdfTextAnchors> =>
  findPdfTextAnchors({
    pages: page,
    textBoxes: [[{ text, x: 12, y: 12, width: 100, height: 12 }]],
    matchers: [{ digits: "12345678901" }],
    stampSize,
    placement: "below",
    offset: 0,
  });

describe("PDF digit anchor matching", () => {
  it.effect("does not match CPF digits when surrounded by CNPJ digits", () =>
    Effect.gen(function* () {
      const anchors = yield* findAnchorsForText("CNPJ 12.345.678/9012-34");

      expect(anchors).toHaveLength(0);
    }),
  );

  it.effect("does not match CPF digits in phone + date digit soup", () =>
    Effect.gen(function* () {
      const anchors = yield* findAnchorsForText("Telefone: (11) 2345-6789 01/01");

      expect(anchors).toHaveLength(0);
    }),
  );

  it.effect("matches a formatted CPF value", () =>
    Effect.gen(function* () {
      const anchors = yield* findAnchorsForText("123.456.789-01");

      expect(anchors).toHaveLength(1);
    }),
  );
});
