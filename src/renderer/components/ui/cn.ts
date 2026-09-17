import { twMerge, type ClassNameValue } from 'tailwind-merge';

/**
 * Merge conditional class names with tailwind-merge so caller overrides win
 * on conflicts (e.g. a caller's `w-32` replaces the component's `w-full`).
 */
export function cn(...inputs: ClassNameValue[]): string {
  return twMerge(...inputs);
}
