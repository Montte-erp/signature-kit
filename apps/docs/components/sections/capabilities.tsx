import { ArrowRight } from "lucide-react";
import { Link } from "fumapress/client";

import { FadeIn } from "@/components/fade-in";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { localePath } from "@/lib/links";
import { m } from "@/paraglide/messages";

import { Container, Section, SectionHeading } from "./_shared";

interface Capability {
  title: () => string;
  description: () => string;
  docHref: string;
  code: string;
  wide?: boolean;
}

const CAPABILITIES: Capability[] = [
  {
    title: m.cap1_title,
    description: m.cap1_desc,
    docHref: "/docs/signing/signers",
    code: `import { signatures } from "@signature-kit/signatures"`,
  },
  {
    title: m.cap2_title,
    description: m.cap2_desc,
    docHref: "/docs/get-started/quickstart",
    code: `a1SignaturesLayer({ pfx, password: Redacted.make(password) })`,
  },
  {
    title: m.cap3_title,
    description: m.cap3_desc,
    docHref: "/docs/signing/pdf",
    code: `signPdf({ pdf, policy: "pades-icp-brasil" })`,
  },
  {
    title: m.cap4_title,
    description: m.cap4_desc,
    docHref: "/docs/signing/xml",
    code: `signXml({ xml, referenceId: "nfe-1" })`,
  },
  {
    title: m.cap5_title,
    description: m.cap5_desc,
    docHref: "/docs/providers/request-shape",
    code: `ClicksignSignatureRequest("contract", props)`,
  },
  {
    title: m.cap6_title,
    description: m.cap6_desc,
    docHref: "/docs/signing/errors",
    code: `Effect.catchTag("SignatureKitError", handle)`,
  },
  {
    title: m.cap7_title,
    description: m.cap7_desc,
    docHref: "/docs/a1-signing/browser-pdf-flow",
    code: `import { signPdfSignatureField } from "@signature-kit/pdf/workflow"`,
    wide: true,
  },
];

export function Capabilities() {
  return (
    <Section>
      <Container>
        <FadeIn>
          <SectionHeading eyebrow={m.cap_eyebrow()} title={m.cap_title()} lead={m.cap_lead()} />
        </FadeIn>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {CAPABILITIES.map((capability, i) => (
            <FadeIn
              key={capability.docHref}
              delay={0.05 + i * 0.05}
              className={cn("h-full min-w-0", capability.wide && "sm:col-span-2")}
            >
              <Card className="group flex h-full min-w-0 flex-col gap-0 p-5">
                <span className="font-mono text-xs text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <CardHeader className="mt-3 gap-2 p-0">
                  <CardTitle className="text-lg font-medium tracking-tight text-foreground">
                    {capability.title()}
                  </CardTitle>
                  <CardDescription className="text-sm leading-relaxed text-pretty">
                    {capability.description()}
                  </CardDescription>
                </CardHeader>
                <CardContent className="mt-auto p-0">
                  <code className="mt-4 block max-w-full min-w-0 overflow-x-auto rounded-lg border border-border bg-input/30 px-3 py-2 font-mono text-xs text-muted-foreground">
                    {capability.code}
                  </code>
                </CardContent>
                <CardFooter className="p-0">
                  <Link
                    className="mt-4 inline-flex items-center gap-1.5 self-start text-sm font-medium text-foreground underline-offset-4 transition-transform duration-100 ease-out hover:underline active:scale-[0.98]"
                    href={localePath(capability.docHref)}
                  >
                    {m.cap_read_docs()}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </CardFooter>
              </Card>
            </FadeIn>
          ))}
        </div>
      </Container>
    </Section>
  );
}
