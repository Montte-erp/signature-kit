import { FileUp, Lock, MousePointerClick, PenLine, ShieldCheck } from "lucide-react";

import { PdfSignerDialog } from "@/components/pdf-signer";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { FadeIn } from "@/components/fade-in";
import { m } from "@/paraglide/messages";

import { Container, Section, SectionHeading } from "./_shared";

const STEPS = [
  { icon: FileUp, title: m.signer_step1_title, body: m.signer_step1_body },
  {
    icon: MousePointerClick,
    title: m.signer_step2_title,
    body: m.signer_step2_body,
  },
  { icon: PenLine, title: m.signer_step3_title, body: m.signer_step3_body },
];

/**
 * Landing showpiece — the real in-browser signer, launched in a modal.
 * Not a mock: the same `@signature-kit/react` browser-pdf flow that ships in the
 * docs. Upload → click to place → load A1 → sign → download, fully client-side.
 */
export function Signer() {
  return (
    <Section className="border-t border-border">
      <Container>
        <FadeIn>
          <SectionHeading
            eyebrow={m.signer_eyebrow()}
            title={m.signer_title()}
            lead={m.signer_lead()}
          />
        </FadeIn>

        <FadeIn delay={0.05}>
          <Card className="mt-8 gap-0 overflow-hidden rounded-2xl p-0 shadow-none">
            {/* window chrome — a real "local only" indicator, not decorative dots */}
            <CardHeader className="flex flex-row items-center gap-2 border-b border-border px-4 py-3">
              <Lock className="size-3.5 text-muted-foreground" />
              <span className="font-mono text-xs text-muted-foreground">
                {m.signer_window_label()}
              </span>
            </CardHeader>

            <CardContent className="grid gap-8 p-6 md:grid-cols-3 md:p-8">
              {STEPS.map((step, i) => (
                <FadeIn key={step.title()} delay={0.1 + i * 0.06} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-input/30">
                      <step.icon className="size-4 text-foreground" />
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      0{i + 1}
                    </span>
                  </div>
                  <h3 className="text-base font-medium text-foreground">{step.title()}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{step.body()}</p>
                </FadeIn>
              ))}
            </CardContent>

            <CardFooter className="flex flex-col items-start gap-4 border-t border-border px-6 py-6 sm:flex-row sm:items-center sm:justify-between md:px-8">
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="size-4 text-foreground" />
                {m.signer_assurance()}
              </p>
              <PdfSignerDialog>
                <Button size="lg">
                  {m.signer_open()}
                  <PenLine data-icon="inline-end" />
                </Button>
              </PdfSignerDialog>
            </CardFooter>
          </Card>
        </FadeIn>
      </Container>
    </Section>
  );
}
