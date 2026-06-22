import { twMerge } from "tailwind-merge";

type ClassValue = string | false | null | undefined;

export function cn(...classes: ReadonlyArray<ClassValue>) {
  return twMerge(classes.filter(Boolean).join(" "));
}
