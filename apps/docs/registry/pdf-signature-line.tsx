import { StyleSheet, Text, View } from "@react-pdf/renderer";

export type PdfSignatureMark = {
  readonly name: string;
  readonly document?: string;
  readonly date?: string;
};

export type PdfSignatureLineProps = {
  readonly name: string;
  readonly document?: string;
  readonly role?: string;
  readonly signed?: PdfSignatureMark;
  readonly label?: string;
  readonly width?: number;
};

const DEFAULT_WIDTH = 260;

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    color: "#111827",
    fontFamily: "Helvetica",
  },
  markBand: {
    alignItems: "center",
    height: 32,
    justifyContent: "flex-end",
    paddingBottom: 2,
    width: "100%",
  },
  mark: {
    color: "#1f2937",
    fontFamily: "Helvetica-Oblique",
    fontSize: 16,
  },
  hint: {
    color: "#9ca3af",
    fontSize: 8,
    letterSpacing: 1,
  },
  line: {
    borderTopColor: "#1f2937",
    borderTopWidth: 1,
    width: "100%",
  },
  name: {
    color: "#111827",
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    marginTop: 6,
    textAlign: "center",
  },
  meta: {
    color: "#6b7280",
    fontSize: 8,
    marginTop: 2,
    textAlign: "center",
  },
  stamp: {
    color: "#6d28d9",
    fontSize: 7,
    marginTop: 4,
    textAlign: "center",
  },
});

export function PdfSignatureLine({
  name,
  document,
  role,
  signed,
  label = "Assinatura",
  width = DEFAULT_WIDTH,
}: PdfSignatureLineProps) {
  return (
    <View style={[styles.root, { width }]}>
      <View style={styles.markBand}>
        {signed === undefined ? (
          <Text style={styles.hint}>{label}</Text>
        ) : (
          <Text style={styles.mark}>{signed.name}</Text>
        )}
      </View>
      <View style={styles.line} />
      <Text style={styles.name}>{signed?.name ?? name}</Text>
      {document === undefined ? null : <Text style={styles.meta}>{document}</Text>}
      {role === undefined ? null : <Text style={styles.meta}>{role}</Text>}
      {signed?.date === undefined ? null : (
        <Text style={styles.stamp}>Assinado digitalmente · {signed.date}</Text>
      )}
    </View>
  );
}
