const H0 = 0x67452301;
const H1 = 0xefcdab89;
const H2 = 0x98badcfe;
const H3 = 0x10325476;
const H4 = 0xc3d2e1f0;

function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function add32(...nums: number[]): number {
  let r = 0;
  for (const n of nums) r = (r + n) >>> 0;
  return r;
}

export function sha1(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const padLen = data.length % 64 < 56 ? 56 - (data.length % 64) : 120 - (data.length % 64);
  const totalLen = data.length + padLen + 8;

  const msg = new Uint8Array(totalLen);
  msg.set(data);
  msg[data.length] = 0x80;

  const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), true);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);
  const bitLenHi = Math.floor(data.length / 0x20000000) | 0;
  const bitLenLo = (data.length * 8) >>> 0;
  view.setUint32(totalLen - 8, bitLenHi, false);
  view.setUint32(totalLen - 4, bitLenLo, false);

  let h0 = H0,
    h1 = H1,
    h2 = H2,
    h3 = H3,
    h4 = H4;
  const w = new Uint32Array(80);

  for (let i = 0; i < totalLen; i += 64) {
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

  const digest = new Uint8Array(20);
  const dv = new DataView(digest.buffer);
  dv.setUint32(0, h0, false);
  dv.setUint32(4, h1, false);
  dv.setUint32(8, h2, false);
  dv.setUint32(12, h3, false);
  dv.setUint32(16, h4, false);
  return digest;
}
