/**
 * 数据 → 云连接：左侧逻辑分组 + 右侧引用原始表 / 结果表。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  Eye,
  Folder,
  FolderPlus,
  Loader2,
  MoreVertical,
  Plus,
  PlugZap,
  RefreshCw,
  ScrollText,
  Settings2,
  Table2,
  Trash2,
  Unplug,
} from 'lucide-react';

import type {
  CloudConnectionActionResult,
  CloudConnectionGroup,
  CloudConnectionGroupInput,
  CloudConnectionRefStatus,
  CloudConnectionState,
  CloudConnectionTablePreview,
  CloudConnectionTableRef,
  DataRawTable,
  DataRawTablePreview,
  DataResultTable,
} from '../../../shared/contracts';
import { cloudConnectionClient } from '../../features/cloud-connection/api/cloud-connection-client';
import { dataClient } from '../../features/data/api/data-client';
import {
  errorText,
  isLiveStatus,
} from '../../features/cloud-connection/hooks/use-cloud-connection';
import { showToast } from '../../utils/toast';
import { GlassDropdownMenu, GlassMenuItem, GlassMenuSeparator } from '../GlassDropdownMenu';
import { useOptionalConfirmDialog } from '../ConfirmDialog';
import { CloudConnectionPreviewDialog, toDataRawTablePreview } from './cloud-connection-preview';
import { EmptyState, fixedTabGroupWidth } from './shared';
import { Badge, cn } from '../ui';
import { groupClass, titleCellClass } from './raw-source-wizard';

type Selection =
  | { kind: 'none' }
  | { kind: 'newGroup' }
  | { kind: 'group'; groupId: string }
  | { kind: 'newTable'; groupId: string }
  | { kind: 'table'; groupId: string; reportName: string };

export type CloudConnectionFocus = {
  nonce: number;
  groupId: string;
  tableId?: string;
  showPicker?: boolean;
};

type Run = (key: string, action: () => Promise<CloudConnectionActionResult>) => Promise<boolean>;

const flushInputClass =
  'min-w-0 flex-1 outline-none hover:bg-surface-hover focus:bg-surface-hover disabled:cursor-default disabled:opacity-60';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ui-form-row">
      <span className="ui-form-label items-center">{label}</span>
      <div className="ui-form-value">{children}</div>
    </div>
  );
}

function HeaderAction({
  children,
  onClick,
  disabled,
  danger,
  testId,
  loading,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      data-testid={testId}
      onClick={onClick}
      className={cn(titleCellClass, danger ? 'text-error hover:bg-error/[0.08]' : 'text-accent')}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children}
    </button>
  );
}

function statusLabel(t: (key: string) => string, status: CloudConnectionRefStatus) {
  if (status === 'ok') return t('cloudConnection.ds.statusOk');
  if (status === 'missing') return t('cloudConnection.ds.statusMissing');
  if (status === 'unmaterialized') return t('cloudConnection.ds.statusUnmaterialized');
  if (status === 'abnormal') return t('cloudConnection.ds.statusAbnormal');
  return t('cloudConnection.ds.statusPending');
}

function statusTone(status: CloudConnectionRefStatus): 'success' | 'error' | 'warning' | 'default' {
  if (status === 'ok') return 'success';
  if (status === 'missing' || status === 'abnormal') return 'error';
  if (status === 'unmaterialized') return 'warning';
  return 'default';
}

export function DatasourceManager({
  state,
  busy,
  run,
  statusBadge,
  onOpenSettings,
  onOpenLog,
  onCreateRawTable,
  initialFocus,
}: {
  state: CloudConnectionState;
  busy: string | null;
  run: Run;
  statusBadge: ReactNode;
  onOpenSettings: () => void;
  onOpenLog: () => void;
  onCreateRawTable?: (groupId: string) => void;
  initialFocus?: CloudConnectionFocus | null;
}) {
  const { t } = useTranslation();
  const confirmDialog = useOptionalConfirmDialog();
  const live = isLiveStatus(state);
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(state.groups.map((g) => g.id))
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<DataRawTablePreview | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewTotalRows, setPreviewTotalRows] = useState<number | undefined>(undefined);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const appliedFocus = useRef<number | null>(null);
  useEffect(() => {
    if (!initialFocus || appliedFocus.current === initialFocus.nonce) return;
    const group = state.groups.find((g) => g.id === initialFocus.groupId);
    if (!group) return;
    setCollapsed((current) => {
      if (!current.has(group.id)) return current;
      const next = new Set(current);
      next.delete(group.id);
      return next;
    });
    if (initialFocus.tableId) {
      const table = group.tables.find(
        (tb) => tb.kind === 'raw' && tb.tableId === initialFocus.tableId
      );
      if (!table) return;
      appliedFocus.current = initialFocus.nonce;
      setSelection({ kind: 'table', groupId: group.id, reportName: table.reportName });
      return;
    }
    appliedFocus.current = initialFocus.nonce;
    setSelection(
      initialFocus.showPicker
        ? { kind: 'newTable', groupId: group.id }
        : { kind: 'group', groupId: group.id }
    );
  }, [initialFocus, state.groups]);

  useEffect(() => {
    if (selection.kind === 'none' || selection.kind === 'newGroup') return;
    const group = state.groups.find((g) => g.id === selection.groupId);
    if (!group) setSelection({ kind: 'none' });
    else if (
      selection.kind === 'table' &&
      !group.tables.some((tb) => tb.reportName === selection.reportName)
    ) {
      setSelection({ kind: 'group', groupId: group.id });
    }
  }, [state.groups, selection]);

  const confirm = async (message: string) =>
    confirmDialog ? confirmDialog.confirmDelete({ message }) : true;

  const showPreview = async (load: () => Promise<CloudConnectionTablePreview>) => {
    setPreview(null);
    setPreviewError(null);
    setPreviewTitle('');
    setPreviewTotalRows(undefined);
    setPreviewOpen(true);
    setPreviewing(true);
    try {
      const raw = await load();
      setPreviewTitle(raw.tableName);
      setPreviewTotalRows(raw.rowCount);
      setPreview(toDataRawTablePreview(raw));
    } catch (error) {
      const message = errorText(error);
      setPreviewError(message);
      showToast('error', message);
    } finally {
      setPreviewing(false);
    }
  };

  const selectedGroup =
    selection.kind !== 'none' && selection.kind !== 'newGroup'
      ? state.groups.find((g) => g.id === selection.groupId)
      : undefined;

  const tableCount = (group: CloudConnectionGroup) =>
    group.entries.length > 0 ? group.entries.length : group.tables.length;

  const toggleGroup = (groupId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <div
      className="glass-table ui-table-flush flex min-h-0 flex-1 flex-col"
      data-testid="cloud-connection-datasources"
    >
      <div className="flex min-h-0 flex-1">
        <aside
          className="flex min-h-0 flex-shrink-0 flex-col border-r border-border-subtle"
          style={{ width: fixedTabGroupWidth(3) }}
          data-testid="cloud-connection-group-tree"
        >
          <div className="flex h-10 flex-shrink-0 items-center justify-between gap-2 border-b border-border-subtle pl-3 pr-2">
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-text-secondary">
              <span className="truncate">{t('cloudConnection.title')}</span>
              {statusBadge}
            </span>
            <div className="flex flex-shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
                data-testid="cloud-connection-add-group"
                onClick={() => setSelection({ kind: 'newGroup' })}
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {t('cloudConnection.ds.addGroup')}
              </button>
              <GlassDropdownMenu
                align="end"
                contentClassName="w-44"
                trigger={
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
                    aria-label={t('data.actions.more')}
                    title={t('data.actions.more')}
                    data-testid="cloud-connection-more"
                  >
                    {busy === 'refresh' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <MoreVertical className="h-3.5 w-3.5" />
                    )}
                  </button>
                }
              >
                <GlassMenuItem
                  icon={<Settings2 className="h-3.5 w-3.5" />}
                  onSelect={onOpenSettings}
                >
                  {t('cloudConnection.actions.openSettings')}
                </GlassMenuItem>
                {live ? (
                  <GlassMenuItem
                    icon={<Unplug className="h-3.5 w-3.5" />}
                    disabled={busy !== null}
                    danger
                    onSelect={() => void run('disconnect', cloudConnectionClient.disconnect)}
                  >
                    {t('cloudConnection.actions.disconnect')}
                  </GlassMenuItem>
                ) : (
                  <GlassMenuItem
                    icon={<PlugZap className="h-3.5 w-3.5" />}
                    disabled={busy !== null}
                    onSelect={() => void run('connect', cloudConnectionClient.connect)}
                  >
                    {t('cloudConnection.actions.connect')}
                  </GlassMenuItem>
                )}
                <GlassMenuSeparator />
                <GlassMenuItem
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  disabled={busy !== null || state.groups.length === 0}
                  onSelect={() => void run('refresh', () => cloudConnectionClient.refreshTables())}
                >
                  {t('cloudConnection.actions.refresh')}
                </GlassMenuItem>
                <GlassMenuSeparator />
                <GlassMenuItem icon={<ScrollText className="h-3.5 w-3.5" />} onSelect={onOpenLog}>
                  {t('cloudConnection.actions.activityLog')}
                </GlassMenuItem>
              </GlassDropdownMenu>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {state.groups.length === 0 ? (
              <div className="px-2 py-6 text-[13px] text-text-muted">
                {t('cloudConnection.ds.emptyGroups')}
              </div>
            ) : (
              <div className="space-y-3">
                {state.groups.map((group) => {
                  const open = !collapsed.has(group.id);
                  const groupActive = selection.kind === 'group' && selection.groupId === group.id;
                  return (
                    <section key={group.id} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSelection({ kind: 'group', groupId: group.id });
                          setCollapsed((prev) => {
                            const next = new Set(prev);
                            next.delete(group.id);
                            return next;
                          });
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-hover',
                          groupActive && 'bg-accent-muted ring-1 ring-inset ring-accent/15'
                        )}
                      >
                        <ChevronRight
                          className={cn(
                            'h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform',
                            open && 'rotate-90'
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleGroup(group.id);
                          }}
                        />
                        <Folder className="h-3.5 w-3.5 flex-shrink-0 text-accent-text" />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text-primary">
                          {group.sourceName}
                        </span>
                        {group.entriesStatus === 'pending' ? (
                          <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-text-muted" />
                        ) : (
                          <span className="flex-shrink-0 text-[11px] font-medium text-text-muted">
                            {t('cloudConnection.ds.tableCount', { count: tableCount(group) })}
                          </span>
                        )}
                      </button>
                      {open && (
                        <div className="ml-[21px] space-y-0.5 border-l border-border-subtle pl-2">
                          {group.tables.map((table) => {
                            const active =
                              selection.kind === 'table' &&
                              selection.groupId === group.id &&
                              selection.reportName === table.reportName;
                            return (
                              <button
                                type="button"
                                key={`m-${table.reportName}`}
                                className={cn(
                                  'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium transition-colors',
                                  active
                                    ? 'bg-accent-muted text-accent-text ring-1 ring-inset ring-accent/15'
                                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                                )}
                                onClick={() =>
                                  setSelection({
                                    kind: 'table',
                                    groupId: group.id,
                                    reportName: table.reportName,
                                  })
                                }
                              >
                                <Table2 className="h-3.5 w-3.5 flex-shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{table.reportName}</span>
                                <Badge tone={statusTone(table.status)}>
                                  {table.kind === 'result'
                                    ? t('cloudConnection.ds.refKindResult')
                                    : t('cloudConnection.ds.refKindRaw')}
                                </Badge>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          {selection.kind === 'none' && (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <EmptyState
                label={t('cloudConnection.ds.selectTitle')}
                description={t('cloudConnection.ds.selectDesc')}
              />
            </div>
          )}
          {selection.kind === 'newGroup' && (
            <GroupForm
              busy={busy}
              onSave={async (input) => {
                const ok = await run('add-group', () => cloudConnectionClient.addGroup(input));
                if (ok) setSelection({ kind: 'none' });
                return ok;
              }}
              onCancel={() => setSelection({ kind: 'none' })}
            />
          )}
          {selection.kind === 'group' && selectedGroup && (
            <GroupForm
              group={selectedGroup}
              busy={busy}
              onSave={async (input) =>
                run('update-group', () =>
                  cloudConnectionClient.updateGroup(selectedGroup.id, input)
                )
              }
              onDelete={async () => {
                if (!(await confirm(t('cloudConnection.ds.deleteGroupConfirm')))) return;
                const ok = await run('delete-group', () =>
                  cloudConnectionClient.deleteGroup(selectedGroup.id)
                );
                if (ok) setSelection({ kind: 'none' });
              }}
              onAddTable={() => setSelection({ kind: 'newTable', groupId: selectedGroup.id })}
            />
          )}
          {selection.kind === 'newTable' && selectedGroup && (
            <TablePicker
              group={selectedGroup}
              busy={busy}
              onCreateRawTable={
                onCreateRawTable ? () => onCreateRawTable(selectedGroup.id) : undefined
              }
              onCancel={() => setSelection({ kind: 'group', groupId: selectedGroup.id })}
              onSave={async (refs) => {
                const ok = await run('add-refs', () =>
                  cloudConnectionClient.addTableRefs(selectedGroup.id, refs)
                );
                if (ok) setSelection({ kind: 'group', groupId: selectedGroup.id });
                return ok;
              }}
            />
          )}
          {selection.kind === 'table' && selectedGroup && (
            <TableRefForm
              group={selectedGroup}
              table={selectedGroup.tables.find((tb) => tb.reportName === selection.reportName)}
              busy={busy}
              onPreview={() =>
                void showPreview(() =>
                  cloudConnectionClient.previewTable(selectedGroup.id, selection.reportName)
                )
              }
              onSaveName={async (reportName) =>
                run('rename-ref', () =>
                  cloudConnectionClient.updateTableRef(selectedGroup.id, selection.reportName, {
                    reportName,
                  })
                )
              }
              onDelete={async () => {
                if (!(await confirm(t('cloudConnection.ds.deleteRefConfirm')))) return;
                const ok = await run('delete-table', () =>
                  cloudConnectionClient.deleteTable(selectedGroup.id, selection.reportName)
                );
                if (ok) setSelection({ kind: 'group', groupId: selectedGroup.id });
              }}
            />
          )}
        </section>
      </div>
      <CloudConnectionPreviewDialog
        open={previewOpen}
        title={previewTitle}
        preview={preview}
        isLoading={previewing && !preview}
        error={previewError}
        totalRowCount={previewTotalRows}
        onClose={() => {
          setPreviewOpen(false);
          setPreview(null);
          setPreviewError(null);
        }}
      />
    </div>
  );
}

function PaneHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-12 flex-shrink-0 items-stretch justify-between border-b border-border-subtle">
      <div className="flex min-w-0 items-center px-3">
        <span className="min-w-0 truncate text-[14px] font-semibold text-text-primary">
          {title}
        </span>
      </div>
      <div className="flex flex-shrink-0 items-stretch">{children}</div>
    </div>
  );
}

function GroupForm({
  group,
  busy,
  onSave,
  onCancel,
  onDelete,
  onAddTable,
}: {
  group?: CloudConnectionGroup;
  busy: string | null;
  onSave: (input: CloudConnectionGroupInput) => Promise<boolean>;
  onCancel?: () => void;
  onDelete?: () => void;
  onAddTable?: () => void;
}) {
  const { t } = useTranslation();
  const [sourceName, setSourceName] = useState(group?.sourceName ?? '');
  const locked = Boolean(group);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="cloud-connection-group-form">
      <PaneHeader title={group ? group.sourceName : t('cloudConnection.ds.newGroup')}>
        {group ? (
          <>
            <HeaderAction
              testId="cloud-connection-add-table"
              disabled={!onAddTable}
              onClick={onAddTable}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('cloudConnection.ds.addTable')}
            </HeaderAction>
            <HeaderAction
              danger
              testId="cloud-connection-delete-group"
              onClick={() => void onDelete?.()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('data.actions.delete')}
            </HeaderAction>
          </>
        ) : (
          <>
            <HeaderAction testId="cloud-connection-group-cancel" onClick={onCancel}>
              {t('common.cancel')}
            </HeaderAction>
            <HeaderAction
              testId="cloud-connection-group-save"
              loading={busy === 'add-group'}
              onClick={() => void onSave({ sourceName })}
            >
              {t('common.save')}
            </HeaderAction>
          </>
        )}
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <section className={groupClass}>
          <div className="ui-group-title">{t('cloudConnection.ds.groupName')}</div>
          <Row label={t('cloudConnection.ds.groupName')}>
            <input
              value={sourceName}
              disabled={locked}
              onChange={(e) => setSourceName(e.target.value)}
              className={cn('ui-flush-text', flushInputClass)}
              data-testid="cloud-connection-group-name"
            />
          </Row>
          {locked && (
            <div
              className="px-3 py-2 text-[12px] text-text-muted"
              title={t('cloudConnection.ds.groupNameLocked')}
            >
              {t('cloudConnection.ds.groupNameLocked')}
            </div>
          )}
        </section>
        {group && group.tables.length === 0 && (
          <p className="mt-3 px-1 text-[13px] text-text-muted">
            {t('cloudConnection.ds.emptyTables')}
          </p>
        )}
      </div>
    </div>
  );
}

function TablePicker({
  group,
  busy,
  onCancel,
  onSave,
  onCreateRawTable,
}: {
  group: CloudConnectionGroup;
  busy: string | null;
  onCancel: () => void;
  onSave: (refs: Array<{ kind: 'raw' | 'result'; tableId: string }>) => Promise<boolean>;
  onCreateRawTable?: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [rawTables, setRawTables] = useState<DataRawTable[]>([]);
  const [resultTables, setResultTables] = useState<DataResultTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    dataClient
      .getDashboard({
        includeSummary: false,
        includePipelines: false,
        includeRawTables: true,
        includeResultTables: true,
        rawTableLimit: 1000,
        outputLimit: 1000,
      })
      .then((dashboard) => {
        if (cancelled) return;
        setRawTables(dashboard.rawTables ?? []);
        setResultTables(dashboard.resultTables ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const used = useMemo(
    () => new Set(group.tables.map((table) => `${table.kind}:${table.tableId}`)),
    [group.tables]
  );
  const match = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
  const raws = rawTables.filter((table) => !query.trim() || match(table.name));
  const results = resultTables.filter((table) => !query.trim() || match(table.name));

  const toggle = (key: string) => {
    if (used.has(key)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="cloud-connection-table-picker">
      <PaneHeader title={t('cloudConnection.ds.pickerTitle')}>
        <HeaderAction
          testId="cloud-connection-create-raw-table"
          onClick={onCreateRawTable}
          disabled={!onCreateRawTable}
        >
          {t('cloudConnection.ds.createRawTable')}
        </HeaderAction>
        <HeaderAction onClick={onCancel}>{t('common.cancel')}</HeaderAction>
        <HeaderAction
          testId="cloud-connection-save-table"
          disabled={picked.size === 0}
          loading={busy === 'add-refs'}
          onClick={() =>
            void onSave(
              [...picked].map((key) => {
                const [kind, tableId] = key.split(':') as ['raw' | 'result', string];
                return { kind, tableId };
              })
            )
          }
        >
          {t('cloudConnection.ds.pickerAdd')}
        </HeaderAction>
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('cloudConnection.ds.pickerSearch')}
          className="mb-3 h-9 w-full border border-border-subtle bg-transparent px-2.5 text-[13px] outline-none"
          data-testid="cloud-connection-picker-search"
        />
        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </div>
        ) : error ? (
          <p className="text-[13px] text-error">{error}</p>
        ) : raws.length === 0 && results.length === 0 ? (
          <div
            className="flex flex-col items-start gap-3"
            data-testid="cloud-connection-picker-empty"
          >
            <p className="text-[13px] text-text-muted">{t('cloudConnection.ds.pickerEmpty')}</p>
            <button
              type="button"
              data-testid="cloud-connection-create-raw-table-empty"
              onClick={onCreateRawTable}
              disabled={!onCreateRawTable}
              className="inline-flex h-8 items-center gap-1.5 border border-border-subtle bg-surface px-3 text-[13px] font-medium text-accent hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('cloudConnection.ds.createRawTable')}
            </button>
          </div>
        ) : (
          <div className="space-y-4" data-testid="cloud-connection-picker-list">
            <PickerSection
              title={t('cloudConnection.ds.pickerRaw')}
              items={raws.map((table) => ({
                key: `raw:${table.id}`,
                name: table.name,
                disabled: used.has(`raw:${table.id}`),
              }))}
              picked={picked}
              onToggle={toggle}
            />
            <PickerSection
              title={t('cloudConnection.ds.pickerResult')}
              items={results.map((table) => ({
                key: `result:${table.id}`,
                name: table.name,
                disabled: used.has(`result:${table.id}`),
              }))}
              picked={picked}
              onToggle={toggle}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PickerSection({
  title,
  items,
  picked,
  onToggle,
}: {
  title: string;
  items: Array<{ key: string; name: string; disabled: boolean }>;
  picked: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className={groupClass}>
      <div className="ui-group-title">{title}</div>
      {items.map((item) => (
        <label
          key={item.key}
          className={cn(
            'flex h-9 items-center gap-2 border-t border-border-subtle px-3 text-[13px]',
            item.disabled
              ? 'cursor-not-allowed opacity-50'
              : 'cursor-pointer hover:bg-surface-hover'
          )}
        >
          <input
            type="checkbox"
            checked={picked.has(item.key) || item.disabled}
            disabled={item.disabled}
            onChange={() => onToggle(item.key)}
            className="accent-[var(--color-accent)]"
          />
          <span className="min-w-0 truncate">{item.name}</span>
        </label>
      ))}
    </section>
  );
}

function TableRefForm({
  group: _group,
  table,
  busy,
  onPreview,
  onSaveName,
  onDelete,
}: {
  group: CloudConnectionGroup;
  table?: CloudConnectionTableRef;
  busy: string | null;
  onPreview: () => void;
  onSaveName: (reportName: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [reportName, setReportName] = useState(table?.reportName ?? '');
  useEffect(() => {
    setReportName(table?.reportName ?? '');
  }, [table?.reportName]);
  if (!table) return null;
  const dirty = reportName.trim() !== table.reportName;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="cloud-connection-table-form">
      <PaneHeader title={table.reportName}>
        <HeaderAction testId="cloud-connection-preview-table" onClick={onPreview}>
          <Eye className="h-3.5 w-3.5" />
          {t('cloudConnection.actions.preview')}
        </HeaderAction>
        {dirty && (
          <HeaderAction
            testId="cloud-connection-save-table"
            loading={busy === 'rename-ref'}
            onClick={() => void onSaveName(reportName)}
          >
            {t('common.save')}
          </HeaderAction>
        )}
        <HeaderAction danger testId="cloud-connection-delete-table" onClick={() => void onDelete()}>
          <Trash2 className="h-3.5 w-3.5" />
          {t('cloudConnection.ds.deleteRef')}
        </HeaderAction>
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <section className={groupClass}>
          <div className="ui-group-title">{table.reportName}</div>
          <Row label={t('cloudConnection.ds.refKind')}>
            <span className="ui-flush-text">
              {table.kind === 'result'
                ? t('cloudConnection.ds.refKindResult')
                : t('cloudConnection.ds.refKindRaw')}
            </span>
          </Row>
          <Row label={t('cloudConnection.ds.displayName')}>
            <span className="ui-flush-text">{table.displayName || '—'}</span>
          </Row>
          <Row label={t('cloudConnection.ds.refStatus')}>
            <Badge tone={statusTone(table.status)}>{statusLabel(t, table.status)}</Badge>
          </Row>
          <Row label={t('cloudConnection.ds.reportName')}>
            <input
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              className={cn('ui-flush-text', flushInputClass)}
              data-testid="cloud-connection-report-name"
            />
          </Row>
          <div className="px-3 py-2 text-[12px] text-text-muted">
            {t('cloudConnection.ds.reportNameHint')}
          </div>
        </section>
      </div>
    </div>
  );
}
