import { verifyPdfSignatures } from "@signature-kit/pdf/verify";
import { SignatureKitErrorCodeValue } from "@signature-kit/signatures";
import { Effect, Fiber, Schema } from "effect";
import { expect, inject, it } from "vitest";

const Receipt = Schema.Union([
  Schema.Struct({ action: Schema.Literals(["ready"]) }),
  Schema.Struct({ action: Schema.Literals(["loaded"]) }),
  Schema.Struct({
    action: Schema.Literals(["error"]),
    tag: Schema.String,
    code: Schema.String,
    message: Schema.String,
  }),
  Schema.Struct({ action: Schema.Literals(["failed"]), detail: Schema.String }),
  Schema.Struct({ action: Schema.Literals(["signed"]), pdf: Schema.Uint8Array }),
  Schema.Struct({ action: Schema.Literals(["disposed"]), outcomes: Schema.Array(Schema.Boolean) }),
]);
type Receipt = typeof Receipt.Type;

it("loads packed workers, retries a bad password, and signs a PDF", async () => {
  const origin = inject("packedConsumerOrigin");
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const frame = yield* Effect.acquireRelease(
          Effect.sync(() => document.createElement("iframe")),
          (element) => Effect.sync(() => element.remove()),
        );
        const wait = (action: Receipt["action"]) =>
          Effect.callback<Receipt>((resume) => {
            const receive = (event: MessageEvent<unknown>) => {
              if (
                event.origin !== origin ||
                event.source !== frame.contentWindow ||
                !Schema.is(Receipt)(event.data)
              )
                return;
              const receipt = event.data;
              if (receipt.action === "failed" || receipt.action === action) {
                window.removeEventListener("message", receive);
                if (receipt.action === "failed") resume(Effect.die(receipt.detail));
                else resume(Effect.succeed(receipt));
              }
            };
            window.addEventListener("message", receive);
            return Effect.sync(() => window.removeEventListener("message", receive));
          }).pipe(Effect.timeout("30 seconds"));
        const ready = yield* Effect.forkChild(wait("ready"));
        yield* Effect.yieldNow;
        frame.src = origin;
        document.body.append(frame);
        yield* Fiber.join(ready);
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.gen(function* () {
            const pending = yield* Effect.forkChild(wait("disposed"));
            yield* Effect.yieldNow;
            frame.contentWindow?.postMessage({ action: "dispose" }, origin);
            yield* Fiber.join(pending).pipe(Effect.timeout("5 seconds"), Effect.orDie);
          }),
        );
        const pfx = yield* Effect.promise(async () => {
          const response = await fetch(`${origin}/ecpf.p12`, {
            signal: AbortSignal.timeout(10000),
          });
          return new Uint8Array(await response.arrayBuffer());
        });
        const objects = [
          "<< /Type /Catalog /Pages 2 0 R >>",
          "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
          "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
          "<< /Length 49 >>\nstream\nBT /F1 18 Tf 100 500 Td (Signature anchor) Tj ET\nendstream",
        ];
        let source = "%PDF-1.4\n";
        const offsets = [0];
        for (const [index, object] of objects.entries()) {
          offsets.push(source.length);
          source += `${index + 1} 0 obj\n${object}\nendobj\n`;
        }
        const xref = source.length;
        source += `xref\n0 6\n0000000000 65535 f \n${offsets
          .slice(1)
          .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
          .join("")}trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
        const pdf = new TextEncoder().encode(source);
        const errorReceipt = yield* Effect.forkChild(wait("error"));
        yield* Effect.yieldNow;
        frame.contentWindow?.postMessage(
          { action: "input", pfx, pdf, pin: "wrong-password" },
          origin,
        );
        const error = yield* Fiber.join(errorReceipt);
        expect(error).toMatchObject({
          tag: "SignatureKitError",
          code: SignatureKitErrorCodeValue.wrongPassword,
          message: "Wrong certificate password.",
        });
        const loaded = yield* Effect.forkChild(wait("loaded"));
        yield* Effect.yieldNow;
        frame.contentWindow?.postMessage({ action: "input", pfx, pdf, pin: "changeit" }, origin);
        yield* Fiber.join(loaded);
        const signing = yield* Effect.forkChild(wait("signed"));
        yield* Effect.yieldNow;
        frame.contentWindow?.postMessage({ action: "sign" }, origin);
        const signed = yield* Fiber.join(signing);
        if (signed.action !== "signed") return yield* Effect.die("Expected signed receipt");
        expect(signed.pdf).toBeInstanceOf(Uint8Array);
        const verified = yield* verifyPdfSignatures({ pdf: signed.pdf });
        expect(verified.map((item) => item.cryptographicValid)).toEqual([true]);
        expect(verified.map((item) => item.coverageValid)).toEqual([true]);
        const requests = yield* Effect.promise(async () => {
          const response = await fetch(`${origin}/__requests`, {
            signal: AbortSignal.timeout(10000),
          });
          return response.json();
        });
        const paths = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.String))(requests);
        expect(paths.some((path) => path.includes("a1.browser.worker"))).toBe(true);
        expect(paths.some((path) => path.includes("liteparse-browser.worker"))).toBe(true);
        const disposing = yield* Effect.forkChild(wait("disposed"));
        yield* Effect.yieldNow;
        frame.contentWindow?.postMessage({ action: "dispose" }, origin);
        const disposed = yield* Fiber.join(disposing);
        expect(disposed).toMatchObject({ action: "disposed", outcomes: [true] });
      }),
    ),
  );
}, 120000);
