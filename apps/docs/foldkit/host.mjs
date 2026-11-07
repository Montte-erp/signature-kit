import { Effect, Option, Schema } from "effect";
import { realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const manifest = await Effect.runPromise(
  Schema.decodeUnknownEffect(
    Schema.Struct({
      schemaVersion: Schema.Literal(1),
      client: Schema.String,
      server: Schema.String,
      serverEntry: Schema.String,
      prerendered: Schema.Array(Schema.String),
    }),
  )(await Bun.file(resolve(root, "dist-foldkit/server/foldkit.build.json")).json()),
);
const client = resolve(root, manifest.client);
const server = resolve(root, manifest.server, manifest.serverEntry);
const handler = await import(pathToFileURL(server).href);
const prerendered = new Map(
  manifest.prerendered.map((path) => [
    path,
    resolve(client, ...path.split("/").filter(Boolean).map(decodeURIComponent), "index.html"),
  ]),
);

export const fetch = async (request) => {
  const path = new URL(request.url).pathname;
  const route = Schema.decodeUnknownOption(
    Schema.Struct({ _tag: Schema.Literal("Page"), path: Schema.String }),
  )(handler.parsePublicUrl(request.url));
  if (Option.isSome(route) && route.value.path.endsWith(".webp")) {
    const result = await handler.renderPage(request);
    return result._tag === "Responded" ? result.response : new Response(null, { status: 404 });
  }
  if (request.method === "GET" || request.method === "HEAD") {
    const filePath = prerendered.get(path);
    if (typeof filePath === "string" && Boolean(filePath.startsWith(`${client}${sep}`))) {
      const realClient = await realpath(client).catch(() => null);
      const realFile = await realpath(filePath).catch(() => null);
      if (
        typeof realClient === "string" &&
        typeof realFile === "string" &&
        Boolean(realFile.startsWith(`${realClient}${sep}`)) &&
        Boolean((await stat(realFile).catch(() => null))?.isFile())
      ) {
        return new Response(request.method === "HEAD" ? null : Bun.file(realFile), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    }

    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return new Response(null, { status: 400 });
    }
    const segments = decoded.split("/");
    if (
      segments.some(
        (segment) =>
          segment === "." ||
          segment === ".." ||
          segment.startsWith(".") ||
          segment.includes("\\") ||
          segment.includes("\0"),
      )
    ) {
      return new Response(null, { status: 404 });
    }
    const name = (segments.at(-1) ?? "").toLowerCase();
    if (
      segments.includes("server") ||
      name.endsWith(".html") ||
      name.endsWith(".map") ||
      /\.(?:ts|tsx|jsx|mjs|cjs)$/.test(name) ||
      name === "manifest.json" ||
      name === "foldkit.build.json"
    ) {
      return new Response(null, { status: 404 });
    }
    const staticPath = resolve(client, `.${decoded}`);
    const realClient = await realpath(client).catch(() => null);
    const realFile = await realpath(staticPath).catch(() => null);
    if (
      typeof realClient === "string" &&
      typeof realFile === "string" &&
      Boolean(realFile.startsWith(`${realClient}${sep}`)) &&
      Boolean((await stat(realFile).catch(() => null))?.isFile())
    ) {
      const file = Bun.file(realFile);
      return new Response(request.method === "HEAD" ? null : file, {
        headers: {
          "content-type": file.type || "application/octet-stream",
          "content-length": String(file.size),
        },
      });
    }
  }
  return handler.default.fetch(request);
};

if (import.meta.main === true) {
  const server = Bun.serve({ port: Number(process.env.PORT ?? 3001), fetch });
  console.log(`Listening on ${server.url}`);
}
