/**
 * SHA-256 pure TypeScript implementation (FIPS 180-4).
 *
 * Zero runtime dependencies. Works in any JS environment.
 */

// SHA-256 initial hash values (first 32 bits of fractional parts of sqrt of first 8 primes)
const INIT_H = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

// SHA-256 round constants (first 32 bits of fractional parts of cbrt of first 64 primes)
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** Process a single 64-byte block into hash state `h` (mutates in place). */
function processBlock(h: Uint32Array, view: DataView, offset: number): void {
  const w = new Uint32Array(64);
  for (let t = 0; t < 16; t++) {
    w[t] = view.getUint32(offset + t * 4, false);
  }
  for (let t = 16; t < 64; t++) {
    const s0 = rotr32(w[t - 15]!, 7) ^ rotr32(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
    const s1 = rotr32(w[t - 2]!, 17) ^ rotr32(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
    w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
  }

  let a = h[0]!;
  let b = h[1]!;
  let c = h[2]!;
  let d = h[3]!;
  let e = h[4]!;
  let f = h[5]!;
  let g = h[6]!;
  let hh = h[7]!;

  for (let t = 0; t < 64; t++) {
    const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
    const ch = (e & f) ^ ((~e >>> 0) & g);
    const temp1 = (hh + S1 + ch + K[t]! + w[t]!) >>> 0;
    const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (S0 + maj) >>> 0;

    hh = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }

  h[0] = (h[0]! + a) >>> 0;
  h[1] = (h[1]! + b) >>> 0;
  h[2] = (h[2]! + c) >>> 0;
  h[3] = (h[3]! + d) >>> 0;
  h[4] = (h[4]! + e) >>> 0;
  h[5] = (h[5]! + f) >>> 0;
  h[6] = (h[6]! + g) >>> 0;
  h[7] = (h[7]! + hh) >>> 0;
}

/**
 * Compute SHA-256 digest of `data`.
 * Returns a 32-byte Uint8Array.
 */
export function sha256(data: Uint8Array): Uint8Array {
  // ---- Pre-processing: padding ----
  const bitLen = data.length * 8;
  const padLen = data.length % 64 < 56 ? 56 - (data.length % 64) : 120 - (data.length % 64);
  const totalLen = data.length + padLen + 8;

  const msg = new Uint8Array(totalLen);
  msg.set(data);
  msg[data.length] = 0x80;

  const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  const bitLenHi = Math.floor(data.length / 0x20000000) | 0;
  const bitLenLo = bitLen >>> 0;
  view.setUint32(totalLen - 8, bitLenHi, false);
  view.setUint32(totalLen - 4, bitLenLo, false);

  // ---- Processing ----
  const h = new Uint32Array(INIT_H);

  for (let i = 0; i < totalLen; i += 64) {
    processBlock(h, view, i);
  }

  // ---- Produce digest ----
  const digest = new Uint8Array(32);
  const dv = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) {
    dv.setUint32(i * 4, h[i]!, false);
  }
  return digest;
}

/**
 * Compute SHA-256 with a pre-processed initial state.
 *
 * This is used for HMAC key-schedule precomputation: the first 64-byte block
 * (ipad or opad XOR key) is processed once and the resulting state is reused
 * for every HMAC call with the same key.
 *
 * @param initState - 8-element Uint32Array with the pre-processed hash state
 * @param data      - The message data (appended after the already-processed block)
 * @param prefixLen - Number of bytes already processed (for length encoding), typically 64
 * @returns 32-byte SHA-256 digest
 */
export function sha256WithState(
  initState: Uint32Array,
  data: Uint8Array,
  prefixLen: number,
): Uint8Array {
  // Total message length = prefixLen (pre-processed) + data.length
  const totalDataLen = prefixLen + data.length;
  const bitLen = totalDataLen * 8;
  const padLen = totalDataLen % 64 < 56 ? 56 - (totalDataLen % 64) : 120 - (totalDataLen % 64);
  const totalLen = data.length + padLen + 8;

  const msg = new Uint8Array(totalLen);
  msg.set(data);
  msg[data.length] = 0x80;

  const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  const bitLenHi = Math.floor(totalDataLen / 0x20000000) | 0;
  const bitLenLo = bitLen >>> 0;
  view.setUint32(totalLen - 8, bitLenHi, false);
  view.setUint32(totalLen - 4, bitLenLo, false);

  // Start from the pre-processed state (copy so we don't mutate)
  const h = new Uint32Array(initState);

  for (let i = 0; i < totalLen; i += 64) {
    processBlock(h, view, i);
  }

  const digest = new Uint8Array(32);
  const dv = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) {
    dv.setUint32(i * 4, h[i]!, false);
  }
  return digest;
}

/**
 * Process a single full 64-byte block from `blockBytes` into a copy of INIT_H.
 * Returns the resulting 8-element hash state.
 * Used to precompute HMAC ipad/opad half-states.
 */
export function sha256ProcessBlock(blockBytes: Uint8Array): Uint32Array {
  const h = new Uint32Array(INIT_H);
  const view = new DataView(blockBytes.buffer, blockBytes.byteOffset, blockBytes.byteLength);
  processBlock(h, view, 0);
  return h;
}
