export type ClassValue = string | false | null | undefined;

/** Join conditional class names. Keeps primitives' base styles overridable by callers. */
export function cn(...inputs: ClassValue[]): string {
  return inputs.filter(Boolean).join(' ');
}
