import { DataCommandError } from '../data-command-types';
import { validateAndNormalizeWorkflowIr } from './workflow-ir';
import type { WorkflowIr } from './workflow-model';
import type { WorkflowOperationsV1 } from './workflow-operations';

/**
 * Deterministic Stable IR -> execution-neutral Operations JSON lowering.
 * Runtime resource binding happens here; the Stable IR never stores physical table IDs.
 */
export function lowerWorkflowIrToOperations({
  ir,
  inputTableId,
  outputTableName,
}: {
  ir: WorkflowIr;
  inputTableId: string;
  outputTableName: string;
}): WorkflowOperationsV1 {
  const normalized = validateAndNormalizeWorkflowIr(ir);
  if (!inputTableId.trim() || !outputTableName.trim()) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Workflow lowering requires input and output resource bindings'
    );
  }
  return {
    operationsVersion: '1.0',
    inputTableId,
    outputTableName,
    outputOperationId:
      normalized.outputOperationId ?? normalized.operations.at(-1)?.operationId ?? null,
    operations: normalized.operations.map((operation) => ({ ...operation })),
  };
}
