import { StyleSheet, Text, View } from "@react-pdf/renderer";

export type PdfInitialsBoxProps = {
  readonly signerName: string;
  readonly signerDocument?: string;
  readonly initials?: string;
  readonly label?: string;
  readonly width?: number;
};

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    fontFamily: "Helvetica",
  },
  initialsBox: {
    alignItems: "center",
    borderColor: "#1f2937",
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    marginRight: 18,
    width: 72,
  },
  initials: {
    color: "#111827",
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    letterSpacing: 1.2,
  },
  initialsLabel: {
    color: "#6b7280",
    fontSize: 6,
    marginTop: 4,
    textTransform: "uppercase",
  },
  signature: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  line: {
    borderTopColor: "#1f2937",
    borderTopWidth: 1,
    width: "100%",
  },
  name: {
    color: "#111827",
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    marginTop: 6,
    textAlign: "center",
  },
  document: {
    color: "#6b7280",
    fontSize: 7,
    marginTop: 2,
    textAlign: "center",
  },
});

const initialsFromName = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");

export function PdfInitialsBox({
  signerName,
  signerDocument,
  initials = initialsFromName(signerName),
  label = "Rubrica",
  width = 360,
}: PdfInitialsBoxProps) {
  return (
    <View style={[styles.root, { width }]}>
      <View style={styles.initialsBox}>
        <Text style={styles.initials}>{initials}</Text>
        <Text style={styles.initialsLabel}>{label}</Text>
      </View>
      <View style={styles.signature}>
        <View style={styles.line} />
        <Text style={styles.name}>{signerName}</Text>
        {signerDocument === undefined ? null : <Text style={styles.document}>{signerDocument}</Text>}
      </View>
    </View>
  );
}
