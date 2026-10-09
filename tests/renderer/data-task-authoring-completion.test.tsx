// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDataTaskAuthoringCompletion } from '../../src/renderer/features/data/hooks/use-data-task-authoring';
import { useAppStore } from '../../src/renderer/store';
import type {
  DataTaskAuthoringCompletion,
  DataTaskAuthoringSession,
} from '../../src/shared/data-task-authoring';
import type { Message } from '../../src/shared/contracts';

const getSessionMessages = vi.hoisted(() => vi.fn());
vi.mock('../../src/renderer/hooks/useIPC', () => ({ useIPC: () => ({ getSessionMessages }) }));
const pending = { sessionId: 'chat', requestId: 'request' };
const completion: DataTaskAuthoringCompletion = {
  requestId: 'request',
  result: {
    taskId: 'saved',
    taskName: 'Saved',
    outputTableId: 'out',
    outputTableName: 'Output',
    workflowDslAvailable: true,
    requiredColumns: [],
    expectedOutputSchema: [],
    lineage: [],
    columnsSnapshot: [],
    sourceSummaryHash: 's',
    workflowHash: 'w',
    version: 1,
    generatedAt: 1,
  },
};
const message: Message = {
  id: 'done',
  sessionId: 'chat',
  role: 'assistant',
  timestamp: 1,
  content: [
    {
      type: 'tool_result',
      toolUseId: 'generate',
      content: 'Saved',
      dataTaskCompletion: completion,
    },
  ],
};
beforeEach(() => {
  useAppStore.setState({ sessionStates: {}, globalNotice: null });
  getSessionMessages.mockResolvedValue([message]);
});
afterEach(cleanup);

describe('shared authoring completion', () => {
  it('restores a persisted result without opening the conversation and consumes it only once', async () => {
    const applied = vi.fn();
    const { rerender } = renderHook(() =>
      useDataTaskAuthoringCompletion(pending, (value) => applied(value))
    );
    await waitFor(() => expect(applied).toHaveBeenCalledExactlyOnceWith(completion));
    expect(getSessionMessages).toHaveBeenCalledWith('chat');
    act(() => useAppStore.getState().addMessage('chat', message));
    rerender();
    expect(applied).toHaveBeenCalledTimes(1);
  });

  it('does not apply a late storage response after the user changes the selected task', async () => {
    let resolve!: (messages: Message[]) => void;
    getSessionMessages.mockReturnValue(
      new Promise<Message[]>((done) => {
        resolve = done;
      })
    );
    const applied = vi.fn();
    const { rerender } = renderHook(
      ({ target }: { target: DataTaskAuthoringSession | null }) =>
        useDataTaskAuthoringCompletion(target, applied),
      { initialProps: { target: pending as DataTaskAuthoringSession | null } }
    );
    rerender({ target: null });
    await act(async () => resolve([message]));
    expect(applied).not.toHaveBeenCalled();
  });

  it.each(['sync', 'async'])(
    'reports %s refresh errors without replaying the saved task',
    async (mode) => {
      const applied = vi.fn(() => {
        if (mode === 'sync') throw new Error('Refresh failed');
        return Promise.reject(new Error('Refresh failed'));
      });
      const { rerender } = renderHook(() => useDataTaskAuthoringCompletion(pending, applied));
      await waitFor(() =>
        expect(useAppStore.getState().globalNotice?.message).toContain('Refresh failed')
      );
      rerender();
      expect(applied).toHaveBeenCalledTimes(1);
    }
  );
});
