// @vitest-environment happy-dom
import React from 'react';
import {
  cleanup,
  fireEvent,
  render as renderUi,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './i18n-test';
import { ConfirmDialogProvider } from '../../src/renderer/components/ConfirmDialog';
const render = (ui: React.ReactElement) => renderUi(ui, { wrapper: ConfirmDialogProvider });
import {
  automationToDraft,
  draftToPayload,
} from '../../src/renderer/components/settings/schedule/model';
import { useAppStore } from '../../src/renderer/store';
import { CloudSyncEditor } from '../../src/renderer/components/settings/schedule/cloud-sync-editor';
import {
  RawTableAutomations,
  ResultTableAutomations,
} from '../../src/renderer/components/data-view/table-automations';
import type { AutomationActionNode } from '../../src/shared/automation/types';

// Keep the tests focused on resource selection; native Radix controls are covered
// by the UI primitives suite and the browser interaction check.
vi.mock('../../src/renderer/components/settings/schedule/editor-controls', () => ({
  FormRow: ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => (
    <label>
      {label}
      {children}
    </label>
  ),
  RequiredLabel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SubGroupRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FlushSelect: ({
    value,
    options,
    placeholder,
    onChange,
    disabled,
    footer,
  }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    placeholder: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    footer?: React.ReactNode;
  }) => (
    <>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {footer}
    </>
  ),
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
      getTablePolicy: async () => ({ runOnChange: false, runOnTrigger: true }),
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
    const item = await screen.findByRole('listitem', { name: 'Scheduled import' });
    fireEvent.click(within(item).getByRole('button', { name: 'Configure' }));
    await waitFor(() =>
      expect(useAppStore.getState().pendingTableAutomationNavigation).toEqual({
        automationId: 'auto',
        returnTarget: { kind: 'raw_table', id: 'in' },
      })
    );
    expect(useAppStore.getState().mainView).toBe('automation');
  });
});

describe('table association conditions', () => {
  function installAssociations(kind: 'raw' | 'result' = 'raw') {
    const rows = ['one', 'two'].map((id) => ({
      id,
      name: id,
      status: 'enabled',
      enabled: true,
      tableBindings: [
        { kind, tableId: 'table', runOnChange: id === 'one', runOnTrigger: id === 'two' },
      ],
      actionGraph: {
        version: 1,
        nodes: [{ id: 'process', type: 'test', enabled: true, config: {} }],
        edges: [],
      },
    }));
    const policy = { runOnChange: true, runOnTrigger: false };
    const setPolicy = vi.fn(async (_table, patch) => Object.assign(policy, patch));
    const replace = vi.fn(async (_table, previousId, nextId) => {
      rows.find((a) => a.id === previousId)!.tableBindings = [];
      rows.find((a) => a.id === nextId)!.tableBindings = [{ kind, tableId: 'table', ...policy }];
    });
    const update = vi.fn(async (id, patch) => {
      const row = rows.find((a) => a.id === id)!;
      Object.assign(row, patch);
      return row;
    });
    Object.assign(
      (window as unknown as { electronAPI: { automation: object } }).electronAPI.automation,
      {
        list: async () => ({ automations: rows, groupCounts: {} }),
        get: async (id: string) => rows.find((a) => a.id === id),
        update,
        getTablePolicy: async () => ({ ...policy }),
        setTablePolicy: setPolicy,
        replaceTableAssociation: replace,
      }
    );
    return { rows, update, policy, setPolicy, replace };
  }
  it.each(['raw', 'result'] as const)(
    'lists every %s association under one shared table policy',
    async (kind) => {
      const f = installAssociations(kind);
      render(
        kind === 'raw' ? (
          <RawTableAutomations rawTable={{ id: 'table', name: 'Excel' } as never} />
        ) : (
          <ResultTableAutomations resultTable={{ id: 'table', name: 'Result' } as never} />
        )
      );
      const first = await screen.findByRole('listitem', { name: 'one' });
      const second = screen.getByRole('listitem', { name: 'two' });
      expect(within(first).queryByRole('checkbox')).toBeNull();
      expect(within(second).queryByRole('checkbox')).toBeNull();
      expect(screen.getAllByRole('checkbox')).toHaveLength(2);
      expect(screen.getByRole('group', { name: 'Trigger policy' })).toBeTruthy();
      expect(screen.getAllByRole('combobox')).toHaveLength(2);
      expect(within(first).getByRole('combobox').textContent).toContain('one');
      expect(within(second).getByRole('combobox').textContent).toContain('two');
      const change = screen.getByRole('checkbox', { name: 'Run after this table updates' });
      expect((change as HTMLInputElement).checked).toBe(true);
      fireEvent.click(change);
      await waitFor(() => expect(f.setPolicy).toHaveBeenCalledTimes(1));
      expect(f.setPolicy).toHaveBeenCalledWith({ kind, tableId: 'table' }, { runOnChange: false });
      expect(f.policy).toEqual({ runOnChange: false, runOnTrigger: false });
      expect(f.update).not.toHaveBeenCalled();
      expect(screen.queryByRole('switch')).toBeNull();
    }
  );
  it('associates a local raw table without adding a cloud download action', async () => {
    const f = installAssociations();
    f.rows.forEach((a) => {
      a.tableBindings = [];
    });
    render(<RawTableAutomations rawTable={{ id: 'table', name: 'Excel' } as never} />);
    const addButton = await screen.findByRole('button', { name: 'Add automation association' });
    await waitFor(() => expect((addButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.keyDown(addButton, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'one' }));
    await waitFor(() => expect(f.update).toHaveBeenCalledTimes(1));
    expect(f.rows[0].tableBindings).toEqual([
      { kind: 'raw', tableId: 'table', runOnChange: true, runOnTrigger: false },
    ]);
    expect(f.rows[0].actionGraph.nodes).toHaveLength(1);
    expect(f.rows[0].actionGraph.nodes[0].type).toBe('test');
    await screen.findByRole('listitem', { name: 'one' });
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add automation association' }), {
      key: 'Enter',
    });
    expect(await screen.findByRole('menuitem', { name: 'two' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'one' })).toBeNull();
  });
  it.each(['raw', 'result'] as const)(
    'switches an existing %s association directly from its row',
    async (kind) => {
      const f = installAssociations(kind);
      f.rows.push({ ...f.rows[0], id: 'three', name: 'three', tableBindings: [] });
      render(
        kind === 'raw' ? (
          <RawTableAutomations rawTable={{ id: 'table', name: 'Excel' } as never} />
        ) : (
          <ResultTableAutomations resultTable={{ id: 'table', name: 'Result' } as never} />
        )
      );
      const first = await screen.findByRole('listitem', { name: 'one' });
      expect(screen.getAllByRole('combobox')).toHaveLength(2);
      fireEvent.click(within(first).getByRole('combobox'));
      expect(await screen.findByRole('option', { name: 'one' })).toBeTruthy();
      expect(screen.queryByRole('option', { name: 'two' })).toBeNull();
      fireEvent.click(screen.getByRole('option', { name: 'three' }));
      await screen.findByRole('listitem', { name: 'three' });
      expect(f.replace).toHaveBeenCalledWith({ kind, tableId: 'table' }, 'one', 'three');
      expect(screen.queryByRole('listitem', { name: 'one' })).toBeNull();
      expect(screen.getByRole('listitem', { name: 'two' })).toBeTruthy();
      expect(screen.getAllByRole('combobox')[0].textContent).toContain('three');
      expect(f.setPolicy).not.toHaveBeenCalled();
    }
  );
  it('unlinks a plain association directly without a sync warning', async () => {
    const f = installAssociations();
    render(<RawTableAutomations rawTable={{ id: 'table', name: 'Excel' } as never} />);
    const item = await screen.findByRole('listitem', { name: 'one' });
    fireEvent.click(within(item).getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(f.update).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(f.rows[0].tableBindings).toEqual([]);
    expect(f.rows[0].actionGraph.nodes[0].type).toBe('test');
    expect(f.rows[1].tableBindings).toHaveLength(1);
  });
  it('removes result subscription and sync action in one update', async () => {
    const f = installAssociations('result');
    const row = f.rows[0] as unknown as import('../../src/shared/automation/types').Automation;
    row.actionGraph.nodes = [
      {
        id: 'push',
        type: 'cloud.sync',
        enabled: true,
        config: { direction: 'output', resultTableId: 'table' },
      },
    ];
    row.outputBindings = [{ resultTableId: 'table', runOnChange: true }];
    render(<ResultTableAutomations resultTable={{ id: 'table', name: 'Result' } as never} />);
    const item = await screen.findByRole('listitem', { name: 'one' });
    fireEvent.click(within(item).getByRole('button', { name: 'Unlink' }));
    const confirmation = await screen.findByRole('dialog');
    expect(within(confirmation).getByText(/Step 1:/)).toBeTruthy();
    expect(f.update).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(f.update).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        (within(item).getByRole('button', { name: 'Unlink' }) as HTMLButtonElement).disabled
      ).toBe(false)
    );
    fireEvent.click(within(item).getByRole('button', { name: 'Unlink' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Unlink' })
    );
    await waitFor(() => expect(f.update).toHaveBeenCalledTimes(1));
    expect(f.update.mock.calls[0][1]).toMatchObject({
      tableBindings: [],
      outputBindings: [],
      actionGraph: { nodes: [] },
    });
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'one' })).toBeNull());
    expect(screen.getByRole('listitem', { name: 'two' })).toBeTruthy();
  });
});
