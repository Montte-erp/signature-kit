import { Effect } from "effect";
import { Asn1Error, Asn1ErrorCodeValue, type Asn1Class, type Asn1Node } from "./config";

const CLASS_MAP: Asn1Class[] = ["universal", "application", "context", "private"];

type Tlv = { readonly node: Asn1Node; readonly next: number };

const fail = (reason: string): Effect.Effect<never, Asn1Error> =>
  Effect.fail(new Asn1Error({ code: Asn1ErrorCodeValue.decodeError, reason }));

/** Decode the first complete TLV from DER bytes. */
export const decodeRoot = (data: Uint8Array): Effect.Effect<Asn1Node, Asn1Error> =>
  data.length === 0
    ? fail("Cannot decode empty data")
    : Effect.map(decodeTlv(data, 0), (tlv) => tlv.node);

const decodeTlv = (data: Uint8Array, start: number): Effect.Effect<Tlv, Asn1Error> =>
  Effect.gen(function* () {
    let offset = start;
    if (offset >= data.length) return yield* fail("Unexpected end of data while reading tag");

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
        if (offset >= data.length) return yield* fail("Truncated long-form tag");
        byte = data[offset]!;
        offset++;
        tag = (tag << 7) | (byte & 0x7f);
      }
    } else {
      tag = lowBits;
    }

    if (offset >= data.length) {
      return yield* fail("Unexpected end of data while reading length");
    }

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
      if (numLengthBytes === 0) return yield* fail("Invalid length encoding");
      if (offset + numLengthBytes > data.length) {
        return yield* fail("Truncated length encoding");
      }
      // Arithmetic, not `<<`: a 4-byte length with the high bit set would overflow a
      // signed 32-bit shift to a negative value and slip past the truncation guard.
      for (let i = 0; i < numLengthBytes; i++) {
        length = length * 256 + data[offset]!;
        offset++;
      }
      if (length > data.length) return yield* fail("Length exceeds available data");
    }

    if (indefinite) {
      if (!constructed) {
        return yield* fail("Indefinite length on primitive encoding is invalid");
      }
      const children: Asn1Node[] = [];
      let childOffset = offset;
      while (true) {
        if (childOffset + 1 >= data.length) {
          return yield* fail("Truncated indefinite-length encoding: missing end-of-content");
        }
        if (data[childOffset] === 0x00 && data[childOffset + 1] === 0x00) {
          childOffset += 2;
          break;
        }
        const child = yield* decodeTlv(data, childOffset);
        children.push(child.node);
        childOffset = child.next;
      }
      return { node: { kind: "constructed", tag, class: asn1Class, children }, next: childOffset };
    }

    const endOffset = offset + length;
    if (endOffset > data.length) {
      return yield* fail(
        `Truncated value: expected ${length} bytes, ${data.length - offset} available`,
      );
    }

    if (constructed) {
      const children: Asn1Node[] = [];
      let childOffset = offset;
      while (childOffset < endOffset) {
        const child = yield* decodeTlv(data, childOffset);
        children.push(child.node);
        childOffset = child.next;
      }
      return { node: { kind: "constructed", tag, class: asn1Class, children }, next: endOffset };
    }

    return {
      node: {
        kind: "primitive",
        tag,
        class: asn1Class,
        bytes: new Uint8Array(data.subarray(offset, endOffset)),
      },
      next: endOffset,
    };
  });
