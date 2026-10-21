import ecpfUrl from "../../signers/a1/__tests__/fixtures/ecpf.p12?inline";
import ecnpjUrl from "../../signers/a1/__tests__/fixtures/ecnpj.p12?inline";
import { Effect } from "effect";

export const readA1FixtureFromBrowser = (name: "ecpf" | "ecnpj"): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const response = await fetch(name === "ecpf" ? ecpfUrl : ecnpjUrl);
    return new Uint8Array(await response.arrayBuffer());
  });
