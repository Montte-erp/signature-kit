/**
 * @signature-kit/asn1 — node model, typed error catalog, and Effect-native accessors.
 *
 * The node is a discriminated union (`kind: "primitive" | "constructed"`) so every
 * read narrows without an `as` cast. Structural expectations return typed Effects
 * in the `Asn1Error` channel; nothing throws across the boundary.
 */

import { Effect, Schema } from "effect";

// =============================================================================
// Node model
// =============================================================================

export const Asn1ClassSchema = Schema.Literals(["universal", "context", "application", "private"]);
export type Asn1Class = (typeof Asn1ClassSchema)["Type"];

export const Asn1PrimitiveSchema = Schema.Struct({
  kind: Schema.Literals(["primitive"]),
  tag: Schema.Number,
  class: Asn1ClassSchema,
  bytes: Schema.Uint8Array,
});

export type Asn1Primitive = (typeof Asn1PrimitiveSchema)["Type"];

type Asn1ConstructedShape = {
  readonly kind: "constructed";
  readonly tag: number;
  readonly class: Asn1Class;
  readonly children: readonly Asn1Node[];
};

export const Asn1NodeSchema: Schema.Schema<Asn1Primitive | Asn1ConstructedShape> = Schema.suspend(
  () => Schema.Union([Asn1PrimitiveSchema, Asn1ConstructedSchema]),
);

export type Asn1Node = (typeof Asn1NodeSchema)["Type"];
export type Asn1Constructed = Extract<Asn1Node, { readonly kind: "constructed" }>;

export const Asn1ConstructedSchema: Schema.Schema<Asn1Constructed> = Schema.Struct({
  kind: Schema.Literals(["constructed"]),
  tag: Schema.Number,
  class: Asn1ClassSchema,
  children: Schema.Array(Schema.suspend(() => Asn1NodeSchema)),
});

// =============================================================================
// Error catalog
// =============================================================================

export const Asn1ErrorCodeSchema = Schema.Literals([
  "asn1.DECODE_ERROR",
  "asn1.STRUCTURE_ERROR",
  "asn1.OID_ERROR",
]);
export type Asn1ErrorCode = (typeof Asn1ErrorCodeSchema)["Type"];
export const Asn1ErrorCodeValue = {
  decodeError: "asn1.DECODE_ERROR",
  structureError: "asn1.STRUCTURE_ERROR",
  oidError: "asn1.OID_ERROR",
} satisfies Record<string, Asn1ErrorCode>;

export class Asn1Error extends Schema.TaggedErrorClass<Asn1Error>()("Asn1Error", {
  code: Asn1ErrorCodeSchema,
  reason: Schema.optional(Schema.String),
}) {
  get message(): string {
    switch (this.code) {
      case "asn1.DECODE_ERROR":
        return this.reason ?? "Failed to decode DER.";
      case "asn1.STRUCTURE_ERROR":
        return this.reason ?? "Unexpected ASN.1 structure.";
      case "asn1.OID_ERROR":
        return this.reason ?? "Failed to decode OID.";
    }
  }
}

// =============================================================================
// DER codec internals
// =============================================================================

const CLASS_MAP: readonly Asn1Class[] = ["universal", "application", "context", "private"];

const CLASS_BITS: Record<Asn1Class, number> = {
  universal: 0x00,
  application: 0x40,
  context: 0x80,
  private: 0xc0,
};

type Tlv = { readonly node: Asn1Node; readonly next: number };

const decodeRoot = (data: Uint8Array): Effect.Effect<Asn1Node, Asn1Error> =>
  data.length === 0
    ? Effect.fail(
        new Asn1Error({
          code: Asn1ErrorCodeValue.decodeError,
          reason: "Cannot decode empty data",
        }),
      )
    : Effect.map(decodeTlv(data, 0), (tlv) => tlv.node);

const decodeTlv = (data: Uint8Array, start: number): Effect.Effect<Tlv, Asn1Error> =>
  Effect.gen(function* () {
    let offset = start;
    if (offset >= data.length)
      return yield* Effect.fail(
        new Asn1Error({
          code: Asn1ErrorCodeValue.decodeError,
          reason: "Unexpected end of data while reading tag",
        }),
      );

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
        if (offset >= data.length)
          return yield* Effect.fail(
            new Asn1Error({
              code: Asn1ErrorCodeValue.decodeError,
              reason: "Truncated long-form tag",
            }),
          );
        byte = data[offset]!;
        offset++;
        tag = (tag << 7) | (byte & 0x7f);
      }
    } else {
      tag = lowBits;
    }

    if (offset >= data.length) {
      return yield* Effect.fail(
        new Asn1Error({
          code: Asn1ErrorCodeValue.decodeError,
          reason: "Unexpected end of data while reading length",
        }),
      );
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
      if (numLengthBytes === 0)
        return yield* Effect.fail(
          new Asn1Error({
            code: Asn1ErrorCodeValue.decodeError,
            reason: "Invalid length encoding",
          }),
        );
      if (offset + numLengthBytes > data.length) {
        return yield* Effect.fail(
          new Asn1Error({
            code: Asn1ErrorCodeValue.decodeError,
            reason: "Truncated length encoding",
          }),
        );
      }
      // Arithmetic, not `<<`: a 4-byte length with the high bit set would overflow a
      // signed 32-bit shift to a negative value and slip past the truncation guard.
      for (let i = 0; i < numLengthBytes; i++) {
        length = length * 256 + data[offset]!;
        offset++;
      }
      if (length > data.length)
        return yield* Effect.fail(
          new Asn1Error({
            code: Asn1ErrorCodeValue.decodeError,
            reason: "Length exceeds available data",
          }),
        );
    }

    if (indefinite) {
      if (!constructed) {
        return yield* Effect.fail(
          new Asn1Error({
            code: Asn1ErrorCodeValue.decodeError,
            reason: "Indefinite length on primitive encoding is invalid",
          }),
        );
      }
      const children: Asn1Node[] = [];
      let childOffset = offset;
      while (true) {
        if (childOffset + 1 >= data.length) {
          return yield* Effect.fail(
            new Asn1Error({
              code: Asn1ErrorCodeValue.decodeError,
              reason: "Truncated indefinite-length encoding: missing end-of-content",
            }),
          );
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
      return yield* Effect.fail(
        new Asn1Error({
          code: Asn1ErrorCodeValue.decodeError,
          reason: `Truncated value: expected ${length} bytes, ${data.length - offset} available`,
        }),
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

const encodeNode = (node: Asn1Node): Uint8Array => {
  const tagBytes = encodeTag(node);
  const valueBytes = encodeValue(node);
  const lengthBytes = encodeLength(valueBytes.length);

  const result = new Uint8Array(tagBytes.length + lengthBytes.length + valueBytes.length);
  let offset = 0;
  result.set(tagBytes, offset);
  offset += tagBytes.length;
  result.set(lengthBytes, offset);
  offset += lengthBytes.length;
  result.set(valueBytes, offset);
  return result;
};

const encodeTag = (node: Asn1Node): Uint8Array => {
  const classBits = CLASS_BITS[node.class] ?? 0;
  const constructedBit = node.kind === "constructed" ? 0x20 : 0;
  if (node.tag < 31) {
    return new Uint8Array([classBits | constructedBit | node.tag]);
  }
  const firstByte = classBits | constructedBit | 0x1f;
  const vlqBytes = encodeTagVlq(node.tag);
  const result = new Uint8Array(1 + vlqBytes.length);
  result[0] = firstByte;
  result.set(vlqBytes, 1);
  return result;
};

const encodeTagVlq = (tag: number): Uint8Array => {
  if (tag < 128) return new Uint8Array([tag]);
  const bytes: number[] = [];
  let value = tag;
  while (value > 0) {
    bytes.unshift(value & 0x7f);
    value = value >>> 7;
  }
  for (let i = 0; i < bytes.length - 1; i++) {
    const byte = bytes[i];
    if (byte !== undefined) bytes[i] = byte | 0x80;
  }
  return new Uint8Array(bytes);
};

const encodeLength = (length: number): Uint8Array => {
  if (length < 128) return new Uint8Array([length]);
  const lengthBytes: number[] = [];
  let value = length;
  while (value > 0) {
    lengthBytes.unshift(value & 0xff);
    value = value >>> 8;
  }
  const result = new Uint8Array(1 + lengthBytes.length);
  result[0] = 0x80 | lengthBytes.length;
  for (let i = 0; i < lengthBytes.length; i++) {
    result[i + 1] = lengthBytes[i]!;
  }
  return result;
};

const encodeValue = (node: Asn1Node): Uint8Array => {
  if (node.kind === "primitive") return node.bytes;

  let childBuffers = node.children.map((child) => encodeNode(child));
  // DER: SET OF elements must be sorted by encoded value (X.690 §11.6)
  if (node.class === "universal" && node.tag === 0x11) {
    childBuffers = childBuffers.slice().sort(compareDerBytes);
  }
  const totalLength = childBuffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buffer of childBuffers) {
    result.set(buffer, offset);
    offset += buffer.length;
  }
  return result;
};

const compareDerBytes = (a: Uint8Array, b: Uint8Array): number => {
  const minLength = Math.min(a.length, b.length);
  for (let i = 0; i < minLength; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return a.length - b.length;
};

const decodeOidBytes = (data: Uint8Array): Effect.Effect<string, Asn1Error> =>
  Effect.gen(function* () {
    if (data.length === 0) {
      return yield* Effect.fail(
        new Asn1Error({
          code: Asn1ErrorCodeValue.oidError,
          reason: "Empty OID data",
        }),
      );
    }

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
        if (offset >= data.length) {
          return yield* Effect.fail(
            new Asn1Error({
              code: Asn1ErrorCodeValue.oidError,
              reason: "Truncated VLQ in OID",
            }),
          );
        }
        byte = data[offset]!;
        offset++;
        // Arithmetic, not `<<`: arcs above 2^31 would overflow a signed 32-bit shift.
        value = value * 128 + (byte & 0x7f);
      }
      components.push(value);
    }

    return components.join(".");
  });

// =============================================================================
// Public boundary
// =============================================================================

/** Decode the first complete TLV from DER bytes. */
export const decode = (data: Uint8Array): Effect.Effect<Asn1Node, Asn1Error> => decodeRoot(data);

/** Re-encode a node to DER. Total for nodes produced by `decode`. */
export const encode = (node: Asn1Node): Uint8Array => encodeNode(node);

// =============================================================================
// Typed accessors
// =============================================================================

export const childrenOf = (node: Asn1Node): Effect.Effect<readonly Asn1Node[], Asn1Error> =>
  node.kind === "constructed"
    ? Effect.succeed(node.children)
    : Effect.fail(
        new Asn1Error({
          code: Asn1ErrorCodeValue.structureError,
          reason: `Expected a constructed node, got a primitive (tag ${node.tag}).`,
        }),
      );

export const bytesOf = (node: Asn1Node): Effect.Effect<Uint8Array, Asn1Error> =>
  node.kind === "primitive"
    ? Effect.succeed(node.bytes)
    : Effect.fail(
        new Asn1Error({
          code: Asn1ErrorCodeValue.structureError,
          reason: `Expected a primitive node, got a constructed node (tag ${node.tag}).`,
        }),
      );

export const oidString = (node: Asn1Node): Effect.Effect<string, Asn1Error> =>
  Effect.flatMap(bytesOf(node), decodeOidBytes);

/** Read a DER INTEGER (two's complement) as a bigint. */
export const integerBigInt = (node: Asn1Node): Effect.Effect<bigint, Asn1Error> =>
  Effect.map(bytesOf(node), (bytes) => {
    if (bytes.length === 0) return 0n;
    let value = (bytes[0]! & 0x80) === 0 ? 0n : -1n;
    for (const byte of bytes) {
      value = (value << 8n) | BigInt(byte);
    }
    return value;
  });
