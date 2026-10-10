import { describe, expect, it, vi } from 'vitest';
import { createDefaultAutomationActionRegistry } from '../src/main/automation/default-actions';

describe('generated data pipeline automation action', () => {
  it('rejects direct analysis-table writes before invoking the pipeline runtime', async () => {
    const runGeneratedPipeline = vi.fn();
    const registry = createDefaultAutomationActionRegistry({
      dataPipelineStore: {} as never,
      dataCommandService: { runGeneratedPipeline } as never,
      sessionManager: {} as never,
    });
    const action = registry.get('cloud.table.process')!;
    const config = {
      pipelineId: 'pipeline',
      source: { location: 'local', tableId: 'input' },
      output: { location: 'cloud', targetTableId: 'remote' },
    };
    expect(() => action.validate?.(config)).toThrow('schedule.cloudSync.useOutputAction');
    await expect(action.execute(config, {} as never, {} as never)).rejects.toThrow(
      'schedule.cloudSync.useOutputAction'
    );
    expect(runGeneratedPipeline).not.toHaveBeenCalled();
  });
  it('passes the certified input and output schemas to the runtime execution', async () => {
    const runGeneratedPipeline = vi.fn(async () => ({
      pipeline: { name: 'generated pipeline', rowCount: 1, columnCount: 1 },
      resultTableId: 'output-1',
    }));
    const registry = createDefaultAutomationActionRegistry({
      dataPipelineStore: {} as never,
      dataCommandService: { runGeneratedPipeline } as never,
      sessionManager: {} as never,
    });
    const action = registry.get('cloud.table.process');
    const requiredColumns = [{ name: 'Sales', type: 'decimal' }];
    const expectedOutputSchema = [{ name: 'Revenue', type: 'decimal' }];

    await action?.execute(
      {
        pipelineId: 'pipeline-1',
        source: { location: 'local', tableId: 'input-1' },
        output: { location: 'local', writeMode: 'replace', targetTableId: 'output-1' },
        requiredColumns,
        expectedOutputSchema,
        schemaPolicy: 'strict',
        outputMode: 'persisted',
      },
      {
        automationId: 'automation-1',
        runId: 'run-1',
        now: 1,
        outputs: new Map(),
        emitArtifact: vi.fn(),
        log: vi.fn(),
      },
      {
        id: 'node-1',
        type: 'cloud.table.process',
        enabled: true,
        config: {},
      }
    );

    expect(runGeneratedPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: 'pipeline-1',
        requiredColumns,
        expectedOutputSchema,
        schemaPolicy: 'strict',
        mode: 'persisted',
      })
    );
  });
});
