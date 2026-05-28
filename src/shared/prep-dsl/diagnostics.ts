import type { PrepDiagnostic } from './ast';

export function createPrepDiagnostic(
  code: string,
  fallback: string,
  params?: Record<string, string | number>,
  location?: { line?: number; column?: number }
): PrepDiagnostic {
  return {
    severity: 'error',
    code,
    message: fallback,
    params,
    line: location?.line,
    column: location?.column,
  };
}

