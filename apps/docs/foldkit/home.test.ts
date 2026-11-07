import { describe, expect, it } from "vitest";
import { Effect, Fiber, Schema } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { it as effectIt } from "@effect/vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { gunzipSync } from "node:zlib";
import { serverAnalyticsLayer } from "../lib/posthog/server";
import { contentPaths, resolveContent } from "./content";
import { createServerComposition, renderDocument, renderPage } from "./entry.server";
import { Message, init, update } from "./main";
import { ExpireHomeCopy } from "./home";

describe("Foldkit home", () => {
  it("renders each home section and localized metadata on the server", async () => {
    const assets = { entryScript: "/entry.js", stylesheets: [], modulePreloads: [] };
    for (const [locale, title] of [
      ["en-US", "One typed boundary for every signature."],
      ["pt-BR", "Um ponto único de assinatura tipado para cada documento."],
    ]) {
      const result = await renderPage(new Request(`https://signaturekit.dev/${locale}`), "test");
      if (result._tag !== "Rendered") return expect.fail(`Missing ${locale} home`);
      const html = renderDocument(result.application, assets);
      expect(html).toContain(title);
      expect(html).toContain(
        locale === "pt-BR" ? "Prévia local, sem upload." : "Local preview, without upload.",
      );
      expect(html).not.toContain("Rendered locally with pdf.js.");
      expect(html).not.toContain("Renderizado localmente com pdf.js.");
      expect(html).not.toContain("18 literal codes");
      expect(html).not.toContain("18 códigos literais");
      for (const id of [
        "signer",
        "auto-sign",
        "providers",
        "capabilities",
        "get-started",
        "sponsors",
      ])
        expect(html).toContain(`id="${id}"`);
      expect(html).toContain("ClicksignSignatureRequest");
      expect(html).toContain("contentBase64");
      expect(html).toContain('name="pfx"');
      expect(html).toContain(`rel="canonical" href="https://signaturekit.dev/${locale}"`);
      expect(html).toContain('hreflang="en-US"');
      expect(html).toContain('hreflang="pt-BR"');
      expect(html).toContain(`href="/${locale}/blog"`);
      expect(html).toContain(`href="/${locale}/changelog"`);
      expect(html).toContain("https://github.com/Licitei/signature-kit/issues");
      expect(html).toContain("https://licitei.com.br");
      expect(html).toContain("npm install @signature-kit/signatures @signature-kit/a1");
      expect(html).toContain("pnpm add @signature-kit/signatures @signature-kit/a1");
      expect(html).toContain("yarn add @signature-kit/signatures @signature-kit/a1");
    }
  });
  it("renders the Portuguese signing landing and structured data", async () => {
    const result = await renderPage(
      new Request("https://signaturekit.dev/pt-BR/assine-documentos-gratis"),
      "test",
    );
    if (result._tag !== "Rendered") return expect.fail("Missing signing landing");
    const html = renderDocument(result.application, {
      entryScript: "/entry.js",
      stylesheets: [],
      modulePreloads: [],
    });
    for (const text of [
      "Quatro passos, tudo no navegador.",
      "Sem upload do PDF",
      "Precisa de cadastro?",
      "Funciona com A3?",
      "/pt-BR/docs/a1-signing/browser-pdf-flow",
      'id="assinar"',
      'name="pfx"',
    ])
      expect(html).toContain(text);
    const match = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(html);
    if (match?.[1] === undefined) return expect.fail("Missing JSON-LD");
    const data: unknown = JSON.parse(match[1]);
    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "SoftwareApplication",
          url: "https://signaturekit.dev/pt-BR/assine-documentos-gratis",
        },
        {
          "@type": "HowTo",
          step: expect.arrayContaining([
            expect.objectContaining({ name: "Envie o PDF" }),
            expect.objectContaining({ name: "Baixe assinado" }),
          ]),
        },
        {
          "@type": "FAQPage",
          mainEntity: expect.arrayContaining([
            expect.objectContaining({ name: "Funciona com A3?" }),
          ]),
        },
      ],
    });
  });
  it("renders localized navigation and preserves the theme toggle", () => {
    const initial = init({ locale: "pt-BR", path: "" }).model;
    expect(update(initial, Message.ThemeToggled()).model.theme).toBe("dark");
    expect(update({ ...initial, theme: "dark" }, Message.ThemeToggled()).model.theme).toBe("light");
  });
  it("sends only bounded search dimensions through the real analytics transport", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const received: string[] = [];
          const receiver = yield* Effect.acquireRelease(
            Effect.sync(() =>
              createServer((request, response) => {
                const chunks: Uint8Array[] = [];
                request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
                request.on("end", () => {
                  const body = Buffer.concat(chunks);
                  received.push(
                    (request.headers["content-encoding"] === "gzip"
                      ? gunzipSync(body)
                      : body
                    ).toString(),
                  );
                  response.writeHead(200).end("{}");
                });
              }).listen(0, "127.0.0.1"),
            ),
            (server) =>
              Effect.promise(
                () =>
                  new Promise<void>((resolve) => {
                    server.closeAllConnections();
                    server.close(() => resolve());
                  }),
              ).pipe(Effect.timeout("3 seconds"), Effect.orDie),
          );
          yield* Effect.promise(() => once(receiver, "listening"));
          const address = receiver.address();
          if (address === null || typeof address === "string")
            return expect.fail("Missing analytics receiver");
          const server = createServerComposition(
            { paths: contentPaths, resolve: resolveContent },
            serverAnalyticsLayer({
              token: "local-test-token",
              host: `http://127.0.0.1:${address.port}`,
            }),
          );
          const secret = "private-search-content";
          const result = yield* Effect.promise(() =>
            server.renderPage(
              new Request(`https://signaturekit.dev/en-US/search?q=${secret}${"x".repeat(250)}`, {
                headers: {
                  referer: "https://private.example/secret",
                  "user-agent": "private-agent",
                },
              }),
              "test",
            ),
          );
          expect(result._tag).toBe("Rendered");
          expect(received).toHaveLength(1);
          const payload = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              batch: Schema.Array(
                Schema.Struct({
                  event: Schema.String,
                  properties: Schema.Record(Schema.String, Schema.Unknown),
                }),
              ),
            }),
          )(JSON.parse(received[0] ?? ""));
          expect(payload.batch[0]?.event).toContain("search_requested");
          expect(payload.batch[0]?.properties).toMatchObject({
            query_present: true,
            query_length: 200,
          });
          expect(JSON.stringify(payload)).not.toContain(secret);
          expect(JSON.stringify(payload)).not.toContain("private.example");
          expect(JSON.stringify(payload)).not.toContain("private-agent");
        }),
      ).pipe(Effect.timeout("15 seconds")),
    );
  }, 20000);
  it("selects providers and records copy success or failure without storing secrets", () => {
    const initial = init({ locale: "en-US", path: "" }).model;
    const selected = update(initial, Message.HomeProviderRequested({ provider: "DocuSeal" })).model;
    expect(selected.homeProvider).toBe("DocuSeal");
    const requested = update(
      selected,
      Message.HomeCopyRequested({ target: "provider", location: "providers" }),
    ).model;
    expect(
      update(
        requested,
        Message.HomeCopyFinished({
          target: "provider",
          request: requested.homeCopyRequest,
          provider: "DocuSeal",
          ok: true,
        }),
      ).model.homeCopied,
    ).toBe("provider");
    expect(
      update(
        requested,
        Message.HomeCopyFinished({
          target: "provider",
          request: requested.homeCopyRequest,
          provider: "DocuSeal",
          ok: false,
        }),
      ).model.homeCopied,
    ).toBe("failed");
    expect(JSON.stringify(selected)).not.toContain("apiKey");
  });
  effectIt.effect("expires current feedback and ignores stale copies and timers", () =>
    Effect.gen(function* () {
      const initial = init({ locale: "en-US", path: "" }).model;
      const first = update(
        initial,
        Message.HomeCopyRequested({ target: "provider", location: "providers" }),
      ).model;
      const second = update(
        first,
        Message.HomeCopyRequested({ target: "provider", location: "providers" }),
      ).model;
      const old = Message.HomeCopyFinished({
        target: "provider",
        provider: "Clicksign",
        request: first.homeCopyRequest,
        ok: true,
      });
      expect(update(second, old).model.homeCopied).toBe("none");
      const completed = update(
        second,
        Message.HomeCopyFinished({
          target: "provider",
          provider: "Clicksign",
          request: second.homeCopyRequest,
          ok: true,
        }),
      ).model;
      expect(completed.homeCopied).toBe("provider");
      const fiber = yield* Effect.forkChild(
        ExpireHomeCopy({ request: second.homeCopyRequest, provider: "Clicksign" }).effect,
      );
      yield* TestClock.adjust("1800 millis");
      const expired = yield* Fiber.join(fiber);
      const next = update(
        completed,
        Message.HomeCopyRequested({ target: "provider", location: "providers" }),
      ).model;
      const nextDone = update(
        next,
        Message.HomeCopyFinished({
          target: "provider",
          provider: "Clicksign",
          request: next.homeCopyRequest,
          ok: true,
        }),
      ).model;
      expect(update(nextDone, expired).model.homeCopied).toBe("provider");
      expect(update(completed, expired).model.homeCopied).toBe("none");
      const changed = update(second, Message.HomeProviderRequested({ provider: "DocuSeal" })).model;
      expect(
        update(
          changed,
          Message.HomeCopyFinished({
            target: "provider",
            provider: "Clicksign",
            request: second.homeCopyRequest,
            ok: true,
          }),
        ).model.homeCopied,
      ).toBe("none");
    }),
  );
});
