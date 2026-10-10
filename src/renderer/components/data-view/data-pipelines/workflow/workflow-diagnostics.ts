import type { PrepDiagnostic } from '../../../../../shared/prep-dsl';

export function formatPrepDiagnosticForUi(
  diagnostic: PrepDiagnostic,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (!diagnostic.code) {
    return diagnostic.message;
  }
  return t(`data.workflow.dslDiagnostics.${diagnostic.code}`, {
    defaultValue: diagnostic.message,
    ...(diagnostic.params ?? {}),
  });
}
