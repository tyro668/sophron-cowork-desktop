// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../src/renderer/store';
import { confirmLeave, useLeaveGuard } from '../../src/renderer/utils/leave-guard';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

/** Mirrors the raw-table editor: guarded only while the data page is on screen. */
function DataPageEditor({ ask }: { ask: () => Promise<boolean> }) {
  const visible = useAppStore((s) => s.mainView === 'data' && !s.showSettings);
  useLeaveGuard(true, ask, { active: visible });
  return null;
}

beforeEach(() => {
  useAppStore.setState({
    mainView: 'chat',
    activeSessionId: null,
    showSettings: false,
    newTaskNonce: 0,
  });
});
afterEach(() => cleanup());

describe('新建任务', () => {
  it('switches to an empty new task from any page and leaves the old conversation alone', () => {
    const before = useAppStore.getState().sessionStates;
    useAppStore.setState({ mainView: 'automation', activeSessionId: 'old', showSettings: true });
    useAppStore.getState().openNewTask();
    const state = useAppStore.getState();
    expect(state.mainView).toBe('chat');
    expect(state.activeSessionId).toBeNull();
    expect(state.showSettings).toBe(false);
    expect(state.newTaskNonce).toBe(1);
    expect(state.sessionStates).toBe(before);
  });

  it('bumps the welcome key every time, even when already on the welcome page', () => {
    useAppStore.getState().openNewTask();
    useAppStore.getState().openNewTask();
    expect(useAppStore.getState().newTaskNonce).toBe(2);
  });

  it('is not blocked by a raw-table editor left dirty on the hidden data page', async () => {
    const ask = vi.fn(async () => false);
    useAppStore.setState({ mainView: 'data' });
    render(<DataPageEditor ask={ask} />);
    // On the data page the editor is asked (and here refuses).
    expect(await confirmLeave()).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
    // After the user went to 自动化 the hidden editor no longer intercepts 新建任务.
    act(() => useAppStore.setState({ mainView: 'automation' }));
    expect(await confirmLeave()).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('routes every entry point through the same 新建任务 handler', () => {
    const sidebar = read('src/renderer/components/Sidebar.tsx');
    const ipc = read('src/renderer/hooks/useIPC.ts');
    const app = read('src/renderer/App.tsx');
    // Button and Ctrl/Cmd+N call handleNewSession; tray / dock menu send NEW_TASK_EVENT to it.
    expect(sidebar).toContain('newSessionRef.current = handleNewSession');
    expect(sidebar).toContain('window.addEventListener(NEW_TASK_EVENT, onNewTask)');
    expect(sidebar).toMatch(
      /handleNewSession = async \(\) => \{\s*if \(!\(await confirmLeave\(\)\)\) return;/
    );
    expect(sidebar).toContain('useAppStore.getState().openNewTask()');
    expect(ipc).toMatch(
      /case 'new-session':\s*\/\/[^\n]*\n\s*window\.dispatchEvent\(new Event\(NEW_TASK_EVENT\)\)/
    );
    // Fresh welcome view (empty input) for each 新建任务, with focus in the input.
    expect(app).toContain('<WelcomeView key={newTaskNonce} />');
    expect(read('src/renderer/components/WelcomeView.tsx')).toContain(
      'textareaRef.current?.focus();'
    );
  });
});
