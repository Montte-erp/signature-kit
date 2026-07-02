/**
 * SHA-512 and SHA-384 pure TypeScript implementation (FIPS 180-4).
 *
 * SHA-384 uses the same core as SHA-512 with different initial values and
 * truncates the output to 48 bytes.
 *
 * Zero runtime dependencies. Works in any JS environment.
 *
 * Note: 64-bit arithmetic is emulated with two 32-bit halves (hi/lo) since
 * JavaScript integers are 53-bit. No BigInt used here to keep it fast.
 */

// SHA-512 round constants K (first 64 bits of cbrt of first 80 primes)
// Stored as pairs [hi, lo] of 32-bit values (index = t*2 for hi, t*2+1 for lo)
const K512 = new Uint32Array([
  0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc,
  0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
  0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe, 0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2,
  0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
  0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
  0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
  0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4,
  0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725, 0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
  0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df,
  0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
  0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30,
  0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
  0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53, 0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8,
  0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
  0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
  0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
  0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178,
  0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6, 0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
  0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c,
  0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817,
]);

// SHA-512 initial hash values
const INIT_512 = new Uint32Array([
  0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
  0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
]);

// SHA-384 initial hash values
const INIT_384 = new Uint32Array([
  0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507, 0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939,
  0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511, 0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4,
]);

function add64(ah: number, al: number, bh: number, bl: number): [number, number] {
  const lo = (al + bl) >>> 0;
  const carry = lo < al >>> 0 ? 1 : 0;
  const hi = (ah + bh + carry) >>> 0;
  return [hi, lo];
}

function rotr64(hi: number, lo: number, n: number): [number, number] {
  if (n < 32) {
    return [((hi >>> n) | (lo << (32 - n))) >>> 0, ((lo >>> n) | (hi << (32 - n))) >>> 0];
  }
  n -= 32;
  return [((lo >>> n) | (hi << (32 - n))) >>> 0, ((hi >>> n) | (lo << (32 - n))) >>> 0];
}

function shr64(hi: number, lo: number, n: number): [number, number] {
  return [(hi >>> n) >>> 0, ((lo >>> n) | (hi << (32 - n))) >>> 0];
}

function xor3_64(
  ah: number,
  al: number,
  bh: number,
  bl: number,
  ch_: number,
  cl: number,
): [number, number] {
  return [(ah ^ bh ^ ch_) >>> 0, (al ^ bl ^ cl) >>> 0];
}
function sha512Core(data: Uint8Array, initH: Uint32Array): Uint8Array {
  const bitLenHi = Math.floor(data.length / 0x20000000);
  const bitLenLo = (data.length << 3) >>> 0;
  const padLen = data.length % 128 < 112 ? 112 - (data.length % 128) : 240 - (data.length % 128);
  const totalLen = data.length + padLen + 16;

  const msg = new Uint8Array(totalLen);
  msg.set(data);
  msg[data.length] = 0x80;

  const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  view.setUint32(totalLen - 16, 0, false);
  view.setUint32(totalLen - 12, 0, false);
  view.setUint32(totalLen - 8, bitLenHi, false);
  view.setUint32(totalLen - 4, bitLenLo, false);

  const h = new Uint32Array(16);
  h.set(initH);

  const W = new Uint32Array(160); // 80 × 64-bit

  for (let i = 0; i < totalLen; i += 128) {
    for (let t = 0; t < 16; t++) {
      W[t * 2] = view.getUint32(i + t * 8, false);
      W[t * 2 + 1] = view.getUint32(i + t * 8 + 4, false);
    }

    for (let t = 16; t < 80; t++) {
      // σ1(W[t-2]) = ROTR19 ^ ROTR61 ^ SHR6
      const [r19h, r19l] = rotr64(W[(t - 2) * 2]!, W[(t - 2) * 2 + 1]!, 19);
      const [r61h, r61l] = rotr64(W[(t - 2) * 2]!, W[(t - 2) * 2 + 1]!, 61);
      const [s6h, s6l] = shr64(W[(t - 2) * 2]!, W[(t - 2) * 2 + 1]!, 6);
      const [s1h, s1l] = xor3_64(r19h, r19l, r61h, r61l, s6h, s6l);

      // σ0(W[t-15]) = ROTR1 ^ ROTR8 ^ SHR7
      const [r1h, r1l] = rotr64(W[(t - 15) * 2]!, W[(t - 15) * 2 + 1]!, 1);
      const [r8h, r8l] = rotr64(W[(t - 15) * 2]!, W[(t - 15) * 2 + 1]!, 8);
      const [s7h, s7l] = shr64(W[(t - 15) * 2]!, W[(t - 15) * 2 + 1]!, 7);
      const [s0h, s0l] = xor3_64(r1h, r1l, r8h, r8l, s7h, s7l);

      let [rh, rl] = add64(W[(t - 16) * 2]!, W[(t - 16) * 2 + 1]!, s0h, s0l);
      [rh, rl] = add64(rh, rl, W[(t - 7) * 2]!, W[(t - 7) * 2 + 1]!);
      [rh, rl] = add64(rh, rl, s1h, s1l);
      W[t * 2] = rh;
      W[t * 2 + 1] = rl;
    }

    let ah = h[0]!,
      al = h[1]!;
    let bh = h[2]!,
      bl = h[3]!;
    let ch_v = h[4]!,
      cl = h[5]!;
    let dh = h[6]!,
      dl = h[7]!;
    let eh = h[8]!,
      el = h[9]!;
    let fh = h[10]!,
      fl = h[11]!;
    let gh = h[12]!,
      gl = h[13]!;
    let hh = h[14]!,
      hl = h[15]!;

    for (let t = 0; t < 80; t++) {
      // Σ1(e) = ROTR14 ^ ROTR18 ^ ROTR41
      const [r14h, r14l] = rotr64(eh, el, 14);
      const [r18h, r18l] = rotr64(eh, el, 18);
      const [r41h, r41l] = rotr64(eh, el, 41);
      const [S1h, S1l] = xor3_64(r14h, r14l, r18h, r18l, r41h, r41l);

      // Ch(e, f, g) = (e & f) ^ (~e & g)
      const chH = ((eh & fh) ^ ((~eh >>> 0) & gh)) >>> 0;
      const chL = ((el & fl) ^ ((~el >>> 0) & gl)) >>> 0;

      // T1 = h + Σ1(e) + Ch(e,f,g) + K[t] + W[t]
      let [T1h, T1l] = add64(hh, hl, S1h, S1l);
      [T1h, T1l] = add64(T1h, T1l, chH, chL);
      [T1h, T1l] = add64(T1h, T1l, K512[t * 2]!, K512[t * 2 + 1]!);
      [T1h, T1l] = add64(T1h, T1l, W[t * 2]!, W[t * 2 + 1]!);

      // Σ0(a) = ROTR28 ^ ROTR34 ^ ROTR39
      const [r28h, r28l] = rotr64(ah, al, 28);
      const [r34h, r34l] = rotr64(ah, al, 34);
      const [r39h, r39l] = rotr64(ah, al, 39);
      const [S0h, S0l] = xor3_64(r28h, r28l, r34h, r34l, r39h, r39l);

      // Maj(a, b, c) = (a & b) ^ (a & c) ^ (b & c)
      const majH = ((ah & bh) ^ (ah & ch_v) ^ (bh & ch_v)) >>> 0;
      const majL = ((al & bl) ^ (al & cl) ^ (bl & cl)) >>> 0;

      // T2 = Σ0(a) + Maj(a,b,c)
      const [T2h, T2l] = add64(S0h, S0l, majH, majL);

      hh = gh;
      hl = gl;
      gh = fh;
      gl = fl;
      fh = eh;
      fl = el;
      [eh, el] = add64(dh, dl, T1h, T1l);
      dh = ch_v;
      dl = cl;
      ch_v = bh;
      cl = bl;
      bh = ah;
      bl = al;
      [ah, al] = add64(T1h, T1l, T2h, T2l);
    }

    const t0 = add64(h[0]!, h[1]!, ah, al);
    h[0] = t0[0];
    h[1] = t0[1];
    const t1 = add64(h[2]!, h[3]!, bh, bl);
    h[2] = t1[0];
    h[3] = t1[1];
    const t2 = add64(h[4]!, h[5]!, ch_v, cl);
    h[4] = t2[0];
    h[5] = t2[1];
    const t3 = add64(h[6]!, h[7]!, dh, dl);
    h[6] = t3[0];
    h[7] = t3[1];
    const t4 = add64(h[8]!, h[9]!, eh, el);
    h[8] = t4[0];
    h[9] = t4[1];
    const t5 = add64(h[10]!, h[11]!, fh, fl);
    h[10] = t5[0];
    h[11] = t5[1];
    const t6 = add64(h[12]!, h[13]!, gh, gl);
    h[12] = t6[0];
    h[13] = t6[1];
    const t7 = add64(h[14]!, h[15]!, hh, hl);
    h[14] = t7[0];
    h[15] = t7[1];
  }

  const digest = new Uint8Array(64);
  const dv = new DataView(digest.buffer);
  for (let i = 0; i < 16; i++) {
    dv.setUint32(i * 4, h[i]!, false);
  }
  return digest;
}

/**
 * Compute SHA-512 digest of `data`.
 * Returns a 64-byte Uint8Array.
 */
export function sha512(data: Uint8Array): Uint8Array {
  return sha512Core(data, INIT_512);
}

/**
 * Compute SHA-384 digest of `data`.
 * Returns a 48-byte Uint8Array.
 */
export function sha384(data: Uint8Array): Uint8Array {
  return sha512Core(data, INIT_384).subarray(0, 48);
}
