export type PermissionRuleAction = 'allow' | 'deny' | 'ask';

export interface PermissionRule {
  tool: string;
  pattern?: string;
  action: PermissionRuleAction;
}

export const PERMISSION_POLICY_IDS = ['default', 'auto_review', 'full_access'] as const;
export type PermissionPolicyId = (typeof PERMISSION_POLICY_IDS)[number];

export const DEFAULT_PERMISSION_POLICY: PermissionPolicyId = 'auto_review';

export function isPermissionPolicy(value: unknown): value is PermissionPolicyId {
  return PERMISSION_POLICY_IDS.some((policy) => policy === value);
}

export const DEFAULT_PERMISSION_RULES: PermissionRule[] = [
  { tool: 'askuserquestion', action: 'allow' },
  { tool: 'todoread', action: 'allow' },
  { tool: 'todowrite', action: 'allow' },
  { tool: 'webfetch', action: 'allow' },
  { tool: 'websearch', action: 'allow' },
  { tool: 'read', action: 'allow' },
  { tool: 'glob', action: 'allow' },
  { tool: 'grep', action: 'allow' },
  { tool: 'ls', action: 'allow' },
  { tool: 'list_directory', action: 'allow' },
  { tool: 'find', action: 'allow' },
  { tool: 'data_get_workflow_dsl_reference', action: 'allow' },
  { tool: 'data_list_input_tables', action: 'allow' },
  { tool: 'capabilities_search', action: 'allow' },
  { tool: 'tool_result_read', action: 'allow' },
  { tool: 'data_list_output_tables', action: 'allow' },
  { tool: 'data_list_tasks', action: 'allow' },
  { tool: 'data_analyze_task_requirement', action: 'allow' },
  { tool: 'data_list_cloud_spaces', action: 'allow' },
  { tool: 'data_list_cloud_projects', action: 'allow' },
  { tool: 'data_list_cloud_tables', action: 'allow' },
  { tool: 'data_preview_table', action: 'allow' },
  { tool: 'data_get_task_workflow', action: 'allow' },
  { tool: 'data_export_workflow_dsl', action: 'allow' },
  { tool: 'data_get_run_result', action: 'allow' },
  { tool: 'automation_list', action: 'allow' },
  { tool: 'automation_prepare', action: 'allow' },
  { tool: 'automation_create', action: 'ask' },
  { tool: 'automation_prepare_schedule_update', action: 'allow' },
  { tool: 'automation_update_schedule', action: 'ask' },
  { tool: 'data_generate_task_from_requirement', action: 'ask' },
  { tool: 'write', action: 'ask' },
  { tool: 'edit', action: 'ask' },
  { tool: 'bash', action: 'ask' },
];

export const AUTO_REVIEW_PERMISSION_RULES: PermissionRule[] = [
  // Review every call, including ordinary writes and commands. Explicit
  // user-defined rules can still precede this risk-based fallback.
  { tool: '*', action: 'ask' },
];

export const FULL_ACCESS_PERMISSION_RULES: PermissionRule[] = [{ tool: '*', action: 'allow' }];

export function normalizePermissionPolicy(value: unknown): PermissionPolicyId {
  return isPermissionPolicy(value) ? value : DEFAULT_PERMISSION_POLICY;
}

export function getPermissionRulesForPolicy(policy: PermissionPolicyId): PermissionRule[] {
  const rules =
    policy === 'full_access'
      ? FULL_ACCESS_PERMISSION_RULES
      : policy === 'auto_review'
        ? AUTO_REVIEW_PERMISSION_RULES
        : DEFAULT_PERMISSION_RULES;

  return rules.map((rule) => ({ ...rule }));
}
