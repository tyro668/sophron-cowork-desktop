// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/renderer/types';
import { useAppStore } from '../../src/renderer/store';
import { PermissionPolicySelector } from '../../src/renderer/components/PermissionPolicySelector';
import { WelcomeView } from '../../src/renderer/components/WelcomeView';
import i18n from './i18n-test';

const ipcMocks = vi.hoisted(() => ({
  changeWorkingDir: vi.fn(),
  startSession: vi.fn(),
}));

vi.mock('../../src/renderer/hooks/useIPC', () => ({
  useIPC: () => ({
    changeWorkingDir: ipcMocks.changeWorkingDir,
    startSession: ipcMocks.startSession,
    isElectron: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    workingDir: null,
    isConfigured: true,
    appConfig: { provider: 'anthropic', model: 'test-model' } as AppConfig,
    welcomeCloudTableChatDrafts: [],
  });
});

describe('new task project folder', () => {
  it('keeps the compact permission trigger from covering the folder picker', () => {
    render(<PermissionPolicySelector open={false} onOpenChange={vi.fn()} buttonClassName="h-9" />);

    const trigger = screen.getByRole('combobox');
    expect(trigger.className).toContain('w-auto');
    expect(trigger.className).not.toContain('w-full');
  });

  it('uses the selected folder as the new task project directory', async () => {
    ipcMocks.changeWorkingDir.mockResolvedValue({ success: true, path: '/tmp/demo-project' });
    ipcMocks.startSession.mockResolvedValue(null);

    render(<WelcomeView />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('welcome.selectWorkingFolder') }));

    await waitFor(() => expect(useAppStore.getState().workingDir).toBe('/tmp/demo-project'));
    expect(ipcMocks.changeWorkingDir).toHaveBeenCalledWith(undefined, undefined);
    expect(screen.getByTitle('/tmp/demo-project')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Analyze this project' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('welcome.letsGo') }));

    await waitFor(() => {
      expect(ipcMocks.startSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        '/tmp/demo-project',
        expect.any(Object)
      );
    });
  });
});
