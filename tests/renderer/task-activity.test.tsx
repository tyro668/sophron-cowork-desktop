// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import './i18n-test';
import { TaskActivity } from '../../src/renderer/components/message/TaskActivity';
import { useAppStore } from '../../src/renderer/store';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('shows streamed input, refreshes activity, then displays only execution output', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  useAppStore.setState({ sessionStates: {} });
  const store = useAppStore.getState();
  store.addTraceStep('s', {
    id: 'tool',
    parentId: 'turn',
    type: 'tool_call',
    status: 'running',
    title: 'write',
    timestamp: 1_000,
    toolPhase: 'preparing',
  });
  const props = {
    sessionId: 's',
    activeTurnStepId: 'turn',
    hasStreamingText: false,
    elapsedMs: 60_000,
    now: 61_000,
  };
  const view = render(<TaskActivity {...props} />);
  expect(screen.getByText('Generating tool arguments: write')).toBeTruthy();
  expect(screen.getByText('No new activity for 60 seconds')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Input preview' }));
  expect(screen.getByText('Waiting for tool arguments')).toBeTruthy();
  vi.setSystemTime(61_000);
  act(() =>
    store.updateTraceStep('s', 'tool', {
      toolInputPreview: { text: '{"content":"hello"}', truncated: false },
    })
  );
  expect(screen.queryByText('No new activity for 60 seconds')).toBeNull();
  expect(screen.getAllByText('{"content":"hello"}').length).toBeGreaterThan(0);
  act(() => store.updateTraceStep('s', 'tool', { toolPhase: 'ready' }));
  expect(screen.getByText('Waiting to run: write')).toBeTruthy();
  act(() => store.updateTraceStep('s', 'tool', { toolPhase: 'executing' }));
  view.rerender(<TaskActivity {...props} />);
  expect(screen.getByText('Running: write')).toBeTruthy();
  expect(screen.queryByText('{"content":"hello"}')).toBeNull();
  expect(screen.getByText('This tool has not produced displayable output yet')).toBeTruthy();
  act(() =>
    store.setLiveToolOutput('s', 'tool', {
      text: 'Written successfully',
      truncated: false,
      updatedAt: 61_000,
    })
  );
  expect(screen.getAllByText('Written successfully').length).toBeGreaterThan(0);
});
