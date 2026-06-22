import { base64ToBytes, bytesToBase64 } from "./base64";

export const pemToDer = (pem: string): Uint8Array =>
  base64ToBytes(
    pem
      .split(/\r?\n/)
      .filter((line) => !line.startsWith("-----"))
      .join(""),
  );

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
