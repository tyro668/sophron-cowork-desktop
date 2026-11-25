/**
 * 数据 → 云连接：左侧逻辑分组 + 右侧引用原始表 / 结果表。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  Locate,
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
  DataRawTablePreview,
} from '../../../shared/contracts';
import { isCloudConnectionRefNameConfirmed } from '../../../shared/contracts';
import { cloudConnectionClient } from '../../features/cloud-connection/api/cloud-connection-client';
import {
  errorText,
  isLiveStatus,
} from '../../features/cloud-connection/hooks/use-cloud-connection';
import { showToast } from '../../utils/toast';
import { GlassDropdownMenu, GlassMenuItem, GlassMenuSeparator } from '../GlassDropdownMenu';
import { useOptionalConfirmDialog } from '../ConfirmDialog';
import { CloudConnectionPreviewDialog, toDataRawTablePreview } from './cloud-connection-preview';
import { TableRefPickerDialog } from './table-ref-picker-dialog';
import { EmptyState, fixedTabGroupWidth } from './shared';
import { Badge, Button, cn } from '../ui';
import { useAppStore } from '../../store';
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
                                {isCloudConnectionRefNameConfirmed(table) ? (
                                  <Badge tone={statusTone(table.status)}>
                                    {statusLabel(t, table.status)}
                                  </Badge>
                                ) : (
                                  <Badge tone="warning" data-testid="cloud-connection-ref-pending">
                                    {t('cloudConnection.ds.namePending')}
                                  </Badge>
                                )}
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
            <>
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
              <TableRefPickerDialog
                open
                group={selectedGroup}
                busy={busy === 'add-refs'}
                onOpenChange={(open) => {
                  if (!open) {
                    setSelection((current) =>
                      current.kind === 'newTable' && current.groupId === selectedGroup.id
                        ? { kind: 'group', groupId: selectedGroup.id }
                        : current
                    );
                  }
                }}
                onCreateRawTable={
                  onCreateRawTable ? () => onCreateRawTable(selectedGroup.id) : undefined
                }
                onSave={async (refs) => {
                  const ok = await run('add-refs', () =>
                    cloudConnectionClient.addTableRefs(selectedGroup.id, refs)
                  );
                  if (ok) {
                    const latest = await cloudConnectionClient.getState();
                    const group = latest.groups.find((item) => item.id === selectedGroup.id);
                    const added = group?.tables.find((table) =>
                      refs.some(
                        (ref) =>
                          ref.kind === table.kind &&
                          ref.tableId === table.tableId &&
                          !isCloudConnectionRefNameConfirmed(table)
                      )
                    );
                    setSelection(
                      added
                        ? { kind: 'table', groupId: selectedGroup.id, reportName: added.reportName }
                        : { kind: 'group', groupId: selectedGroup.id }
                    );
                  }
                  return ok;
                }}
              />
            </>
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
              onConfirmName={async (reportName) => {
                const ok = await run('confirm-ref', () =>
                  cloudConnectionClient.updateTableRef(selectedGroup.id, selection.reportName, {
                    reportName,
                  })
                );
                if (ok) {
                  setSelection({
                    kind: 'table',
                    groupId: selectedGroup.id,
                    reportName,
                  });
                }
                return ok;
              }}
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

function TableRefForm({
  group,
  table,
  busy,
  onPreview,
  onConfirmName,
  onDelete,
}: {
  group: CloudConnectionGroup;
  table?: CloudConnectionTableRef;
  busy: string | null;
  onPreview: () => void;
  onConfirmName: (reportName: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const navigateToDataElement = useAppStore((s) => s.navigateToDataElement);
  const [reportName, setReportName] = useState(table?.reportName ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  useEffect(() => {
    setReportName(table?.reportName ?? '');
    setNameError(null);
  }, [table?.reportName]);
  if (!table) return null;
  const pending = !isCloudConnectionRefNameConfirmed(table);
  const canLocate = table.status !== 'missing';

  const validateName = (value: string): string | null => {
    const name = value.trim();
    if (!name) return t('cloudConnection.ds.nameRequired');
    if (name !== table.reportName && group.tables.some((item) => item.reportName === name)) {
      return t('cloudConnection.ds.nameDuplicate');
    }
    return null;
  };

  const handleConfirm = async () => {
    const error = validateName(reportName);
    setNameError(error);
    if (error) return;
    await onConfirmName(reportName.trim());
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="cloud-connection-table-form">
      <PaneHeader title={t('cloudConnection.ds.refConfig')}>
        <HeaderAction testId="cloud-connection-preview-table" onClick={onPreview}>
          <Eye className="h-3.5 w-3.5" />
          {t('cloudConnection.actions.preview')}
        </HeaderAction>
        {pending && (
          <HeaderAction
            testId="cloud-connection-confirm-name"
            loading={busy === 'confirm-ref'}
            onClick={() => void handleConfirm()}
          >
            {t('cloudConnection.ds.confirmReportName')}
          </HeaderAction>
        )}
        <HeaderAction danger testId="cloud-connection-delete-table" onClick={() => void onDelete()}>
          <Trash2 className="h-3.5 w-3.5" />
          {t('cloudConnection.ds.deleteRef')}
        </HeaderAction>
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <section className={groupClass}>
          <Row label={t('cloudConnection.ds.refKind')}>
            <span className="ui-flush-text">
              {table.kind === 'result'
                ? t('cloudConnection.ds.refKindResult')
                : t('cloudConnection.ds.refKindRaw')}
            </span>
          </Row>
          <Row label={t('cloudConnection.ds.sourceTableName')}>
            <div className="flex min-h-[35px] min-w-0 items-center gap-1 px-[10px]">
              <span className="ui-flush-text min-w-0 flex-1 truncate !px-0">
                {table.displayName || '—'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0 text-text-muted hover:bg-accent-muted hover:text-accent disabled:opacity-40"
                disabled={!canLocate}
                title={t('cloudConnection.ds.locateTable')}
                aria-label={t('cloudConnection.ds.locateTable')}
                data-testid="cloud-connection-locate-table"
                onClick={() =>
                  navigateToDataElement({
                    kind: table.kind === 'result' ? 'result_table' : 'raw_table',
                    id: table.tableId,
                  })
                }
              >
                <Locate className="h-3.5 w-3.5" />
              </Button>
            </div>
          </Row>
          {pending && (
            <>
              <Row label={t('cloudConnection.ds.reportName')}>
                <input
                  value={reportName}
                  onChange={(event) => {
                    setReportName(event.target.value);
                    setNameError(null);
                  }}
                  className={cn('ui-flush-text', flushInputClass)}
                  data-testid="cloud-connection-report-name"
                />
              </Row>
              {nameError && (
                <div className="px-3 py-1 text-[12px] text-error" role="alert">
                  {nameError}
                </div>
              )}
              <div className="px-3 py-2 text-[12px] text-text-muted">
                {t('cloudConnection.ds.confirmNameHint')}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
