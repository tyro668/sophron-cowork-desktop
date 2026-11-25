/**
 * 数据 → 云连接的数据源管理，布局对齐「云空间」：左侧分组树 + 右侧配置表单。
 * 字段语义与 Java `LocalDatasourceBean` / `ExcelTableBean` 一致。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  Eye,
  FileSpreadsheet,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  PlugZap,
  RefreshCw,
  ScrollText,
  Settings2,
  Table2,
  Trash2,
  Unplug,
  MoreVertical,
} from 'lucide-react';

import type {
  CloudConnectionActionResult,
  CloudConnectionGroup,
  CloudConnectionGroupInput,
  CloudConnectionState,
  CloudConnectionTableConfig,
  CloudConnectionTableInput,
  CloudConnectionTablePreview,
  DataRawTablePreview,
} from '../../../shared/contracts';
import { cloudConnectionClient } from '../../features/cloud-connection/api/cloud-connection-client';
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
import { cellSelectClass, groupClass, titleCellClass } from './raw-source-wizard';

type Selection =
  | { kind: 'none' }
  | { kind: 'newGroup' }
  | { kind: 'group'; groupId: string }
  | { kind: 'newTable'; groupId: string }
  | { kind: 'table'; groupId: string; tableName: string }
  | { kind: 'entry'; groupId: string; entryId: string };

type Run = (key: string, action: () => Promise<CloudConnectionActionResult>) => Promise<boolean>;

/** 与 Java `ExcelTableBean` 默认值一致。 */
export const DEFAULT_TABLE_FORM: CloudConnectionTableInput = {
  tableName: '',
  strategy: 5,
  fieldStrategy: 0,
  readStrategy: 0,
  appendStrategy: 0,
  relativeFilePath: '',
  headerRowNumber: 1,
  sheetStrategy: 0,
  sheetNumber: 1,
  sheetName: 'Sheet1',
  password: undefined,
};

const EMPTY_GROUP_FORM: CloudConnectionGroupInput = {
  sourceName: '',
  directoryPath: '',
  strategy: 1,
};

const flushInputClass =
  'min-w-0 flex-1 outline-none hover:bg-surface-hover focus:bg-surface-hover disabled:cursor-default disabled:opacity-60';

function Row({ label, children, split }: { label: string; children: ReactNode; split?: boolean }) {
  return (
    <div className="ui-form-row">
      <span className="ui-form-label items-center">{label}</span>
      <div className={cn('ui-form-value', split && '!flex-row items-stretch')}>{children}</div>
    </div>
  );
}

function FlushSelect({
  value,
  options,
  disabled,
  onChange,
  className,
  testId,
}: {
  value: number | string;
  options: Array<{ value: number | string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
  testId?: string;
}) {
  const label = options.find((o) => String(o.value) === String(value))?.label ?? String(value);
  if (disabled) {
    return (
      <span className={cn('ui-flush-text min-w-0 flex-1', className)} data-testid={testId}>
        {label}
      </span>
    );
  }
  return (
    <select
      value={String(value)}
      data-testid={testId}
      onChange={(e) => onChange(e.target.value)}
      className={cn(cellSelectClass, 'min-w-0 flex-1', className)}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
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

export function DatasourceManager({
  state,
  busy,
  run,
  statusBadge,
  onOpenSettings,
  onOpenLog,
}: {
  state: CloudConnectionState;
  busy: string | null;
  run: Run;
  statusBadge: ReactNode;
  onOpenSettings: () => void;
  onOpenLog: () => void;
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

  // 选中的分组 / 表被删除后回退
  useEffect(() => {
    if (selection.kind === 'none' || selection.kind === 'newGroup') return;
    const group = state.groups.find((g) => g.id === selection.groupId);
    if (!group) setSelection({ kind: 'none' });
    else if (
      selection.kind === 'table' &&
      !group.tables.some((tb) => tb.tableName === selection.tableName)
    )
      setSelection({ kind: 'group', groupId: group.id });
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
                  const autoEntries = group.entries.filter((e) => !e.manual);
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
                        <span
                          className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text-primary"
                          title={group.directoryPath}
                        >
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
                              selection.tableName === table.tableName;
                            return (
                              <button
                                type="button"
                                key={`m-${table.tableName}`}
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
                                    tableName: table.tableName,
                                  })
                                }
                              >
                                <Table2 className="h-3.5 w-3.5 flex-shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{table.tableName}</span>
                                <Badge tone="accent">{t('cloudConnection.ds.manual')}</Badge>
                              </button>
                            );
                          })}
                          {autoEntries.map((entry) => {
                            const active =
                              selection.kind === 'entry' &&
                              selection.groupId === group.id &&
                              selection.entryId === entry.id;
                            return (
                              <button
                                type="button"
                                key={`a-${entry.id}`}
                                title={entry.id}
                                className={cn(
                                  'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium transition-colors',
                                  active
                                    ? 'bg-accent-muted text-accent-text ring-1 ring-inset ring-accent/15'
                                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                                )}
                                onClick={() =>
                                  setSelection({
                                    kind: 'entry',
                                    groupId: group.id,
                                    entryId: entry.id,
                                  })
                                }
                              >
                                <FileSpreadsheet className="h-3.5 w-3.5 flex-shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{entry.id}</span>
                              </button>
                            );
                          })}
                          {group.tables.length === 0 && autoEntries.length === 0 && (
                            <div className="h-8 px-2 py-2 text-[12px] text-text-muted">
                              {group.entriesStatus === 'pending'
                                ? t('cloudConnection.fileStatus.parsing')
                                : t('cloudConnection.ds.emptyTables')}
                            </div>
                          )}
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
          {selection.kind === 'none' ? (
            <>
              <div className="flex h-12 flex-shrink-0 items-center border-b border-border-subtle px-3" />
              <div className="flex min-h-0 flex-1 flex-col justify-center overflow-auto">
                <EmptyState
                  label={t('cloudConnection.ds.selectTitle')}
                  description={t('cloudConnection.ds.selectDesc')}
                />
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {selection.kind === 'newGroup' && (
                <GroupForm
                  key="new-group"
                  busy={busy}
                  onCancel={() =>
                    setSelection(
                      state.groups[0]
                        ? { kind: 'group', groupId: state.groups[0].id }
                        : { kind: 'none' }
                    )
                  }
                  onSave={async (input) => {
                    const before = new Set(state.groups.map((g) => g.id));
                    let created: string | undefined;
                    const ok = await run('group', async () => {
                      const result = await cloudConnectionClient.addGroup(input);
                      created = result.state.groups.find((g) => !before.has(g.id))?.id;
                      return result;
                    });
                    if (ok && created) setSelection({ kind: 'group', groupId: created });
                    return ok;
                  }}
                />
              )}
              {selection.kind === 'group' && selectedGroup && (
                <GroupForm
                  key={`group-${selectedGroup.id}`}
                  group={selectedGroup}
                  busy={busy}
                  onAddTable={() => setSelection({ kind: 'newTable', groupId: selectedGroup.id })}
                  onSave={(input) =>
                    run('group', () => cloudConnectionClient.updateGroup(selectedGroup.id, input))
                  }
                  onDelete={async () => {
                    if (await confirm(t('cloudConnection.ds.deleteGroupConfirm')))
                      await run('group', () => cloudConnectionClient.deleteGroup(selectedGroup.id));
                  }}
                  onRemoveLegacy={async (filePath) => {
                    if (await confirm(t('cloudConnection.removeConfirm')))
                      await run('legacy', () =>
                        cloudConnectionClient.removeLegacyFile(selectedGroup.id, filePath)
                      );
                  }}
                />
              )}
              {(selection.kind === 'newTable' || selection.kind === 'table') && selectedGroup && (
                <TableForm
                  key={
                    selection.kind === 'table'
                      ? `table-${selectedGroup.id}-${selection.tableName}`
                      : `new-table-${selectedGroup.id}`
                  }
                  group={selectedGroup}
                  table={
                    selection.kind === 'table'
                      ? selectedGroup.tables.find((tb) => tb.tableName === selection.tableName)
                      : undefined
                  }
                  busy={busy}
                  previewing={previewing}
                  onPreview={(original, input) =>
                    void showPreview(() =>
                      cloudConnectionClient.previewDraft(selectedGroup.id, original, input)
                    )
                  }
                  onCancel={() => setSelection({ kind: 'group', groupId: selectedGroup.id })}
                  onSave={async (original, input) => {
                    const ok = await run('table', () =>
                      cloudConnectionClient.saveTable(selectedGroup.id, original, input)
                    );
                    if (ok)
                      setSelection({
                        kind: 'table',
                        groupId: selectedGroup.id,
                        tableName: input.tableName.trim(),
                      });
                    return ok;
                  }}
                  onDelete={async (tableName) => {
                    if (await confirm(t('cloudConnection.ds.deleteTableConfirm')))
                      await run('table', () =>
                        cloudConnectionClient.deleteTable(selectedGroup.id, tableName)
                      );
                  }}
                />
              )}
              {selection.kind === 'entry' && selectedGroup && (
                <EntryDetail
                  group={selectedGroup}
                  entryId={selection.entryId}
                  previewing={previewing}
                  onPreview={() =>
                    void showPreview(() =>
                      cloudConnectionClient.previewTable(selectedGroup.id, selection.entryId)
                    )
                  }
                />
              )}
            </div>
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
  onRemoveLegacy,
}: {
  group?: CloudConnectionGroup;
  busy: string | null;
  onSave: (input: CloudConnectionGroupInput) => Promise<boolean>;
  onCancel?: () => void;
  onDelete?: () => void;
  onAddTable?: () => void;
  onRemoveLegacy?: (filePath: string) => void;
}) {
  const { t } = useTranslation();
  const initial = useMemo<CloudConnectionGroupInput>(
    () =>
      group
        ? {
            sourceName: group.sourceName,
            directoryPath: group.directoryPath,
            strategy: group.strategy,
          }
        : EMPTY_GROUP_FORM,
    [group]
  );
  const [form, setForm] = useState(initial);
  const [editing, setEditing] = useState(!group);
  useEffect(() => {
    if (!editing) setForm(initial);
  }, [initial, editing]);

  const strategyOptions = [
    { value: '0', label: t('cloudConnection.ds.groupStrategy.0') },
    { value: '1', label: t('cloudConnection.ds.groupStrategy.1') },
    { value: '2', label: t('cloudConnection.ds.groupStrategy.2') },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="cloud-connection-group-form">
      <PaneHeader title={group ? group.sourceName : t('cloudConnection.ds.newGroup')}>
        {group && !editing && (
          <>
            <HeaderAction
              testId="cloud-connection-add-table"
              disabled={!group.directoryPath}
              onClick={onAddTable}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('cloudConnection.ds.addTable')}
            </HeaderAction>
            <HeaderAction testId="cloud-connection-group-edit" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
              {t('cloudConnection.ds.edit')}
            </HeaderAction>
            <HeaderAction danger onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </HeaderAction>
          </>
        )}
        {editing && (
          <>
            <HeaderAction
              onClick={() => {
                if (group) {
                  setForm(initial);
                  setEditing(false);
                } else onCancel?.();
              }}
            >
              {t('common.cancel')}
            </HeaderAction>
            <HeaderAction
              testId="cloud-connection-group-save"
              disabled={busy !== null}
              loading={busy === 'group'}
              onClick={() => {
                void onSave(form).then((ok) => {
                  if (ok) setEditing(false);
                });
              }}
            >
              {t('common.save')}
            </HeaderAction>
          </>
        )}
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <section className={groupClass}>
          <Row label={t('cloudConnection.ds.groupName')}>
            <input
              value={form.sourceName}
              disabled={!editing || Boolean(group)}
              maxLength={100}
              placeholder={t('cloudConnection.ds.groupNameLocked')}
              title={group ? t('cloudConnection.ds.groupNameLocked') : undefined}
              onChange={(e) => setForm({ ...form, sourceName: e.target.value })}
              data-testid="cloud-connection-group-name"
              className={flushInputClass}
            />
          </Row>
          <Row label={t('cloudConnection.ds.directory')} split>
            <input
              value={form.directoryPath}
              disabled={!editing}
              onChange={(e) => setForm({ ...form, directoryPath: e.target.value })}
              className={`${flushInputClass} font-mono text-[12px]`}
            />
            {editing && (
              <button
                type="button"
                aria-label={t('cloudConnection.ds.browse')}
                title={t('cloudConnection.ds.browse')}
                className="ui-accent-cell w-[88px] flex-shrink-0 border-l border-border-subtle"
                onClick={async () => {
                  const dir = await cloudConnectionClient.pickDirectory();
                  if (dir) setForm((f) => ({ ...f, directoryPath: dir }));
                }}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t('cloudConnection.ds.browse')}
              </button>
            )}
          </Row>
          <Row label={t('cloudConnection.ds.strategy')}>
            <FlushSelect
              value={form.strategy}
              disabled={!editing}
              options={strategyOptions}
              onChange={(v) => setForm({ ...form, strategy: Number(v) })}
            />
          </Row>
        </section>
        {group && group.files.length > 0 && (
          <section className={groupClass}>
            <div className="ui-group-title">{t('cloudConnection.ds.legacyFiles')}</div>
            {group.files.map((file) => (
              <div key={file} className="ui-form-row">
                <span className="ui-form-label items-center">
                  {t('cloudConnection.ds.filePath')}
                </span>
                <div className="ui-form-value !flex-row items-stretch">
                  <span className="ui-flush-text min-w-0 flex-1 truncate font-mono" title={file}>
                    {file}
                  </span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    className="inline-flex w-[88px] flex-shrink-0 items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                    onClick={() => onRemoveLegacy?.(file)}
                  >
                    {t('cloudConnection.actions.remove')}
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}
        {group?.entriesError && (
          <div className="px-1 py-2 text-[12px] text-error">{group.entriesError}</div>
        )}
      </div>
    </div>
  );
}

function toInput(table: CloudConnectionTableConfig | undefined): CloudConnectionTableInput {
  if (!table) return { ...DEFAULT_TABLE_FORM };
  const { hasPassword: _hasPassword, ...rest } = table;
  return { ...rest, password: undefined };
}

function TableForm({
  group,
  table,
  busy,
  previewing,
  onPreview,
  onSave,
  onCancel,
  onDelete,
}: {
  group: CloudConnectionGroup;
  table?: CloudConnectionTableConfig;
  busy: string | null;
  previewing: boolean;
  onPreview: (originalName: string | null, input: CloudConnectionTableInput) => void;
  onSave: (originalName: string | null, input: CloudConnectionTableInput) => Promise<boolean>;
  onCancel: () => void;
  onDelete: (tableName: string) => void;
}) {
  const { t } = useTranslation();
  const initial = useMemo(() => toInput(table), [table]);
  const [form, setForm] = useState<CloudConnectionTableInput>(initial);
  const [editing, setEditing] = useState(!table);
  useEffect(() => {
    if (!editing) setForm(initial);
  }, [initial, editing]);
  const set = (patch: Partial<CloudConnectionTableInput>) => setForm((f) => ({ ...f, ...patch }));
  const single = form.strategy === 0;
  const disabled = !editing;
  const original = table?.tableName ?? null;
  const opt = (prefix: string, values: number[]) =>
    values.map((v) => ({ value: v, label: t(`cloudConnection.ds.${prefix}.${v}`) }));
  const appendOptions = opt('appendStrategy', [0, 1]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="cloud-connection-table-form">
      <PaneHeader title={table ? table.tableName : t('cloudConnection.ds.newTable')}>
        {table && !editing && (
          <>
            <HeaderAction testId="cloud-connection-table-edit" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
              {t('cloudConnection.ds.edit')}
            </HeaderAction>
            <HeaderAction danger onClick={() => onDelete(table.tableName)}>
              <Trash2 className="h-3.5 w-3.5" />
            </HeaderAction>
          </>
        )}
        {editing && (
          <>
            <HeaderAction
              onClick={() => {
                if (table) {
                  setForm(initial);
                  setEditing(false);
                } else onCancel();
              }}
            >
              {t('common.cancel')}
            </HeaderAction>
            <HeaderAction
              testId="cloud-connection-table-save"
              disabled={busy !== null}
              loading={busy === 'table'}
              onClick={() => {
                void onSave(original, form).then((ok) => {
                  if (ok) setEditing(false);
                });
              }}
            >
              {t('common.save')}
            </HeaderAction>
          </>
        )}
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <section className={groupClass}>
          <Row label={t('cloudConnection.ds.tableName')} split>
            <input
              value={form.tableName}
              disabled={disabled}
              maxLength={200}
              onChange={(e) => set({ tableName: e.target.value })}
              data-testid="cloud-connection-table-name"
              className={flushInputClass}
            />
            <button
              type="button"
              aria-label={t('cloudConnection.actions.preview')}
              title={t('cloudConnection.actions.preview')}
              disabled={previewing || !form.relativeFilePath}
              className="ui-accent-cell w-[88px] flex-shrink-0 border-l border-border-subtle disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => onPreview(original, form)}
            >
              {previewing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {t('cloudConnection.actions.preview')}
            </button>
          </Row>
          <Row label={t('cloudConnection.ds.sourceStrategy')}>
            <FlushSelect
              value={single ? 'single' : 'merge'}
              disabled={disabled}
              options={[
                { value: 'merge', label: t('cloudConnection.ds.source.merge') },
                { value: 'single', label: t('cloudConnection.ds.source.single') },
              ]}
              onChange={(v) =>
                set({
                  strategy: v === 'single' ? 0 : 5,
                  relativeFilePath: '',
                })
              }
            />
          </Row>
          {!single && (
            <Row label={t('cloudConnection.ds.mergeStrategy')} split>
              <FlushSelect
                value={form.appendStrategy}
                disabled={disabled}
                options={appendOptions}
                onChange={(v) => set({ appendStrategy: Number(v) })}
              />
              <FlushSelect
                value={form.strategy}
                disabled={disabled}
                options={opt('sortStrategy', [5, 1, 2, 3, 4])}
                onChange={(v) => set({ strategy: Number(v) })}
                testId="cloud-connection-sort-strategy"
                className="border-l border-border-subtle"
              />
              <FlushSelect
                value={form.readStrategy}
                disabled={disabled}
                options={opt('readStrategy', [0, 1])}
                onChange={(v) => set({ readStrategy: Number(v) })}
                className="border-l border-border-subtle"
              />
            </Row>
          )}
          <Row label={t('cloudConnection.ds.fieldStrategy')}>
            <FlushSelect
              value={form.fieldStrategy}
              disabled={disabled}
              options={opt('fieldType', [0, 1])}
              onChange={(v) => set({ fieldStrategy: Number(v) })}
            />
          </Row>
          <Row label={t('cloudConnection.ds.filePath')} split>
            <input
              value={form.relativeFilePath}
              disabled={disabled}
              placeholder={single ? '/data.xlsx' : '/'}
              onChange={(e) => set({ relativeFilePath: e.target.value })}
              className={`${flushInputClass} font-mono text-[12px]`}
              title={group.directoryPath}
            />
            <button
              type="button"
              disabled={disabled}
              aria-label={t('cloudConnection.ds.browse')}
              title={t('cloudConnection.ds.browse')}
              className="ui-accent-cell w-[88px] flex-shrink-0 border-l border-border-subtle disabled:cursor-not-allowed disabled:opacity-50"
              onClick={async () => {
                try {
                  const rel = await cloudConnectionClient.pickTablePath(
                    group.id,
                    single ? 'file' : 'directory'
                  );
                  if (rel) set({ relativeFilePath: rel });
                } catch (error) {
                  showToast('error', errorText(error));
                }
              }}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {t('cloudConnection.ds.browse')}
            </button>
          </Row>
          <Row label={t('cloudConnection.ds.password')} split>
            <input
              type="password"
              autoComplete="new-password"
              value={form.password ?? ''}
              disabled={disabled}
              placeholder={
                table?.hasPassword && form.password === undefined
                  ? t('cloudConnection.ds.passwordSaved')
                  : t('cloudConnection.ds.passwordPlaceholder')
              }
              onChange={(e) => set({ password: e.target.value })}
              className={flushInputClass}
            />
            {editing && table?.hasPassword && form.password !== null && (
              <button
                type="button"
                className="ui-accent-cell w-[88px] flex-shrink-0 border-l border-border-subtle"
                onClick={() => set({ password: null })}
              >
                {t('cloudConnection.ds.clearPassword')}
              </button>
            )}
          </Row>
          <Row label={t('cloudConnection.ds.sheetStrategy')} split>
            <FlushSelect
              value={form.sheetStrategy}
              disabled={disabled}
              options={opt('sheet', [0, 1, 2])}
              onChange={(v) => set({ sheetStrategy: Number(v) })}
            />
            {form.sheetStrategy === 0 && (
              <div className="flex w-[88px] flex-shrink-0 items-stretch border-l border-border-subtle">
                <input
                  type="number"
                  min={1}
                  value={form.sheetNumber}
                  disabled={disabled}
                  onChange={(e) => set({ sheetNumber: Number(e.target.value) || 1 })}
                  className={flushInputClass}
                />
              </div>
            )}
            {form.sheetStrategy === 1 && (
              <div className="flex w-[140px] flex-shrink-0 items-stretch border-l border-border-subtle">
                <input
                  value={form.sheetName}
                  disabled={disabled}
                  onChange={(e) => set({ sheetName: e.target.value })}
                  className={flushInputClass}
                />
              </div>
            )}
            {form.sheetStrategy === 2 && single && (
              <FlushSelect
                value={form.appendStrategy}
                disabled={disabled}
                options={appendOptions}
                onChange={(v) => set({ appendStrategy: Number(v) })}
                className="border-l border-border-subtle"
              />
            )}
          </Row>
          <Row label={t('cloudConnection.ds.headerRow')}>
            <input
              type="number"
              min={1}
              value={form.headerRowNumber}
              disabled={disabled}
              onChange={(e) => set({ headerRowNumber: Math.max(1, Number(e.target.value) || 1) })}
              className={flushInputClass}
            />
          </Row>
        </section>
      </div>
    </div>
  );
}

function EntryDetail({
  group,
  entryId,
  previewing,
  onPreview,
}: {
  group: CloudConnectionGroup;
  entryId: string;
  previewing: boolean;
  onPreview: () => void;
}) {
  const { t } = useTranslation();
  const entry = group.entries.find((e) => e.id === entryId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader title={entryId}>
        <HeaderAction disabled={previewing} onClick={onPreview}>
          {previewing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
          {t('cloudConnection.actions.preview')}
        </HeaderAction>
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <section className={groupClass}>
          <Row label={t('cloudConnection.ds.groupName')}>
            <span className="ui-flush-text truncate">{group.sourceName}</span>
          </Row>
          <Row label={t('cloudConnection.ds.filePath')}>
            <span className="ui-flush-text truncate font-mono text-[12px]">
              {entry?.fileName ?? entryId}
            </span>
          </Row>
          <Row label="Sheet">
            <span className="ui-flush-text">{entry?.sheetName ?? '-'}</span>
          </Row>
        </section>
      </div>
    </div>
  );
}
