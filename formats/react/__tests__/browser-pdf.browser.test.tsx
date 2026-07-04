import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePdfObjectUrl } from "@signature-kit/react/browser-pdf";

const rafTick = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

async function waitFor(predicate: () => boolean, label: string, maxFrames = 300): Promise<void> {
  for (let i = 0; i < maxFrames && !predicate(); i++) {
    await rafTick();
  }

  expect(predicate(), label).toBe(true);
}

const createPdf = async (label: string): Promise<Uint8Array> => {
  const source = [
    "%PDF-1.4",
    "%\xE2\xE3\xCF\xD3",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 320 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj`,
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "5 0 obj << /Length 30 >> stream",
    `BT /F1 14 Tf 24 120 Td (${label}) Tj ET`,
    "endstream",
    "endobj",
    "xref",
    "0 6",
    "0000000000 65535 f ",
    "0000000009 00000 n ",
    "0000000079 00000 n ",
    "0000000148 00000 n ",
    "0000000212 00000 n ",
    "0000000303 00000 n ",
    "trailer << /Size 6 /Root 1 0 R >>",
    "startxref",
    "0",
    "%%EOF",
  ];
  return Promise.resolve(new TextEncoder().encode(source.join("\n")));
};

describe("usePdfObjectUrl lifecycle", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  const mount = (ui: React.ReactElement) => {
    if (container === null) {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    }

    root?.render(ui);
  };

  const cleanup = () => {
    if (root !== null) {
      root.unmount();
      root = null;
    }

    if (container !== null) {
      container.remove();
      container = null;
    }
  };

  it("creates object URL and revokes it when bytes are replaced and cleared", async () => {
    const createObjectUrlSpy = vi.spyOn(URL, "createObjectURL");
    const revokeObjectUrlSpy = vi.spyOn(URL, "revokeObjectURL");
    const observedUrls: Array<string | null> = [];

    function Harness({ bytes }: { readonly bytes: Uint8Array | null }) {
      const url = usePdfObjectUrl(bytes);

      React.useEffect(() => {
        const last = observedUrls.at(-1);
        if (last !== url) {
          observedUrls.push(url);
        }
      }, [url]);

      return null;
    }

    mount(<Harness bytes={await createPdf("first")} />);
    await waitFor(() => observedUrls.some((value) => value !== null), "initial object URL");

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    const firstUrl = observedUrls.at(-1);
    expect(firstUrl).toBeTypeOf("string");

    mount(<Harness bytes={await createPdf("second")} />);
    await waitFor(() => observedUrls.at(-1) !== firstUrl, "replaced object URL");
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith(firstUrl);

    const secondUrl = observedUrls.at(-1);
    expect(typeof secondUrl).toBe("string");

    mount(<Harness bytes={null} />);
    await waitFor(() => observedUrls.at(-1) === null, "cleared object URL");
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith(secondUrl);
  });
});
