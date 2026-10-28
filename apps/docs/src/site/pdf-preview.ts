import { Context } from "effect";
import type { Effect, Scope } from "effect";
import type { PdfError, PdfSignatureBadge } from "@signature-kit/pdf/config";

export class PdfPreview extends Context.Service<
  PdfPreview,
  {
    readonly render: (
      id: string,
      pageIndex: number,
      canvas: HTMLCanvasElement,
    ) => Effect.Effect<void, PdfError, Scope.Scope>;
    readonly renderStamp: (
      badge: PdfSignatureBadge,
      canvas: HTMLCanvasElement,
    ) => Effect.Effect<void, PdfError, Scope.Scope>;
    readonly remove: (id: string) => Effect.Effect<void>;
    readonly clear: Effect.Effect<void>;
  }
>()("@signature-kit/docs/PdfPreview") {}
