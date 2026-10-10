import type { DataToolPromptContext } from '../data/data-tool-types';
import dataToolsRoutingPrompt from './data-tools-routing.txt?raw';
import { renderPromptTemplate } from './template';

/** Stable domain rules — delivered once per session, not per user turn. */
export function buildDataToolStablePrompt(): string {
  return renderPromptTemplate(dataToolsRoutingPrompt, {});
}

/** Short per-turn state: selected/recent resources and workspace. */
export function buildDataToolStatePrompt(context: DataToolPromptContext): string {
  return buildCurrentContextSection(context);
}

function buildCurrentContextSection(context: DataToolPromptContext): string {
  const lines = ['Current data context:'];
  if (context.authoringRequest) {
    lines.push(
      '- Pipeline authoring request: input, output, existing pipeline and canvas snapshot are bound by the application. Use data_analyze_pipeline_requirement, wait for user confirmation, then data_generate_pipeline_from_requirement. These tools apply the saved bindings; do not bypass them with direct workflow authoring.'
    );
  }
  if (context.selectedDataPipelineId) {
    lines.push(
      `- currentDataPipeline: ${context.selectedDataPipelineId}${formatName(context.selectedDataPipelineName)}`
    );
  }
  if (context.selectedRawTableId) {
    lines.push(
      `- currentRawTable: ${context.selectedRawTableId}${formatName(context.selectedRawTableName)}`
    );
  }
  if (context.selectedResultTableId) {
    lines.push(
      `- currentResultTable: ${context.selectedResultTableId}${formatName(context.selectedResultTableName)}`
    );
  }
  for (const ref of context.recentResources ?? []) {
    const label = ref.listed ? `candidate${ref.kind} (listed, not selected)` : `recent${ref.kind}`;
    lines.push(`- ${label}: ${ref.id}${formatName(ref.name)}`);
  }
  for (const table of context.attachedCloudTables ?? []) {
    lines.push(`- attachedCloudTable: ${table.id}${formatName(table.name)}`);
  }
  if (lines.length === 1) {
    lines.push(
      '- No current data pipeline/table is selected. Use list tools before referencing resources by name.'
    );
  }
  if (context.workspacePath) {
    lines.push(`- workspacePath: ${context.workspacePath}`);
  }
  return lines.join('\n');
}

function formatName(name: string | undefined): string {
  return name ? ` ("${name.replace(/"/g, '\\"')}")` : '';
}
