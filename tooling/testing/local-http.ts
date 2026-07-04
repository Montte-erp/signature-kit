import { expect } from "@effect/vitest";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";
import { Effect } from "effect";

export const expectProviderListResult = (result: unknown): void => {
  expect(result).toEqual([]);
};

export type LocalRequest = {
  readonly method: string;
  readonly pathname: string;
  readonly query: URLSearchParams;
  readonly search: string;
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

export type LocalResponse = {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  readonly keepOpen?: boolean;
  readonly onClose?: () => void;
};

export type LocalServer = {
  readonly server: Server;
  readonly baseUrl: string;
  readonly requests: LocalRequest[];
};

type LocalServerStart =
  | {
      readonly _tag: "listening";
      readonly server: Server;
      readonly baseUrl: string;
      readonly requests: LocalRequest[];
    }
  | { readonly _tag: "missingTcpPort" };

const collectBody = (request: IncomingMessage): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk) => {
      chunks.push(Uint8Array.from(chunk));
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", (error) => reject(error));
  });

const normalizeHeaders = (headers: IncomingHttpHeaders): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    normalized[key.toLowerCase()] = Array.isArray(value) ? (value[0] ?? "") : value;
  }
  return normalized;
};

export const startLocalServer = (
  handler: (request: LocalRequest) => Promise<LocalResponse>,
): Effect.Effect<LocalServer> =>
  Effect.promise(
    () =>
      new Promise<LocalServerStart>((resolve, reject) => {
        const requests: LocalRequest[] = [];
        const server = createServer((request: IncomingMessage, response: ServerResponse) => {
          void (async () => {
            const method = request.method ?? "";
            const url = new URL(request.url ?? "/", "http://127.0.0.1");
            const body = await collectBody(request);
            const recorded: LocalRequest = {
              method,
              pathname: url.pathname,
              query: url.searchParams,
              search: url.search,
              url,
              headers: normalizeHeaders(request.headers),
              body,
            };
            requests.push(recorded);

            const reply = await handler(recorded);
            response.statusCode = reply.status;
            if (reply.onClose !== undefined) {
              response.on("close", reply.onClose);
            }
            if (reply.headers !== undefined) {
              for (const [key, value] of Object.entries(reply.headers)) {
                response.setHeader(key, value);
              }
            }
            if (reply.body === undefined) {
              response.end();
              return;
            }
            if (typeof reply.body === "string") {
              if (reply.keepOpen === true) {
                response.write(reply.body);
                return;
              }
              response.end(reply.body);
              return;
            }
            response.end(Buffer.from(reply.body));
          })().catch(() => {
            response.statusCode = 500;
            response.end("server error");
          });
        });

        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (typeof address === "object" && address !== null) {
            resolve({
              _tag: "listening",
              server,
              baseUrl: `http://127.0.0.1:${address.port}`,
              requests,
            });
            return;
          }
          resolve({ _tag: "missingTcpPort" });
        });
      }),
  ).pipe(
    Effect.flatMap((result) =>
      result._tag === "listening"
        ? Effect.succeed({
            server: result.server,
            baseUrl: result.baseUrl,
            requests: result.requests,
          })
        : Effect.die("HTTP server did not expose a TCP port."),
    ),
  );

export const closeLocalServer = (server: Server): Effect.Effect<void> =>
  Effect.sync(() => {
    server.closeAllConnections();
    server.closeIdleConnections();
    server.close();
  });

export const localHttpServer = (handler: (request: LocalRequest) => Promise<LocalResponse>) =>
  Effect.acquireRelease(startLocalServer(handler), (server) => closeLocalServer(server.server));

export const jsonBody = (body: string): unknown => (body === "" ? {} : JSON.parse(body));
