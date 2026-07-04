import * as React from "react";

export const usePdfObjectUrl = (bytes: Uint8Array | null): string | null => {
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (bytes === null) {
      setUrl(null);
      return undefined;
    }
    // This hook is client-only; missing URL/Blob in the effect means the host
    // runtime lacks required browser PDF primitives and should fail loudly.
    const pdfBytes = new Uint8Array(bytes.byteLength);
    pdfBytes.set(bytes);
    const nextUrl = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
    setUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [bytes]);

  return url;
};
