// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { loadDataTaskResources } from '../../src/renderer/features/data/api/data-task-resources';
import { EMPTY_DASHBOARD } from '../../src/renderer/features/data/model/types';

describe('saved task choices', () => {
  it('loads independent pages without dropping older tasks or duplicating input/output choices', async () => {
    const tasks = Array.from({ length: 200 }, (_, index) => ({ id: `task-${index}` }));
    const getDashboard = vi
      .fn()
      .mockResolvedValueOnce({
        ...EMPTY_DASHBOARD,
        tasks,
        datasets: [{ id: 'input' }],
        outputTables: [{ id: 'output' }],
      })
      .mockResolvedValueOnce({ ...EMPTY_DASHBOARD, tasks: [{ id: 'older-task' }] });
    (window as { electronAPI?: unknown }).electronAPI = { data: { getDashboard } };
    const resources = await loadDataTaskResources();
    expect(resources.tasks).toHaveLength(201);
    expect(resources.tasks.at(-1)?.id).toBe('older-task');
    expect(resources.datasets).toEqual([{ id: 'input' }]);
    expect(resources.outputTables).toEqual([{ id: 'output' }]);
    expect(getDashboard.mock.calls[1][0]).toMatchObject({
      taskOffset: 200,
      includeTasks: true,
      includeDatasets: false,
      includeOutputTables: false,
    });
  });
});
