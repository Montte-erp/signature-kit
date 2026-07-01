const ASCII = new TextEncoder();
const ASCII_DECODER = new TextDecoder("utf-8");
const HEX_ALPHABET = "0123456789abcdef";

export const encodeAscii = (value: string): Uint8Array => ASCII.encode(value);

export const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  let length = 0;
  for (const part of parts) length += part.byteLength;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

export const indexOfBytes = (data: Uint8Array, pattern: Uint8Array, start = 0): number => {
  if (pattern.byteLength === 0) return start <= data.byteLength ? start : -1;
  const max = data.byteLength - pattern.byteLength;
  for (let offset = start; offset <= max; offset++) {
    let matched = true;
    for (let index = 0; index < pattern.byteLength; index++) {
      if (data[offset + index] !== pattern[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return offset;
  }
  return -1;
};

export const lastIndexOfBytes = (data: Uint8Array, pattern: Uint8Array): number => {
  if (pattern.byteLength === 0) return data.byteLength;
  for (let offset = data.byteLength - pattern.byteLength; offset >= 0; offset--) {
    let matched = true;
    for (let index = 0; index < pattern.byteLength; index++) {
      if (data[offset + index] !== pattern[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return offset;
  }
  return -1;
};

export const indexOfByte = (data: Uint8Array, byte: number, start = 0): number => {
  for (let offset = start; offset < data.byteLength; offset++) {
    if (data[offset] === byte) return offset;
  }
  return -1;
};

export const replaceRange = (
  data: Uint8Array,
  start: number,
  end: number,
  replacement: Uint8Array,
): Uint8Array => concatBytes([data.slice(0, start), replacement, data.slice(end)]);

export const asciiSlice = (data: Uint8Array, start: number, end: number): string =>
  ASCII_DECODER.decode(data.slice(start, end));

export const bytesToHex = (bytes: Uint8Array): string => {
  let output = "";
  for (const byte of bytes) {
    output += HEX_ALPHABET[(byte >> 4) & 0x0f] ?? "";
    output += HEX_ALPHABET[byte & 0x0f] ?? "";
  }
  return output;
};

export const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let index = 0; index < bytes.length; index++) {
    const high = hex.charCodeAt(index * 2);
    const low = hex.charCodeAt(index * 2 + 1);
    const highNibble = high <= 57 ? high - 48 : high <= 70 ? high - 55 : high - 87;
    const lowNibble = low <= 57 ? low - 48 : low <= 70 ? low - 55 : low - 87;
    bytes[index] = (highNibble << 4) | lowNibble;
  }
  return bytes;
};

export const trimTrailingZeroHex = (hex: string): string => {
  let end = hex.length;
  while (end >= 2 && hex.slice(end - 2, end) === "00") end -= 2;
  return hex.slice(0, end);
};
