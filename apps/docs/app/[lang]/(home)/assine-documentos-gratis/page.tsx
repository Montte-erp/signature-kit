import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowRight, Check } from "lucide-react";

import { FadeIn } from "@/components/fade-in";
import { PdfSigner } from "@/components/pdf-signer-islands";
import { Container, Section, SectionHeading } from "@/components/sections/_shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { parseLocale } from "@/lib/locale";
import { absoluteUrl, OG_LOCALE, SITE_NAME } from "@/lib/site";
import { setServerLocale } from "@/lib/server-locale";

const PATH = "/pt-BR/assine-documentos-gratis";
const TITLE = "Assine documentos grátis com certificado A1";
const DESCRIPTION =
  "Assine documentos PDF grátis no navegador com certificado digital A1. O arquivo, o .p12/.pfx e a senha ficam no seu dispositivo.";

type PortugueseSeoPageProps = {
  readonly params: Promise<{ readonly lang: string }>;
};

export async function generateMetadata({ params }: PortugueseSeoPageProps): Promise<Metadata> {
  const { lang } = await params;
  const locale = parseLocale(lang);
  if (locale !== "pt-BR") notFound();

  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: PATH },
    openGraph: {
      title: `${TITLE} | ${SITE_NAME}`,
      description: DESCRIPTION,
      url: absoluteUrl(PATH),
      siteName: SITE_NAME,
      type: "website",
      locale: OG_LOCALE[locale],
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
    },
  };
}

const promises = [
  "Sem upload do PDF",
  "Sem cadastro",
  "Senha nunca sai da página",
  "Assinatura PAdES com A1",
];

const steps = [
  {
    title: "Envie o PDF",
    body: "Lido como bytes no navegador. Nenhum upload acontece.",
  },
  {
    title: "Posicione a assinatura",
    body: "Clique no ponto da assinatura ou use o posicionamento automático.",
  },
  {
    title: "Carregue o A1",
    body: "Selecione o .p12 ou .pfx e informe a senha. Tudo fica local.",
  },
  {
    title: "Baixe assinado",
    body: "A assinatura PAdES é aplicada na página e o PDF sai pronto.",
  },
];

const faqs = [
  {
    question: "Precisa de cadastro?",
    answer: "Não. Basta o PDF e um certificado A1 válido.",
  },
  {
    question: "O documento vai para algum servidor?",
    answer: "Não. PDF, certificado e senha ficam em memória local durante a assinatura.",
  },
  {
    question: "Funciona com A3?",
    answer: "Ainda não. Esta página assina apenas com A1.",
  },
];

/**
 * Structured data so Google can surface this page as rich results: the FAQ as an
 * expandable accordion, the four steps as a HowTo, and the tool itself as a free
 * SoftwareApplication. One inline <script> — no client JS, no bloat.
 */
function buildJsonLd() {
  const url = absoluteUrl(PATH);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "SignatureKit — Assinador de PDF grátis",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url,
        description: DESCRIPTION,
        offers: { "@type": "Offer", price: "0", priceCurrency: "BRL" },
      },
      {
        "@type": "HowTo",
        name: "Como assinar um documento PDF grátis com certificado A1",
        description: DESCRIPTION,
        totalTime: "PT2M",
        step: steps.map((step, i) => ({
          "@type": "HowToStep",
          position: i + 1,
          name: step.title,
          text: step.body,
          url: `${url}#assinar`,
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
    ],
  };
}

export default async function AssineDocumentosGratisPage({ params }: PortugueseSeoPageProps) {
  const { lang } = await params;
  const locale = parseLocale(lang);
  if (locale !== "pt-BR") notFound();
  setServerLocale(locale);

  return (
    <main className="flex flex-col">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted static JSON-LD
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildJsonLd()) }}
      />
      <Section>
        <Container className="pt-20 pb-14 text-center sm:pt-24 sm:pb-16">
          <FadeIn>
            <Badge
              variant="outline"
              className="px-3 py-1 font-mono text-xs text-muted-foreground"
            >
              Ferramenta grátis
            </Badge>
          </FadeIn>
          <FadeIn delay={0.08}>
            <h1 className="mx-auto mt-6 max-w-[18ch] text-[2.5rem]/[1.05] font-medium tracking-tight text-balance text-foreground sm:text-6xl lg:text-7xl">
              Assine documentos grátis com A1 no navegador.
            </h1>
          </FadeIn>
          <FadeIn delay={0.16}>
            <p className="mx-auto mt-5 max-w-[58ch] text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
              Assinatura PAdES com certificado digital A1, direto no navegador. O PDF não sobe para servidor e a senha não é armazenada.
            </p>
          </FadeIn>
          <FadeIn delay={0.24}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="#assinar">
                  Assinar agora
                  <ArrowDown data-icon="inline-end" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link href="/pt-BR/docs/components/browser-signing">
                  Como funciona
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </div>
          </FadeIn>
          <FadeIn delay={0.32}>
            <ul className="mx-auto mt-10 flex max-w-2xl flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {promises.map((promise) => (
                <li key={promise} className="flex items-center gap-2">
                  <Check className="size-4" />
                  <span>{promise}</span>
                </li>
              ))}
            </ul>
          </FadeIn>
        </Container>
      </Section>

      <Section className="border-t border-border">
        <Container>
          <FadeIn>
            <SectionHeading
              eyebrow="Como funciona"
              title="Quatro passos, tudo no navegador."
              lead="A criptografia roda local. React entrega só a interface."
            />
          </FadeIn>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {steps.map((step, i) => (
              <FadeIn key={step.title} delay={0.05 + i * 0.05} className="h-full">
                <Card className="flex h-full flex-col gap-0 p-5">
                  <span className="font-mono text-xs text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <CardHeader className="mt-3 gap-2 p-0">
                    <CardTitle className="text-lg font-medium tracking-tight">
                      {step.title}
                    </CardTitle>
                    <CardDescription className="text-sm leading-relaxed text-pretty">
                      {step.body}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </FadeIn>
            ))}
          </div>
        </Container>
      </Section>

      <Section id="assinar" className="border-t border-border">
        <Container>
          <FadeIn>
            <SectionHeading
              eyebrow="Assinar"
              title="Assine seu documento agora."
              lead="Tenha o PDF, o certificado A1 (.p12 ou .pfx) e a senha em mãos."
            />
          </FadeIn>
          <FadeIn delay={0.08} className="mt-10">
            <PdfSigner />
          </FadeIn>
        </Container>
      </Section>

      <Section className="border-t border-border">
        <Container>
          <FadeIn>
            <SectionHeading
              eyebrow="Perguntas frequentes"
              title="Grátis, com validade técnica."
              lead="Mesmo núcleo de assinatura PAdES do pacote aberto. Esta página só reduz o escopo a A1 no navegador."
            />
          </FadeIn>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {faqs.map((item, i) => (
              <FadeIn key={item.question} delay={0.05 + i * 0.05} className="h-full">
                <Card className="flex h-full flex-col gap-0 p-5">
                  <CardHeader className="gap-2 p-0">
                    <CardTitle className="text-base font-medium tracking-tight">
                      {item.question}
                    </CardTitle>
                    <CardDescription className="text-sm leading-relaxed text-pretty">
                      {item.answer}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </FadeIn>
            ))}
          </div>
        </Container>
      </Section>
    </main>
  );
}
