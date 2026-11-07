import { foldkit } from "@foldkit/vite-plugin";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

const socialImages: Plugin = {
  name: "signaturekit-social-images",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (!/^\/(en-US|pt-BR)\/.*\.webp$/.test(url.pathname)) return next();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      response.once("close", cancel);
      const run = async () => {
        const entry = await server.ssrLoadModule("/foldkit/entry.server.ts");
        const result = await entry.renderPage(
          new Request(url, { method: request.method, signal: controller.signal }),
        );
        if (result._tag !== "Responded") {
          response.writeHead(404).end();
          return;
        }
        const body = await result.response.arrayBuffer();
        response.writeHead(
          result.response.status,
          Object.fromEntries(result.response.headers.entries()),
        );
        response.end(Buffer.from(body));
      };
      run()
        .catch(() => {
          if (!response.destroyed) response.writeHead(500).end();
        })
        .finally(() => response.removeListener("close", cancel));
    });
  },
};

export default defineConfig({
  envPrefix: ["VITE_", "WAKU_PUBLIC_"],
  environments: { ssr: { build: { copyPublicDir: false } } },
  plugins: [
    socialImages,
    foldkit({
      devToolsMcpPort: false,
      ssr: {
        clientEntry: "/foldkit/entry.client.ts",
        serverEntry: "/foldkit/entry.server.ts",
        build: {
          clientOutDir: "dist-foldkit/client",
          serverOutDir: "dist-foldkit/server",
          prerender: { origin: "https://signaturekit.dev" },
        },
      },
    }),
  ],
});
