// ──────────────────────────────────────────────────────────────────────────
// Single source of truth for every code sample, type and error shown on the
// site. Pulled VERBATIM from the real packages under core/, signers/, formats/.
// Never invent API surface here — if it isn't in the source, it isn't here.
// ──────────────────────────────────────────────────────────────────────────

export type Snippet = {
  /** Filename for `file` chrome, or a label for `terminal` chrome. */
  readonly label: string;
  readonly lang: string;
  readonly kind?: "file" | "terminal";
  readonly code: string;
};

// ── Hero: one real Effect program across three tabs ────────────────────────

export const heroTabs: readonly Snippet[] = [
  {
    label: "signature-kit.ts",
    lang: "ts",
    code: `import { createSignatureKit } from "@signature-kit/core"
import { loadA1SignerAdapter } from "@signature-kit/a1"
import { Effect, Redacted } from "effect"

// pfx: Uint8Array — os bytes do .pfx/.p12 (A1)
export const program = Effect.gen(function* () {
  const signer = yield* loadA1SignerAdapter({
    pfx,
    password: Redacted.make("senha-do-certificado"),
  })

  return createSignatureKit({ signer })
})`,
  },
  {
    label: "assinar.ts",
    lang: "ts",
    code: `const signatureKit = yield* program

// identidade normalizada — e-CPF / e-CNPJ
const identity = yield* signatureKit.certificates.inspect()

const artifact = yield* signatureKit.signatures.sign({
  content,
  algorithm: "rsa-sha256",
})
// artifact: { algorithm, signature: Uint8Array }`,
  },
  {
    label: "verificar.ts",
    lang: "ts",
    code: `const result = yield* signatureKit.signatures.verify({
  content,
  signature: artifact.signature,
  algorithm: artifact.algorithm,
})

// result.valid: boolean — a falha não é exceção:
// vira SignatureKitError no canal de erro tipado.`,
  },
];

export const installCommand = "bun add @signature-kit/core @signature-kit/a1";

/** package spec used by <InstallTabs/> on the landing + docs. */
export const heroInstallSpec = "@signature-kit/core @signature-kit/a1";

// ── "Onde roda": same createSignatureKit, the delta is the point ───────────────

const runsOnBody = `const signer = yield* loadA1SignerAdapter({ pfx, password })
const signatureKit = createSignatureKit({ signer })

const artifact = yield* signatureKit.signatures.sign({
  content,
  algorithm: "rsa-sha256",
})`;

export const runtimeTabs: readonly Snippet[] = [
  {
    label: "node.ts",
    lang: "ts",
    code: `// runtime: Node.js — node:crypto via WebCrypto\n${runsOnBody}`,
  },
  {
    label: "bun.ts",
    lang: "ts",
    code: `// runtime: Bun — WebCrypto nativo\n${runsOnBody}`,
  },
  {
    label: "deno.ts",
    lang: "ts",
    code: `// runtime: Deno — WebCrypto nativo\n${runsOnBody}`,
  },
  {
    label: "worker.ts",
    lang: "ts",
    code: `// runtime: Cloudflare Workers — WebCrypto da plataforma\n${runsOnBody}`,
  },
  {
    label: "browser.ts",
    lang: "ts",
    code: `// runtime: navegador — window.crypto.subtle\n${runsOnBody}`,
  },
];

// ── The seam: the real SignerAdapter type, verbatim ─────────────────────────

export const signerAdapterType: Snippet = {
  label: "core/contracts/src/index.ts",
  lang: "ts",
  code: `/**
 * The capability seam. A signer owns "where the signing power comes from".
 * It never owns document-format mutation (XML/PDF live in format modules).
 */
export type SignerAdapter = {
  readonly id: string;
  inspect(): Effect.Effect<SignerIdentity, SignatureKitError>;
  certificate(): Effect.Effect<Certificate, SignatureKitError>;
  importSigningKey(algorithm: SignatureAlgorithm): Effect.Effect<CryptoKey, SignatureKitError>;
  sign(input: SignInput): Effect.Effect<SignatureArtifact, SignatureKitError>;
  verify(input: VerifyInput): Effect.Effect<VerificationResult, SignatureKitError>;
};`,
};

// ── Formats dock onto the seam via Effect.provide(layer) ────────────────────

export const formatTabs: readonly Snippet[] = [
  {
    label: "xml-dsig.ts",
    lang: "ts",
    code: `import { signXml } from "@signature-kit/xml"
import { a1SignaturesLayer } from "@signature-kit/a1"
import { Effect } from "effect"

const layer = a1SignaturesLayer({ pfx, password })

const signedXml = yield* signXml({
  xml,
  referenceId: "nfe-1",
}).pipe(Effect.provide(layer))`,
  },
  {
    label: "pdf-pades.ts",
    lang: "ts",
    code: `import { signPdf } from "@signature-kit/pdf"
import { a1SignaturesLayer } from "@signature-kit/a1"
import { Effect } from "effect"

const layer = a1SignaturesLayer({ pfx, password })

const signedPdf = yield* signPdf({
  pdf,
  policy: "pades-icp-brasil",
}).pipe(Effect.provide(layer))`,
  },
  {
    label: "icp-brasil.ts",
    lang: "ts",
    code: `// PdfSignaturePolicy = "pades-ades" | "pades-icp-brasil"
const layer = a1SignaturesLayer({ pfx, password })

const signedPdf = yield* signPdf({
  pdf,
  policy: "pades-icp-brasil",
  // política PAdES AD-RB buscada automaticamente —
  // ou informe icpBrasil: { policyOid, policyHash, ... }
  policyTimeoutMillis: 10_000,
}).pipe(Effect.provide(layer))`,
  },
];

// ── Typed error catalog: the real SignatureKitError union ──────────────────────
// `message` is the verbatim default from core/contracts SignatureKitError.message.
// Codes marked overridable resolve to `this.reason ?? <default>` at runtime.

export type ErrorEntry = {
  readonly code: string;
  readonly message: string;
  readonly overridable: boolean;
};

export const errorCatalog: readonly ErrorEntry[] = [
  { code: "signature-kit.EMPTY_FILE", message: "Certificate file is empty (0 bytes).", overridable: false },
  { code: "signature-kit.INVALID_FORMAT", message: "The file is not a PKCS#12 (.pfx/.p12) certificate.", overridable: true },
  { code: "signature-kit.INVALID_INPUT", message: "Invalid signing input.", overridable: true },
  { code: "signature-kit.WRONG_PASSWORD", message: "Wrong certificate password.", overridable: false },
  { code: "signature-kit.UNSUPPORTED_ALGORITHM", message: "The certificate uses an unsupported encryption algorithm.", overridable: true },
  { code: "signature-kit.NO_CERTIFICATE", message: "The file does not contain a certificate.", overridable: false },
  { code: "signature-kit.NO_PRIVATE_KEY", message: "The file does not contain a private key.", overridable: false },
  { code: "signature-kit.CORRUPTED_FILE", message: "The file is corrupted or not a valid PKCS#12 certificate.", overridable: false },
  { code: "signature-kit.X509_PARSE_FAILED", message: "X.509 parsing failed.", overridable: true },
  { code: "signature-kit.PEM_EXTRACTION_FAILED", message: "Failed to extract PEM material from the PFX.", overridable: false },
  { code: "signature-kit.KEY_IMPORT_FAILED", message: "Failed to import the key into Web Crypto.", overridable: true },
  { code: "signature-kit.DIGEST_FAILED", message: "Failed to compute the certificate digest.", overridable: false },
  { code: "signature-kit.SIGN_FAILED", message: "Failed to sign the content.", overridable: true },
  { code: "signature-kit.VERIFY_FAILED", message: "Failed to verify the signature.", overridable: true },
  { code: "signature-kit.UNKNOWN", message: "Unknown SignatureKit failure.", overridable: true },
];

/** The real SignatureKitError field shape, shown above the catalog. */
export const errorShape: Snippet = {
  label: "SignatureKitError",
  lang: "ts",
  code: `// _tag: "SignatureKitError"
class SignatureKitError {
  readonly code: SignatureKitErrorCode   // 15 literais "signature-kit.*"
  readonly retryable: boolean         // decidido no ponto da falha
  readonly reason?: string            // mensagem contextual
  readonly operation?: SignatureKitOperation
  get message(): string               // default por código
}`,
};

// ── Remote providers: each a separate package, real distinct option keys ────

export const providerTabs: readonly Snippet[] = [
  {
    label: "clicksign.ts",
    lang: "ts",
    code: `import { clicksign } from "@signature-kit/clicksign"
import { Redacted } from "effect"

const provider = clicksign({
  accessToken: Redacted.make(token),
  environment: "sandbox",   // "production" | "sandbox"
  locale: "pt-BR",          // "en-US" | "pt-BR"
  autoClose: true,
})`,
  },
  {
    label: "docusign.ts",
    lang: "ts",
    code: `import { docusign } from "@signature-kit/docusign"
import { Redacted } from "effect"

const provider = docusign({
  baseUrl: "https://demo.docusign.net/restapi",
  accountId: "account-123",
  accessToken: Redacted.make(token),
})`,
  },
  {
    label: "dropbox-sign.ts",
    lang: "ts",
    code: `import { dropboxSign } from "@signature-kit/dropbox-sign"
import { Redacted } from "effect"

const provider = dropboxSign({
  apiKey: Redacted.make(key),
  testMode: true,
})`,
  },
  {
    label: "adobe-sign.ts",
    lang: "ts",
    code: `import { adobeSign } from "@signature-kit/adobe-sign"
import { Redacted } from "effect"

const provider = adobeSign({
  baseUrl: "https://api.na1.adobesign.com/api/rest/v6",
  accessToken: Redacted.make(token),
})`,
  },
];

export const gatewaySnippet: Snippet = {
  label: "gateway.ts",
  lang: "ts",
  code: `import { createSignatureGateway, createFetchHttpClient } from "@signature-kit/signature-gateway"
import { docusign } from "@signature-kit/docusign"
import { clicksign } from "@signature-kit/clicksign"

const gateway = createSignatureGateway({
  http: createFetchHttpClient(),
  providers: [docusign(docuSignOptions), clicksign(clicksignOptions)],
})

// um formato de requisição para todos os provedores:
const request = yield* gateway.createSignatureRequest({
  provider: "docusign",
  title: "Contrato",
  documents: [{ fileName: "contrato.pdf", mimeType: "application/pdf", content }],
  recipients: [{ name: "Ana Silva", email: "ana@example.com" }],
})`,
};

// ── Repo tree: the real monorepo shape; "instale só o que usar" ─────────────

export type PackageLeaf = {
  readonly name: string;
  readonly summary: string;
  readonly exports: string;
  readonly install: string;
  readonly href?: string;
  readonly internal?: boolean;
};

export type PackageGroup = {
  readonly dir: string;
  readonly leaves: readonly PackageLeaf[];
};

export const packageTree: readonly PackageGroup[] = [
  {
    dir: "core/",
    leaves: [
      { name: "@signature-kit/core", summary: "Runtime de assinatura: assina e verifica bytes.", exports: "createSignatureKit · signaturesLayer · signatures", install: "bun add @signature-kit/core", href: "/docs/signers" },
      { name: "@signature-kit/contracts", summary: "Contratos e o modelo de erro tipado.", exports: "SignerAdapter · SignatureKitError · SignInput", install: "bun add @signature-kit/contracts", href: "/docs/errors" },
      { name: "@signature-kit/x509", summary: "Parsing X.509 e campos ICP-Brasil.", exports: "parseX509 · toSignerIdentity", install: "bun add @signature-kit/x509", href: "/docs/certificates" },
    ],
  },
  {
    dir: "signers/",
    leaves: [
      { name: "@signature-kit/a1", summary: "Assinador A1 / PKCS#12 (e-CPF, e-CNPJ).", exports: "loadA1SignerAdapter · a1SignaturesLayer", install: "bun add @signature-kit/a1", href: "/docs/signers" },
      { name: "@signature-kit/signature-gateway", summary: "Gateway que normaliza provedores remotos.", exports: "createSignatureGateway", install: "bun add @signature-kit/signature-gateway", href: "/docs/providers" },
      { name: "@signature-kit/docusign", summary: "Fábrica do provedor DocuSign.", exports: "docusign", install: "bun add @signature-kit/docusign", href: "/docs/providers/docusign" },
      { name: "@signature-kit/clicksign", summary: "Fábrica do provedor Clicksign.", exports: "clicksign", install: "bun add @signature-kit/clicksign", href: "/docs/providers/clicksign" },
    ],
  },
  {
    dir: "formats/",
    leaves: [
      { name: "@signature-kit/xml", summary: "Assinatura XML-DSig sobre o serviço de assinaturas.", exports: "signXml · verifyXml", install: "bun add @signature-kit/xml", href: "/docs/xml" },
      { name: "@signature-kit/pdf", summary: "Assinatura PDF/CMS no formato PAdES.", exports: "signPdf · verifyPdf", install: "bun add @signature-kit/pdf", href: "/docs/pdf" },
    ],
  },
  {
    dir: "shared/",
    leaves: [
      { name: "@signature-kit/cms", summary: "CMS/PAdES e política ICP-Brasil (interno).", exports: "createDetachedSignedData", install: "—", internal: true },
      { name: "@signature-kit/asn1", summary: "ASN.1 DER encode/decode (interno).", exports: "decode · encode · oidString", install: "—", internal: true },
      { name: "@signature-kit/crypto", summary: "Primitivas WebCrypto (interno).", exports: "—", install: "—", internal: true },
    ],
  },
];
