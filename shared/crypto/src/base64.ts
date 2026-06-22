const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const base64Value = (char: string): number => {
  const code = char.charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (char === "+") return 62;
  if (char === "/") return 63;
  return 0;
};

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] ?? 0;
    const second = bytes[offset + 1] ?? 0;
    const third = bytes[offset + 2] ?? 0;
    const chunk = (first << 16) | (second << 8) | third;
    output += BASE64_ALPHABET[(chunk >> 18) & 0x3f] ?? "";
    output += BASE64_ALPHABET[(chunk >> 12) & 0x3f] ?? "";
    output += offset + 1 < bytes.length ? (BASE64_ALPHABET[(chunk >> 6) & 0x3f] ?? "") : "=";
    output += offset + 2 < bytes.length ? (BASE64_ALPHABET[chunk & 0x3f] ?? "") : "=";
  }
  return output;
};

export const base64ToBytes = (base64: string): Uint8Array => {
  const clean = base64.replace(/[\t\n\r ]/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const output = new Uint8Array(Math.floor((clean.length * 3) / 4) - padding);
  let outputOffset = 0;

  for (let offset = 0; offset < clean.length; offset += 4) {
    const first = base64Value(clean[offset] ?? "");
    const second = base64Value(clean[offset + 1] ?? "");
    const third = base64Value(clean[offset + 2] ?? "");
    const fourth = base64Value(clean[offset + 3] ?? "");
    const chunk = (first << 18) | (second << 12) | (third << 6) | fourth;

    if (outputOffset < output.length) {
      output[outputOffset] = (chunk >> 16) & 0xff;
      outputOffset++;
    }
    if (outputOffset < output.length) {
      output[outputOffset] = (chunk >> 8) & 0xff;
      outputOffset++;
    }
    if (outputOffset < output.length) {
      output[outputOffset] = chunk & 0xff;
      outputOffset++;
    }
  }

  return output;
};
