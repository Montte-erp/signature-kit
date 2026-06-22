import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkedExtensions, skippedSegments, skippedSuffixes } from "./config";

export const hasCheckedExtension = (path: string): boolean => {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && checkedExtensions.has(path.slice(dot));
};

export const shouldSkip = (path: string): boolean => {
  const parts = path.split("/");
  return (
    parts.some((part) => skippedSegments.has(part)) ||
    [...skippedSuffixes].some((suffix) => path.endsWith(suffix))
  );
};

export function* walk(root: string): Generator<string> {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const normalized = path.replaceAll("\\", "/");

    if (shouldSkip(normalized)) continue;

    const stats = statSync(normalized);
    if (stats.isDirectory()) {
      yield* walk(path);
    } else if (stats.isFile() && hasCheckedExtension(normalized)) {
      yield normalized;
    }
  }
}
