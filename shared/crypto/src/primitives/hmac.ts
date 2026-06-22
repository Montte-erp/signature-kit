/**
 * HMAC pure TypeScript implementation (RFC 2104).
 *
 * Supports SHA-1, SHA-256, SHA-384, and SHA-512 as the underlying hash.
 * Zero runtime dependencies. Works in any JS environment.
 */

import { sha1 } from "./sha1";
import { sha256, sha256ProcessBlock, sha256WithState } from "./sha256";
import { sha384, sha512 } from "./sha512";

export type HmacHashAlgorithm = "sha1" | "sha256" | "sha384" | "sha512";

/**
 * Returns the block size (in bytes) for the given hash algorithm.
 * SHA-1/SHA-256: 64 bytes; SHA-384/SHA-512: 128 bytes.
 */
function blockSize(alg: HmacHashAlgorithm): number {
  return alg === "sha384" || alg === "sha512" ? 128 : 64;
}

/**
 * Dispatch to the appropriate hash function.
 */
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

/**
 * Compute HMAC(key, data) using the specified hash algorithm.
 *
 * @param alg  - Hash algorithm: 'sha1' | 'sha256' | 'sha384' | 'sha512'
 * @param key  - Secret key (any length)
 * @param data - Message data
 * @returns HMAC digest as Uint8Array (same length as hash output)
 */
export function hmac(alg: HmacHashAlgorithm, key: Uint8Array, data: Uint8Array): Uint8Array {
  const B = blockSize(alg);

  // Step 1: If key > block size, hash it; if shorter, pad with zeros.
  let k: Uint8Array;
  if (key.length > B) {
    k = hashFn(alg, key);
  } else {
    k = new Uint8Array(B);
    k.set(key);
  }

  // Step 2: ipad = k XOR 0x36, opad = k XOR 0x5c
  const ipad = new Uint8Array(B);
  const opad = new Uint8Array(B);
  for (let i = 0; i < B; i++) {
    ipad[i] = k[i]! ^ 0x36;
    opad[i] = k[i]! ^ 0x5c;
  }

  // Step 3: inner = H(ipad || data)
  const inner = new Uint8Array(B + data.length);
  inner.set(ipad);
  inner.set(data, B);
  const innerHash = hashFn(alg, inner);

  // Step 4: outer = H(opad || inner)
  const outer = new Uint8Array(B + innerHash.length);
  outer.set(opad);
  outer.set(innerHash, B);

  return hashFn(alg, outer);
}

/**
 * A precomputed HMAC context for a fixed key.
 *
 * When calling HMAC many times with the same key (e.g., PBKDF2), precomputing
 * the ipad and opad half-states avoids redundant work on every call.
 *
 * Currently optimized for SHA-256 (the most common PBKDF2 PRF).
 * Falls back to the standard hmac() for other algorithms.
 */
export interface HmacContext {
  /** Compute HMAC for the given message data */
  compute(data: Uint8Array): Uint8Array;
}

/**
 * Create a precomputed HMAC context for SHA-256 with a fixed key.
 *
 * Precomputes the ipad and opad block states so each call to `compute()`
 * only needs to process the message data portion — saving ~2 SHA-256 block
 * compressions per call.
 */
function createHmacSha256Context(key: Uint8Array): HmacContext {
  const B = 64; // SHA-256 block size

  // Normalize key
  let k: Uint8Array;
  if (key.length > B) {
    k = sha256(key);
  } else {
    k = new Uint8Array(B);
    k.set(key);
  }

  // Precompute padded ipad and opad blocks
  const ipadBlock = new Uint8Array(B);
  const opadBlock = new Uint8Array(B);
  for (let i = 0; i < B; i++) {
    ipadBlock[i] = k[i]! ^ 0x36;
    opadBlock[i] = k[i]! ^ 0x5c;
  }

  // Process each block through SHA-256 to get half-states
  const ipadState = sha256ProcessBlock(ipadBlock);
  const opadState = sha256ProcessBlock(opadBlock);

  return {
    compute(data: Uint8Array): Uint8Array {
      // inner = H(ipad_state, data)  — skip the ipad block compression
      const innerHash = sha256WithState(ipadState, data, B);
      // outer = H(opad_state, innerHash) — skip the opad block compression
      return sha256WithState(opadState, innerHash, B);
    },
  };
}

/**
 * Create a precomputed HMAC context for a fixed key and algorithm.
 *
 * For SHA-256, this uses block-state precomputation for best performance.
 * For other algorithms, falls back to standard HMAC with cached key pads.
 */
export function createHmac(alg: HmacHashAlgorithm, key: Uint8Array): HmacContext {
  if (alg === "sha256") {
    return createHmacSha256Context(key);
  }

  // Generic fallback: precompute padded ipad/opad (saves XOR and alloc per call)
  const B = blockSize(alg);
  let k: Uint8Array;
  if (key.length > B) {
    k = hashFn(alg, key);
  } else {
    k = new Uint8Array(B);
    k.set(key);
  }
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
