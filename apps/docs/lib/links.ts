import { getLocale } from "@/paraglide/runtime";

export function localePath(path: string): string {
  const suffix = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `/${getLocale()}${suffix}`;
}
