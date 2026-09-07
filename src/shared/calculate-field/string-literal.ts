export function formatCalculationStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
