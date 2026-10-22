import {
  getJflowQuickReference,
  getJflowReference,
  type JflowReferenceTopic,
} from '../../shared/jflow';

export type DataDslReferenceTopic = JflowReferenceTopic;

const TOOL_USAGE =
  'Apply a program with data_apply_workflow_dsl (run dryRun: true first and fix every diagnostic); read the current program with data_export_workflow_dsl.';

export function getWorkflowDslReference(topic: DataDslReferenceTopic = 'all'): string {
  return `${getJflowReference(topic)}\n\n${TOOL_USAGE}`;
}

export function getWorkflowDslQuickReference(): string {
  return getJflowQuickReference();
}
