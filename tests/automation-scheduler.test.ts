import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomationScheduler } from '../src/main/automation/automation-scheduler';
import type { AutomationService } from '../src/main/automation/automation-service';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('automation scheduler recovery', () => {
  it('uses the persisted nextRunAt after a new scheduler starts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const record = {
      id: 'a',
      enabled: true,
      status: 'enabled',
      trigger: { kind: 'daily' },
      nextRunAt: 2000,
    };
    const service = {
      list: () => [record],
      runDueAutomations: vi.fn(async () => {
        record.nextRunAt = 10000;
      }),
    };
    const first = new AutomationScheduler(service as unknown as AutomationService);
    first.start();
    first.stop();
    const restored = new AutomationScheduler(service as unknown as AutomationService);
    restored.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(service.runDueAutomations).toHaveBeenCalledTimes(1);
    restored.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not create a second timer when rescheduled during a scan', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const record = {
      id: 'a',
      enabled: true,
      status: 'enabled',
      trigger: { kind: 'daily' },
      nextRunAt: 1000,
    };
    const service = {
      list: () => [record],
      runDueAutomations: vi.fn(async () => {
        await gate;
        record.nextRunAt = 10000;
      }),
    };
    const scheduler = new AutomationScheduler(service as unknown as AutomationService);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.reschedule();
    scheduler.reschedule();
    expect(vi.getTimerCount()).toBe(0);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(1);
    record.enabled = false;
    scheduler.reschedule();
    await vi.advanceTimersByTimeAsync(9000);
    expect(service.runDueAutomations).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('backs off and retries a failed scan instead of spinning or dropping the timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const record = {
      id: 'a',
      enabled: true,
      status: 'enabled',
      trigger: { kind: 'daily' },
      nextRunAt: 1000,
    };
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockImplementation(async () => {
        record.nextRunAt = 10000;
      });
    const scheduler = new AutomationScheduler({
      list: () => [record],
      runDueAutomations: run,
    } as unknown as AutomationService);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
