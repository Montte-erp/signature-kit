import * as Submodel from "foldkit/submodel";

import { freeSigningPath, localizedSitePath } from "../../lib/site-route.ts";
import type { ContentEntry } from "../content/config.ts";
import type { Model } from "./landing.ts";
import { Message } from "./landing.ts";
import * as Signer from "./signer.ts";

const title = "Assine documentos grátis com certificado A1";
const description =
  "Assine documentos PDF grátis no navegador com certificado digital A1. O arquivo, o .p12/.pfx e a senha ficam no seu dispositivo.";
const promises = [
  "Sem upload do PDF",
  "Sem cadastro",
  "Senha nunca sai da página",
  "Assinatura PAdES com A1",
];
const steps = [
  { title: "Envie o PDF", body: "Lido como bytes no navegador. Nenhum upload acontece." },
  {
    title: "Posicione a assinatura",
    body: "Clique no ponto da assinatura ou use o posicionamento automático.",
  },
  { title: "Carregue o A1", body: "Selecione o .p12 ou .pfx e informe a senha. Tudo fica local." },
  { title: "Baixe assinado", body: "A assinatura PAdES é aplicada na página e o PDF sai pronto." },
];
const questions = [
  { question: "Precisa de cadastro?", answer: "Não. Basta o PDF e um certificado A1 válido." },
  {
    question: "O documento vai para algum servidor?",
    answer: "Não. PDF, certificado e senha ficam em memória local durante a assinatura.",
  },
  { question: "Funciona com A3?", answer: "Ainda não. Esta página assina apenas com A1." },
];

export const freeSigningEntry: ContentEntry = {
  locale: "pt-BR",
  path: freeSigningPath,
  page: {
    title,
    description,
    html: "",
    text: [
      title,
      description,
      ...promises,
      ...steps.flatMap((step) => [step.title, step.body]),
      ...questions.flatMap((item) => [item.question, item.answer]),
    ].join(" "),
    headings: [],
  },
};

export const freeSigningStructuredData = (url: string) => ({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "SignatureKit — Assinador de PDF grátis",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url,
      description,
      offers: { "@type": "Offer", price: "0", priceCurrency: "BRL" },
    },
    {
      "@type": "HowTo",
      name: "Como assinar um documento PDF grátis com certificado A1",
      description,
      totalTime: "PT2M",
      step: steps.map((step, index) => ({
        "@type": "HowToStep",
        position: index + 1,
        name: step.title,
        text: step.body,
        url: url + "#assinar",
      })),
    },
    {
      "@type": "FAQPage",
      mainEntity: questions.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    },
  ],
});

export const view = Submodel.defineView<Model, Message>((model, h) =>
  h.div(
    [h.Class("landing")],
    [
      h.section(
        [h.Class("landing-hero")],
        [
          h.p([h.Class("landing-badge")], ["Ferramenta grátis"]),
          h.h1([], ["Assine documentos grátis com A1 no navegador."]),
          h.p(
            [],
            [
              "Assinatura PAdES com certificado digital A1, direto no navegador. O PDF não sobe para servidor e a senha não é armazenada.",
            ],
          ),
          h.a([h.Href("#assinar"), h.Class("site-action")], ["Assinar agora"]),
          h.a(
            [h.Href(localizedSitePath("docs/a1-signing/browser-pdf-flow", model.locale))],
            ["Como funciona"],
          ),
          h.ul(
            [],
            promises.map((promise) => h.li([], [promise])),
          ),
        ],
      ),
      h.section(
        [],
        [
          h.h2([], ["Quatro passos, tudo no navegador."]),
          h.p([], ["A criptografia roda local. Nenhum documento precisa sair do seu dispositivo."]),
          h.ol(
            [h.Class("landing-capabilities")],
            steps.map((step) => h.li([], [h.h3([], [step.title]), h.p([], [step.body])])),
          ),
        ],
      ),
      h.section(
        [h.Id("assinar")],
        [
          h.h2([], ["Assine seu documento agora."]),
          h.p([], ["Tenha o PDF, o certificado A1 (.p12 ou .pfx) e a senha em mãos."]),
          h.submodel({
            slotId: "free-signing-session",
            model: model.signer,
            view: Signer.view,
            toParentMessage: (message) => Message.GotSignerMessage({ message }),
          }),
        ],
      ),
      h.section(
        [],
        [
          h.h2([], ["Perguntas frequentes"]),
          h.p(
            [],
            [
              "Grátis, com validade técnica. Mesmo núcleo de assinatura PAdES do pacote aberto, com A1 no navegador.",
            ],
          ),
          ...questions.map((item) =>
            h.details([], [h.summary([], [item.question]), h.p([], [item.answer])]),
          ),
        ],
      ),
    ],
  ),
);
