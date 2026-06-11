import type { PrepDiagnostic } from '../../shared/prep-dsl';

/** Delimiter unlikely to appear in diagnostic fields (SOH control char). */
const SIG_DELIMITER = String.fromCharCode(1);

export function arePrepDiagnosticsEqual(
  left: readonly PrepDiagnostic[],
  right: readonly PrepDiagnostic[]
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (diagnosticSignature(left[index]) !== diagnosticSignature(right[index])) {
      return false;
    }
  }
  return true;
}

function diagnosticSignature(diagnostic: PrepDiagnostic): string {
  return [
    diagnostic.severity,
    diagnostic.code ?? '',
    diagnostic.message,
    diagnostic.line ?? '',
    diagnostic.column ?? '',
    serializeParams(diagnostic.params),
  ].join(SIG_DELIMITER);
}

function serializeParams(params: PrepDiagnostic['params']): string {
  if (!params) return '';
  return Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${String(value)}`)
    .join('|');
}
