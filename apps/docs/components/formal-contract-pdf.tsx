"use client";

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from "@react-pdf/renderer";

/*
 * Formal-contract generator — REACT-PDF ("pdfx"), the same engine @signature-kit/
 * react renders signature templates with. Browser-safe: built-in Helvetica only
 * (no Font.register → no fontkit hang) and we AWAIT pdf(...).toBlob() (the browser
 * path; never Node renderToStream/Buffer) — exactly the fixes for the "Generating…"
 * hang.
 *
 * Each document is a real A4 contract (title + justified lorem body) closed by a
 * FORMAL signature component. Several VARIANTS ship so the demo showcases the
 * range, the way real documents differ — each rests the signature ON a signature
 * LINE (or in a field that carries one):
 *
 *   "line"      classic centered signature line + name / CPF / role
 *   "field"     an e-sign field box (label tab) above the identification
 *   "witnessed" two lines side by side — signatário + testemunha
 *   "initials"  a rubrica box next to the signature line (Brazilian rubrica)
 *
 * While unsigned the line stands empty (a faint "Assinatura" hint); `signed` rests
 * the applied mark on it.
 */

const PAGE_W = 595.28; // A4 in PDF points
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Where the signature components sit (TOP-LEFT origin, top-down like react-pdf/CSS).
const BLOCK_TOP = PAGE_H - 196;
const SIG_W = 260;
const SIG_LEFT = (PAGE_W - SIG_W) / 2;

export type SignatureVariant = "line" | "field" | "witnessed" | "initials";

export const SIGNATURE_VARIANTS: ReadonlyArray<SignatureVariant> = [
  "line",
  "field",
  "witnessed",
  "initials",
];

export interface FormalSignatureRect {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Representative signature mark area (the centered "line" variant), for tests. */
export const formalSignatureRect: FormalSignatureRect = {
  pageIndex: 0,
  x: SIG_LEFT,
  y: BLOCK_TOP,
  width: SIG_W,
  height: 36,
};

export interface SignedMark {
  readonly name: string;
  readonly document: string;
  readonly date: string;
}

const PARTY_NAME = "Maria A. Costa";
const PARTY_DOCUMENT = "CPF/CNPJ: 000.000.000-00";
const WITNESS_NAME = "Ana R. Lima";
const WITNESS_DOCUMENT = "CPF: 111.222.333-44";

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase())
    .join("");

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#ffffff",
    color: "#111111",
    fontFamily: "Helvetica",
    paddingTop: MARGIN,
    paddingHorizontal: MARGIN,
    paddingBottom: 72,
    position: "relative",
  },
  title: { fontFamily: "Helvetica-Bold", fontSize: 18, color: "#111111" },
  meta: { fontSize: 9, color: "#6b6b6b", letterSpacing: 1, marginTop: 6 },
  rule: {
    borderTopWidth: 1,
    borderTopColor: "#111111",
    marginTop: 14,
    marginBottom: 18,
  },
  body: {
    fontSize: 11,
    lineHeight: 1.5,
    textAlign: "justify",
    color: "#1f2937",
    marginBottom: 11,
  },

  // shared signature pieces
  markBand: {
    height: 32,
    width: "100%",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 2,
  },
  markName: { fontFamily: "Helvetica-Oblique", fontSize: 16, color: "#1f2937" },
  markNameSm: { fontFamily: "Helvetica-Oblique", fontSize: 13, color: "#1f2937" },
  markHint: { fontSize: 8, color: "#9ca3af", letterSpacing: 1 },
  line: { width: "100%", borderTopWidth: 1, borderTopColor: "#1f2937" },
  partyName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: "#111111",
    marginTop: 6,
    textAlign: "center",
  },
  partyDoc: { fontSize: 9, color: "#6b6b6b", marginTop: 2, textAlign: "center" },
  partyRole: {
    fontSize: 8,
    color: "#6b6b6b",
    letterSpacing: 1,
    marginTop: 3,
    textAlign: "center",
  },
  stamp: { fontSize: 7, color: "#6b21a8", marginTop: 4, textAlign: "center" },

  // variant: line (centered)
  centerBlock: {
    position: "absolute",
    left: SIG_LEFT,
    top: BLOCK_TOP,
    width: SIG_W,
    alignItems: "center",
  },

  // variant: field (e-sign box, right)
  fieldBlock: {
    position: "absolute",
    left: PAGE_W - MARGIN - 224,
    top: BLOCK_TOP - 16,
    width: 224,
  },
  fieldTab: { fontSize: 7, letterSpacing: 1, color: "#7c3aed", marginBottom: 3 },
  fieldBox: {
    height: 52,
    borderWidth: 1,
    borderColor: "#7c3aed",
    borderRadius: 4,
    backgroundColor: "#f5f3ff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  fieldBoxEmpty: { borderStyle: "dashed", backgroundColor: "#ffffff" },
  fieldCaption: {
    fontSize: 8,
    color: "#6b6b6b",
    marginTop: 5,
    textAlign: "center",
  },

  // variant: witnessed (two columns)
  wideBlock: {
    position: "absolute",
    left: MARGIN,
    top: BLOCK_TOP,
    width: CONTENT_W,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  col: { width: CONTENT_W * 0.42, alignItems: "center" },

  // variant: initials (rubrica + signature)
  initialsBlock: {
    position: "absolute",
    left: PAGE_W - MARGIN - 300,
    top: BLOCK_TOP,
    width: 300,
    flexDirection: "row",
    alignItems: "flex-end",
  },
  rubricaBox: {
    width: 74,
    height: 50,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 18,
  },
  rubricaLabel: { fontSize: 6, letterSpacing: 1, color: "#94a3b8" },
  rubricaInk: {
    fontFamily: "Helvetica-Oblique",
    fontSize: 18,
    color: "#1f2937",
    marginTop: 2,
  },
  sigCol: { flexGrow: 1, alignItems: "center" },

  footer: {
    position: "absolute",
    bottom: 32,
    left: MARGIN,
    right: MARGIN,
    borderTopWidth: 1,
    borderTopColor: "#dddddd",
    paddingTop: 6,
    fontSize: 8,
    color: "#6b6b6b",
  },
});

const Identification = ({ name, document, role }: { name: string; document: string; role: string }) => (
  <>
    <Text style={styles.partyName}>{name}</Text>
    <Text style={styles.partyDoc}>{document}</Text>
    <Text style={styles.partyRole}>{role}</Text>
  </>
);

const SignedStamp = ({ date }: { date: string }) => (
  <Text style={styles.stamp}>Assinado digitalmente · {date}</Text>
);

function SignatureLineVariant({ signed }: { signed?: SignedMark }) {
  return (
    <View style={styles.centerBlock}>
      <View style={styles.markBand}>
        {signed ? (
          <Text style={styles.markName}>{signed.name}</Text>
        ) : (
          <Text style={styles.markHint}>Assinatura</Text>
        )}
      </View>
      <View style={styles.line} />
      <Identification name={signed?.name ?? PARTY_NAME} document={PARTY_DOCUMENT} role="CONTRATANTE" />
      {signed ? <SignedStamp date={signed.date} /> : null}
    </View>
  );
}

function SignatureFieldVariant({ signed }: { signed?: SignedMark }) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldTab}>ASSINATURA</Text>
      <View style={[styles.fieldBox, signed ? {} : styles.fieldBoxEmpty]}>
        {signed ? (
          <>
            <Text style={styles.markName}>{signed.name}</Text>
            <SignedStamp date={signed.date} />
          </>
        ) : (
          <Text style={styles.markHint}>Assine aqui</Text>
        )}
      </View>
      <Text style={styles.fieldCaption}>
        {signed?.name ?? PARTY_NAME} · {PARTY_DOCUMENT}
      </Text>
    </View>
  );
}

function SignatureWitnessedVariant({ signed }: { signed?: SignedMark }) {
  return (
    <View style={styles.wideBlock}>
      <View style={styles.col}>
        <View style={styles.markBand}>
          {signed ? <Text style={styles.markName}>{signed.name}</Text> : null}
        </View>
        <View style={styles.line} />
        <Identification name={signed?.name ?? PARTY_NAME} document={PARTY_DOCUMENT} role="CONTRATANTE" />
      </View>
      <View style={styles.col}>
        <View style={styles.markBand}>
          {signed ? <Text style={styles.markNameSm}>{WITNESS_NAME}</Text> : null}
        </View>
        <View style={styles.line} />
        <Identification name={WITNESS_NAME} document={WITNESS_DOCUMENT} role="TESTEMUNHA" />
      </View>
    </View>
  );
}

function SignatureInitialsVariant({ signed }: { signed?: SignedMark }) {
  return (
    <View style={styles.initialsBlock}>
      <View style={styles.rubricaBox}>
        <Text style={styles.rubricaLabel}>RUBRICA</Text>
        <Text style={styles.rubricaInk}>{initialsOf(signed?.name ?? PARTY_NAME)}</Text>
      </View>
      <View style={styles.sigCol}>
        <View style={styles.markBand}>
          {signed ? (
            <Text style={styles.markName}>{signed.name}</Text>
          ) : (
            <Text style={styles.markHint}>Assinatura</Text>
          )}
        </View>
        <View style={styles.line} />
        <Identification name={signed?.name ?? PARTY_NAME} document={PARTY_DOCUMENT} role="CONTRATANTE" />
      </View>
    </View>
  );
}

function SignatureComponent({
  variant,
  signed,
}: {
  variant: SignatureVariant;
  signed?: SignedMark;
}) {
  switch (variant) {
    case "field":
      return <SignatureFieldVariant signed={signed} />;
    case "witnessed":
      return <SignatureWitnessedVariant signed={signed} />;
    case "initials":
      return <SignatureInitialsVariant signed={signed} />;
    default:
      return <SignatureLineVariant signed={signed} />;
  }
}

export interface FormalContractOptions {
  readonly title: string;
  readonly paragraphs: ReadonlyArray<string>;
  readonly variant: SignatureVariant;
  readonly signed?: SignedMark;
}

function FormalContract({ title, paragraphs, variant, signed }: FormalContractOptions) {
  return (
    <Document title={title}>
      <Page size={{ width: PAGE_W, height: PAGE_H }} style={styles.page}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.meta}>SIGNATUREKIT · DOCUMENTO DEMO</Text>
        <View style={styles.rule} />

        {paragraphs.map((paragraph, index) => (
          <Text key={index} style={styles.body}>
            {paragraph}
          </Text>
        ))}

        <SignatureComponent variant={variant} signed={signed} />

        <Text style={styles.footer} fixed>
          {title}
        </Text>
      </Page>
    </Document>
  );
}

/**
 * Render a formal contract to PDF bytes with react-pdf, in the browser, with the
 * chosen signature-component `variant`. Pass `signed` to rest the applied mark on
 * the line. Helvetica-only + awaited `.toBlob()`, so it never hangs.
 */
export async function generateFormalContractPdf(
  options: FormalContractOptions,
): Promise<Uint8Array> {
  const blob = await pdf(<FormalContract {...options} />).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}
