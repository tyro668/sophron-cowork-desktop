export function parseNonNegativeInteger(value: string): number | undefined {
  if (value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.max(0, Math.floor(number));
}
