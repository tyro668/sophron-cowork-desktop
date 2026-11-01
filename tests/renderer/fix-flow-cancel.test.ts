import { describe, expect, it, vi } from 'vitest';
import { runFixFlow } from '../../src/renderer/components/data-view/fix-error-flow';
import {
  markNormalizerGenerationCancelled,
  type NormalizerGenerationLog,
} from '../../src/renderer/components/data-view/raw-table-normalizer-utils';
import { cancelledError } from '../../src/shared/cancel';

const t = ((key: string) => key) as never;

function freshLog(): NormalizerGenerationLog {
  return { meta: [], steps: [], startedAt: Date.now() };
}

describe('取消 in the generation console', () => {
  it('a cancelled AI 修复 turn ends 已取消, not as an error, and reports no error text', async () => {
    const log = freshLog();
    const result = await runFixFlow({
      log,
      flush: () => undefined,
      maxRounds: 3,
      initial: { message: 'boom', error: 'boom' },
      verifyKind: 'trial',
      t,
      fix: async () => {
        throw new Error(`Error invoking remote method 'x': ${cancelledError().message}`);
      },
      verify: vi.fn(),
    });
    expect(result).toMatchObject({ cancelled: true, passed: false });
    expect(result.error).toBeUndefined();
    expect(log.outcome).toMatchObject({ status: 'cancelled', title: 'fixError.cancelled' });
  });

  it('取消 during a verify stops before the next round starts', async () => {
    const log = freshLog();
    let cancelled = false;
    const fix = vi.fn(async () => ({ versionNumber: 2, changedFiles: ['main.py'] }));
    const result = await runFixFlow({
      log,
      flush: () => undefined,
      maxRounds: 3,
      initial: { message: 'boom', error: 'boom' },
      verifyKind: 'trial',
      t,
      cancelled: () => cancelled,
      fix,
      verify: async () => {
        cancelled = true;
        return { passed: false, failure: { message: 'still broken', error: 'still broken' } };
      },
    });
    expect(fix).toHaveBeenCalledTimes(1);
    expect(result.cancelled).toBe(true);
    expect(log.outcome?.status).toBe('cancelled');
  });

  it('markNormalizerGenerationCancelled stops the active step without an error mark', () => {
    const log = freshLog();
    log.steps.push({ phase: 'code_generation', status: 'active', notes: [], stream: '' });
    markNormalizerGenerationCancelled(log, '已取消');
    expect(log.steps[0].status).toBe('cancelled');
    expect(log.outcome?.status).toBe('cancelled');
    expect(log.finishedAt).toBeDefined();
  });
});
