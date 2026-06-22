import { readFile } from "node:fs/promises";
import { Effect } from "effect";

export type A1FixtureName = "ecpf" | "ecnpj";

export const readA1Fixture = (name: A1FixtureName): Effect.Effect<Uint8Array> =>
  Effect.promise(
    async () =>
      new Uint8Array(
        await readFile(new URL(`../../signers/a1/__tests__/fixtures/${name}.p12`, import.meta.url)),
      ),
  );

export const toArrayBufferView = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
};
