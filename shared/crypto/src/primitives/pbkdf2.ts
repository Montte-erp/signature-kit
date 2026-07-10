import { createHmac, hmac } from "./hmac";
import type { HmacHashAlgorithm } from "./hmac";

export function pbkdf2(
  prf: HmacHashAlgorithm,
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
): Uint8Array {
  const hmacCtx = createHmac(prf, password);

  const hLen = hmac(prf, password, new Uint8Array(0)).length;

  const blockCount = Math.ceil(dkLen / hLen);
  const dk = new Uint8Array(dkLen);

  for (let i = 1; i <= blockCount; i++) {
    const block = f(hmacCtx, salt, iterations, i, hLen);

    const offset = (i - 1) * hLen;
    const toCopy = Math.min(hLen, dkLen - offset);
    dk.set(block.subarray(0, toCopy), offset);
  }

  return dk;
}

function f(
  hmacCtx: ReturnType<typeof createHmac>,
  salt: Uint8Array,
  iterations: number,
  blockIndex: number,
  hLen: number,
): Uint8Array {
  const saltWithIndex = new Uint8Array(salt.length + 4);
  saltWithIndex.set(salt);
  saltWithIndex[salt.length] = (blockIndex >>> 24) & 0xff;
  saltWithIndex[salt.length + 1] = (blockIndex >>> 16) & 0xff;
  saltWithIndex[salt.length + 2] = (blockIndex >>> 8) & 0xff;
  saltWithIndex[salt.length + 3] = blockIndex & 0xff;

  let u = hmacCtx.compute(saltWithIndex);
  const result = new Uint8Array(hLen);
  for (let j = 0; j < hLen; j++) result[j] = u[j]!;

  for (let c = 1; c < iterations; c++) {
    u = hmacCtx.compute(u);
    for (let j = 0; j < hLen; j++) result[j]! ^= u[j]!;
  }

  return result;
}
