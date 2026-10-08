// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextPanel } from '../../src/renderer/components/ContextPanel';
import { useAppStore } from '../../src/renderer/store';
import { normalizeTokenUsage } from '../../src/main/agent/agent-runner-log-utils';
import './i18n-test';

const ipcMocks = vi.hoisted(() => ({ getMCPServers: vi.fn() }));
vi.mock('../../src/renderer/hooks/useIPC', () => ({
  useIPC: () => ({ getMCPServers: ipcMocks.getMCPServers }),
}));

beforeEach(() => {
  ipcMocks.getMCPServers.mockResolvedValue([]);
  useAppStore.setState(useAppStore.getInitialState());
  useAppStore.getState().addSession({
    id: 's1',
    title: 'Context usage',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
  });
  useAppStore.getState().setActiveSession('s1');
  useAppStore.getState().setSessionContextWindow('s1', 1_000_000);
  useAppStore.setState({ contextPanelCollapsed: false });
});

afterEach(cleanup);

function addResponse(usage: unknown) {
  act(() => {
    useAppStore.getState().addMessage('s1', {
      id: String(useAppStore.getState().sessionStates.s1.messages.length),
      sessionId: 's1',
      role: 'assistant',
      timestamp: Date.now(),
      content: [{ type: 'text', text: 'Response' }],
      tokenUsage: normalizeTokenUsage(usage),
    });
  });
}

describe('context usage display', () => {
  it('tracks the latest full prompt and output as cache hits change across tool turns', async () => {
    render(<ContextPanel />);
    addResponse({ input: 1600, output: 200 });
    expect(await screen.findByText('1.8k / 1.0M')).toBeTruthy();
    addResponse({ input: 700, cacheRead: 1200, output: 200 });
    expect(screen.getByText('2.1k / 1.0M')).toBeTruthy();
    addResponse({ input: 1200, cacheRead: 1700, output: 200 });
    expect(screen.getByText('3.1k / 1.0M')).toBeTruthy();
    addResponse({ input: 0, cacheRead: 3200, output: 200 });
    expect(screen.getByText('3.4k / 1.0M')).toBeTruthy();
    act(() => useAppStore.getState().updateSession('s1', { status: 'completed' }));
    expect(screen.getByText('3.4k / 1.0M')).toBeTruthy();
  });

  it('keeps the last measured snapshot while streaming or receiving unmetered messages', async () => {
    render(<ContextPanel />);
    addResponse({ input: 1600, output: 200 });
    await screen.findByText('1.8k / 1.0M');
    act(() => useAppStore.getState().setPartialMessage('s1', 'Streaming response'));
    addResponse(undefined);
    addResponse({ input: 0, output: 0 });
    expect(screen.getByText('1.8k / 1.0M')).toBeTruthy();
  });

  it('allows an actual smaller prompt after compaction instead of retaining a high-water mark', async () => {
    render(<ContextPanel />);
    addResponse({ input: 9000, cacheRead: 1000, output: 1000 });
    await screen.findByText('11.0k / 1.0M');
    addResponse({ input: 1200, output: 200 });
    expect(screen.getByText('1.4k / 1.0M')).toBeTruthy();
  });
});
