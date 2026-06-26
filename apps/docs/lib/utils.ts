import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names: clsx for conditional composition, tailwind-merge to
 * resolve conflicting Tailwind utilities. The standard shadcn `cn`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
