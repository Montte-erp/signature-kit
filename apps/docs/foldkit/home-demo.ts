import { Effect, Exit, Schema } from "effect";
import * as Mount from "foldkit/mount";
import { createIllustrativePdf } from "@signature-kit/pdf/stamp";
import type { HtmlBuilder } from "foldkit/html";
import { captureDocsEvent } from "../lib/posthog/client";
import type { Locale } from "./content";

const DemoMounted = Schema.TaggedStruct("DemoMounted", {});
const DemoMount = Mount.define("DemoMount", {
  messages: [DemoMounted],
  execute: ({ element }) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const locale = element.getAttribute("data-locale") === "pt-BR" ? "pt-BR" : "en-US";
          const names =
            locale === "pt-BR"
              ? ["Contrato de serviços", "Aditivo contratual", "Procuração", "Termo de adesão"]
              : [
                  "Service agreement",
                  "Contract amendment",
                  "Power of attorney",
                  "Terms of adhesion",
                ];
          const documentIds = ["doc-contrato", "doc-aditivo", "doc-procuracao", "doc-adesao"];
          const variants = ["line", "field", "witnessed", "initials"] satisfies (
            | "line"
            | "field"
            | "witnessed"
            | "initials"
          )[];
          const preview = element.querySelector<HTMLIFrameElement>("[data-demo-preview]");
          const label = element.querySelector<HTMLElement>("[data-demo-label]");
          const status = element.querySelector<HTMLElement>("[data-demo-status]");
          const download = element.querySelector<HTMLAnchorElement>("[data-demo-download]");
          const run = element.querySelector<HTMLButtonElement>("[data-demo-run]");
          const reset = element.querySelector<HTMLButtonElement>("[data-demo-reset]");
          const previous = element.querySelector<HTMLButtonElement>("[data-demo-previous]");
          const next = element.querySelector<HTMLButtonElement>("[data-demo-next]");
          const tabs = [...element.querySelectorAll<HTMLButtonElement>("[data-demo-index]")];
          let active = 0;
          let generation = 0;
          let closed = false;
          let urls: string[] = [];
          let controller: AbortController | undefined;
          const revoke = (items: string[]) => items.forEach((url) => URL.revokeObjectURL(url));
          const show = () => {
            const url = urls[active];
            if (preview !== null && url !== undefined) preview.src = url;
            if (download !== null) {
              if (url === undefined) download.removeAttribute("href");
              else {
                download.href = url;
                download.download = `${names[active] ?? "example"}.pdf`;
              }
            }
            if (label !== null) label.textContent = `${names[active] ?? ""} · ${active + 1} / 4`;
            tabs.forEach((tab, index) =>
              tab.setAttribute("aria-pressed", String(index === active)),
            );
          };
          const generate = (marked: boolean) => {
            const current = ++generation;
            controller?.abort();
            controller = new AbortController();
            const signal = controller.signal;
            if (status !== null)
              status.textContent =
                locale === "pt-BR" ? "Preparando exemplos…" : "Preparing examples…";
            if (run !== null) run.disabled = true;
            if (reset !== null) reset.disabled = true;
            const program = Effect.forEach(variants, (variant, index) =>
              createIllustrativePdf({
                title: names[index] ?? "Example",
                body:
                  locale === "pt-BR"
                    ? "Documento demonstrativo. Este conteúdo é apenas um exemplo visual."
                    : "Demonstration document. This content is only a visual example.",
                variant,
                marked,
                markLabel: locale === "pt-BR" ? "MARCA ILUSTRATIVA" : "ILLUSTRATIVE MARK",
              }),
            );
            Effect.runPromiseExitWith(context)(program, { signal }).then(
              (result) => {
                if (closed || current !== generation) return;
                if (Exit.isFailure(result)) {
                  if (status !== null)
                    status.textContent =
                      locale === "pt-BR"
                        ? "Não foi possível gerar os exemplos."
                        : "Could not generate examples.";
                } else {
                  const old = urls;
                  urls = result.value.map((bytes) =>
                    URL.createObjectURL(
                      new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
                    ),
                  );
                  show();
                  revoke(old);
                  if (status !== null)
                    status.textContent = marked
                      ? locale === "pt-BR"
                        ? "Marcas ilustrativas aplicadas. Não são assinaturas digitais."
                        : "Illustrative marks applied. These are not digital signatures."
                      : locale === "pt-BR"
                        ? "Exemplos prontos, sem assinatura digital."
                        : "Examples ready, without digital signatures.";
                }
                if (run !== null) run.disabled = false;
                if (reset !== null) reset.disabled = false;
              },
              () => {
                if (closed || current !== generation) return;
                if (status !== null)
                  status.textContent =
                    locale === "pt-BR"
                      ? "Não foi possível gerar os exemplos."
                      : "Could not generate examples.";
                if (run !== null) run.disabled = false;
                if (reset !== null) reset.disabled = false;
              },
            );
          };
          const onDownload = () => {
            if (urls[active] === undefined) return;
            captureDocsEvent("auto_sign_demo_downloaded", {
              document_id: documentIds[active],
              signed: false,
            });
          };
          const onRun = () => {
            captureDocsEvent("auto_sign_demo_started", { document_count: 4 });
            generate(true);
          };
          const onReset = () => {
            captureDocsEvent("auto_sign_demo_reset", { document_count: 4 });
            generate(false);
          };
          const onPrevious = () => {
            active = (active + 3) % 4;
            show();
          };
          const onNext = () => {
            active = (active + 1) % 4;
            show();
          };
          const tabHandlers = tabs.map((tab, index) => ({
            tab,
            handler: () => {
              active = index;
              show();
            },
          }));
          download?.addEventListener("click", onDownload);
          run?.addEventListener("click", onRun);
          reset?.addEventListener("click", onReset);
          previous?.addEventListener("click", onPrevious);
          next?.addEventListener("click", onNext);
          tabHandlers.forEach(({ tab, handler }) => tab.addEventListener("click", handler));
          generate(false);
          return () => {
            closed = true;
            generation++;
            controller?.abort();
            download?.removeEventListener("click", onDownload);
            run?.removeEventListener("click", onRun);
            reset?.removeEventListener("click", onReset);
            previous?.removeEventListener("click", onPrevious);
            next?.removeEventListener("click", onNext);
            tabHandlers.forEach(({ tab, handler }) => tab.removeEventListener("click", handler));
            revoke(urls);
          };
        }),
        (dispose) => Effect.sync(dispose),
      );
      return DemoMounted.make({});
    }),
});

export const homeDemo = <Message>(h: HtmlBuilder<Message>, locale: Locale, mounted: Message) => {
  const pt = locale === "pt-BR";
  const names = pt
    ? ["Contrato de serviços", "Aditivo contratual", "Procuração", "Termo de adesão"]
    : ["Service agreement", "Contract amendment", "Power of attorney", "Terms of adhesion"];
  return h.div(
    [
      h.Class("home-demo"),
      h.Attribute("data-locale", locale),
      h.OnMount(Mount.mapMessage(DemoMount(), () => mounted)),
    ],
    [
      h.p(
        [],
        [
          pt
            ? "Exemplo visual ilustrativo: não é assinatura digital e não usa certificado."
            : "Illustrative visual example: not a digital signature and no certificate is used.",
        ],
      ),
      h.div(
        [h.Class("home-demo-controls")],
        [
          h.button(
            [h.Type("button"), h.Attribute("data-demo-run", "")],
            [pt ? "Aplicar marcas ilustrativas" : "Apply illustrative marks"],
          ),
          h.button(
            [h.Type("button"), h.Attribute("data-demo-reset", "")],
            [pt ? "Reiniciar" : "Reset"],
          ),
          h.button(
            [
              h.Type("button"),
              h.Attribute("data-demo-previous", ""),
              h.Attribute("aria-label", pt ? "Documento anterior" : "Previous document"),
            ],
            ["←"],
          ),
          h.button(
            [
              h.Type("button"),
              h.Attribute("data-demo-next", ""),
              h.Attribute("aria-label", pt ? "Próximo documento" : "Next document"),
            ],
            ["→"],
          ),
          h.a(
            [h.Attribute("data-demo-download", "")],
            [pt ? "Baixar exemplo" : "Download example"],
          ),
        ],
      ),
      h.div(
        [
          h.Class("home-demo-controls"),
          h.Attribute("role", "group"),
          h.Attribute("aria-label", pt ? "Documentos de exemplo" : "Example documents"),
        ],
        names.map((name, index) =>
          h.button(
            [
              h.Type("button"),
              h.Attribute("data-demo-index", String(index)),
              h.Attribute("aria-pressed", String(index === 0)),
            ],
            [name],
          ),
        ),
      ),
      h.p([h.Attribute("data-demo-label", "")], [names[0] ?? ""]),
      h.p(
        [h.Attribute("data-demo-status", ""), h.Attribute("role", "status")],
        [pt ? "Preparando exemplos…" : "Preparing examples…"],
      ),
      h.iframe(
        [
          h.Attribute("data-demo-preview", ""),
          h.Attribute("title", pt ? "Prévia do exemplo" : "Example preview"),
        ],
        [],
      ),
    ],
  );
};
