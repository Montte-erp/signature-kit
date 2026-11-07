import { Button } from "@foldkit/ui";
import { Effect, Exit, Schema } from "effect";
import { Command } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { defineView } from "foldkit/submodel";
import * as Mount from "foldkit/mount";
import { createIllustrativePdf } from "@signature-kit/pdf/stamp";
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
          const variants = ["line", "field", "witnessed", "initials"] satisfies (
            | "line"
            | "field"
            | "witnessed"
            | "initials"
          )[];
          const preview = element.querySelector<HTMLIFrameElement>("[data-demo-preview]");
          const status = element.querySelector<HTMLElement>("[data-demo-status]");
          const download = element.querySelector<HTMLAnchorElement>("[data-demo-download]");
          const run = element.querySelector<HTMLButtonElement>("[data-demo-run]");
          const reset = element.querySelector<HTMLButtonElement>("[data-demo-reset]");
          let active = Number(element.getAttribute("data-active") ?? "0");
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
          let request = element.getAttribute("data-request");
          const observer = new MutationObserver(() => {
            active = Number(element.getAttribute("data-active") ?? "0");
            const nextRequest = element.getAttribute("data-request");
            if (nextRequest !== request) {
              request = nextRequest;
              generate(element.getAttribute("data-marked") === "true");
            }
            show();
          });
          observer.observe(element, {
            attributes: true,
            attributeFilter: ["data-active", "data-request", "data-marked"],
          });
          generate(element.getAttribute("data-marked") === "true");
          return () => {
            closed = true;
            generation++;
            controller?.abort();
            observer.disconnect();
            revoke(urls);
          };
        }),
        (dispose) => Effect.sync(dispose),
      );
      return DemoMounted.make({});
    }),
});

export const HomeDemoModel = Schema.Struct({
  active: Schema.Int,
  request: Schema.Int,
  marked: Schema.Boolean,
});
export type HomeDemoModel = typeof HomeDemoModel.Type;
export const Message = defineMessageUnion({
  DemoMounted: {},
  PreviousRequested: {},
  NextRequested: {},
  DocumentSelected: { index: Schema.Int },
  MarkRequested: {},
  ResetRequested: {},
  DownloadRequested: {},
  AnalyticsRecorded: {},
});
export type Message = typeof Message.Type;
const RecordDemoEvent = Command.define("RecordDemoEvent", {
  args: { action: Schema.Literals(["run", "reset", "download"]), index: Schema.Int },
  messages: [Message.AnalyticsRecorded],
  execute: ({ action, index }) =>
    Effect.sync(() => {
      if (action === "run") captureDocsEvent("auto_sign_demo_started", { document_count: 4 });
      if (action === "reset") captureDocsEvent("auto_sign_demo_reset", { document_count: 4 });
      if (action === "download")
        captureDocsEvent("auto_sign_demo_downloaded", {
          document_id: ["doc-contrato", "doc-aditivo", "doc-procuracao", "doc-adesao"][index],
          signed: false,
        });
      return Message.AnalyticsRecorded();
    }),
});
export const homeDemoInit = (): HomeDemoModel => ({ active: 0, request: 0, marked: false });
export const homeDemoUpdate = (model: HomeDemoModel, message: Message) =>
  Message.match(message, {
    DemoMounted: () => ({ model }),
    AnalyticsRecorded: () => ({ model }),
    PreviousRequested: () => ({ model: { ...model, active: (model.active + 3) % 4 } }),
    NextRequested: () => ({ model: { ...model, active: (model.active + 1) % 4 } }),
    DocumentSelected: ({ index }) => ({ model: { ...model, active: index } }),
    MarkRequested: () => ({
      model: { ...model, request: model.request + 1, marked: true },
      commands: [RecordDemoEvent({ action: "run", index: model.active })],
    }),
    ResetRequested: () => ({
      model: { ...model, request: model.request + 1, marked: false },
      commands: [RecordDemoEvent({ action: "reset", index: model.active })],
    }),
    DownloadRequested: () => ({
      model,
      commands: [RecordDemoEvent({ action: "download", index: model.active })],
    }),
  });

export const homeDemoView = defineView<HomeDemoModel, Message, { readonly locale: Locale }>(
  (model, { locale }, h) => {
    const pt = locale === "pt-BR";
    const names = pt
      ? ["Contrato de serviços", "Aditivo contratual", "Procuração", "Termo de adesão"]
      : ["Service agreement", "Contract amendment", "Power of attorney", "Terms of adhesion"];
    return h.div(
      [
        h.Class("home-demo"),
        h.Attribute("data-locale", locale),
        h.Attribute("data-active", String(model.active)),
        h.Attribute("data-request", String(model.request)),
        h.Attribute("data-marked", String(model.marked)),
        h.OnMount(Mount.mapMessage(DemoMount(), () => Message.DemoMounted())),
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
            Button.view(
              {
                onClick: Message.MarkRequested(),
                toView: ({ button }) =>
                  h.button(
                    [...button, h.Attribute("data-demo-run", "")],
                    [pt ? "Aplicar marcas ilustrativas" : "Apply illustrative marks"],
                  ),
              },
              h,
            ),
            Button.view(
              {
                onClick: Message.ResetRequested(),
                toView: ({ button }) =>
                  h.button(
                    [...button, h.Attribute("data-demo-reset", "")],
                    [pt ? "Reiniciar" : "Reset"],
                  ),
              },
              h,
            ),
            Button.view(
              {
                onClick: Message.PreviousRequested(),
                toView: ({ button }) =>
                  h.button(
                    [
                      ...button,
                      h.Attribute("data-demo-previous", ""),
                      h.AriaLabel(pt ? "Documento anterior" : "Previous document"),
                    ],
                    ["←"],
                  ),
              },
              h,
            ),
            Button.view(
              {
                onClick: Message.NextRequested(),
                toView: ({ button }) =>
                  h.button(
                    [
                      ...button,
                      h.Attribute("data-demo-next", ""),
                      h.AriaLabel(pt ? "Próximo documento" : "Next document"),
                    ],
                    ["→"],
                  ),
              },
              h,
            ),
            h.a(
              [h.Attribute("data-demo-download", ""), h.OnClick(Message.DownloadRequested())],
              [pt ? "Baixar exemplo" : "Download example"],
            ),
          ],
        ),
        h.div(
          [
            h.Class("home-demo-controls"),
            h.Role("group"),
            h.AriaLabel(pt ? "Documentos de exemplo" : "Example documents"),
          ],
          names.map((name, index) =>
            Button.view(
              {
                onClick: Message.DocumentSelected({ index }),
                toView: ({ button }) =>
                  h.button(
                    [
                      ...button,
                      h.Attribute("data-demo-index", String(index)),
                      h.AriaPressed(String(index === model.active)),
                    ],
                    [name],
                  ),
              },
              h,
            ),
          ),
        ),
        h.p(
          [h.Attribute("data-demo-label", "")],
          [`${names[model.active] ?? ""} · ${model.active + 1} / 4`],
        ),
        h.p(
          [h.Attribute("data-demo-status", ""), h.Role("status")],
          [pt ? "Preparando exemplos…" : "Preparing examples…"],
        ),
        h.iframe([
          h.Attribute("data-demo-preview", ""),
          h.Attribute("title", pt ? "Prévia do exemplo" : "Example preview"),
        ]),
      ],
    );
  },
);
