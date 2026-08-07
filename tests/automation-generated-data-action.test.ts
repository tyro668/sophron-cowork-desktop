import { describe, expect, it, vi } from 'vitest';
import { createDefaultAutomationActionRegistry } from '../src/main/automation/default-actions';

describe('generated data task automation action', () => {
  it('passes the certified input and output schemas to the runtime execution', async () => {
    const runGeneratedTask = vi.fn(async () => ({
      task: { name: 'generated task', rowCount: 1, columnCount: 1 },
      outputTableId: 'output-1',
    }));
    const registry = createDefaultAutomationActionRegistry({
      dataTaskStore: {} as never,
      dataCommandService: { runGeneratedTask } as never,
      sessionManager: {} as never,
    });
    const action = registry.get('cloud.table.process');
    const requiredColumns = [{ name: 'Sales', type: 'decimal' }];
    const expectedOutputSchema = [{ name: 'Revenue', type: 'decimal' }];

    await action?.execute(
      {
        taskId: 'task-1',
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

    expect(runGeneratedTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        requiredColumns,
        expectedOutputSchema,
        schemaPolicy: 'strict',
        mode: 'persisted',
      })
    );
  });
});
