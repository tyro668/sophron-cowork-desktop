// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import './i18n-test';
import { ChatView } from '../../src/renderer/components/ChatView';
import { useAppStore } from '../../src/renderer/store';
import type { Session } from '../../src/renderer/types';

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.assign(window, { ResizeObserver: ResizeObserverStub });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
});

function seedRunningTurn() {
  const session: Session = {
    id: 's1',
    title: 'Chat',
    status: 'running',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    createdAt: 1,
    updatedAt: 1,
  };
  useAppStore.setState({
    sessions: [session],
    activeSessionId: 's1',
    sessionStates: {},
  });
  const store = useAppStore.getState();
  store.addMessage('s1', {
    id: 'u1',
    sessionId: 's1',
    role: 'user',
    content: [],
    timestamp: 1,
    localStatus: 'queued',
  });
  store.activateNextTurn('s1', 'step-1');
  return store;
}

it('renders the waiting indicator inside the pending assistant reply row', () => {
  seedRunningTurn();
  render(<ChatView />);

  const status = screen.getByRole('status');
  expect(status.textContent).toContain('Waiting for model response');

  // The indicator lives inside a message row directly after the user message —
  // not as a standalone block appended after the conversation list.
  const replyRow = status.closest('.chat-message-row');
  expect(replyRow).not.toBeNull();
  expect(replyRow!.querySelector('.message-user')).toBeNull();

  const userRow = replyRow!.previousElementSibling;
  expect(userRow?.classList.contains('chat-message-row')).toBe(true);
  expect(userRow?.querySelector('.message-user')).not.toBeNull();

  const rows = document.querySelectorAll('.chat-message-row');
  expect(rows[rows.length - 1]).toBe(replyRow);
});

it('keeps the activity indicator inside the reply while streaming', async () => {
  const store = seedRunningTurn();
  render(<ChatView />);

  await act(async () => {
    store.setPartialMessage('s1', 'Hel');
  });

  const status = screen.getByRole('status');
  expect(status.textContent).toContain('Generating a response');

  const replyRow = status.closest('.chat-message-row');
  expect(replyRow).not.toBeNull();
  expect(await screen.findByText('Hel')).toBeTruthy();
});
