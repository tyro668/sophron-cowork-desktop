import type { DataToolPromptContext } from '../data/data-tool-types';
import dataToolsRoutingPrompt from './data-tools-routing.txt?raw';
import { renderPromptTemplate } from './template';

export function buildDataToolPrompt(context: DataToolPromptContext): string {
  return renderPromptTemplate(dataToolsRoutingPrompt, {
    CURRENT_DATA_CONTEXT: buildCurrentContextSection(context),
  });
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

function formatName(name: string | undefined): string {
  return name ? ` ("${name.replace(/"/g, '\\"')}")` : '';
}
