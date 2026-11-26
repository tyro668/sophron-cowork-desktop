// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/renderer/types';
import { useAppStore } from '../../src/renderer/store';
import { PermissionPolicySelector } from '../../src/renderer/components/PermissionPolicySelector';
import { WelcomeView } from '../../src/renderer/components/WelcomeView';
import i18n from './i18n-test';

const ipcMocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  selectFolders: vi.fn(),
  setWorkingDirPath: vi.fn(),
  startSession: vi.fn(),
}));

vi.mock('../../src/renderer/hooks/useIPC', () => ({
  useIPC: () => ({
    createProject: ipcMocks.createProject,
    selectFolders: ipcMocks.selectFolders,
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

  it('requires adding a project working folder before submitting and supports multiple folders in modal', async () => {
    ipcMocks.selectFolders
      .mockResolvedValueOnce(['/tmp/feishu'])
      .mockResolvedValueOnce(['/tmp/reports', '/tmp/feishu']);
    ipcMocks.createProject.mockImplementation(async (folders: string[], name: string | null) => {
      const project = {
        id: 'p-new',
        name,
        cwd: folders[0],
        folders,
        createdAt: 10,
        updatedAt: 10,
      };
      useAppStore.getState().upsertProject(project);
      useAppStore.getState().setWorkingDir(folders[0]);
      return { success: true, project };
    });
    ipcMocks.startSession.mockResolvedValue(null);

    render(<WelcomeView />);

    // Without a working directory, submit is disabled and requirement banner is visible.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Analyze this project' } });
    const submitButton = screen.getByRole('button', { name: i18n.t('welcome.letsGo') });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(i18n.t('welcome.workingFolderRequired'))).toBeTruthy();

    // Open two-section project menu: empty top section + New project bottom action.
    const trigger = screen.getByRole('button', {
      name: i18n.t('welcome.selectWorkingFolder'),
    });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByText(i18n.t('welcome.noProjectsYet'))).toBeTruthy();
    fireEvent.click(await screen.findByRole('menuitem', { name: i18n.t('welcome.newProject') }));

    // Add first folder and verify name auto-fills.
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('welcome.addFolder') }));

    const nameInput = screen.getByLabelText(i18n.t('welcome.projectNameLabel')) as HTMLInputElement;
    await waitFor(() => expect(nameInput.value).toBe('feishu'));
    expect(screen.getByTitle('/tmp/feishu')).toBeTruthy();

    // Add a second folder (duplicate /tmp/feishu should be deduplicated).
    fireEvent.click(screen.getByRole('button', { name: i18n.t('welcome.addFolder') }));
    await waitFor(() => expect(screen.getByTitle('/tmp/reports')).toBeTruthy());

    // Edit project name and submit.
    fireEvent.change(nameInput, { target: { value: 'Sales Analysis' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('welcome.createProjectConfirm') }));

    await waitFor(() =>
      expect(ipcMocks.createProject).toHaveBeenCalledWith(
        ['/tmp/feishu', '/tmp/reports'],
        'Sales Analysis'
      )
    );
    await waitFor(() => expect(useAppStore.getState().workingDir).toBe('/tmp/feishu'));
    expect(screen.getByRole('button', { name: 'Sales Analysis' })).toBeTruthy();
    expect(screen.getByTitle('/tmp/feishu')).toBeTruthy();

    // Now submitting works with the newly created project working directory.
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(ipcMocks.startSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        '/tmp/feishu',
        expect.any(Object)
      );
    });
  });

  it('lists existing projects in the top section and activates one', async () => {
    ipcMocks.setWorkingDirPath.mockResolvedValue({ success: true, path: '/tmp/beta' });
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

    expect(
      await screen.findByRole('menuitem', { name: i18n.t('welcome.newProject') })
    ).toBeTruthy();
    const betaItem = await screen.findByRole('menuitem', { name: 'beta' });
    fireEvent.click(betaItem);
    expect(ipcMocks.setWorkingDirPath).toHaveBeenCalledWith('/tmp/beta');
  });

  it('treats legacy internal DefaultWorkingDir as unset and prompts for a real project', () => {
    useAppStore.setState({
      workingDir: '/Users/demo/Library/Application Support/sophron/DefaultWorkingDir',
      projects: [
        {
          id: 'legacy-default',
          name: null,
          cwd: '/Users/demo/Library/Application Support/sophron/DefaultWorkingDir',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    render(<WelcomeView />);
    expect(
      screen.getByRole('button', { name: i18n.t('welcome.selectWorkingFolder') })
    ).toBeTruthy();
    expect(screen.getByText(i18n.t('welcome.workingFolderRequired'))).toBeTruthy();
  });
});
