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
} from '../../../shared/contracts';
import { cloudConnectionClient } from '../../features/cloud-connection/api/cloud-connection-client';
import {
  errorText,
  isLiveStatus,
} from '../../features/cloud-connection/hooks/use-cloud-connection';
import { showToast } from '../../utils/toast';
import { GlassDropdownMenu, GlassMenuItem, GlassMenuSeparator } from '../GlassDropdownMenu';
import { useOptionalConfirmDialog } from '../ConfirmDialog';
import { CloudConnectionPreviewDialog } from './cloud-connection-preview';
import { EmptyState, fixedTabGroupWidth } from './shared';
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '../ui';
import { SegmentedControl } from '../settings/schedule/editor-controls';

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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ui-form-row">
      <span className="ui-form-label items-center">{label}</span>
      <div className="ui-form-value text-[13px]">
        <div className="flex min-w-0 items-center gap-1.5">{children}</div>
      </div>
    </div>
  );
}

function NumberSelect({
  value,
  options,
  disabled,
  onChange,
  className,
  testId,
}: {
  value: number;
  options: Array<{ value: number; label: string }>;
  disabled?: boolean;
  onChange: (value: number) => void;
  className?: string;
  testId?: string;
}) {
  return (
    <Select value={String(value)} disabled={disabled} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className={cn('min-w-0', className)} data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={String(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
  const [preview, setPreview] = useState<CloudConnectionTablePreview | null>(null);
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
    setPreviewing(true);
    try {
      setPreview(await load());
    } catch (error) {
      showToast('error', errorText(error));
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

  const canAddTableTo =
    selectedGroup && selectedGroup.directoryPath
      ? selectedGroup
      : selection.kind !== 'none' && selection.kind !== 'newGroup'
        ? state.groups.find((g) => g.id === selection.groupId)
        : undefined;

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
          <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-border-subtle pl-3 pr-2">
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-text-secondary">
              {t('cloudConnection.title')}
              {statusBadge}
            </span>
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
              <GlassMenuItem icon={<Settings2 className="h-3.5 w-3.5" />} onSelect={onOpenSettings}>
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
              <GlassMenuItem
                icon={<Plus className="h-3.5 w-3.5" />}
                onSelect={() => setSelection({ kind: 'newGroup' })}
              >
                {t('cloudConnection.ds.addGroup')}
              </GlassMenuItem>
              <GlassMenuItem
                icon={<Table2 className="h-3.5 w-3.5" />}
                disabled={!canAddTableTo?.directoryPath}
                onSelect={() => {
                  if (canAddTableTo) setSelection({ kind: 'newTable', groupId: canAddTableTo.id });
                }}
              >
                {t('cloudConnection.ds.addTable')}
              </GlassMenuItem>
              <GlassMenuSeparator />
              <GlassMenuItem icon={<ScrollText className="h-3.5 w-3.5" />} onSelect={onOpenLog}>
                {t('cloudConnection.actions.activityLog')}
              </GlassMenuItem>
            </GlassDropdownMenu>
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
              <div className="flex h-10 flex-shrink-0 items-center border-b border-border-subtle px-3" />
              <div className="flex min-h-0 flex-1 flex-col justify-center overflow-auto">
                <EmptyState
                  label={t('cloudConnection.ds.selectTitle')}
                  description={t('cloudConnection.ds.selectDesc')}
                />
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
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
      <CloudConnectionPreviewDialog preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function PaneHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-10 items-center justify-between gap-2 border-b border-border-subtle px-3">
      <span className="min-w-0 truncate text-[13px] font-semibold text-text-primary">{title}</span>
      <div className="flex flex-shrink-0 items-center gap-1">{children}</div>
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
    <div data-testid="cloud-connection-group-form">
      <PaneHeader title={group ? group.sourceName : t('cloudConnection.ds.newGroup')}>
        {group && !editing && (
          <>
            <Button size="sm" variant="ghost" onClick={onAddTable} disabled={!group.directoryPath}>
              <Plus className="h-3.5 w-3.5" />
              {t('cloudConnection.ds.addTable')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              data-testid="cloud-connection-group-edit"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              {t('cloudConnection.ds.edit')}
            </Button>
            <Button size="sm" variant="ghost" className="hover:text-error" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </PaneHeader>
      <Row label={t('cloudConnection.ds.groupName')}>
        <Input
          value={form.sourceName}
          disabled={!editing || Boolean(group)}
          maxLength={100}
          placeholder={t('cloudConnection.ds.groupNameLocked')}
          title={group ? t('cloudConnection.ds.groupNameLocked') : undefined}
          onChange={(e) => setForm({ ...form, sourceName: e.target.value })}
          data-testid="cloud-connection-group-name"
        />
      </Row>
      <Row label={t('cloudConnection.ds.directory')}>
        <Input
          value={form.directoryPath}
          disabled={!editing}
          onChange={(e) => setForm({ ...form, directoryPath: e.target.value })}
          className="font-mono text-[12px]"
        />
        <Button
          size="icon"
          variant="secondary"
          className="h-8 w-8 flex-shrink-0"
          disabled={!editing}
          aria-label={t('cloudConnection.ds.browse')}
          title={t('cloudConnection.ds.browse')}
          onClick={async () => {
            const dir = await cloudConnectionClient.pickDirectory();
            if (dir) setForm((f) => ({ ...f, directoryPath: dir }));
          }}
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </Button>
      </Row>
      <Row label={t('cloudConnection.ds.strategy')}>
        {editing ? (
          <SegmentedControl
            value={String(form.strategy)}
            options={strategyOptions}
            onChange={(v) => setForm({ ...form, strategy: Number(v) })}
          />
        ) : (
          <span>{t(`cloudConnection.ds.groupStrategy.${form.strategy}`)}</span>
        )}
      </Row>
      {group && group.files.length > 0 && (
        <div className="border-b border-border-subtle">
          <div className="px-3 pb-1 pt-2 text-[12px] font-medium text-text-secondary">
            {t('cloudConnection.ds.legacyFiles')}
          </div>
          {group.files.map((file) => (
            <div key={file} className="flex h-8 items-center gap-2 px-3 text-[12px]">
              <FileSpreadsheet className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate font-mono" title={file}>
                {file}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="hover:text-error"
                disabled={busy !== null}
                onClick={() => onRemoveLegacy?.(file)}
              >
                {t('cloudConnection.actions.remove')}
              </Button>
            </div>
          ))}
        </div>
      )}
      {group?.entriesError && (
        <div className="px-3 py-2 text-[12px] text-error">{group.entriesError}</div>
      )}
      {editing && (
        <div className="flex justify-end gap-2 px-3 py-2">
          <Button
            size="sm"
            onClick={() => {
              if (group) {
                setForm(initial);
                setEditing(false);
              } else onCancel?.();
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy === 'group'}
            disabled={busy !== null}
            data-testid="cloud-connection-group-save"
            onClick={async () => {
              if (await onSave(form)) setEditing(false);
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      )}
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
    <div data-testid="cloud-connection-table-form">
      <PaneHeader title={table ? table.tableName : t('cloudConnection.ds.newTable')}>
        {table && !editing && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(true)}
              data-testid="cloud-connection-table-edit"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t('cloudConnection.ds.edit')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="hover:text-error"
              onClick={() => onDelete(table.tableName)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </PaneHeader>
      <Row label={t('cloudConnection.ds.tableName')}>
        <Input
          value={form.tableName}
          disabled={disabled}
          maxLength={200}
          onChange={(e) => set({ tableName: e.target.value })}
          data-testid="cloud-connection-table-name"
        />
        <Button
          size="icon"
          variant="secondary"
          className="h-8 w-8 flex-shrink-0"
          aria-label={t('cloudConnection.actions.preview')}
          title={t('cloudConnection.actions.preview')}
          loading={previewing}
          disabled={previewing || !form.relativeFilePath}
          onClick={() => onPreview(original, form)}
        >
          {!previewing && <Eye className="h-3.5 w-3.5" />}
        </Button>
      </Row>
      <Row label={t('cloudConnection.ds.sourceStrategy')}>
        {editing ? (
          <SegmentedControl
            value={single ? 'single' : 'merge'}
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
        ) : (
          <span>{t(`cloudConnection.ds.source.${single ? 'single' : 'merge'}`)}</span>
        )}
      </Row>
      {!single && (
        <Row label={t('cloudConnection.ds.mergeStrategy')}>
          <NumberSelect
            value={form.appendStrategy}
            disabled={disabled}
            options={appendOptions}
            onChange={(v) => set({ appendStrategy: v })}
          />
          <NumberSelect
            value={form.strategy}
            disabled={disabled}
            options={opt('sortStrategy', [5, 1, 2, 3, 4])}
            onChange={(v) => set({ strategy: v })}
            testId="cloud-connection-sort-strategy"
          />
          <NumberSelect
            value={form.readStrategy}
            disabled={disabled}
            options={opt('readStrategy', [0, 1])}
            onChange={(v) => set({ readStrategy: v })}
          />
        </Row>
      )}
      <Row label={t('cloudConnection.ds.fieldStrategy')}>
        <NumberSelect
          value={form.fieldStrategy}
          disabled={disabled}
          options={opt('fieldType', [0, 1])}
          onChange={(v) => set({ fieldStrategy: v })}
        />
      </Row>
      <Row label={t('cloudConnection.ds.filePath')}>
        <Input
          value={form.relativeFilePath}
          disabled={disabled}
          placeholder={single ? '/data.xlsx' : '/'}
          onChange={(e) => set({ relativeFilePath: e.target.value })}
          className="font-mono text-[12px]"
          title={group.directoryPath}
        />
        <Button
          size="icon"
          variant="secondary"
          className="h-8 w-8 flex-shrink-0"
          disabled={disabled}
          aria-label={t('cloudConnection.ds.browse')}
          title={t('cloudConnection.ds.browse')}
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
        </Button>
      </Row>
      <Row label={t('cloudConnection.ds.password')}>
        <Input
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
        />
        {editing && table?.hasPassword && form.password !== null && (
          <Button size="sm" variant="ghost" onClick={() => set({ password: null })}>
            {t('cloudConnection.ds.clearPassword')}
          </Button>
        )}
      </Row>
      <Row label={t('cloudConnection.ds.sheetStrategy')}>
        <NumberSelect
          value={form.sheetStrategy}
          disabled={disabled}
          options={opt('sheet', [0, 1, 2])}
          onChange={(v) => set({ sheetStrategy: v })}
          className="w-auto flex-1"
        />
        {form.sheetStrategy === 0 && (
          <Input
            type="number"
            min={1}
            value={form.sheetNumber}
            disabled={disabled}
            onChange={(e) => set({ sheetNumber: Number(e.target.value) || 1 })}
            className="w-24 flex-shrink-0"
          />
        )}
        {form.sheetStrategy === 1 && (
          <Input
            value={form.sheetName}
            disabled={disabled}
            onChange={(e) => set({ sheetName: e.target.value })}
            className="w-32 flex-shrink-0"
          />
        )}
        {form.sheetStrategy === 2 && single && (
          <NumberSelect
            value={form.appendStrategy}
            disabled={disabled}
            options={appendOptions}
            onChange={(v) => set({ appendStrategy: v })}
            className="w-auto flex-1"
          />
        )}
      </Row>
      <Row label={t('cloudConnection.ds.headerRow')}>
        <Input
          type="number"
          min={1}
          value={form.headerRowNumber}
          disabled={disabled}
          onChange={(e) => set({ headerRowNumber: Math.max(1, Number(e.target.value) || 1) })}
          className="w-24"
        />
      </Row>
      {editing && (
        <div className="flex justify-end gap-2 px-3 py-2">
          <Button
            size="sm"
            onClick={() => {
              if (table) {
                setForm(initial);
                setEditing(false);
              } else onCancel();
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy === 'table'}
            disabled={busy !== null}
            data-testid="cloud-connection-table-save"
            onClick={async () => {
              if (await onSave(original, form)) setEditing(false);
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      )}
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
    <div>
      <PaneHeader title={entryId}>
        <Button size="sm" variant="ghost" loading={previewing} onClick={onPreview}>
          {!previewing && <Eye className="h-3.5 w-3.5" />}
          {t('cloudConnection.actions.preview')}
        </Button>
      </PaneHeader>
      <Row label={t('cloudConnection.ds.groupName')}>
        <span className="truncate">{group.sourceName}</span>
      </Row>
      <Row label={t('cloudConnection.ds.filePath')}>
        <span className="truncate font-mono text-[12px]">{entry?.fileName ?? entryId}</span>
      </Row>
      <Row label="Sheet">
        <span>{entry?.sheetName ?? '-'}</span>
      </Row>
    </div>
  );
}
