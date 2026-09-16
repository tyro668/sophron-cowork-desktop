import { getOperatorConfigValidation, validateOperatorConfig } from '../operator-schemas';
import {
  WORKFLOW_PLAN_VERSION,
  type WorkflowPlan,
  type WorkflowPlanDiagnostic,
  type WorkflowPlanInput,
  type WorkflowPlanNode,
} from './model';

/**
 * Normalize workflow nodes+edges into the versioned, strongly-typed plan.
 * Each operator config is parsed through its zod schema so the resulting
 * `plan.nodes[].config` is the canonical typed config (defaults applied,
 * transforms resolved). Nodes whose config fails validation keep the raw
 * record — diagnostics report them — so later checks still run.
 */
export function buildWorkflowPlan(
  input: WorkflowPlanInput,
  options: { includeConfigDiagnostics?: boolean } = {}
): {
  plan: WorkflowPlan;
  diagnostics: WorkflowPlanDiagnostic[];
} {
  const diagnostics: WorkflowPlanDiagnostic[] = [];
  const nodes = input.nodes.map((node) => {
    const rawConfig = node.config ?? {};
    const parsed = getOperatorConfigValidation(node.type, rawConfig);
    const config = parsed.success ? parsed.data : rawConfig;
    // Disabled nodes pass through at runtime; incomplete configs on them are
    // drafts, not errors.
    const disabled = rawConfig.disabled === true;
    if (options.includeConfigDiagnostics !== false && !disabled) {
      for (const diagnostic of validateOperatorConfig(node.type, rawConfig)) {
        diagnostics.push({ ...diagnostic, nodeId: node.id, nodeType: node.type });
      }
    }
    return {
      id: node.id,
      type: node.type,
      label: node.label,
      config,
      x: node.x,
      y: node.y,
    } as WorkflowPlanNode;
  });
  return {
    plan: {
      version: WORKFLOW_PLAN_VERSION,
      nodes,
      edges: input.edges.map((edge) => ({ ...edge })),
    },
    diagnostics,
  };
}
