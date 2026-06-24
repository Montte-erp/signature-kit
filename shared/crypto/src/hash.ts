import { Schema } from "effect";
import { sha256 } from "./primitives/sha256";
import { sha384, sha512 } from "./primitives/sha512";

export const HashAlgorithmSchema = Schema.Literals(["sha256", "sha384", "sha512"]);
export type HashAlgorithm = (typeof HashAlgorithmSchema)["Type"];

export const hash = (algorithm: HashAlgorithm, data: Uint8Array): Uint8Array => {
  switch (algorithm) {
    case "sha256":
      return sha256(data);
    case "sha384":
      return sha384(data);
    case "sha512":
      return sha512(data);
  }
};
