/**
 * DES and 3DES-EDE-CBC pure TypeScript implementation (FIPS 46-3).
 *
 * Implements single DES (used as building block) and triple-DES EDE
 * (Encrypt-Decrypt-Encrypt with three independent keys) in CBC mode
 * with PKCS#7 unpadding.
 *
 * Zero runtime dependencies. Works in any JS environment.
 *
 * ⚠️  3DES is considered legacy/deprecated. It is used here exclusively for
 *     PKCS#12 compatibility (ICP-Brasil A1 certificates).
 */

import { Effect } from "effect";
import { CryptoError, CryptoErrorCodeValue, CryptoOperationValue } from "../config";
import { removePkcs7Padding } from "./padding";

// DES permutation tables are 1-based (bit positions) converted to 0-based.

// Initial Permutation (IP)
const IP = new Uint8Array([
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64,
  56, 48, 40, 32, 24, 16, 8, 57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53,
  45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
]);

// Final Permutation (IP^-1)
const FP = new Uint8Array([
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37,
  5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2,
  42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
]);

// PC-1 permutation (64 bits → 56 bits, split into C and D)
const PC1 = new Uint8Array([
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60,
  52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21,
  13, 5, 28, 20, 12, 4,
]);

// PC-2 permutation (56 bits → 48 bits per sub-key)
const PC2 = new Uint8Array([
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2, 41, 52,
  31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
]);

// Expansion permutation E (32 bits → 48 bits)
const E = new Uint8Array([
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19,
  20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
]);

// P permutation (after S-boxes, 32 bits → 32 bits)
const P_TABLE = new Uint8Array([
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13,
  30, 6, 22, 11, 4, 25,
]);

// S-boxes: 8 boxes, each 4×16 = 64 values
const S_BOXES = [
  new Uint8Array([
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11,
    9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5,
    11, 3, 14, 10, 0, 6, 13,
  ]),
  new Uint8Array([
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10,
    6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2,
    11, 6, 7, 12, 0, 5, 14, 9,
  ]),
  new Uint8Array([
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12,
    11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4,
    15, 14, 3, 11, 5, 2, 12,
  ]),
  new Uint8Array([
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1,
    10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9,
    4, 5, 11, 12, 7, 2, 14,
  ]),
  new Uint8Array([
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10,
    3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6,
    15, 0, 9, 10, 4, 5, 3,
  ]),
  new Uint8Array([
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14,
    0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10,
    11, 14, 1, 7, 6, 0, 8, 13,
  ]),
  new Uint8Array([
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12,
    2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9,
    5, 0, 15, 14, 2, 3, 12,
  ]),
  new Uint8Array([
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11,
    0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13,
    15, 12, 9, 0, 3, 5, 6, 11,
  ]),
];

// Number of left rotations per round
const LEFT_ROTATIONS = new Uint8Array([1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]);

/** Get a specific bit (1-based) from a byte array */
function getBit(data: Uint8Array, pos: number): number {
  const p = pos - 1;
  return (data[p >> 3]! >> (7 - (p & 7))) & 1;
}

/** Apply a permutation to bits */
function permute(data: Uint8Array, table: Uint8Array, outBits: number): Uint8Array {
  const result = new Uint8Array(Math.ceil(outBits / 8));
  for (let i = 0; i < outBits; i++) {
    const bit = getBit(data, table[i]!);
    result[i >> 3]! |= bit << (7 - (i & 7));
  }
  return result;
}

/** Left-rotate a 28-bit value by n positions */
function rotateLeft28(v: number, n: number): number {
  return ((v << n) | (v >>> (28 - n))) & 0x0fffffff;
}

/** Generate 16 48-bit sub-keys from a 64-bit DES key */
function generateSubkeys(key: Uint8Array): Uint8Array[] {
  // Apply PC-1
  const kp = permute(key, PC1, 56);

  // Split into C (bits 1-28) and D (bits 29-56) stored in 32-bit integers
  let C = 0,
    D = 0;
  for (let i = 0; i < 28; i++) {
    C |= getBit(kp, i + 1) << (27 - i);
    D |= getBit(kp, i + 29) << (27 - i);
  }

  const subkeys: Uint8Array[] = [];

  for (let round = 0; round < 16; round++) {
    C = rotateLeft28(C, LEFT_ROTATIONS[round]!);
    D = rotateLeft28(D, LEFT_ROTATIONS[round]!);

    // Combine C and D into 7 bytes for PC-2
    const cd = new Uint8Array(7);
    for (let i = 0; i < 28; i++) {
      const bit = (C >> (27 - i)) & 1;
      cd[i >> 3]! |= bit << (7 - (i & 7));
    }
    for (let i = 0; i < 28; i++) {
      const bit = (D >> (27 - i)) & 1;
      cd[(i + 28) >> 3]! |= bit << (7 - ((i + 28) & 7));
    }

    subkeys.push(permute(cd, PC2, 48));
  }

  return subkeys;
}

/** DES Feistel function f(R, K) */
function feistel(R: Uint8Array, K: Uint8Array): Uint8Array {
  // Expand R (32 bits) to 48 bits using E table
  const expanded = permute(R, E, 48);

  // XOR with sub-key
  for (let i = 0; i < 6; i++) {
    expanded[i]! ^= K[i]!;
  }

  // S-box substitution: 48 bits → 32 bits
  const sOut = new Uint8Array(4);
  for (let box = 0; box < 8; box++) {
    const bitPos = box * 6;
    const byteOff = bitPos >> 3;
    const bitOff = bitPos & 7;

    // Extract 6 bits
    let sixBits: number;
    if (bitOff <= 2) {
      sixBits = (expanded[byteOff]! >> (2 - bitOff)) & 0x3f;
    } else {
      sixBits =
        ((expanded[byteOff]! << (bitOff - 2)) | (expanded[byteOff + 1]! >> (10 - bitOff))) & 0x3f;
    }

    // Row = b1 (MSB) and b6 (LSB) of the 6-bit group: row = (b1 << 1) | b6
    const row = ((sixBits >> 4) & 2) | (sixBits & 1);
    const col = (sixBits >> 1) & 0x0f;
    const val = S_BOXES[box]![row * 16 + col]!;

    // Write 4 bits of output
    const outBitPos = box * 4;
    const outByteOff = outBitPos >> 3;
    const outBitOff = outBitPos & 7;
    if (outBitOff <= 4) {
      sOut[outByteOff]! |= val << (4 - outBitOff);
    } else {
      sOut[outByteOff]! |= val >> (outBitOff - 4);
      sOut[outByteOff + 1]! |= (val << (12 - outBitOff)) & 0xff;
    }
  }

  return permute(sOut, P_TABLE, 32);
}

/**
 * Encrypt or decrypt a single 8-byte DES block.
 * @param block - 8 bytes (modified in place)
 * @param subkeys - 16 sub-keys (forward for encrypt, reversed for decrypt)
 */
function desBlock(block: Uint8Array, subkeys: Uint8Array[]): void {
  const perm = permute(block, IP, 64);

  let L = perm.subarray(0, 4);
  let R = perm.subarray(4, 8);

  for (let round = 0; round < 16; round++) {
    const fOut = feistel(R, subkeys[round]!);
    const newR = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
      newR[i] = L[i]! ^ fOut[i]!;
    }
    L = R;
    R = newR;
  }

  // Final: R16 || L16
  const preOut = new Uint8Array(8);
  preOut.set(R, 0);
  preOut.set(L, 4);

  const out = permute(preOut, FP, 64);
  block.set(out);
}

/**
 * Pure 3DES-EDE-CBC decryption returning still-padded plaintext.
 * Never throws. Caller is responsible for validation and unpadding.
 *
 * @param key - 24 bytes (three 8-byte DES keys: K1, K2, K3)
 * @param iv  - 8 bytes
 * @param ciphertext - Must be a multiple of 8 bytes
 */
function tripleDesCbcDecryptRaw(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  // Generate sub-keys for each of the three DES keys
  const sk1 = generateSubkeys(key.subarray(0, 8));
  const sk2 = generateSubkeys(key.subarray(8, 16));
  const sk3 = generateSubkeys(key.subarray(16, 24));

  // Reversed sub-keys for decryption (K1 and K3 are applied in reverse)
  const sk1r = [...sk1].reverse();
  const sk3r = [...sk3].reverse();

  const plaintext = new Uint8Array(ciphertext.length);
  let prev = new Uint8Array(iv);

  for (let i = 0; i < ciphertext.length; i += 8) {
    const block = new Uint8Array(ciphertext.subarray(i, i + 8));
    const ctBlock = new Uint8Array(block); // save for CBC chain

    // 3DES-EDE decrypt: D(K3) → E(K2) → D(K1)
    // But "EDE" for decryption means: decrypt with K3, encrypt with K2, decrypt with K1
    desBlock(block, sk3r); // Decrypt with K3
    desBlock(block, sk2); // Encrypt with K2
    desBlock(block, sk1r); // Decrypt with K1

    // CBC: XOR with previous ciphertext block
    for (let j = 0; j < 8; j++) {
      plaintext[i + j] = block[j]! ^ prev[j]!;
    }
    prev = ctBlock;
  }

  return plaintext;
}

/**
 * Decrypt data using 3DES-EDE-CBC with PKCS#7 unpadding.
 *
 * @param key - 24 bytes (three 8-byte DES keys: K1, K2, K3)
 * @param iv  - 8 bytes
 * @param ciphertext - Must be a multiple of 8 bytes
 */
export const tripleDesCbcDecrypt = (
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Effect.Effect<Uint8Array, CryptoError> => {
  if (key.length !== 24) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.cipherError,
        reason: `3DES: key must be 24 bytes, got ${key.length}`,
        operation: CryptoOperationValue.cipherDes,
      }),
    );
  }
  if (iv.length !== 8) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.cipherError,
        reason: "3DES-CBC: IV must be 8 bytes",
        operation: CryptoOperationValue.cipherDes,
      }),
    );
  }
  if (ciphertext.length % 8 !== 0) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.cipherError,
        reason: "3DES-CBC: ciphertext must be multiple of 8 bytes",
        operation: CryptoOperationValue.cipherDes,
      }),
    );
  }

  return removePkcs7Padding(tripleDesCbcDecryptRaw(key, iv, ciphertext), 8);
};
