// ──────────────────────────────────────────────────────────────────────────
// Single source of truth for every code sample, type and error shown on the
// site. Pulled VERBATIM from the real packages under core/, signers/, formats/.
// Never invent API surface here — if it isn't in the source, it isn't here.
// ──────────────────────────────────────────────────────────────────────────

import type { CodeLanguage } from "astro";

export type Snippet = {
  /** Filename for `file` chrome, or a label for `terminal` chrome. */
  readonly label: string;
  readonly lang: CodeLanguage;
  readonly kind?: "file" | "terminal";
  readonly code: string;
};

// ── Hero: one real Effect program across three tabs ────────────────────────

export const heroTabs: readonly Snippet[] = [
  {
    label: "signature-kit.ts",
    lang: "ts",
    code: `import { createSignatureKit } from "@signature-kit/core/runtime"
import { loadA1SignerAdapter } from "@signature-kit/a1/signer"
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
  label: "core/core/src/config.ts",
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
    code: `import { signXml } from "@signature-kit/xml/sign"
import { a1SignaturesLayer } from "@signature-kit/a1/signer"
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
    code: `import { signPdf } from "@signature-kit/pdf/sign"
import { a1SignaturesLayer } from "@signature-kit/a1/signer"
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
// `message` is the verbatim default from @signature-kit/core/config SignatureKitError.message.
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
  { code: "signature-kit.HTTP", message: "Remote signature HTTP request failed.", overridable: true },
  { code: "signature-kit.RESPONSE_SHAPE", message: "Remote signature response shape was invalid.", overridable: true },
  { code: "signature-kit.UNSUPPORTED_OPERATION", message: "Remote signature operation is unsupported.", overridable: true },
  { code: "signature-kit.UNKNOWN", message: "Unknown SignatureKit failure.", overridable: true },
];

/** The real SignatureKitError field shape, shown above the catalog. */
export const errorShape: Snippet = {
  label: "SignatureKitError",
  lang: "ts",
  code: `// _tag: "SignatureKitError"
class SignatureKitError {
  readonly code: SignatureKitErrorCode   // 18 literais "signature-kit.*"
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
    code: `import { createClicksignSignatureRequest } from "@signature-kit/clicksign"
import { signatureHttpClientLive } from "@signature-kit/core/http"
import { Effect, Redacted } from "effect"

const request = createClicksignSignatureRequest(
  {
    accessToken: Redacted.make(token),
    environment: "sandbox",
    locale: "pt-BR",
    autoClose: true,
  },
  {
    title: "Contrato",
    documents: [{ fileName: "contrato.pdf", mimeType: "application/pdf", content }],
    recipients: [{ name: "Ana Silva", email: "ana@example.com" }],
  },
).pipe(Effect.provide(signatureHttpClientLive))`,
  },
  {
    label: "docusign.ts",
    lang: "ts",
    code: `import { createDocuSignSignatureRequest } from "@signature-kit/docusign"
import { signatureHttpClientLive } from "@signature-kit/core/http"
import { Effect, Redacted } from "effect"

const request = createDocuSignSignatureRequest(
  {
    baseUrl: "https://demo.docusign.net/restapi",
    accountId: "account-123",
    accessToken: Redacted.make(token),
  },
  {
    title: "Contrato",
    documents: [{ fileName: "contrato.pdf", mimeType: "application/pdf", content }],
    recipients: [{ name: "Ana Silva", email: "ana@example.com" }],
  },
).pipe(Effect.provide(signatureHttpClientLive))`,
  },
  {
    label: "assinafy.ts",
    lang: "ts",
    code: `import { createAssinafySignatureRequest } from "@signature-kit/assinafy"
import { signatureHttpClientLive } from "@signature-kit/core/http"
import { Effect, Redacted } from "effect"

const request = createAssinafySignatureRequest(
  {
    apiKey: Redacted.make(apiKey),
    environment: "sandbox",
  },
  {
    title: "Contrato",
    documents: [{ fileName: "contrato.pdf", mimeType: "application/pdf", content }],
    recipients: [{ name: "Ana Silva", email: "ana@example.com" }],
  },
).pipe(Effect.provide(signatureHttpClientLive))`,
  },
  {
    label: "zapsign.ts",
    lang: "ts",
    code: `import { createZapSignSignatureRequest } from "@signature-kit/zapsign"
import { signatureHttpClientLive } from "@signature-kit/core/http"
import { Effect, Redacted } from "effect"

const request = createZapSignSignatureRequest(
  {
    apiToken: Redacted.make(token),
    environment: "sandbox",
    locale: "pt-br",
  },
  {
    title: "Contrato",
    documents: [{ fileName: "contrato.pdf", mimeType: "application/pdf", content }],
    recipients: [{ name: "Ana Silva", email: "ana@example.com" }],
  },
).pipe(Effect.provide(signatureHttpClientLive))`,
  },
];

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
      { name: "@signature-kit/core", summary: "Runtime, contratos de assinatura e erro tipado.", exports: "createSignatureKit · SignerAdapter · SignatureKitError", install: "bun add @signature-kit/core", href: "/docs/signers" },
      { name: "@signature-kit/certificates", summary: "Parsing PKCS#12/X.509 e campos ICP-Brasil.", exports: "parseCertificate · toSignerIdentity", install: "bun add @signature-kit/certificates", href: "/docs/certificates" },
    ],
  },
  {
    dir: "signers/",
    leaves: [
      { name: "@signature-kit/a1", summary: "Assinador A1 / PKCS#12 (e-CPF, e-CNPJ).", exports: "loadA1SignerAdapter · a1SignaturesLayer", install: "bun add @signature-kit/a1", href: "/docs/signers" },
      { name: "@signature-kit/docusign", summary: "Signer remoto DocuSign.", exports: "createDocuSignSignatureRequest · providers", install: "bun add @signature-kit/docusign", href: "/docs/providers/docusign" },
      { name: "@signature-kit/clicksign", summary: "Signer remoto Clicksign.", exports: "createClicksignSignatureRequest · providers", install: "bun add @signature-kit/clicksign", href: "/docs/providers/clicksign" },
      { name: "@signature-kit/assinafy", summary: "Signer remoto Assinafy.", exports: "createAssinafySignatureRequest · providers", install: "bun add @signature-kit/assinafy", href: "/docs/providers/assinafy" },
      { name: "@signature-kit/zapsign", summary: "Signer remoto ZapSign.", exports: "createZapSignSignatureRequest · providers", install: "bun add @signature-kit/zapsign", href: "/docs/providers/zapsign" },
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
