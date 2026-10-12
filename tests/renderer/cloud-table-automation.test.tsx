// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './i18n-test';
import {
  automationToDraft,
  draftToPayload,
} from '../../src/renderer/components/settings/schedule/model';
import { useAppStore } from '../../src/renderer/store';
import { CloudSyncEditor } from '../../src/renderer/components/settings/schedule/cloud-sync-editor';
import { RawTableAutomations } from '../../src/renderer/components/data-view/table-automations';
import type { AutomationActionNode } from '../../src/shared/automation/types';

// Keep the tests focused on resource selection; native Radix controls are covered
// by the UI primitives suite and the browser interaction check.
vi.mock('../../src/renderer/components/settings/schedule/editor-controls', () => ({
  ConfigRow: ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => (
    <label>
      {label}
      {children}
    </label>
  ),
  FieldStack: ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => (
    <label>
      {label}
      {children}
    </label>
  ),
  ConfigSection: ({
    title,
    children,
  }: {
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
  }) => (
    <section>
      {title}
      {children}
    </section>
  ),
  SelectLine: ({
    value,
    options,
    placeholder,
    onChange,
  }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    placeholder: string;
    onChange: (value: string) => void;
  }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
const listTables = vi.fn();
const listFiles = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    mainView: 'data',
    appConfig: null,
    desktopAuthStatus: { authenticated: true, apiOrigin: 'https://cloud.example', updatedAt: 0 },
    pendingTableAutomationNavigation: null,
  });
  (window as { electronAPI?: unknown }).electronAPI = {
    data: {
      listCloudSpaces: async () => ({
        spaces: [
          { spaceId: 's', spaceName: 'Space' },
          { spaceId: 'other', spaceName: 'Other space' },
        ],
      }),
      listCloudProjects: async () => ({ projects: [{ projectId: 'p', projectName: 'Project' }] }),
      listCloudTables: listTables,
      listCloudDriveFiles: listFiles,
    },
    automation: {
      list: async () => ({
        automations: [
          {
            id: 'auto',
            name: 'Scheduled import',
            status: 'enabled',
            actionGraph: {
              nodes: [{ type: 'cloud.sync', config: { direction: 'input', rawTableId: 'in' } }],
            },
          },
        ],
        groupCounts: {},
      }),
    },
  };
  listTables.mockResolvedValue({
    tables: [
      { tableId: 'a', tableName: 'Analysis only', kind: 'analysis' },
      { tableId: 'b', tableName: 'Base only', kind: 'base' },
    ],
    hasMore: false,
  });
  listFiles.mockResolvedValue({
    files: [
      { fileId: 'f', fileName: 'Writable.csv', fileType: 'csv', writable: true, version: 3 },
      { fileId: 'x', fileName: 'Workbook.xlsx', fileType: 'excel' },
      { fileId: 'r', fileName: 'Read-only.csv', fileType: 'csv', writable: false },
    ],
    hasMore: false,
  });
});
afterEach(cleanup);

describe('cloud automation resource directions', () => {
  it('keeps a paused migration disabled in the editor until explicitly enabled', () => {
    const draft = automationToDraft({
      name: 'Legacy',
      enabled: true,
      status: 'paused',
      trigger: { kind: 'daily', times: ['09:00'], timezone: 'UTC' },
      actionGraph: {
        version: 1,
        edges: [],
        nodes: [
          {
            id: 'n',
            type: 'cloud.sync',
            enabled: true,
            config: { direction: 'output' },
          },
        ],
      },
    } as never);
    expect(draft.enabled).toBe(false);
    expect(draftToPayload(draft, null).enabled).toBe(false);
    expect(draftToPayload({ ...draft, enabled: true }, null).enabled).toBe(true);
    expect(draft.trigger).toMatchObject({ kind: 'daily', times: ['09:00'] });
  });

  it('filters analysis/base sources and clears the prior remote table when switching kind', async () => {
    const onChange = vi.fn();
    const node: AutomationActionNode = {
      id: 'n',
      type: 'cloud.sync',
      enabled: true,
      config: {
        direction: 'input',
        spaceId: 's',
        projectId: 'p',
        tableKind: 'analysis',
        tableId: 'a',
        rawTableId: 'in',
      },
    };
    const { rerender } = render(
      <CloudSyncEditor node={node} rawTables={[]} resultTables={[]} onChange={onChange} />
    );
    await screen.findByRole('option', { name: 'Analysis only' });
    expect(screen.queryByRole('option', { name: 'Base only' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'base' } });
    const next = onChange.mock.calls[0][0];
    expect(next.config).toMatchObject({
      tableKind: 'base',
      rawTableId: 'in',
      tableId: undefined,
    });
    rerender(<CloudSyncEditor node={next} rawTables={[]} resultTables={[]} onChange={onChange} />);
    await screen.findByRole('option', { name: 'Base only' });
    expect(screen.queryByRole('option', { name: 'Analysis only' })).toBeNull();
    expect(listFiles).not.toHaveBeenCalled();
  });
  it('excludes Excel/read-only output targets and clears the file/version when changing project scope', async () => {
    const onChange = vi.fn();
    render(
      <CloudSyncEditor
        node={{
          id: 'n',
          type: 'cloud.sync',
          enabled: true,
          config: {
            direction: 'output',
            type: 'drive_file',
            resultTableId: 'out',
            spaceId: 's',
            projectId: 'p',
            writeMode: 'append',
            fileId: 'f',
            version: 3,
          },
        }}
        rawTables={[]}
        resultTables={[]}
        onChange={onChange}
      />
    );
    await screen.findByRole('option', { name: 'Writable.csv' });
    expect(screen.queryByRole('option', { name: 'Workbook.xlsx' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Read-only.csv' })).toBeNull();
    expect(listFiles).toHaveBeenCalledWith(expect.objectContaining({ fileType: 'csv' }));
    fireEvent.change(screen.getByLabelText('Analysis space'), { target: { value: 'other' } });
    expect(onChange.mock.calls[0][0].config).toMatchObject({
      spaceId: 'other',
      projectId: '',
      fileId: undefined,
      version: undefined,
      resultTableId: 'out',
    });
    expect(listTables).not.toHaveBeenCalled();
  });
  it('finds input associations from actions and opens the existing automation', async () => {
    render(<RawTableAutomations rawTable={{ id: 'in', name: 'Input' } as never} />);
    fireEvent.click(await screen.findByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: /Scheduled import/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    await waitFor(() =>
      expect(useAppStore.getState().pendingTableAutomationNavigation).toEqual({
        automationId: 'auto',
        returnTarget: { kind: 'raw_table', id: 'in' },
      })
    );
    expect(useAppStore.getState().mainView).toBe('automation');
  });
});
