import { StyleSheet, Text, View } from "@react-pdf/renderer";

export type PdfPartySignatureBlockProps = {
  readonly signerName: string;
  readonly signerDocument?: string;
  readonly role?: string;
  readonly title?: string;
  readonly signedAt?: string;
  readonly width?: number;
  readonly height?: number;
};

const styles = StyleSheet.create({
  root: {
    borderColor: "#9ca3af",
    borderRadius: 6,
    borderWidth: 1,
    color: "#111827",
    fontFamily: "Helvetica",
    padding: 10,
  },
  title: {
    color: "#374151",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 0.8,
    marginBottom: 18,
    textTransform: "uppercase",
  },
  line: {
    borderTopColor: "#1f2937",
    borderTopWidth: 1,
    marginBottom: 4,
    width: "100%",
  },
  name: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    textAlign: "center",
  },
  meta: {
    color: "#4b5563",
    fontSize: 7,
    lineHeight: 1.35,
    marginTop: 2,
    textAlign: "center",
  },
});

export function PdfPartySignatureBlock({
  signerName,
  signerDocument,
  role,
  title = "Assinatura",
  signedAt,
  width = 240,
  height = 116,
}: PdfPartySignatureBlockProps) {
  return (
    <View style={[styles.root, { width, minHeight: height }]}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.line} />
      <Text style={styles.name}>{signerName}</Text>
      {signerDocument === undefined ? null : <Text style={styles.meta}>{signerDocument}</Text>}
      {role === undefined ? null : <Text style={styles.meta}>{role}</Text>}
      {signedAt === undefined ? null : <Text style={styles.meta}>Assinado em: {signedAt}</Text>}
    </View>
  );
}
