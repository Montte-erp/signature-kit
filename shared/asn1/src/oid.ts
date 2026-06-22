import type { Asn1Step } from "./config";

/** Decode DER OID value bytes to dot-notation. No-throw discriminated result. */
export const decodeOidBytes = (data: Uint8Array): Asn1Step<string> => {
  if (data.length === 0) return { _tag: "fail", reason: "Empty OID data" };

  const components: number[] = [];
  const firstByte = data[0]!;
  if (firstByte < 80) {
    components.push(Math.floor(firstByte / 40));
    components.push(firstByte % 40);
  } else {
    components.push(2);
    components.push(firstByte - 80);
  }

  let offset = 1;
  while (offset < data.length) {
    let value = 0;
    let byte = 0x80;
    while ((byte & 0x80) !== 0) {
      if (offset >= data.length) return { _tag: "fail", reason: "Truncated VLQ in OID" };
      byte = data[offset]!;
      offset++;
      // Arithmetic, not `<<`: arcs above 2^31 would overflow a signed 32-bit shift.
      value = value * 128 + (byte & 0x7f);
    }
    components.push(value);
  }

  return { _tag: "ok", value: components.join(".") };
};
