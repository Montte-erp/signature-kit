import { Effect } from "effect";
import { CryptoError, CryptoErrorCodeValue, CryptoOperationValue } from "./config";
import { base64ToBytes, bytesToBase64 } from "./base64";

export const pemToDer = (pem: string): Effect.Effect<Uint8Array, CryptoError> => {
  const base64 = pem
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("-----"))
    .join("");
  if (base64.length === 0) {
    return Effect.fail(
      new CryptoError({
        code: CryptoErrorCodeValue.invalidFormat,
        reason: "PEM input does not contain base64 DER content.",
        operation: CryptoOperationValue.pemDecode,
      }),
    );
  }
  return base64ToBytes(base64);
};

export const derToPem = (der: Uint8Array, label: string): string => {
  const base64 = bytesToBase64(der);
  const lines: string[] = [];
  lines.push(`-----BEGIN ${label}-----`);
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.slice(i, i + 64));
  }
  lines.push(`-----END ${label}-----`);
  return lines.join("\n");
};
