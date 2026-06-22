export const site = {
  name: "SignatureKit",
  title: "SignatureKit – assinatura digital Effect-native para TypeScript",
  description:
    "Uma fronteira de assinatura para TypeScript. O core assina bytes; XML, PDF, ICP-Brasil e provedores remotos são pacotes que plugam nela.",
  url: "https://signature-kit.dev",
  github: "https://github.com/Montte-erp/signature-kit",
  version: "0.0.0",
  install: "bun add @signature-kit/core @signature-kit/a1",
};

export const landingNavigation = [
  { text: "fronteira", href: "/#seam" },
  { text: "formatos", href: "/#formats" },
  { text: "provedores", href: "/#providers" },
  { text: "docs", href: "/docs/installation" },
];

export const docsNavigation = [
  {
    title: "comece aqui",
    links: [
      { text: "Introdução", href: "/docs" },
      { text: "Instalação", href: "/docs/installation" },
      { text: "Primeiro uso", href: "/docs/quickstart" },
    ],
  },
  {
    title: "conceitos",
    links: [
      { text: "A fronteira de assinatura", href: "/docs/signers" },
      { text: "Certificados A1", href: "/docs/certificates" },
      { text: "Canal de erro tipado", href: "/docs/errors" },
    ],
  },
  {
    title: "formatos",
    links: [
      { text: "XML-DSig", href: "/docs/xml" },
      { text: "PDF / PAdES", href: "/docs/pdf" },
    ],
  },
  {
    title: "provedores",
    links: [
      { text: "Gateway", href: "/docs/providers" },
      { text: "DocuSign", href: "/docs/providers/docusign" },
      { text: "Dropbox Sign", href: "/docs/providers/dropbox-sign" },
      { text: "Adobe Sign", href: "/docs/providers/adobe-sign" },
      { text: "Clicksign", href: "/docs/providers/clicksign" },
    ],
  },
];

export const footerNavigation = [
  {
    title: "biblioteca",
    links: [
      { text: "Instalação", href: "/docs/installation" },
      { text: "Primeiro uso", href: "/docs/quickstart" },
      { text: "A fronteira", href: "/docs/signers" },
      { text: "Canal de erro tipado", href: "/docs/errors" },
    ],
  },
  {
    title: "formatos",
    links: [
      { text: "XML-DSig", href: "/docs/xml" },
      { text: "PDF / PAdES", href: "/docs/pdf" },
      { text: "Certificados A1", href: "/docs/certificates" },
    ],
  },
  {
    title: "provedores",
    links: [
      { text: "Gateway", href: "/docs/providers" },
      { text: "DocuSign", href: "/docs/providers/docusign" },
      { text: "Clicksign", href: "/docs/providers/clicksign" },
    ],
  },
];
