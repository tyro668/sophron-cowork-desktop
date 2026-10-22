import type { WorkflowDiagnostic } from '../../../../../shared/workflow-diagnostics';

export function formatWorkflowDiagnosticForUi(
  diagnostic: WorkflowDiagnostic,
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
