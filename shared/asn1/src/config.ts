/**
 * @signature-kit/asn1 — node model, typed error catalog, and Effect-native accessors.
 *
 * The node is a discriminated union (`kind: "primitive" | "constructed"`) so every
 * read narrows without an `as` cast. Structural expectations return typed Effects
 * in the `Asn1Error` channel; nothing throws across the boundary.
 */

import { Effect, Schema } from "effect";
import { decodeRoot } from "./decoder";
import { encodeNode } from "./encoder";
import { decodeOidBytes } from "./oid";

// =============================================================================
// Node model
// =============================================================================

export const Asn1ClassSchema = Schema.Literals(["universal", "context", "application", "private"]);
export type Asn1Class = (typeof Asn1ClassSchema)["Type"];

export type Asn1Primitive = {
  readonly kind: "primitive";
  readonly tag: number;
  readonly class: Asn1Class;
  readonly bytes: Uint8Array;
};

export type Asn1Constructed = {
  readonly kind: "constructed";
  readonly tag: number;
  readonly class: Asn1Class;
  readonly children: readonly Asn1Node[];
};

export type Asn1Node = Asn1Primitive | Asn1Constructed;

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
