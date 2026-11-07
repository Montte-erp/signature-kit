import { Effect } from "effect";
import { createServer } from "vite";
import { expect, it } from "vitest";

it("serves social WebP through the real Vite development server", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* Effect.acquireRelease(
          Effect.promise(() =>
            createServer({
              configFile: "apps/docs/foldkit.vite.config.ts",
              root: "apps/docs",
              server: { host: "127.0.0.1", port: 0 },
              logLevel: "silent",
            }),
          ),
          (server) =>
            Effect.promise(() => server.close()).pipe(Effect.timeout("5 seconds"), Effect.orDie),
        );
        yield* Effect.promise(() => server.listen());
        const address = server.httpServer?.address();
        if (address === null || address === undefined || typeof address === "string")
          return expect.fail("Missing development server address");
        yield* Effect.promise(async (signal) => {
          const origin = `http://127.0.0.1:${address.port}`;
          const response = await fetch(`${origin}/en-US/index.webp`, {
            signal,
            headers: { "sec-fetch-dest": "image" },
          });
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toBe("image/webp");
          const bytes = new Uint8Array(await response.arrayBuffer());
          expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
          expect(new TextDecoder().decode(bytes.subarray(8, 16))).toBe("WEBPVP8L");
          const dimensions = new DataView(bytes.buffer).getUint32(21, true);
          expect([(dimensions & 0x3fff) + 1, ((dimensions >>> 14) & 0x3fff) + 1]).toEqual([
            1200, 630,
          ]);
          const head = await fetch(`${origin}/en-US/index.webp`, { method: "HEAD", signal });
          expect(head.status).toBe(200);
          expect(await head.text()).toBe("");
          const missing = await fetch(`${origin}/en-US/blog/not-real.webp`, { signal });
          expect(missing.status).toBe(404);
          const post = await fetch(`${origin}/en-US/index.webp`, { method: "POST", signal });
          expect(post.status).toBe(405);
          expect(post.headers.get("allow")).toBe("GET, HEAD");
        });
      }),
    ).pipe(Effect.timeout("30 seconds")),
  );
}, 35000);
