import { OPERATOR_TYPES, type DataWorkflowOperatorType } from '../../../shared/operators';

/** Version stamp on requirement-analysis receipts; bump when AI authoring capabilities change. */
export const AI_JFLOW_RUNTIME_PROFILE_VERSION = 'jflow-runtime/r1' as const;

/** Node types an AI-generated (single-input) jflow program may compile to. */
const EXCLUDED: ReadonlySet<DataWorkflowOperatorType> = new Set(['join', 'set_op', 'sql']);

export const AI_GENERATED_WORKFLOW_NODE_TYPES: readonly DataWorkflowOperatorType[] =
  OPERATOR_TYPES.filter((type) => !EXCLUDED.has(type));

export const AI_GENERATED_WORKFLOW_NODE_TYPE_SET: ReadonlySet<DataWorkflowOperatorType> = new Set(
  AI_GENERATED_WORKFLOW_NODE_TYPES
);
