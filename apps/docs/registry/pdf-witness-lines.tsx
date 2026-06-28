import { StyleSheet, Text, View } from "@react-pdf/renderer";

type PdfSignaturePerson = {
  readonly name: string;
  readonly document?: string;
  readonly label?: string;
};

export type PdfWitnessLinesProps = {
  readonly signer: PdfSignaturePerson;
  readonly witness: PdfSignaturePerson;
  readonly gap?: number;
  readonly width?: number;
};

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    fontFamily: "Helvetica",
  },
  column: {
    alignItems: "center",
    color: "#111827",
  },
  line: {
    borderTopColor: "#1f2937",
    borderTopWidth: 1,
    height: 1,
    width: "100%",
  },
  label: {
    color: "#6b7280",
    fontSize: 7,
    letterSpacing: 0.8,
    marginBottom: 24,
    textTransform: "uppercase",
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
function PersonLine({ person, width }: { readonly person: PdfSignaturePerson; readonly width: number }) {
  return (
    <View style={[styles.column, { width }]}>
      <Text style={styles.label}>{person.label ?? "Assinatura"}</Text>
      <View style={styles.line} />
      <Text style={styles.name}>{person.name}</Text>
      {person.document === undefined ? null : <Text style={styles.document}>{person.document}</Text>}
    </View>
  );
}

export function PdfWitnessLines({ signer, witness, gap = 40, width = 460 }: PdfWitnessLinesProps) {
  const columnWidth = (width - gap) / 2;

  return (
    <View style={[styles.root, { width }]}>
      <View style={{ marginRight: gap }}>
        <PersonLine person={signer} width={columnWidth} />
      </View>
      <PersonLine person={witness} width={columnWidth} />
    </View>
  );
}
