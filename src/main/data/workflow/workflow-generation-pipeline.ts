import type { DataAutomationColumnSnapshot } from '../../../renderer/types';
import {
  assertAtomicWorkflowHelpers,
  compileWorkflowJavaScript,
  executeWorkflowJavaScriptInSandbox,
} from './javascript-runtime';
import { lowerWorkflowIrToOperations } from './workflow-lowering';
import { exportWorkflowOperationsToPrepDsl } from './workflow-operations';
import type { GeneratedDataTaskWorkflow } from './operation-compiler';
import { computeWorkflowIrSemanticHash } from './workflow-ir';
import { DataCommandError } from '../data-command-types';

export function compileGeneratedJavaScriptWorkflow({
  javascriptSource,
  inputTableId,
  outputTableName,
  requirement,
  columns,
}: {
  javascriptSource: string;
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: DataAutomationColumnSnapshot[];
}): GeneratedDataTaskWorkflow {
  const compiled = compileWorkflowJavaScript(javascriptSource);
  const ir = executeWorkflowJavaScriptInSandbox({ compiled, inputTableId, outputTableName });
  const verificationIr = executeWorkflowJavaScriptInSandbox({
    compiled,
    inputTableId,
    outputTableName,
  });
  const semanticHash = computeWorkflowIrSemanticHash(ir);
  if (semanticHash !== computeWorkflowIrSemanticHash(verificationIr)) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow JavaScript produced non-deterministic Workflow IR',
      {
        diagnostics: [
          {
            severity: 'error',
            code: 'NON_DETERMINISTIC_WORKFLOW_BUILD',
            message: 'The same JavaScript source produced different Workflow IR results',
          },
        ],
      }
    );
  }
  assertAtomicWorkflowHelpers(ir);
  const operations = lowerWorkflowIrToOperations({ ir, inputTableId, outputTableName });
  return {
    ...exportWorkflowOperationsToPrepDsl({
      workflow: operations,
      sourceIr: ir,
      requirement,
      columns,
    }),
    javascriptSource,
    workflowIr: ir,
    workflowIrSemanticHash: semanticHash,
  };
}
