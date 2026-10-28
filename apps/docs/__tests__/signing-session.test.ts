import { PDFDocument } from "@cantoo/pdf-lib";
import { Effect, Option, Redacted, Result } from "effect";
import { describe, expect, it } from "@effect/vitest";

import { TestClock } from "effect/testing";
import { parseCertificate } from "@signature-kit/certificates";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { verifyPdfSignatures } from "@signature-kit/pdf/verify";
import { readA1Fixture } from "../../../tooling/testing/fixtures.ts";

import { SigningSession, signingSessionLayer } from "../src/site/signing-session.ts";

describe("browser signing session", () => {
  it("owns real PDF bytes while returning document metadata and isolates separate sessions", async () => {
    const file = await PDFDocument.create();
    file.addPage([600, 800]);
    file.addPage([400, 500]);
    const source = new Blob([new Uint8Array(await file.save())], { type: "application/pdf" });
    const document = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* SigningSession;
          const pfx = yield* readA1Fixture("ecpf");
          yield* session.setCertificate(Redacted.make(pfx));
          const added = yield* session.addDocument(source, "agreement.pdf");
          expect(added.name).toBe("agreement.pdf");
          expect(added.pages).toHaveLength(2);
          expect(added.pages[0]?.width).toBe(600);
          expect(Object.keys(added).sort()).toEqual(["id", "name", "pages", "signed"]);
          expect(yield* session.documents).toEqual([added]);
          return {
            document: added,
            readDocuments: session.documents,
            readCertificate: session.certificate,
          };
        }).pipe(Effect.provide(signingSessionLayer)),
      ),
    );
    expect(await Effect.runPromise(document.readDocuments)).toEqual([]);
    expect(Option.isNone(await Effect.runPromise(document.readCertificate))).toBe(true);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* SigningSession;
          expect(yield* session.documents).toEqual([]);
          const added = yield* session.addDocument(source, "second.pdf");
          expect(added.id).not.toBe(document.document.id);
          yield* session.removeDocument(added.id);
          expect(yield* session.documents).toEqual([]);
        }).pipe(Effect.provide(signingSessionLayer)),
      ),
    );
  });
  it("places and moves the signature through the PDF builder and preserves a valid placement after failure", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([600, 800]);
    pdf.addPage([400, 500]);
    const file = new Blob([new Uint8Array(await pdf.save())]);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* SigningSession;
          const added = yield* session.addDocument(file, "placement.pdf");
          const placed = yield* session.placeDocument(added.id, { pageIndex: 1, x: 40, y: 60 });
          expect(placed.rect).toEqual({ pageIndex: 1, x: 40, y: 60, width: 320, height: 128 });
          const moved = yield* session.placeDocument(added.id, { pageIndex: 0, x: 80, y: 200 });
          expect(moved.rect).toEqual({ pageIndex: 0, x: 80, y: 200, width: 320, height: 128 });
          const clamped = yield* session.placeDocument(added.id, { pageIndex: 1, x: 390, y: 490 });
          expect(clamped.rect).toEqual({ pageIndex: 1, x: 80, y: 372, width: 320, height: 128 });
          const failed = yield* session
            .placeDocument(added.id, { pageIndex: 99, x: 0, y: 0 })
            .pipe(Effect.result);
          expect(Result.isFailure(failed)).toBe(true);
          expect(yield* session.documents).toEqual([clamped]);
        }).pipe(Effect.provide(signingSessionLayer)),
      ),
    );
  });

  it.effect("signs a placed document with real A1 and exports a cryptographically valid PDF", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* SigningSession;
        const pdf = yield* Effect.promise(() => PDFDocument.create());
        pdf.addPage([600, 800]);
        const bytes = yield* Effect.promise(() => pdf.save());
        const document = yield* session.addDocument(
          new Blob([new Uint8Array(bytes)]),
          "contract.pdf",
        );
        yield* session.placeDocument(document.id, { pageIndex: 0, x: 60, y: 600 });
        const pfx = yield* readA1Fixture("ecpf");
        const password = Redacted.make("changeit");
        const certificate = yield* parseCertificate(pfx, password);
        yield* TestClock.setTime(certificate.validity.notBefore.getTime() + 1000);
        const signed = yield* session
          .signDocument(document.id, { policy: "pades-ades" })
          .pipe(Effect.provide(a1SignaturesLayer({ pfx, password })));
        expect(signed.signed).toBe(true);
        const artifact = yield* session.exportDocument(document.id);
        const signedPdf = new Uint8Array(yield* Effect.promise(() => artifact.arrayBuffer()));
        const verification = yield* verifyPdfSignatures({ pdf: signedPdf });
        expect(verification).toHaveLength(1);
        expect(verification[0]?.valid).toBe(true);
        yield* session.placeDocument(document.id, { pageIndex: 0, x: 80, y: 600 });
        expect((yield* session.documents)[0]?.signed).toBe(false);
        const stale = yield* session.exportDocument(document.id).pipe(Effect.result);
        expect(Result.isFailure(stale)).toBe(true);
        yield* session.setCertificate(Redacted.make(pfx));
        expect(Option.isSome(yield* session.certificate)).toBe(true);
        yield* session.clear;
        expect(Option.isNone(yield* session.certificate)).toBe(true);
        expect(yield* session.documents).toEqual([]);
      }).pipe(Effect.provide(signingSessionLayer)),
    ),
  );
});
