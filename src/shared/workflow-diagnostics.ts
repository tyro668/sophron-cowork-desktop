/** Diagnostic shape shared by operator-config validation, workflow plans and the runtime. */
export type WorkflowDiagnosticSeverity = 'error' | 'warning';

export interface WorkflowDiagnostic {
  severity: WorkflowDiagnosticSeverity;
  message: string;
  code?: string;
  params?: Record<string, string | number>;
  line?: number;
  column?: number;
}
