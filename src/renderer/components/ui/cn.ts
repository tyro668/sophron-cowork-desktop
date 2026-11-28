import { extendTailwindMerge, type ClassNameValue } from 'tailwind-merge';

// Register custom fontSize and boxShadow tokens from tailwind.config.js so
// tailwind-merge classifies `text-ui-*` as font-size (not text-color) and
// does not strip them when paired with `text-text-primary` / `text-accent`.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['ui-body', 'ui-label', 'ui-control', 'ui-caption'] }],
      shadow: [{ shadow: ['soft', 'card', 'elevated'] }],
    },
  },
});

/**
 * Merge conditional class names with tailwind-merge so caller overrides win
 * on conflicts (e.g. a caller's `w-32` replaces the component's `w-full`).
 */
export function cn(...inputs: ClassNameValue[]): string {
  return twMerge(...inputs);
}
