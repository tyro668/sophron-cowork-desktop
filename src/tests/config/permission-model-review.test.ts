import { afterEach, describe, expect, it, vi } from 'vitest';
import { completePermissionReview } from '../../main/config/permission-model-review';
import { reviewAutoPermission } from '../../main/config/permission-auto-review';
import type { PermissionEvaluation } from '../../main/config/permission-rules-store';
const unresolved: PermissionEvaluation = {
  decision: 'ask',
  source: 'auto_review',
  reason: 'tool_needs_confirmation',
};
const input = { command: 'python3 -c "print(1 + 1)"' };
afterEach(() => vi.useRealTimers());

describe('model fallback for automatic permissions', () => {
  it.each(['low', 'medium'])('allows %s risk without a user prompt', async (risk) => {
    const complete = vi.fn<(prompt: string) => Promise<{ text: string }>>(async () => ({
      text: JSON.stringify({ risk }),
    }));
    const result = await completePermissionReview(unresolved, {
      toolName: 'bash',
      input,
      complete,
    });
    expect(result).toMatchObject({ decision: 'allow', reason: 'model_routine_operation' });
    expect(JSON.parse(complete.mock.calls[0][0])).toMatchObject({ arguments: input, tool: 'bash' });
  });

  it.each(['high', 'unknown'])('asks for confirmation when risk is %s', async (risk) => {
    const result = await completePermissionReview(unresolved, {
      toolName: 'custom_tool',
      input: {},
      complete: async () => ({ text: JSON.stringify({ risk }) }),
    });
    expect(result.decision).toBe('ask');
  });

  it('never overrides a known high-risk operation or an explicit rule', async () => {
    const complete = vi.fn(async () => ({ text: '{"risk":"low"}' }));
    const dangerous = reviewAutoPermission('bash', { command: 'rm -rf ~/Documents' });
    for (const evaluation of [
      { ...dangerous, source: 'auto_review' as const },
      { decision: 'ask' as const, source: 'rule' as const },
      { decision: 'deny' as const, source: 'rule' as const },
      {
        decision: 'allow' as const,
        source: 'auto_review' as const,
        reason: 'local_command' as const,
      },
    ]) {
      expect(
        await completePermissionReview(evaluation, { toolName: 'bash', input, complete })
      ).toEqual(evaluation);
    }
    expect(complete).not.toHaveBeenCalled();
  });

  it.each(['not json', '{}', '{"risk":"allow"}', '{"risk":null}'])(
    'fails closed for an invalid review: %s',
    async (text) => {
      expect(
        (
          await completePermissionReview(unresolved, {
            toolName: 'bash',
            input,
            complete: async () => ({ text }),
          })
        ).decision
      ).toBe('ask');
    }
  );

  it('bounds the machine assessment, without imposing a deadline on human approval', async () => {
    vi.useFakeTimers();
    let reviewSignal: AbortSignal | undefined;
    const result = completePermissionReview(unresolved, {
      toolName: 'bash',
      input,
      complete: (_prompt, _system, signal) => {
        reviewSignal = signal;
        return new Promise(() => {});
      },
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toMatchObject({ decision: 'ask', reason: 'review_unavailable' });
    expect(reviewSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates task cancellation to an in-progress review', async () => {
    const controller = new AbortController();
    let reviewSignal: AbortSignal | undefined;
    const result = completePermissionReview(unresolved, {
      toolName: 'bash',
      input,
      signal: controller.signal,
      complete: (_prompt, _system, signal) => {
        reviewSignal = signal;
        return new Promise(() => {});
      },
    });
    controller.abort();
    await expect(result).resolves.toMatchObject({ decision: 'ask' });
    expect(reviewSignal?.aborted).toBe(true);
  });

  it('does not submit truncated tool input for a potentially incomplete approval', async () => {
    const complete = vi.fn();
    const result = await completePermissionReview(unresolved, {
      toolName: 'bash',
      input: { command: 'x'.repeat(49_000) },
      complete,
    });
    expect(result.decision).toBe('ask');
    expect(complete).not.toHaveBeenCalled();
  });
});
