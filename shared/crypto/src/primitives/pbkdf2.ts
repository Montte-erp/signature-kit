/**
 * PBKDF2 pure TypeScript implementation (RFC 2898 / PKCS#5).
 *
 * Uses HMAC with any supported hash as the pseudo-random function.
 * Zero runtime dependencies. Works in any JS environment.
 */

import { createHmac, type HmacHashAlgorithm, hmac } from "./hmac";

/**
 * Derive a key of `dkLen` bytes from a password and salt using PBKDF2.
 *
 * @param prf         - Hash algorithm for HMAC PRF: 'sha1' | 'sha256' | 'sha384' | 'sha512'
 * @param password    - Password as raw Uint8Array
 * @param salt        - Cryptographic salt
 * @param iterations  - Iteration count (must be >= 1)
 * @param dkLen       - Desired derived key length in bytes
 * @returns Derived key as Uint8Array
 */
export function pbkdf2(
  prf: HmacHashAlgorithm,
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
): Uint8Array {
  // Precompute HMAC context for this key — avoids re-deriving ipad/opad per iteration
  const hmacCtx = createHmac(prf, password);

  // hLen = output length of PRF (HMAC hash output)
  // Compute once using the standard hmac for length detection
  const hLen = hmac(prf, password, new Uint8Array(0)).length;

  // Number of blocks needed
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

/**
 * Compute one PRF block: F(Password, Salt, c, i)
 * = U1 XOR U2 XOR ... XOR Uc
 * where U1 = PRF(Password, Salt || INT(i))
 *       Uk = PRF(Password, U_{k-1})
 */
function f(
  hmacCtx: ReturnType<typeof createHmac>,
  salt: Uint8Array,
  iterations: number,
  blockIndex: number,
  hLen: number,
): Uint8Array {
  // Build Salt || INT(i) (4-byte big-endian block index)
  const saltWithIndex = new Uint8Array(salt.length + 4);
  saltWithIndex.set(salt);
  saltWithIndex[salt.length] = (blockIndex >>> 24) & 0xff;
  saltWithIndex[salt.length + 1] = (blockIndex >>> 16) & 0xff;
  saltWithIndex[salt.length + 2] = (blockIndex >>> 8) & 0xff;
  saltWithIndex[salt.length + 3] = blockIndex & 0xff;

  // U1
  let u = hmacCtx.compute(saltWithIndex);
  const result = new Uint8Array(hLen);
  for (let j = 0; j < hLen; j++) result[j] = u[j]!;

  // U2 ... Uc
  for (let c = 1; c < iterations; c++) {
    u = hmacCtx.compute(u);
    for (let j = 0; j < hLen; j++) result[j]! ^= u[j]!;
  }

  return result;
}
