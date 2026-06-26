import type { DataToolPromptContext } from './data-tool-types';
import { getWorkflowDslQuickReference } from './data-dsl-reference';

export function buildDataToolPrompt(context: DataToolPromptContext): string {
  return [
    '<data_processing_tools>',
    buildRoutingSection(),
    buildCurrentContextSection(context),
    buildToolGuideSection(),
    buildDslReferenceSection(),
    buildWorkflowRecipesSection(),
    '</data_processing_tools>',
  ].join('\n\n');
}

function buildRoutingSection(): string {
  return [
    'You have access to data_* tools for local data processing.',
    'Use data_* tools only when the user wants to create, manage, save, run, or modify a fixed reusable data-processing workflow.',
    'Do not automatically create a data task for one-off exploration, casual analysis, simple questions, or requests that explicitly ask you to use Python.',
    'If the user has not asked for a fixed/reusable workflow, ask whether they want to save the processing as a reusable data task before using write or execute data tools.',
    'Never read the app SQLite database, DuckDB files, or raw local data files directly for data processing. Use data_* tools instead.',
    'Never write pseudo tool markup such as <tool_use>...</tool_use> in assistant text. If a data operation is needed, call the actual data_* tool.',
    'Never search or read source-tree design docs for workflow DSL syntax. Packaged apps may not include source docs. Use the embedded prompt guide or data_get_workflow_dsl_reference.',
    'Do not load entire tables into chat. Use preview tools with bounded limits.',
    'Before referencing a table, output table, or task by name, call the relevant list tool and use returned IDs. If multiple resources match, ask the user to choose.',
    'When data tools return Markdown links for input tables, output tables, or data tasks, preserve those links in your user-facing response so the user can click through to the resource.',
    'Within a fixed workflow, validate with dryRun and run with mode=temporary before persisted writes.',
    'A temporary run only validates a preview and never updates reusable output tables. Do not upload an output table to cloud after only a temporary run.',
    'Creating input tables from local files/folders, persisted runs, output overwrite, and replacing physical data must go through the normal tool permission flow.',
  ].join('\n');
}

function buildCurrentContextSection(context: DataToolPromptContext): string {
  const lines = ['Current data context:'];
  if (context.selectedDataTaskId) {
    lines.push(
      `- currentDataTask: ${context.selectedDataTaskId}${formatName(context.selectedDataTaskName)}`
    );
  }
  if (context.selectedInputTableId) {
    lines.push(
      `- currentInputTable: ${context.selectedInputTableId}${formatName(context.selectedInputTableName)}`
    );
  }
  if (context.selectedOutputTableId) {
    lines.push(
      `- currentOutputTable: ${context.selectedOutputTableId}${formatName(context.selectedOutputTableName)}`
    );
  }
  if (lines.length === 1) {
    lines.push(
      '- No current data task/table is selected. Use list tools before referencing resources by name.'
    );
  }
  if (context.workspacePath) {
    lines.push(`- workspacePath: ${context.workspacePath}`);
  }
  return lines.join('\n');
}

function buildToolGuideSection(): string {
  return [
    'Core tool guide:',
    '- DSL help: data_get_workflow_dsl_reference. Use this tool instead of reading source files such as design/prep/*.md.',
    '- Discover resources: data_list_input_tables, data_list_output_tables, data_list_tasks.',
    '- Discover personal analysis cloud/mock resources: data_list_cloud_spaces, data_list_cloud_projects, data_list_cloud_tables.',
    '- Move data between cloud/mock and cowork: use data_import_cloud_table to download a cloud table into a cowork input table; use data_upload_table_to_cloud to upload a cowork input/output table back with CREATE or REPLACE.',
    '- Create resources for fixed workflows: data_create_input_table_with_processing_strategy, data_create_input_table, data_create_output_table, data_create_task.',
    '- Prefer data_create_input_table_with_processing_strategy when creating an input table. Pass processingStrategy.strategy="auto" for normal built-in import. Pass processingStrategy.strategy="customize" and the user-provided rulePrompt for complex Excel/CSV/folder standardization before workflow DSL.',
    '- For customize processing, data_create_input_table_with_processing_strategy samples the real source with built-in Node readers, generates an executable normalizer project through the configured LLM, previews it, publishes the validated version, and imports the input table bound to that published strategy.',
    '- The lower-level normalizer tools data_summarize_input_table_source, data_generate_input_table_normalizer_draft, data_preview_input_table_normalizer_version, and data_publish_input_table_normalizer_version are for step-by-step inspection or retrying a failed generated project.',
    '- When creating a data task for a known input/output table, pass sourceInputTableId and outputTableId to data_create_task so the task, input table, and output table are visibly linked immediately.',
    '- Inspect data safely: data_preview_table and data_get_task_workflow.',
    '- Save workflow logic: data_apply_workflow_dsl with dryRun=true first, then dryRun=false after validation.',
    '- data_apply_workflow_dsl expects text prep DSL, not JSON. Never pass JSON nodes/edges/commands as the dsl string.',
    '- When the workflow should read a created input table or write to a reusable output table, pass inputTableId and outputTableId directly to data_apply_workflow_dsl. This binds the first input_source/output node and avoids guessing node IDs.',
    '- If a field name contains spaces or special characters, reference it as [`field name`], for example [`Year of Transaction Date`]. Use [field_name] only for simple identifier-like fields.',
    '- Edit existing workflow nodes: data_configure_input_operator, data_apply_operator_dsl, data_configure_output_operator.',
    '- Use configure_* tools only after data_get_task_workflow or data_apply_workflow_dsl returns the real node IDs. Do not invent node IDs like input_1, output_1, node_2, or n0.',
    '- Execute workflows: data_run_task with mode=temporary first; then run mode=persisted before any cloud upload or formal output delivery.',
    '- Read results: data_get_run_result for the latest run, and data_preview_table on the output table id after mode=persisted to confirm the reusable output table was updated.',
    'Workflow DSL notes:',
    '- Use input source dataset "<inputTableId>" as alias when the workflow reads a created input table.',
    '- For a new task, prefer binding outputTableId on data_apply_workflow_dsl instead of calling data_configure_output_operator.',
    '- Keep previews small. Default 20 rows, maximum 100 rows.',
  ].join('\n');
}

function buildDslReferenceSection(): string {
  return ['Embedded workflow DSL quick reference:', getWorkflowDslQuickReference()].join('\n');
}

function buildWorkflowRecipesSection(): string {
  return [
    'Standard fixed-workflow recipes:',
    '0. From personal analysis cloud/mock: list cloud spaces/projects/tables, call data_import_cloud_table, then use the returned inputTable id in the normal workflow.',
    '1. From a user-authorized file/folder: call data_create_input_table_with_processing_strategy, using strategy=customize when the source needs LLM-generated standardization code and strategy=auto otherwise. Inspect the preview, create an output table if needed, create a task with sourceInputTableId/outputTableId, apply text workflow DSL with inputTableId/outputTableId and dryRun=true, then save and temporary run.',
    '2. From existing tables: list matching input/output tables, preview schemas, create or select a task with sourceInputTableId/outputTableId, apply text DSL using returned IDs, then temporary run.',
    '3. To publish formal output: configure the output operator with outputTableId, run mode=temporary for validation, then run mode=persisted to update the reusable output table.',
    '4. To send a finished table back to personal analysis cloud/mock, first run mode=persisted, then preview the output table id and only then call data_upload_table_to_cloud with writeMode=CREATE for a new cloud table or REPLACE with tableId for an existing cloud table.',
    '5. If the user only asks to explore or analyze once, do not create a task automatically. Ask whether to turn it into a reusable data task.',
  ].join('\n');
}

function formatName(name: string | undefined): string {
  return name ? ` ("${name.replace(/"/g, '\\"')}")` : '';
}
