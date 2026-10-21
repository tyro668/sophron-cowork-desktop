import type { AgentToolPack } from '../extensions/agent-runtime-extension';

/**
 * Data tool catalog split into intent-scoped packs. Everything stays
 * registered in the session; only activated packs are exposed to the model.
 * Business generation and expert editing are separate;
 * the rest activate on keyword/resource signals or via `capabilities_search`.
 */
export const DATA_TOOL_PACKS = {
  'data.core': {
    description:
      'List/preview data resources, read pipeline workflows, run pipelines, read run results',
    tools: [
      'data_list_raw_tables',
      'data_list_result_tables',
      'data_list_pipelines',
      'data_preview_table',
      'data_get_pipeline_workflow',
      'data_run_pipeline',
      'data_get_run_result',
    ],
  },
  'data.tables': {
    description:
      'Create/update input and output tables from local files or folders, inspect source files',
    tools: [
      'data_create_raw_table',
      'data_create_raw_table_with_processing_strategy',
      'data_update_raw_table',
      'data_summarize_raw_table_source',
      'data_create_result_table',
      'data_update_result_table',
    ],
  },
  'data.normalizer': {
    description: 'Step-by-step raw-table normalizer drafts, version preview and publish',
    tools: [
      'data_generate_raw_table_normalizer_draft',
      'data_preview_raw_table_normalizer_version',
      'data_publish_raw_table_normalizer_version',
      'data_list_raw_table_normalizer_versions',
    ],
  },
  'data.cloud': {
    description: 'Personal-analysis cloud spaces/projects/tables, cloud import and upload',
    tools: [
      'data_list_cloud_spaces',
      'data_list_cloud_projects',
      'data_list_cloud_tables',
      'data_import_cloud_table',
      'data_upload_table_to_cloud',
    ],
  },
  'data.run': {
    description: 'Resolve and run an existing data pipeline',
    tools: ['data_list_pipelines', 'data_run_pipeline'],
  },
  'data.generate': {
    description: 'Analyze requirements and generate a data pipeline after confirmation',
    tools: [
      'data_list_raw_tables',
      'data_list_result_tables',
      'data_get_pipeline_workflow',
      'data_analyze_pipeline_requirement',
      'data_generate_pipeline_from_requirement',
    ],
  },
  'data.authoring': {
    description:
      'Expert workflow editing: pipeline update, capability manifest, constrained plan/DSL apply, per-operator config, DSL export/reference',
    tools: [
      'data_create_pipeline',
      'data_update_pipeline',
      'data_get_workflow_capability_manifest',
      'data_apply_workflow_plan',
      'data_apply_workflow_dsl',
      'data_apply_operator_dsl',
      'data_export_workflow_dsl',
      'data_get_workflow_dsl_reference',
      'data_configure_input_operator',
      'data_configure_output_operator',
    ],
  },
} as const satisfies Record<string, AgentToolPack>;

export const AUTOMATION_TOOL_PACKS = {
  'automation.core': {
    description: 'List automations, enable or disable them',
    tools: ['automation_list', 'automation_set_enabled'],
  },
  'automation.create': {
    description: 'Prepare and create a new scheduled automation',
    tools: ['automation_prepare', 'automation_create'],
  },
  'automation.update': {
    description: 'Prepare and apply a schedule change to an existing automation',
    tools: ['automation_prepare_schedule_update', 'automation_update_schedule'],
  },
} as const satisfies Record<string, AgentToolPack>;
