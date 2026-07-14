import type {
  DataAutomationColumnSnapshot,
  DataAutomationLineageEntry,
} from '../../../renderer/types';

export type GeneratedWorkflowRequiredColumnResolver = (
  name: unknown,
  context?: string
) => GeneratedWorkflowColumnBinding;

export interface GeneratedWorkflowColumnBinding {
  name: string;
  type?: string;
  sourceColumn?: { name: string; type?: string };
  sourceColumns?: Array<{ name: string; type?: string }>;
  expression?: string;
}

export interface GeneratedWorkflowGenerationResult {
  workflowDsl: string;
  requiredColumns: DataAutomationColumnSnapshot[];
  expectedOutputSchema: DataAutomationColumnSnapshot[];
  lineage: DataAutomationLineageEntry[];
}
