import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logCtx: vi.fn(),
  logCtxError: vi.fn(),
}));
import {
  AgentRunEventBridge,
  type AgentRunBridgeDeps,
} from '../src/main/agent/agent-runner-event-bridge';
afterEach(() => vi.useRealTimers());

describe('agent approval activity clock', () => {
  it('suspends inactivity across all pending approvals and resumes a fresh timeout afterwards', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const onTimeoutAbort = vi.fn();
    const bridge = new AgentRunEventBridge({
      provider: 'test',
      controller,
      onTimeoutAbort,
    } as unknown as AgentRunBridgeDeps);
    bridge.resetActivityTimeout();
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    const resumeFirst = bridge.pauseForPermission();
    const resumeSecond = bridge.pauseForPermission();
    bridge.resetActivityTimeout(); // SDK activity must not re-arm while a dialog is open.
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    resumeFirst();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(controller.signal.aborted).toBe(false);
    resumeSecond();
    resumeSecond(); // Idempotent cleanup.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
    expect(onTimeoutAbort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTimeoutAbort).toHaveBeenCalledOnce();
    expect(controller.signal.aborted).toBe(true);
  });
});
