import { describe, expect, it } from 'vitest';
import { buildDataToolStablePrompt, buildDataToolStatePrompt } from '../src/main/prompts';
import type { DataToolPromptContext } from '../src/main/data/data-tool-types';

const baseContext: DataToolPromptContext = {
  sessionId: 'session-1',
  workspacePath: '/tmp/workspace',
  capabilities: {
    canCreateRawTable: true,
    canCreateResultTable: true,
    canCreatePipeline: true,
    canRunPipeline: true,
    canImportLocalFiles: true,
  },
};

describe('data tool prompt', () => {
  it('stable prompt carries routing rules without per-turn state', () => {
    const prompt = buildDataToolStablePrompt();

    expect(prompt).toContain('fixed reusable data-processing workflow');
    expect(prompt).toContain('Do not automatically create a data pipeline for one-off exploration');
    expect(prompt).toContain('runtime structured tool-call channel');
    expect(prompt).not.toContain('<tool_use>');
    expect(prompt).toContain('data_analyze_pipeline_requirement');
    expect(prompt).toContain('data_generate_pipeline_from_requirement');
    expect(prompt).toContain('mandatory two-turn flow');
    expect(prompt).toContain(
      'Never call data_generate_pipeline_from_requirement in the same user turn'
    );
    expect(prompt).toContain('outputMode="create" with resultTableName');
    expect(prompt).toContain('Never pass a nested output object or JSON string');
    expect(prompt).toContain('Do not call data_preview_table first just to discover columns');
    expect(prompt).toContain('includeRows=true only when the user explicitly asks');
    expect(prompt).toContain('return at most 5 rows');
    expect(prompt).toContain('mode=persisted');
    expect(prompt).toContain('preserve those links in your user-facing response');
    expect(prompt).toContain('data_get_workflow_capability_manifest');
    expect(prompt).toContain('data_apply_workflow_plan');
    expect(prompt).toContain('inputResources');
    // Pack-aware guidance instead of an always-on full tool dump.
    expect(prompt).toContain('capabilities_search');
    expect(prompt).not.toContain('Embedded workflow DSL quick reference');
    // No dynamic state leaks into the stable channel.
    expect(prompt).not.toContain('Current data context');
  });

  it('state prompt carries only the current resource context', () => {
    const prompt = buildDataToolStatePrompt({
      ...baseContext,
      selectedDataPipelineId: 'task_1',
      selectedDataPipelineName: 'Sales cleanup',
      selectedRawTableId: 'rawTable_1',
      selectedRawTableName: 'Sales raw',
      selectedResultTableId: 'output_1',
      selectedResultTableName: 'Sales output',
      recentResources: [{ kind: 'Pipeline', id: 'task_9', name: 'Dedup' }],
    });

    expect(prompt).toContain('currentDataPipeline: task_1 ("Sales cleanup")');
    expect(prompt).toContain('currentRawTable: rawTable_1 ("Sales raw")');
    expect(prompt).toContain('currentResultTable: output_1 ("Sales output")');
    expect(prompt).toContain('recentPipeline: task_9 ("Dedup")');
    expect(prompt).toContain('workspacePath: /tmp/workspace');
    expect(prompt).not.toContain('mandatory two-turn flow');
  });
});
