import { Schema } from "effect";
import { sha1 } from "./sha1.js";
import { sha256, sha256ProcessBlock, sha256WithState } from "./sha256.js";
import { sha384, sha512 } from "./sha512.js";

export const HmacHashAlgorithmSchema = Schema.Literals(["sha1", "sha256", "sha384", "sha512"]);
export type HmacHashAlgorithm = (typeof HmacHashAlgorithmSchema)["Type"];
function blockSize(alg: HmacHashAlgorithm): number {
  return alg === "sha384" || alg === "sha512" ? 128 : 64;
}

function hashFn(alg: HmacHashAlgorithm, data: Uint8Array): Uint8Array {
  switch (alg) {
    case "sha1":
      return sha1(data);
    case "sha256":
      return sha256(data);
    case "sha384":
      return sha384(data);
    case "sha512":
      return sha512(data);
  }
}

const normalizeHmacKey = (alg: HmacHashAlgorithm, key: Uint8Array): Uint8Array => {
  const blockLength = blockSize(alg);
  if (key.length <= blockLength) {
    const normalized = new Uint8Array(blockLength);
    normalized.set(key);
    return normalized;
  }
  const hashed = hashFn(alg, key);
  const normalized = new Uint8Array(blockLength);
  normalized.set(hashed);
  return normalized;
};

export function hmac(alg: HmacHashAlgorithm, key: Uint8Array, data: Uint8Array): Uint8Array {
  const B = blockSize(alg);
  const k = normalizeHmacKey(alg, key);

  const ipad = new Uint8Array(B);
  const opad = new Uint8Array(B);
  for (let i = 0; i < B; i++) {
    ipad[i] = k[i]! ^ 0x36;
    opad[i] = k[i]! ^ 0x5c;
  }

  const inner = new Uint8Array(B + data.length);
  inner.set(ipad);
  inner.set(data, B);
  const innerHash = hashFn(alg, inner);

  const outer = new Uint8Array(B + innerHash.length);
  outer.set(opad);
  outer.set(innerHash, B);

  return hashFn(alg, outer);
}

export type HmacContext = {
  readonly compute: (data: Uint8Array) => Uint8Array;
};
function createHmacSha256Context(key: Uint8Array): HmacContext {
  const B = 64;
  const k = normalizeHmacKey("sha256", key);

  const ipadBlock = new Uint8Array(B);
  const opadBlock = new Uint8Array(B);
  for (let i = 0; i < B; i++) {
    ipadBlock[i] = k[i]! ^ 0x36;
    opadBlock[i] = k[i]! ^ 0x5c;
  }

  const ipadState = sha256ProcessBlock(ipadBlock);
  const opadState = sha256ProcessBlock(opadBlock);

  return {
    compute(data: Uint8Array): Uint8Array {
      const innerHash = sha256WithState(ipadState, data, B);
      return sha256WithState(opadState, innerHash, B);
    },
  };
}

export function createHmac(alg: HmacHashAlgorithm, key: Uint8Array): HmacContext {
  if (alg === "sha256") {
    return createHmacSha256Context(key);
  }

  const B = blockSize(alg);
  const k = normalizeHmacKey(alg, key);
  const ipad = new Uint8Array(B);
  const opad = new Uint8Array(B);
  for (let i = 0; i < B; i++) {
    ipad[i] = k[i]! ^ 0x36;
    opad[i] = k[i]! ^ 0x5c;
  }

  return {
    compute(data: Uint8Array): Uint8Array {
      const inner = new Uint8Array(B + data.length);
      inner.set(ipad);
      inner.set(data, B);
      const innerHash = hashFn(alg, inner);

      const outer = new Uint8Array(B + innerHash.length);
      outer.set(opad);
      outer.set(innerHash, B);
      return hashFn(alg, outer);
    },
  };
}
