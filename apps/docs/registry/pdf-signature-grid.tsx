import { StyleSheet, Text, View } from "@react-pdf/renderer";

export type PdfSignatureGridSigner = {
  readonly name: string;
  readonly document?: string;
  readonly role?: string;
  readonly signedAt?: string;
};

export type PdfSignatureGridProps = {
  readonly signers: ReadonlyArray<PdfSignatureGridSigner>;
  readonly columns?: number;
  readonly width?: number;
};

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    paddingBottom: 18,
    paddingHorizontal: 8,
  },
  line: {
    borderTopColor: "#1f2937",
    borderTopWidth: 1,
    marginBottom: 4,
    width: "100%",
  },
  name: {
    color: "#111827",
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    textAlign: "center",
  },
  meta: {
    color: "#6b7280",
    fontFamily: "Helvetica",
    fontSize: 7,
    lineHeight: 1.35,
    textAlign: "center",
  },
});

export function PdfSignatureGrid({ signers, columns = 2, width = 460 }: PdfSignatureGridProps) {
  const columnWidth = width / columns;

  return (
    <View style={[styles.root, { width }]}>
      {signers.map((signer) => (
        <View key={`${signer.name}:${signer.document ?? signer.role ?? "signer"}`} style={[styles.cell, { width: columnWidth }]}>
          <View style={styles.line} />
          <Text style={styles.name}>{signer.name}</Text>
          {signer.document === undefined ? null : <Text style={styles.meta}>{signer.document}</Text>}
          {signer.role === undefined ? null : <Text style={styles.meta}>{signer.role}</Text>}
          {signer.signedAt === undefined ? null : <Text style={styles.meta}>Assinado em: {signer.signedAt}</Text>}
        </View>
      ))}
    </View>
  );
}
