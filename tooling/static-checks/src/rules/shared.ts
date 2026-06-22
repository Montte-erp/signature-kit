import { adapterOrPackagePathPrefixes, fiscalCorePrefix } from "../config";

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const isAdapterOrPackageFile = (path: string): boolean => {
  return adapterOrPackagePathPrefixes.some((prefix) => path.startsWith(prefix));
};

export const isFiscalCoreFile = (path: string): boolean => path.startsWith(fiscalCorePrefix);

export const isTaggedErrorName = (name: string): boolean => {
  const raw = name.replace(/\s*<[\s\S]*$/, "");
  return /(^|\.)(?:TaggedError|TaggedErrorClass)$/.test(raw);
};

export const isCatalogFile = (path: string): boolean =>
  path.endsWith("/config.ts") ||
  path.endsWith("/manifest.ts") ||
  path.endsWith("/observability.ts") ||
  path.endsWith("/schemas.ts");
