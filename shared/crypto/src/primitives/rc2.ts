/**
 * RC2-CBC pure TypeScript implementation (RFC 2268).
 *
 * Supports 40-bit (effectiveBits=40) and 128-bit (effectiveBits=128) effective
 * key lengths, both in CBC mode with PKCS#7 unpadding.
 *
 * RC2 is a legacy cipher. It is used here exclusively for PKCS#12
 * compatibility (pbeWithSHAAnd40BitRC2-CBC / pbeWithSHAAnd128BitRC2-CBC).
 *
 * Zero runtime dependencies. Works in any JS environment.
 */

import { Effect } from "effect";
import { CryptoError, CryptoErrorCodeValue, CryptoOperationValue } from "../config";
import { removePkcs7Padding } from "./padding";

// RC2 permutation table (RFC 2268, Section 2)
const PITABLE = new Uint8Array([
  0xd9, 0x78, 0xf9, 0xc4, 0x19, 0xdd, 0xb5, 0xed, 0x28, 0xe9, 0xfd, 0x79, 0x4a, 0xa0, 0xd8, 0x9d,
  0xc6, 0x7e, 0x37, 0x83, 0x2b, 0x76, 0x53, 0x8e, 0x62, 0x4c, 0x64, 0x88, 0x44, 0x8b, 0xfb, 0xa2,
  0x17, 0x9a, 0x59, 0xf5, 0x87, 0xb3, 0x4f, 0x13, 0x61, 0x45, 0x6d, 0x8d, 0x09, 0x81, 0x7d, 0x32,
  0xbd, 0x8f, 0x40, 0xeb, 0x86, 0xb7, 0x7b, 0x0b, 0xf0, 0x95, 0x21, 0x22, 0x5c, 0x6b, 0x4e, 0x82,
  0x54, 0xd6, 0x65, 0x93, 0xce, 0x60, 0xb2, 0x1c, 0x73, 0x56, 0xc0, 0x14, 0xa7, 0x8c, 0xf1, 0xdc,
  0x12, 0x75, 0xca, 0x1f, 0x3b, 0xbe, 0xe4, 0xd1, 0x42, 0x3d, 0xd4, 0x30, 0xa3, 0x3c, 0xb6, 0x26,
  0x6f, 0xbf, 0x0e, 0xda, 0x46, 0x69, 0x07, 0x57, 0x27, 0xf2, 0x1d, 0x9b, 0xbc, 0x94, 0x43, 0x03,
  0xf8, 0x11, 0xc7, 0xf6, 0x90, 0xef, 0x3e, 0xe7, 0x06, 0xc3, 0xd5, 0x2f, 0xc8, 0x66, 0x1e, 0xd7,
  0x08, 0xe8, 0xea, 0xde, 0x80, 0x52, 0xee, 0xf7, 0x84, 0xaa, 0x72, 0xac, 0x35, 0x4d, 0x6a, 0x2a,
  0x96, 0x1a, 0xd2, 0x71, 0x5a, 0x15, 0x49, 0x74, 0x4b, 0x9f, 0xd0, 0x5e, 0x04, 0x18, 0xa4, 0xec,
  0xc2, 0xe0, 0x41, 0x6e, 0x0f, 0x51, 0xcb, 0xcc, 0x24, 0x91, 0xaf, 0x50, 0xa1, 0xf4, 0x70, 0x39,
  0x99, 0x7c, 0x3a, 0x85, 0x23, 0xb8, 0xb4, 0x7a, 0xfc, 0x02, 0x36, 0x5b, 0x25, 0x55, 0x97, 0x31,
  0x2d, 0x5d, 0xfa, 0x98, 0xe3, 0x8a, 0x92, 0xae, 0x05, 0xdf, 0x29, 0x10, 0x67, 0x6c, 0xba, 0xc9,
  0xd3, 0x00, 0xe6, 0xcf, 0xe1, 0x9e, 0xa8, 0x2c, 0x63, 0x16, 0x01, 0x3f, 0x58, 0xe2, 0x89, 0xa9,
  0x0d, 0x38, 0x34, 0x1b, 0xab, 0x33, 0xff, 0xb0, 0xbb, 0x48, 0x0c, 0x5f, 0xb9, 0xb1, 0xcd, 0x2e,
  0xc5, 0xf3, 0xdb, 0x47, 0xe5, 0xa5, 0x9c, 0x77, 0x0a, 0xa6, 0x20, 0x68, 0xfe, 0x7f, 0xc1, 0xad,
]);

/**
 * RC2 key expansion.
 *
 * @param key      - Raw key bytes (1..128 bytes)
 * @param pkeySz   - Effective key length in bits (e.g. 40 or 128)
 * @returns 64 16-bit words as a plain number[]
 */
function rc2ExpandKey(key: Uint8Array, pkeySz: number): number[] {
  const L = new Uint8Array(128);
  L.set(key);

  const t = key.length;
  const t8 = Math.ceil(pkeySz / 8);
  const tm = 0xff >> (8 * t8 - pkeySz);

  // Step 2: expand
  for (let i = t; i < 128; i++) {
    L[i] = PITABLE[(L[i - 1]! + L[i - t]!) & 0xff]!;
  }

  // Step 3: limit effective bits
  L[128 - t8] = PITABLE[L[128 - t8]! & tm]!;

  // Step 4: reduce
  for (let i = 127 - t8; i >= 0; i--) {
    L[i] = PITABLE[L[i + 1]! ^ L[i + t8]!]!;
  }

  // Convert to 64 16-bit words (little-endian)
  const K: number[] = new Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = L[i * 2]! | (L[i * 2 + 1]! << 8);
  }

  return K;
}

/**
 * Decrypt a single 8-byte RC2 block in place.
 * Implements the inverse of the 16-round RC2 encryption described in RFC 2268.
 *
 * Forward mix at key index j (each round processes R0..R3):
 *   R0 += K[j]   + (R3 & R2) + (~R3 & R1); R0 = R0 <<< 1
 *   R1 += K[j+1] + (R0 & R3) + (~R0 & R2); R1 = R1 <<< 2
 *   R2 += K[j+2] + (R1 & R0) + (~R1 & R3); R2 = R2 <<< 3
 *   R3 += K[j+3] + (R2 & R1) + (~R2 & R0); R3 = R3 <<< 5
 *
 * Inverse mix at key index j (reverse order, unrotate THEN subtract):
 *   R3 = R3 >>> 5; R3 -= K[j+3] + (R2 & R1) + (~R2 & R0)
 *   R2 = R2 >>> 3; R2 -= K[j+2] + (R1 & R0) + (~R1 & R3)
 *   R1 = R1 >>> 2; R1 -= K[j+1] + (R0 & R3) + (~R0 & R2)
 *   R0 = R0 >>> 1; R0 -= K[j]   + (R3 & R2) + (~R3 & R1)
 */
function rc2DecryptBlock(block: Uint8Array, K: number[]): void {
  // Load 4 16-bit words (little-endian)
  let r0 = (block[0]! | (block[1]! << 8)) & 0xffff;
  let r1 = (block[2]! | (block[3]! << 8)) & 0xffff;
  let r2 = (block[4]! | (block[5]! << 8)) & 0xffff;
  let r3 = (block[6]! | (block[7]! << 8)) & 0xffff;

  function invMix(j: number): void {
    // Right rotate R3 by 5, then subtract
    r3 = ((r3 >>> 5) | (r3 << 11)) & 0xffff;
    r3 = (r3 - (K[j + 3]! + (r2 & r1) + (~r2 & r0))) & 0xffff;

    // Right rotate R2 by 3, then subtract
    r2 = ((r2 >>> 3) | (r2 << 13)) & 0xffff;
    r2 = (r2 - (K[j + 2]! + (r1 & r0) + (~r1 & r3))) & 0xffff;

    // Right rotate R1 by 2, then subtract
    r1 = ((r1 >>> 2) | (r1 << 14)) & 0xffff;
    r1 = (r1 - (K[j + 1]! + (r0 & r3) + (~r0 & r2))) & 0xffff;

    // Right rotate R0 by 1, then subtract
    r0 = ((r0 >>> 1) | (r0 << 15)) & 0xffff;
    r0 = (r0 - (K[j]! + (r3 & r2) + (~r3 & r1))) & 0xffff;
  }

  function invMash(): void {
    r3 = (r3 - K[r2 & 63]!) & 0xffff;
    r2 = (r2 - K[r1 & 63]!) & 0xffff;
    r1 = (r1 - K[r0 & 63]!) & 0xffff;
    r0 = (r0 - K[r3 & 63]!) & 0xffff;
  }

  // Reverse of forward: inv-mix×5, inv-mash, inv-mix×6, inv-mash, inv-mix×5
  // Forward key index sequence: 0,4,8,12,16 | (mash) | 20,24,28,32,36,40 | (mash) | 44,48,52,56,60
  // Inverse: 60,56,52,48,44 | (invMash) | 40,36,32,28,24,20 | (invMash) | 16,12,8,4,0

  invMix(60);
  invMix(56);
  invMix(52);
  invMix(48);
  invMix(44);

  invMash();

  invMix(40);
  invMix(36);
  invMix(32);
  invMix(28);
  invMix(24);
  invMix(20);

  invMash();

  invMix(16);
  invMix(12);
  invMix(8);
  invMix(4);
  invMix(0);

  // Store back (little-endian)
  block[0] = r0 & 0xff;
  block[1] = (r0 >>> 8) & 0xff;
  block[2] = r1 & 0xff;
  block[3] = (r1 >>> 8) & 0xff;
  block[4] = r2 & 0xff;
  block[5] = (r2 >>> 8) & 0xff;
  block[6] = r3 & 0xff;
  block[7] = (r3 >>> 8) & 0xff;
}

/**
 * Pure RC2-CBC decryption. Returns the still-padded plaintext. Never throws.
 *
 * @param key          - Raw key bytes (1..128 bytes)
 * @param effectiveBits - Effective key length in bits (40 or 128)
 * @param iv           - 8 bytes
 * @param ciphertext   - Must be a multiple of 8 bytes
 */
function rc2CbcDecryptRaw(
  key: Uint8Array,
  effectiveBits: number,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  const K = rc2ExpandKey(key, effectiveBits);
  const plaintext = new Uint8Array(ciphertext.length);
  let prev = new Uint8Array(iv);

  for (let i = 0; i < ciphertext.length; i += 8) {
    const block = new Uint8Array(ciphertext.subarray(i, i + 8));
    const ctBlock = new Uint8Array(block); // save for CBC chain

    rc2DecryptBlock(block, K);

    // CBC: XOR with previous ciphertext block
    for (let j = 0; j < 8; j++) {
      plaintext[i + j] = block[j]! ^ prev[j]!;
    }
    prev = ctBlock;
  }

  return plaintext;
}

/**
 * Decrypt data encrypted with RC2-CBC + PKCS#7 unpadding.
 *
 * @param key          - Raw key bytes
 * @param effectiveBits - Effective key length in bits (40 or 128)
 * @param iv           - 8 bytes
 * @param ciphertext   - Must be a multiple of 8 bytes
 */
export const rc2CbcDecrypt = (
  key: Uint8Array,
  effectiveBits: number,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Effect.Effect<Uint8Array, CryptoError> => {
  if (iv.length !== 8) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.cipherError,
        reason: "RC2-CBC: IV must be 8 bytes.",
        operation: CryptoOperationValue.cipherRc2,
      }),
    );
  }

  if (ciphertext.length % 8 !== 0) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.cipherError,
        reason: "RC2-CBC: ciphertext must be a multiple of 8 bytes.",
        operation: CryptoOperationValue.cipherRc2,
      }),
    );
  }

  if (key.length < 1 || key.length > 128) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.cipherError,
        reason: "RC2: key length must be 1..128 bytes.",
        operation: CryptoOperationValue.cipherRc2,
      }),
    );
  }

  return removePkcs7Padding(rc2CbcDecryptRaw(key, effectiveBits, iv, ciphertext), 8);
};
