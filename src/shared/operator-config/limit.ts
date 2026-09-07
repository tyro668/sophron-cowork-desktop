export function parseNonNegativeInteger(value: string): number | undefined {
  if (value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.max(0, Math.floor(number));
}

export function parsePositiveInteger(value: string): number | undefined {
  const number = parseNonNegativeInteger(value);
  return number === undefined ? undefined : Math.max(1, number);
}
