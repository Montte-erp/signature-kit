import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { foldkit } from "@foldkit/vite-plugin";
import type { Plugin, UserConfig } from "vite";
import { SiteContent } from "../src/site/config.ts";

export const appRoot = fileURLToPath(new URL("../", import.meta.url));

export const siteViteConfig = (
  content: typeof SiteContent.Type,
  outputDir: string,
  siteUrl: string,
  production: boolean,
): UserConfig => {
  const contentModule: Plugin = {
    name: "signature-kit:content",
    resolveId(id) {
      if (id === "virtual:signature-kit/content") return "\0signature-kit:content";
    },
    async load(id) {
      if (id !== "\0signature-kit:content") return;
      // effect-boundary: native host invocation [allow-run: Vite and HTTP application boundary]
      const json = await Effect.runPromise(
        Schema.encodeEffect(Schema.fromJsonString(SiteContent))(content),
      );
      return `export default ${json};`;
    },
    generateBundle() {
      if (this.environment.name !== "client") return;
      for (const asset of content.assets) {
        this.emitFile({ type: "asset", fileName: asset.fileName, source: asset.source });
      }
    },
  };
  return {
    root: appRoot,
    envPrefix: [],
    oxc: { jsx: { development: !production } },
    define: production ? { "process.env.NODE_ENV": JSON.stringify("production") } : undefined,
    resolve: { tsconfigPaths: true },
    ssr: { noExternal: true },
    logLevel: "warn",
    build: { emptyOutDir: true },
    plugins: [
      contentModule,
      ...foldkit({
        devToolsMcpPort: false,
        ssr: {
          clientEntry: "/src/site/client.ts",
          serverEntry: "/src/entry.server.ts",
          build: {
            clientOutDir: join(outputDir, "client"),
            serverOutDir: join(outputDir, "server"),
            prerender: { origin: siteUrl },
          },
        },
      }),
    ],
  };
};
