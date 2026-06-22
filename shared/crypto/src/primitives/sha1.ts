/**
 * SHA-1 pure TypeScript implementation (FIPS 180-4).
 *
 * Zero runtime dependencies. Works in any JS environment (browser, Node.js,
 * Deno, Cloudflare Workers, Bun).
 *
 * ⚠️  SHA-1 is cryptographically broken for collision resistance. It is used
 *     here exclusively for PKCS#12 legacy MAC/KDF compatibility.
 */

// SHA-1 initial hash values (first 32 bits of fractional parts of sqrt(2..5))
const H0 = 0x67452301;
const H1 = 0xefcdab89;
const H2 = 0x98badcfe;
const H3 = 0x10325476;
const H4 = 0xc3d2e1f0;

/** Rotate left 32-bit integer */
function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/** Add two 32-bit unsigned integers (mod 2^32) */
function add32(...nums: number[]): number {
  let r = 0;
  for (const n of nums) r = (r + n) >>> 0;
  return r;
}

/**
 * Compute SHA-1 digest of `data`.
 * Returns a 20-byte Uint8Array.
 */
export function sha1(data: Uint8Array): Uint8Array {
  // ---- Pre-processing: padding ----
  const bitLen = data.length * 8;
  // Message length in bytes after padding: must be ≡ 56 (mod 64)
  const padLen = data.length % 64 < 56 ? 56 - (data.length % 64) : 120 - (data.length % 64);
  const totalLen = data.length + padLen + 8;

  const msg = new Uint8Array(totalLen);
  msg.set(data);
  msg[data.length] = 0x80;

  // Append bit length as big-endian 64-bit integer (only lower 32 bits in practice)
  const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), true);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);
  // Actually SHA-1 uses big-endian for length
  // Re-do: write the 64-bit length big-endian
  const bitLenHi = Math.floor(data.length / 0x20000000) | 0; // data.length * 8, upper 32 bits
  const bitLenLo = (data.length * 8) >>> 0;
  view.setUint32(totalLen - 8, bitLenHi, false);
  view.setUint32(totalLen - 4, bitLenLo, false);

  // ---- Processing ----
  let h0 = H0,
    h1 = H1,
    h2 = H2,
    h3 = H3,
    h4 = H4;
  const w = new Uint32Array(80);

  for (let i = 0; i < totalLen; i += 64) {
    // Prepare message schedule
    for (let t = 0; t < 16; t++) {
      w[t] = view.getUint32(i + t * 4, false);
    }
    for (let t = 16; t < 80; t++) {
      w[t] = rotl32(w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!, 1);
    }

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4;

    for (let t = 0; t < 80; t++) {
      let f: number, k: number;
      if (t < 20) {
        f = (b & c) | ((~b >>> 0) & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = add32(rotl32(a, 5), f, e, k, w[t]!);
      e = d;
      d = c;
      c = rotl32(b, 30);
      b = a;
      a = temp;
    }

    h0 = add32(h0, a);
    h1 = add32(h1, b);
    h2 = add32(h2, c);
    h3 = add32(h3, d);
    h4 = add32(h4, e);
  }

  // ---- Produce digest ----
  const digest = new Uint8Array(20);
  const dv = new DataView(digest.buffer);
  dv.setUint32(0, h0, false);
  dv.setUint32(4, h1, false);
  dv.setUint32(8, h2, false);
  dv.setUint32(12, h3, false);
  dv.setUint32(16, h4, false);
  return digest;
}
