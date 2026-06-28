import { StyleSheet, Text, View } from "@react-pdf/renderer";

export type PdfSignatureFieldProps = {
  readonly signerName: string;
  readonly signerDocument?: string;
  readonly label?: string;
  readonly required?: boolean;
  readonly signedName?: string;
  readonly signedAt?: string;
  readonly width?: number;
  readonly height?: number;
};

const styles = StyleSheet.create({
  root: {
    borderColor: "#9ca3af",
    borderRadius: 4,
    borderWidth: 1,
    color: "#111827",
    fontFamily: "Helvetica",
    padding: 8,
  },
  labelRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  label: {
    color: "#374151",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    textTransform: "uppercase",
  },
  required: {
    color: "#b91c1c",
    fontSize: 7,
  },
  signingArea: {
    alignItems: "center",
    borderColor: "#d1d5db",
    borderStyle: "dashed",
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  signedName: {
    color: "#1f2937",
    fontFamily: "Helvetica-Oblique",
    fontSize: 14,
  },
  placeholder: {
    color: "#9ca3af",
    fontSize: 8,
  },
  footer: {
    color: "#6b7280",
    fontSize: 7,
    marginTop: 6,
  },
});

export function PdfSignatureField({
  signerName,
  signerDocument,
  label = "Campo de assinatura",
  required = true,
  signedName,
  signedAt,
  width = 260,
  height = 96,
}: PdfSignatureFieldProps) {
  return (
    <View style={[styles.root, { height, width }]}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {required ? <Text style={styles.required}>Obrigatório</Text> : null}
      </View>
      <View style={styles.signingArea}>
        {signedName === undefined ? (
          <Text style={styles.placeholder}>Assinar aqui</Text>
        ) : (
          <Text style={styles.signedName}>{signedName}</Text>
        )}
      </View>
      <Text style={styles.footer}>
        {signerName}
        {signerDocument === undefined ? "" : ` · ${signerDocument}`}
        {signedAt === undefined ? "" : ` · ${signedAt}`}
      </Text>
    </View>
  );
}
