import type { Asn1Class, Asn1Node, Asn1Step } from "./config";

const CLASS_MAP: Asn1Class[] = ["universal", "application", "context", "private"];

type Tlv = { readonly node: Asn1Node; readonly next: number };

const fail = (reason: string): Asn1Step<never> => ({ _tag: "fail", reason });

/**
 * Decode the first complete TLV from DER bytes.
 *
 * No-throw: returns an `Asn1Step` discriminated result that the public `decode`
 * boundary lifts into the `Asn1Error` channel.
 */
export const decodeRoot = (data: Uint8Array): Asn1Step<Asn1Node> => {
  if (data.length === 0) return fail("Cannot decode empty data");
  const step = decodeTlv(data, 0);
  return step._tag === "ok" ? { _tag: "ok", value: step.value.node } : step;
};

const decodeTlv = (data: Uint8Array, start: number): Asn1Step<Tlv> => {
  let offset = start;
  if (offset >= data.length) return fail("Unexpected end of data while reading tag");

  const startByte = data[offset]!;
  offset++;

  const classBits = (startByte >> 6) & 0x03;
  const asn1Class: Asn1Class = CLASS_MAP[classBits] ?? "universal";
  const constructed = (startByte & 0x20) !== 0;

  let tag: number;
  const lowBits = startByte & 0x1f;
  if (lowBits === 0x1f) {
    tag = 0;
    let byte = 0x80;
    while ((byte & 0x80) !== 0) {
      if (offset >= data.length) return fail("Truncated long-form tag");
      byte = data[offset]!;
      offset++;
      tag = (tag << 7) | (byte & 0x7f);
    }
  } else {
    tag = lowBits;
  }

  if (offset >= data.length) return fail("Unexpected end of data while reading length");

  const lengthByte = data[offset]!;
  offset++;
  let length = 0;
  let indefinite = false;

  if (lengthByte === 0x80) {
    indefinite = true;
  } else if (lengthByte < 0x80) {
    length = lengthByte;
  } else {
    const numLengthBytes = lengthByte & 0x7f;
    if (numLengthBytes === 0) return fail("Invalid length encoding");
    if (offset + numLengthBytes > data.length) return fail("Truncated length encoding");
    // Arithmetic, not `<<`: a 4-byte length with the high bit set would overflow a
    // signed 32-bit shift to a negative value and slip past the truncation guard.
    for (let i = 0; i < numLengthBytes; i++) {
      length = length * 256 + data[offset]!;
      offset++;
    }
    if (length > data.length) return fail("Length exceeds available data");
  }

  if (indefinite) {
    if (!constructed) return fail("Indefinite length on primitive encoding is invalid");
    const children: Asn1Node[] = [];
    let childOffset = offset;
    while (true) {
      if (childOffset + 1 >= data.length) {
        return fail("Truncated indefinite-length encoding: missing end-of-content");
      }
      if (data[childOffset] === 0x00 && data[childOffset + 1] === 0x00) {
        childOffset += 2;
        break;
      }
      const childStep = decodeTlv(data, childOffset);
      if (childStep._tag === "fail") return childStep;
      children.push(childStep.value.node);
      childOffset = childStep.value.next;
    }
    return {
      _tag: "ok",
      value: { node: { kind: "constructed", tag, class: asn1Class, children }, next: childOffset },
    };
  }

  const endOffset = offset + length;
  if (endOffset > data.length) {
    return fail(`Truncated value: expected ${length} bytes, ${data.length - offset} available`);
  }

  if (constructed) {
    const children: Asn1Node[] = [];
    let childOffset = offset;
    while (childOffset < endOffset) {
      const childStep = decodeTlv(data, childOffset);
      if (childStep._tag === "fail") return childStep;
      children.push(childStep.value.node);
      childOffset = childStep.value.next;
    }
    return {
      _tag: "ok",
      value: { node: { kind: "constructed", tag, class: asn1Class, children }, next: endOffset },
    };
  }

  return {
    _tag: "ok",
    value: {
      node: {
        kind: "primitive",
        tag,
        class: asn1Class,
        bytes: new Uint8Array(data.subarray(offset, endOffset)),
      },
      next: endOffset,
    },
  };
};
