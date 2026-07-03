import { createServer } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";
import { Effect } from "effect";

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
};

export type LocalServer = {
  readonly server: Server;
  readonly baseUrl: string;
  readonly requests: LocalRequest[];
};

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
      new Promise<LocalServer>((resolve, reject) => {
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
            if (reply.headers !== undefined) {
              for (const [key, value] of Object.entries(reply.headers)) {
                response.setHeader(key, value);
              }
            }
            if (reply.body === undefined) {
              response.end();
              return;
            }
            if (reply.body instanceof Uint8Array) {
              response.end(Buffer.from(reply.body));
              return;
            }
            response.end(reply.body);
          })().catch((error) => {
            const message = error instanceof Error ? error.message : "server error";
            response.statusCode = 500;
            response.end(message);
          });
        });

        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (typeof address === "object" && address !== null) {
            resolve({
              server,
              baseUrl: `http://127.0.0.1:${address.port}`,
              requests,
            });
            return;
          }
          reject(new Error("HTTP server did not expose a TCP port."));
        });
      }),
  );

export const closeLocalServer = (server: Server): Effect.Effect<void> =>
  Effect.sync(() => {
    server.closeAllConnections();
    server.closeIdleConnections();
    server.close();
  });

export const jsonBody = (body: string): Record<string, unknown> =>
  body === "" ? {} : (JSON.parse(body) as Record<string, unknown>);

export const parseBodyAsJson = <T>(body: string): T => JSON.parse(body) as T;
