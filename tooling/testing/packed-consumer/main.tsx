import * as React from "react";
import { createRoot } from "react-dom/client";
import { Schema } from "effect";
import { useA1Certificate, useA1Signer, disposeA1Session } from "@signature-kit/react/a1";

const Input = Schema.Union([
  Schema.Struct({
    action: Schema.Literals(["input"]),
    pfx: Schema.Uint8Array,
    pdf: Schema.Uint8Array,
    pin: Schema.String,
  }),
  Schema.Struct({ action: Schema.Literals(["sign"]) }),
  Schema.Struct({ action: Schema.Literals(["dispose"]) }),
]);

function App() {
  const certificate = useA1Certificate();
  const signer = useA1Signer();
  const [result, setResult] = React.useState("ready");
  const pfx = React.useRef<Uint8Array>(new Uint8Array());
  const pdf = React.useRef<Uint8Array>(new Uint8Array());
  const password = React.useRef("");
  React.useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || !Schema.is(Input)(event.data)) return;
      if (event.data.action === "input") {
        pfx.current = new Uint8Array(event.data.pfx);
        pdf.current = new Uint8Array(event.data.pdf);
        password.current = event.data.pin;
        document.getElementById("load")?.click();
      } else if (event.data.action === "sign") {
        document.getElementById("sign")?.click();
      } else if (event.data.action === "dispose") {
        void disposeA1Session().then((outcomes) => {
          window.parent.postMessage({ action: "disposed", outcomes }, "*");
        });
      }
    };
    window.addEventListener("message", receive);
    window.parent.postMessage({ action: "ready" }, "*");
    return () => {
      window.removeEventListener("message", receive);
      void disposeA1Session();
    };
  }, []);
  return (
    <main>
      <output>{result}</output>
      <button
        id="load"
        onClick={() =>
          void certificate.load(pfx.current, password.current).then((outcome) => {
            setResult(outcome.ok === true ? "loaded" : outcome.error.code);
            window.parent.postMessage(
              outcome.ok === true
                ? { action: "loaded" }
                : {
                    action: "error",
                    tag: outcome.error._tag,
                    code: outcome.error.code,
                    message: outcome.error.message,
                  },
              "*",
            );
          })
        }
      >
        Load
      </button>
      <button
        id="sign"
        onClick={() =>
          void signer
            .sign({
              documents: [
                {
                  id: "pdf",
                  pdf: pdf.current,
                  anchors: {
                    matchers: [{ text: "Signature anchor" }],
                    stampSize: { width: 180, height: 54 },
                  },
                },
              ],
              signing: {},
            })
            .then(async (outcome) => {
              const row = outcome.ok === true ? outcome.rows[0] : undefined;
              if (row?.status !== "signed") {
                setResult("failed");
                window.parent.postMessage(
                  { action: "failed", detail: JSON.stringify(outcome) },
                  "*",
                );
                return;
              }
              const url = URL.createObjectURL(
                new Blob([new Uint8Array(row.signedPdf)], { type: "application/pdf" }),
              );
              await fetch(url, { signal: AbortSignal.timeout(10000) })
                .then((response) => response.arrayBuffer())
                .then((buffer) => {
                  window.parent.postMessage({ action: "signed", pdf: new Uint8Array(buffer) }, "*");
                  setResult("signed");
                })
                .catch(() => {
                  window.parent.postMessage(
                    { action: "failed", detail: "Reading signed PDF Blob failed" },
                    "*",
                  );
                })
                .finally(() => {
                  URL.revokeObjectURL(url);
                });
            })
        }
      >
        Sign
      </button>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
