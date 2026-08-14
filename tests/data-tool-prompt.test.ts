import { describe, expect, it } from 'vitest';
import { buildDataToolPrompt } from '../src/main/data/data-tool-prompt';
import type { DataToolPromptContext } from '../src/main/data/data-tool-types';

const baseContext: DataToolPromptContext = {
  sessionId: 'session-1',
  workspacePath: '/tmp/workspace',
  capabilities: {
    canCreateInputTable: true,
    canCreateOutputTable: true,
    canCreateTask: true,
    canRunTask: true,
    canImportLocalFiles: true,
  },
};

describe('data tool prompt', () => {
  it('injects fixed-workflow routing rules and tool docs', () => {
    const prompt = buildDataToolPrompt(baseContext);

    expect(prompt).toContain('fixed reusable data-processing workflow');
    expect(prompt).toContain('Do not automatically create a data task for one-off exploration');
    expect(prompt).toContain('data_create_input_table');
    expect(prompt).toContain('data_create_input_table_with_processing_strategy');
    expect(prompt).toContain('processingStrategy.strategy="customize"');
    expect(prompt).toContain('runtime structured tool-call channel');
    expect(prompt).not.toContain('<tool_use>');
    expect(prompt).toContain('data_analyze_task_requirement');
    expect(prompt).toContain('data_generate_task_from_requirement');
    expect(prompt).toContain('mandatory two-turn flow');
    expect(prompt).toContain(
      'Never call data_generate_task_from_requirement in the same user turn'
    );
    expect(prompt).toContain('outputMode="create" with outputTableName');
    expect(prompt).toContain('Never pass a nested output object or JSON string');
    expect(prompt).toContain('Do not create or update output tables');
    expect(prompt).toContain('Do not call data_preview_table first just to discover columns');
    expect(prompt).toContain('includeRows=true only when the user explicitly asks');
    expect(prompt).toContain('return at most 5 rows');
    expect(prompt).toContain('mode=persisted');
    expect(prompt).toContain('preserve those links in your user-facing response');
    expect(prompt).toContain('Do not author workflow DSL');
    expect(prompt).not.toContain('data_apply_workflow_dsl');
    expect(prompt).not.toContain('Embedded workflow DSL quick reference');
  });

  it('includes selected data context when available', () => {
    const prompt = buildDataToolPrompt({
      ...baseContext,
      selectedDataTaskId: 'task_1',
      selectedDataTaskName: 'Sales cleanup',
      selectedInputTableId: 'dataset_1',
      selectedInputTableName: 'Sales raw',
      selectedOutputTableId: 'output_1',
      selectedOutputTableName: 'Sales output',
    });

    expect(prompt).toContain('currentDataTask: task_1 ("Sales cleanup")');
    expect(prompt).toContain('currentInputTable: dataset_1 ("Sales raw")');
    expect(prompt).toContain('currentOutputTable: output_1 ("Sales output")');
  });
});
