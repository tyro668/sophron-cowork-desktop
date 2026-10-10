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
  setWorkingDirPath: vi.fn(),
  startSession: vi.fn(),
}));

vi.mock('../../src/renderer/hooks/useIPC', () => ({
  useIPC: () => ({
    changeWorkingDir: ipcMocks.changeWorkingDir,
    setWorkingDirPath: ipcMocks.setWorkingDirPath,
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
    projects: [],
  });
});

describe('new pipeline project folder', () => {
  it('keeps the compact permission trigger from covering the folder picker', () => {
    render(<PermissionPolicySelector open={false} onOpenChange={vi.fn()} buttonClassName="h-9" />);

    const trigger = screen.getByRole('combobox');
    expect(trigger.className).toContain('w-auto');
    expect(trigger.className).not.toContain('w-full');
  });

  it('uses the selected folder as the new pipeline project directory', async () => {
    ipcMocks.changeWorkingDir.mockResolvedValue({ success: true, path: '/tmp/demo-project' });
    ipcMocks.startSession.mockResolvedValue(null);

    render(<WelcomeView />);
    const trigger = screen.getByRole('button', {
      name: i18n.t('welcome.selectWorkingFolder'),
    });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: i18n.t('welcome.openFolder') }));

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

  it('lists existing projects in the directory menu and activates one', async () => {
    ipcMocks.setWorkingDirPath.mockResolvedValue({ success: true, path: '/tmp/alpha' });
    useAppStore.setState({
      workingDir: '/tmp/alpha',
      projects: [
        {
          id: 'p1',
          name: 'Alpha',
          cwd: '/tmp/alpha',
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: 'p2',
          name: null,
          cwd: '/tmp/beta',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    render(<WelcomeView />);
    const trigger = screen.getByRole('button', { name: 'Alpha' });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    const betaItem = await screen.findByRole('menuitem', { name: 'beta' });
    fireEvent.click(betaItem);
    expect(ipcMocks.setWorkingDirPath).toHaveBeenCalledWith('/tmp/beta');
  });
});
