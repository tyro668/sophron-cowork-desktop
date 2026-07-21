import type { DataAutomationColumnSnapshot } from '../../../renderer/types';
import { DataCommandError } from '../data-command-types';
import { compileGeneratedWorkflowIr, type GeneratedDataTaskWorkflow } from './operation-compiler';
import type { WorkflowIr, WorkflowOperationIr } from './workflow-model';

/** Stable lowering output before it is exported to the textual Prep DSL. */
export interface WorkflowOperationsV1 {
  operationsVersion: '1.0';
  inputTableId: string;
  outputTableName: string;
  outputOperationId: string | null;
  operations: WorkflowOperationIr[];
}

export function validateWorkflowOperations(value: WorkflowOperationsV1): WorkflowOperationsV1 {
  if (value.operationsVersion !== '1.0') {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Unsupported workflow operations version: ${String(value.operationsVersion)}`
    );
  }
  if (!value.inputTableId.trim()) {
    throw new DataCommandError('VALIDATION_FAILED', 'Workflow operations require inputTableId');
  }
  if (!value.outputTableName.trim()) {
    throw new DataCommandError('VALIDATION_FAILED', 'Workflow operations require outputTableName');
  }
  return value;
}

export function exportWorkflowOperationsToPrepDsl({
  workflow,
  sourceIr,
  requirement,
  columns,
}: {
  workflow: WorkflowOperationsV1;
  sourceIr: WorkflowIr;
  requirement: string;
  columns: DataAutomationColumnSnapshot[];
}): GeneratedDataTaskWorkflow {
  validateWorkflowOperations(workflow);
  return compileGeneratedWorkflowIr({
    ir: {
      ...sourceIr,
      outputOperationId: workflow.outputOperationId,
      operations: workflow.operations,
    },
    inputTableId: workflow.inputTableId,
    outputTableName: workflow.outputTableName,
    requirement,
    columns,
  });
}
