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
    expect(prompt).toContain('data_create_output_table');
    expect(prompt).toContain('data_create_task');
    expect(prompt).toContain('sourceInputTableId and outputTableId');
    expect(prompt).toContain('mode=temporary before persisted writes');
    expect(prompt).toContain('not JSON');
    expect(prompt).toContain('inputTableId and outputTableId');
    expect(prompt).toContain('preserve those links in your user-facing response');
    expect(prompt).toContain('Do not invent node IDs');
    expect(prompt).toContain('data_get_workflow_dsl_reference');
    expect(prompt).toContain('Never search or read source-tree design docs');
    expect(prompt).toContain('Packaged apps may not include source docs');
    expect(prompt).toContain('Embedded workflow DSL quick reference');
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
