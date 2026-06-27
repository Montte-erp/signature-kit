import { Tab, Tabs } from "fumadocs-ui/components/tabs";

import { CodeBlock } from "@/components/code-block";
import { FadeIn } from "@/components/fade-in";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { m } from "@/paraglide/messages";

import { Container, Section, SectionHeading } from "./_shared";

/**
 * Two-step quickstart, framed as one house two-panel terminal Card.
 *
 * Left panel (01): install the two primary packages through the package manager
 * of your choice. Right panel (02): the real first program — load an A1 layer
 * with `a1SignaturesLayer`, then inspect the certificate and sign content
 * through the `signatures` accessors, all piped through `Effect.provide`.
 *
 * Each panel is a header strip (index chip + mono label) → flush code body →
 * an `mt-auto` footnote shelf, so both shelves pin to the same baseline.
 *
 * Every code string is valid against @signature-kit/* GROUND TRUTH.
 */

const INSTALL: ReadonlyArray<{ readonly value: string; readonly label: string; readonly code: string }> = [
  { value: "bun", label: "bun", code: "bun add @signature-kit/core @signature-kit/a1" },
  { value: "npm", label: "npm", code: "npm install @signature-kit/core @signature-kit/a1" },
  { value: "pnpm", label: "pnpm", code: "pnpm add @signature-kit/core @signature-kit/a1" },
  { value: "yarn", label: "yarn", code: "yarn add @signature-kit/core @signature-kit/a1" },
];

const FIRST_CALL = `import { a1SignaturesLayer } from "@signature-kit/a1/signer"
import { signatures } from "@signature-kit/core/signatures"
import { Effect, Redacted } from "effect"

// Load the A1 / PKCS#12 container once — pfx is the .pfx/.p12 *bytes*.
const layer = a1SignaturesLayer({
  pfx,
  password: Redacted.make(process.env.A1_PASSWORD ?? ""),
})

// Inspect the certificate, then sign — typed errors, no thrown exceptions.
const program = Effect.gen(function* () {
  const identity = yield* signatures.inspect()

  const artifact = yield* signatures.sign({
    content,
    algorithm: "rsa-sha256",
  })

  return { identity, artifact }
}).pipe(Effect.provide(layer))

const { identity, artifact } = await Effect.runPromise(program)`;

// Stripped-chrome CodeBlock so the highlighted figure sits flush inside a panel.
const FLUSH = "!my-0 border-0 bg-transparent shadow-none";
// Circular numbered step badge with a soft ring — reads as an ordered sequence.
const INDEX_CHIP =
  "grid size-6 shrink-0 place-items-center rounded-full border border-border bg-background font-mono text-[11px] font-medium text-foreground";

export function GetStarted() {
  return (
    <Section>
      <Container>
        <FadeIn>
          <SectionHeading
            eyebrow={m.gs_eyebrow()}
            title={m.gs_title()}
            lead={m.gs_lead()}
          />
        </FadeIn>

        <FadeIn delay={0.05}>
          <Card className="mt-10 grid gap-0 overflow-hidden rounded-2xl p-0 shadow-none lg:grid-cols-2">
              {/* 01 — Install */}
              <div className="flex flex-col border-b border-border lg:border-r lg:border-b-0">
              <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
                <span className={INDEX_CHIP}>01</span>
                <span className="font-mono text-xs text-foreground">
                  {m.gs_step1_heading()}
                </span>
              </div>

              <div className="flex flex-1 flex-col p-4">
                <Tabs items={INSTALL.map((i) => i.label)}>
                  {INSTALL.map((i) => (
                    <Tab key={i.value} value={i.label}>
                      <CodeBlock code={i.code} lang="bash" className={FLUSH} />
                    </Tab>
                  ))}
                </Tabs>
              </div>

              <div className="mt-auto border-t border-border bg-muted/30 px-4 py-3">
                <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
                  <code className="font-mono text-foreground">
                    @signature-kit/core
                  </code>{" "}
                  {m.gs_note1()}{" "}
                  <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
                    <Badge variant="outline" className="font-mono">
                      /a1
                    </Badge>
                    <Badge variant="outline" className="font-mono">
                      /pdf
                    </Badge>
                    <Badge variant="outline" className="font-mono">
                      /xml
                    </Badge>
                  </span>
                </p>
              </div>
            </div>

            {/* 02 — Make your first call */}
            <div className="flex flex-col">
              <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
                <span className={INDEX_CHIP}>02</span>
                <span className="font-mono text-xs text-foreground">
                  {m.gs_step2_heading()}
                </span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground/50">
                  first-signature.ts
                </span>
              </div>

              <div className="flex flex-1 flex-col p-4">
                <CodeBlock code={FIRST_CALL} lang="tsx" className={FLUSH} />
              </div>

              <div className="mt-auto border-t border-border bg-muted/30 px-4 py-3">
                <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
                  <code className="mr-1 font-mono text-foreground">runPromise</code>
                  {m.gs_note2_a()}
                  <code className="mx-1 font-mono text-foreground">identity</code>
                  {m.gs_note2_b()}
                  <code className="mx-1 font-mono text-foreground">artifact</code>
                  {m.gs_note2_c()}
                  <code className="mx-1 font-mono text-foreground">signPdf</code>
                  {m.gs_note2_d()}
                  <code className="mx-1 font-mono text-foreground">signXml</code>
                  {m.gs_note2_e()}
                </p>
              </div>
            </div>
            </Card>
        </FadeIn>
      </Container>
    </Section>
  );
}
