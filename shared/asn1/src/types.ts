export type Asn1Class = "universal" | "context" | "application" | "private";

export type Asn1Node = {
  tag: number;
  constructed: boolean;
  class: Asn1Class;
  value: Uint8Array | Asn1Node[];
};
