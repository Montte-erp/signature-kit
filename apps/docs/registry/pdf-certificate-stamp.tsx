import { StyleSheet, Text, View } from "@react-pdf/renderer";

export type PdfCertificateStampProps = {
  readonly signerName: string;
  readonly certificateSubject?: string;
  readonly serialNumber?: string;
  readonly policy?: string;
  readonly signedAt?: string;
  readonly validationUrl?: string;
  readonly width?: number;
};

const styles = StyleSheet.create({
  root: {
    borderColor: "#4f46e5",
    borderRadius: 6,
    borderWidth: 1,
    color: "#1f2937",
    fontFamily: "Helvetica",
    padding: 8,
  },
  header: {
    color: "#3730a3",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 0.8,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  signer: {
    color: "#111827",
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    marginBottom: 4,
  },
  line: {
    color: "#4b5563",
    fontSize: 7,
    lineHeight: 1.35,
  },
  validation: {
    color: "#4338ca",
    fontSize: 6,
    marginTop: 6,
  },
});

export function PdfCertificateStamp({
  signerName,
  certificateSubject,
  serialNumber,
  policy = "ICP-Brasil",
  signedAt,
  validationUrl,
  width = 260,
}: PdfCertificateStampProps) {
  return (
    <View style={[styles.root, { width }]}>
      <Text style={styles.header}>Assinatura digital verificada</Text>
      <Text style={styles.signer}>{signerName}</Text>
      <Text style={styles.line}>Política: {policy}</Text>
      {certificateSubject === undefined ? null : (
        <Text style={styles.line}>Certificado: {certificateSubject}</Text>
      )}
      {serialNumber === undefined ? null : <Text style={styles.line}>Série: {serialNumber}</Text>}
      {signedAt === undefined ? null : <Text style={styles.line}>Assinado em: {signedAt}</Text>}
      {validationUrl === undefined ? null : <Text style={styles.validation}>{validationUrl}</Text>}
    </View>
  );
}
