import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomationScheduler } from '../src/main/automation/automation-scheduler';
import type { AutomationService } from '../src/main/automation/automation-service';
const fs = vi.hoisted(() => ({ watch: vi.fn() }));
vi.mock('fs', async (original) => ({
  ...(await original<typeof import('fs')>()),
  watch: fs.watch,
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('local table watcher', () => {
  it('registers a non-cloud source, debounces source changes, and stops cleanly', async () => {
    vi.useFakeTimers();
    let change!: (event: string, file: string) => void;
    const close = vi.fn();
    const watcher = { close, on: vi.fn() };
    fs.watch.mockImplementation((_path, callback) => {
      change = callback;
      return watcher;
    });
    const resolve = vi.fn(async () => [
      { rawTableId: 'excel', sourcePath: '/tmp/sales.csv', kind: 'file' as const },
    ]);
    const reimport = vi.fn(async () => {});
    const record = {
      id: 'a',
      enabled: true,
      status: 'enabled',
      nextRunAt: null,
      trigger: { kind: 'manual' },
      tableBindings: [{ kind: 'raw', tableId: 'excel', runOnChange: true, runOnTrigger: false }],
      actionGraph: { nodes: [], edges: [] },
    };
    const scheduler = new AutomationScheduler(
      { list: () => ({ automations: [record] }) } as unknown as AutomationService,
      { resolveRawTableWatchTargets: resolve, reimportRawTable: reimport }
    );
    try {
      scheduler.start();
      await Promise.resolve();
      expect(resolve).toHaveBeenCalledWith(['excel']);
      expect(fs.watch).toHaveBeenCalledWith('/tmp', expect.any(Function));
      change('change', 'other.csv');
      await vi.advanceTimersByTimeAsync(2000);
      expect(reimport).not.toHaveBeenCalled();
      change('rename', 'sales.csv');
      change('change', 'sales.csv');
      await vi.advanceTimersByTimeAsync(2000);
      expect(reimport).toHaveBeenCalledExactlyOnceWith('excel');
      record.tableBindings[0].runOnChange = false;
      resolve.mockResolvedValue([]);
      scheduler.reschedule();
      await Promise.resolve();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      scheduler.stop();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not install a watcher after stop while source resolution is pending', async () => {
    let resolve!: (
      targets: Array<{ rawTableId: string; sourcePath: string; kind: 'file' }>
    ) => void;
    const scheduler = new AutomationScheduler(
      { list: () => ({ automations: [] }) } as unknown as AutomationService,
      {
        resolveRawTableWatchTargets: () =>
          new Promise((r) => {
            resolve = r;
          }),
      }
    );
    scheduler.start();
    scheduler.stop();
    resolve([{ rawTableId: 'a', sourcePath: '/tmp/a.csv', kind: 'file' }]);
    await Promise.resolve();
    expect(fs.watch).not.toHaveBeenCalled();
  });
});
