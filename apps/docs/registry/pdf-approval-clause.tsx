import { StyleSheet, Text, View } from "@react-pdf/renderer";

export type PdfApprovalClauseProps = {
  readonly text: string;
  readonly approverName: string;
  readonly approverRole?: string;
  readonly signedAt?: string;
  readonly width?: number;
};

const styles = StyleSheet.create({
  root: {
    borderColor: "#d1d5db",
    borderRadius: 6,
    borderWidth: 1,
    color: "#111827",
    fontFamily: "Helvetica",
    padding: 10,
  },
  heading: {
    color: "#374151",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 0.8,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  body: {
    fontSize: 9,
    lineHeight: 1.45,
    marginBottom: 18,
  },
  line: {
    borderTopColor: "#1f2937",
    borderTopWidth: 1,
    marginBottom: 4,
    width: 220,
  },
  name: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
  },
  meta: {
    color: "#6b7280",
    fontSize: 7,
    lineHeight: 1.35,
  },
});

export function PdfApprovalClause({
  text,
  approverName,
  approverRole,
  signedAt,
  width = 460,
}: PdfApprovalClauseProps) {
  return (
    <View style={[styles.root, { width }]}>
      <Text style={styles.heading}>Aprovação</Text>
      <Text style={styles.body}>{text}</Text>
      <View style={styles.line} />
      <Text style={styles.name}>{approverName}</Text>
      {approverRole === undefined ? null : <Text style={styles.meta}>{approverRole}</Text>}
      {signedAt === undefined ? null : <Text style={styles.meta}>Aprovado em: {signedAt}</Text>}
    </View>
  );
}
