import { StyleSheet, Text, View } from "@react-pdf/renderer";

export type PdfPageInitialsFooterProps = {
  readonly initials: string;
  readonly pageLabel?: string;
  readonly documentLabel?: string;
  readonly width?: number;
};

const styles = StyleSheet.create({
  root: {
    borderTopColor: "#d1d5db",
    borderTopWidth: 1,
    color: "#374151",
    flexDirection: "row",
    fontFamily: "Helvetica",
    fontSize: 7,
    justifyContent: "space-between",
    paddingTop: 6,
  },
  initials: {
    color: "#111827",
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.2,
  },
  muted: {
    color: "#6b7280",
  },
});

export function PdfPageInitialsFooter({
  initials,
  pageLabel,
  documentLabel,
  width = 520,
}: PdfPageInitialsFooterProps) {
  return (
    <View style={[styles.root, { width }]}>
      <Text style={styles.initials}>Rubrica: {initials}</Text>
      {documentLabel === undefined ? null : <Text style={styles.muted}>{documentLabel}</Text>}
      {pageLabel === undefined ? null : <Text style={styles.muted}>{pageLabel}</Text>}
    </View>
  );
}
