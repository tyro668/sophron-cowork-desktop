import { useState, type ReactNode } from 'react';
import {
  ArrowUpDown,
  Bell,
  CalendarClock,
  Database,
  FolderInput,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { Automation, AutomationRun } from '../../../types';
import { formatAppDateTime } from '../../../utils/i18n-format';
import { GlassDropdownMenu, GlassMenuItem } from '../../GlassDropdownMenu';
import type { AutomationRunLogEntry } from './types';
import { AUTOMATION_TABLE_PAGE_SIZE } from './types';

import { EmptyState, flatToolbarRowClass } from '../../data-view/shared';
import {
  AssignGroupDialog,
  buildGroupSections,
  GroupNameDialog,
  GroupSectionRows,
  hasNamedSections,
  toggleCollapsed,
  type AssignGroupTarget,
  type DataListGroup,
} from '../../data-view/group-ui';
import { Button } from '../../ui/button';

export function AutomationListPanel({
  automations,
  groups,
  groupCounts,
  groupPages,
  selectedId,
  selectedAutomation,
  searchQuery,
  isLoading,
  onCreate,
  onSearchChange,
  onRefresh,
  onGroupPageChange,
  onRun,
  onEdit,
  onDelete,
  onAssignToGroup,
  onRenameGroup,
  onDeleteGroup,
  onSelect,
  tr,
}: {
  automations: Automation[];
  groups: DataListGroup[];
  groupCounts: Record<string, number>;
  groupPages: Record<string, number>;
  selectedId: string | null;
  selectedAutomation: Automation | null;
  searchQuery: string;
  isLoading: boolean;
  onCreate: () => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onGroupPageChange: (groupKey: string, page: number) => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAssignToGroup: (target: AssignGroupTarget) => void;
  onRenameGroup: (group: DataListGroup, name: string) => void;
  onDeleteGroup: (group: DataListGroup) => void;
  onSelect: (automation: Automation) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DataListGroup | null>(null);
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className={`${flatToolbarRowClass} justify-between`}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {(isLoading || automations.length > 0 || searchQuery.trim()) && (
            <button
              onClick={onCreate}
              className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium shadow-soft transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              {tr('schedule.newAutomation', '新建自动化')}
            </button>
          )}
          <DataTableSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={tr('schedule.searchPlaceholder', '搜索自动化')}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DataToolbarButton
            icon={<Play className="h-3.5 w-3.5" />}
            label={tr('schedule.runNow', '立即运行')}
            disabled={!selectedAutomation || selectedAutomation.status === 'running'}
            onClick={onRun}
          />
          <DataToolbarButton
            icon={<PencilLine className="h-3.5 w-3.5" />}
            label={tr('schedule.configure', '配置')}
            disabled={!selectedAutomation}
            onClick={onEdit}
          />
          <DataToolbarButton
            icon={<FolderInput className="h-3.5 w-3.5" />}
            label={tr('data.groups.moveToGroup', '移动到分组')}
            disabled={!selectedAutomation}
            onClick={() => {
              if (selectedAutomation) {
                setAssignDialogOpen(true);
              }
            }}
          />
          <DataToolbarButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={tr('schedule.delete', '删除')}
            disabled={!selectedAutomation}
            danger
            onClick={onDelete}
          />
          <DataMoreMenu
            items={[
              {
                key: 'refresh',
                label: tr('schedule.refresh', '刷新'),
                icon: <RefreshCw className="h-3.5 w-3.5" />,
                onClick: onRefresh,
              },
            ]}
            tr={tr}
          />
        </div>
      </div>
      <div className="glass-table flex min-h-0 flex-1 flex-col rounded-none border-0">
        <div className="min-h-0 flex-1 overflow-auto">
          {!isLoading && automations.length === 0 ? (
            <EmptyState
              label={tr('schedule.empty', '暂无自动化')}
              description={
                searchQuery.trim()
                  ? tr('workspaceEmpty.searchHint', '试试其他关键词，或清除搜索。')
                  : tr(
                      'workspaceEmpty.automationHint',
                      '设置触发时间和执行动作，让重复工作自动完成。'
                    )
              }
              action={
                searchQuery.trim() ? (
                  <Button variant="secondary" onClick={() => onSearchChange('')}>
                    {tr('workspaceEmpty.clearSearch', '清除搜索')}
                  </Button>
                ) : (
                  <Button variant="primary" onClick={onCreate} className="shadow-soft">
                    <Plus className="h-4 w-4" />
                    {tr('schedule.newAutomation', '新建自动化')}
                  </Button>
                )
              }
            />
          ) : (
            <AutomationTable
              automations={automations}
              groups={groups}
              groupCounts={groupCounts}
              groupPages={groupPages}
              selectedId={selectedId}
              isLoading={isLoading}
              onSelect={onSelect}
              onEdit={onEdit}
              onGroupPageChange={onGroupPageChange}
              onRenameGroup={setRenameTarget}
              onDeleteGroup={onDeleteGroup}
              tr={tr}
            />
          )}
        </div>
        <div className="h-0" />
      </div>
      <AssignGroupDialog
        open={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        groups={groups}
        currentGroupId={selectedAutomation?.groupId ?? null}
        onSubmit={(target) => {
          if (selectedAutomation) {
            onAssignToGroup(target);
          }
          setAssignDialogOpen(false);
        }}
      />
      <GroupNameDialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        initialName={renameTarget?.name ?? ''}
        onSubmit={(name) => {
          if (renameTarget) {
            onRenameGroup(renameTarget, name);
          }
          setRenameTarget(null);
        }}
      />
    </div>
  );
}

export function AutomationRunLogPanel({
  automations,
  entries,
  isLoading,
  onRefresh,
  tr,
}: {
  automations: Automation[];
  entries: AutomationRunLogEntry[];
  isLoading: boolean;
  onRefresh: () => void;
  tr: (key: string, fallback: string) => string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className={`${flatToolbarRowClass} justify-end`}>
        <DataToolbarButton
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          label={tr('schedule.refresh', '刷新')}
          disabled={automations.length === 0 || isLoading}
          onClick={onRefresh}
        />
      </div>
      <div className="glass-table flex min-h-0 flex-1 flex-col rounded-none border-0">
        <div className="min-h-0 flex-1 overflow-auto">
          <AutomationRunTable
            entries={entries}
            isLoading={isLoading}
            hasAutomations={automations.length > 0}
            tr={tr}
          />
        </div>
      </div>
    </div>
  );
}

function AutomationRunTable({
  entries,
  isLoading,
  hasAutomations,
  tr,
}: {
  entries: AutomationRunLogEntry[];
  isLoading: boolean;
  hasAutomations: boolean;
  tr: (key: string, fallback: string) => string;
}) {
  if (!hasAutomations) {
    return (
      <EmptyState
        label={tr('schedule.empty', '还没有自动化')}
        description={tr(
          'workspaceEmpty.automationHint',
          '设置触发时间和执行动作，让重复工作自动完成。'
        )}
      />
    );
  }
  if (isLoading) {
    return <LoadingState label={tr('schedule.runsLoading', '正在加载执行日志...')} />;
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        label={tr('schedule.runsEmpty', '暂无执行记录')}
        description={tr(
          'workspaceEmpty.runsHint',
          '自动化按触发条件运行后，执行记录会显示在这里。'
        )}
      />
    );
  }
  return (
    <div className="min-w-0 overflow-hidden">
      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted">
            <th className="w-[22%] whitespace-nowrap px-3">
              {tr('schedule.runColumns.automation', '自动化')}
            </th>
            <th className="w-[12%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.status', '状态')}
            </th>
            <th className="w-[10%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.reason', '触发')}
            </th>
            <th className="w-[18%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.startedAt', '开始时间')}
            </th>
            <th className="w-[10%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.duration', '耗时')}
            </th>
            <th className="w-[8%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.artifacts', '产物')}
            </th>
            <th className="w-[10%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.delivery', '交付')}
            </th>
            <th className="w-[20%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.error', '错误信息')}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(({ automation, run }) => (
            <tr
              key={run.id}
              className="h-[3.25rem] border-b border-border-muted/85 last:border-b-0 transition-colors hover:bg-surface-hover/35"
            >
              <td className="truncate px-3 text-[13px] font-medium text-text-secondary">
                {automation.name}
              </td>
              <td className="px-3">
                <AutomationRunStatusBadge status={run.status} tr={tr} />
              </td>
              <td className="truncate px-2 text-[13px] font-medium text-text-secondary">
                {formatRunReason(run.triggerReason, tr)}
              </td>
              <td className="truncate whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                {formatAppDateTime(run.startedAt ?? run.queuedAt ?? run.createdAt)}
              </td>
              <td className="truncate whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                {formatDurationMs(run.durationMs)}
              </td>
              <td className="px-2 text-[13px] font-medium text-text-secondary">
                {run.artifactCount}
              </td>
              <td className="truncate px-2 text-[13px] font-medium text-text-secondary">
                {formatDeliveryStatus(run.deliveryStatus, tr)}
              </td>
              <td className="truncate px-2 text-[12px] text-text-muted" title={run.error ?? ''}>
                {run.error ?? '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AutomationTable({
  automations,
  groups,
  groupCounts,
  groupPages,
  selectedId,
  isLoading,
  onSelect,
  onEdit,
  onGroupPageChange,
  onRenameGroup,
  onDeleteGroup,
  tr,
}: {
  automations: Automation[];
  groups: DataListGroup[];
  groupCounts: Record<string, number>;
  groupPages: Record<string, number>;
  selectedId: string | null;
  isLoading: boolean;
  onSelect: (automation: Automation) => void;
  onEdit: () => void;
  onGroupPageChange: (groupKey: string, page: number) => void;
  onRenameGroup: (group: DataListGroup) => void;
  onDeleteGroup: (group: DataListGroup) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const sections = buildGroupSections(automations, groups, (automation) => automation.groupId);
  const grouped = hasNamedSections(sections);
  const renderRow = (automation: Automation, index: number, indented = false) => {
    const selected = automation.id === selectedId;
    const icon = AUTOMATION_ICON_STYLES[index % AUTOMATION_ICON_STYLES.length];
    const RowIcon = icon.Icon;
    return (
      <tr
        key={automation.id}
        onClick={() => onSelect(automation)}
        onDoubleClick={onEdit}
        className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
          selected
            ? 'bg-accent-muted ring-1 ring-inset ring-accent/20'
            : 'hover:bg-surface-hover/35'
        }`}
      >
        <td className={indented ? 'pl-9 pr-2' : 'px-2'}>
          <div className="flex min-w-0 items-center gap-3">
            {indented ? (
              <RowIcon className={`h-3.5 w-3.5 flex-shrink-0 ${icon.textClass}`} />
            ) : (
              <div
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${icon.bgClass}`}
              >
                <RowIcon className="h-4 w-4" />
              </div>
            )}
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium text-text-secondary">
                {automation.name}
              </span>
              {automation.description && (
                <span className="truncate text-[11px] text-text-muted">
                  {automation.description}
                </span>
              )}
            </div>
          </div>
        </td>
        <td className="px-2">
          <AutomationStatusBadge automation={automation} tr={tr} />
        </td>
        <td className="px-2 text-[13px] font-medium text-text-secondary">
          {automation.actionGraph.nodes.length}
        </td>
        <td className="truncate whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
          <span className="truncate">{formatAutomationNextRun(automation, tr)}</span>
        </td>
        <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
          {formatAppDateTime(automation.updatedAt)}
        </td>
      </tr>
    );
  };
  if (isLoading) {
    return <LoadingState label={tr('schedule.loadingTasks', '正在加载自动化...')} />;
  }
  if (automations.length === 0) {
    return <EmptyState label={tr('schedule.empty', '还没有自动化')} />;
  }
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-left">
        <colgroup>
          <col />
          <col className="w-36" />
          <col className="w-24" />
          <col className="w-64" />
          <col className="w-52" />
        </colgroup>
        <thead>
          <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted">
            <th className="whitespace-nowrap px-2">{tr('schedule.columns.name', '名称')}</th>
            <th className="whitespace-nowrap px-2">{tr('schedule.columns.status', '状态')}</th>
            <th className="whitespace-nowrap px-2">{tr('schedule.columns.actions', '动作')}</th>
            <th className="whitespace-nowrap px-2">{tr('schedule.columns.nextRun', '下次执行')}</th>
            <th className="whitespace-nowrap px-2">
              <span className="inline-flex items-center gap-1">
                {tr('schedule.columns.updatedAt', '更新时间')}
                <ArrowUpDown className="h-3 w-3" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <GroupSectionRows
              key={section.key}
              colSpan={5}
              section={section}
              grouped={grouped}
              collapsed={collapsed.has(section.key)}
              onToggle={() => setCollapsed((current) => toggleCollapsed(current, section.key))}
              onRename={section.group ? onRenameGroup : undefined}
              onDelete={section.group ? onDeleteGroup : undefined}
              count={groupCounts[section.key] ?? section.rows.length}
              page={groupPages[section.key] ?? 1}
              pageSize={AUTOMATION_TABLE_PAGE_SIZE}
              onPageChange={(page) => onGroupPageChange(section.key, page)}
              renderRow={renderRow}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const AUTOMATION_ICON_STYLES: Array<{ Icon: LucideIcon; bgClass: string; textClass: string }> = [
  { Icon: CalendarClock, bgClass: 'bg-accent-muted text-accent', textClass: 'text-accent' },
  { Icon: Database, bgClass: 'bg-accent-muted text-accent', textClass: 'text-accent' },
  { Icon: Bell, bgClass: 'bg-warning/10 text-warning', textClass: 'text-warning' },
];

const AUTOMATION_STATUS_TONES: Record<Automation['status'], string> = {
  enabled: 'bg-success/10 text-success',
  disabled: 'bg-bg-tertiary text-text-muted',
  failed: 'bg-error/10 text-error',
  paused: 'bg-bg-tertiary text-text-muted',
  running: 'bg-warning/10 text-warning',
};

const AUTOMATION_RUN_STATUS_TONES: Record<AutomationRun['status'], string> = {
  cancelled: 'bg-bg-tertiary text-text-muted',
  failed: 'bg-error/10 text-error',
  queued: 'bg-warning/10 text-warning',
  running: 'bg-warning/10 text-warning',
  succeeded: 'bg-success/10 text-success',
};

function StatusBadge({
  status,
  labelKeyPrefix,
  tone,
  tr,
}: {
  status: string;
  labelKeyPrefix: string;
  tone: string;
  tr: (key: string, fallback: string) => string;
}) {
  return (
    <span
      className={`inline-flex h-6 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {tr(`${labelKeyPrefix}.${status}`, status)}
    </span>
  );
}

function AutomationStatusBadge({
  automation,
  tr,
}: {
  automation: Automation;
  tr: (key: string, fallback: string) => string;
}) {
  const tone =
    AUTOMATION_STATUS_TONES[automation.status] ??
    (automation.enabled ? 'bg-success/10 text-success' : 'bg-bg-tertiary text-text-muted');
  return (
    <StatusBadge status={automation.status} labelKeyPrefix="schedule.status" tone={tone} tr={tr} />
  );
}

function formatAutomationNextRun(
  automation: Automation,
  tr: (key: string, fallback: string) => string
): string {
  if (automation.trigger.kind === 'manual') {
    if (automation.outputBindings?.some((binding) => binding.runOnChange))
      return tr('schedule.outputChangeTrigger', '输出表更新后执行');
    return tr('schedule.noAutoTrigger', '无自动触发');
  }
  return automation.nextRunAt ? formatAppDateTime(automation.nextRunAt) : '-';
}

function AutomationRunStatusBadge({
  status,
  tr,
}: {
  status: AutomationRun['status'];
  tr: (key: string, fallback: string) => string;
}) {
  return (
    <StatusBadge
      status={status}
      labelKeyPrefix="schedule.runStatus"
      tone={AUTOMATION_RUN_STATUS_TONES[status]}
      tr={tr}
    />
  );
}

function formatRunReason(
  reason: AutomationRun['triggerReason'],
  tr: (key: string, fallback: string) => string
): string {
  return tr(`schedule.runReason.${reason}`, reason);
}

function formatDeliveryStatus(
  status: AutomationRun['deliveryStatus'],
  tr: (key: string, fallback: string) => string
): string {
  if (!status) return '-';
  return tr(`schedule.deliveryStatus.${status}`, status);
}

function formatDurationMs(durationMs: number | null): string {
  if (durationMs === null) return '-';
  if (durationMs < 1000) return `${durationMs}ms`;
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function getRunSortTime(run: AutomationRun): number {
  return run.startedAt ?? run.queuedAt ?? run.createdAt;
}

function DataTableSearch({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-full sm:w-[18rem]">
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-lg border border-border-muted bg-surface pl-8 pr-3 text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
    </div>
  );
}

function DataToolbarButton({
  icon,
  label,
  disabled,
  danger = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        danger
          ? 'text-error hover:border-error/30 hover:bg-error/10'
          : 'text-text-secondary hover:border-accent/30 hover:bg-accent-muted hover:text-accent'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

interface DataMoreMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function DataMoreMenu({
  items,
  tr,
}: {
  items: DataMoreMenuItem[];
  tr: (key: string, fallback: string) => string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <GlassDropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="end"
      contentClassName="w-40"
      trigger={
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent"
          title={tr('data.actions.more', '更多')}
          aria-label={tr('data.actions.more', '更多')}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      }
    >
      {items.map((item) => (
        <GlassMenuItem
          key={item.key}
          disabled={item.disabled}
          danger={item.danger}
          icon={item.icon}
          onSelect={item.onClick}
        >
          {item.label}
        </GlassMenuItem>
      ))}
    </GlassDropdownMenu>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center px-4 py-10 text-center text-xs font-medium text-text-muted">
      <div className="inline-flex items-center gap-2 rounded-lg border border-border-muted bg-surface px-3 py-2 shadow-soft">
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" />
        {label}
      </div>
    </div>
  );
}
