import { useState, type ReactNode } from 'react';
import {
  ArrowUpDown,
  Bell,
  CalendarClock,
  Database,
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
import { AUTOMATION_TABLE_PAGE_SIZE, type AutomationRunLogEntry } from './types';

export function StatCard({
  label,
  description,
  value,
  Icon,
  iconClassName,
}: {
  label: string;
  description: string;
  value: number;
  Icon: LucideIcon;
  iconClassName: string;
}) {
  return (
    <article className="glass-card flex h-[5.75rem] items-center gap-3 rounded-xl px-3">
      <div
        className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${iconClassName}`}
      >
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        <div className="text-[1.25rem] font-medium leading-none text-text-secondary">{value}</div>
        <div className="mt-1.5 whitespace-nowrap text-[13px] font-medium leading-4 text-text-secondary">
          {label}
        </div>
        <div className="mt-1 truncate text-[11px] leading-4 text-text-secondary">{description}</div>
      </div>
    </article>
  );
}

export function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative h-9 px-2.5 text-left text-[13px] font-medium transition-colors ${
        active ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {label}
      {active && <span className="absolute bottom-0 left-0 h-px w-full rounded-full bg-accent" />}
    </button>
  );
}

export function AutomationListPanel({
  automations,
  totalAutomations,
  currentPage,
  selectedId,
  selectedAutomation,
  searchQuery,
  isLoading,
  onCreate,
  onSearchChange,
  onRefresh,
  onPageChange,
  onRun,
  onEdit,
  onDelete,
  onSelect,
  tr,
}: {
  automations: Automation[];
  totalAutomations: number;
  currentPage: number;
  selectedId: string | null;
  selectedAutomation: Automation | null;
  searchQuery: string;
  isLoading: boolean;
  onCreate: () => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSelect: (automation: Automation) => void;
  tr: (key: string, fallback: string) => string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="mb-3 flex flex-shrink-0 flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button
            onClick={onCreate}
            className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            {tr('schedule.newAutomation', '新建自动化')}
          </button>
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
      <div className="glass-table flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <AutomationTable
            automations={automations}
            selectedId={selectedId}
            isLoading={isLoading}
            onSelect={onSelect}
            onEdit={onEdit}
            tr={tr}
          />
        </div>
        <PaginationFooter
          count={totalAutomations}
          currentPage={currentPage}
          onPageChange={onPageChange}
          tr={tr}
          embedded
        />
      </div>
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
      <div className="mb-3 flex flex-shrink-0 justify-end">
        <DataToolbarButton
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          label={tr('schedule.refresh', '刷新')}
          disabled={automations.length === 0 || isLoading}
          onClick={onRefresh}
        />
      </div>
      <div className="glass-table flex min-h-0 flex-1 flex-col">
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
    return <EmptyState label={tr('schedule.empty', '还没有自动化')} />;
  }
  if (isLoading) {
    return <LoadingState label={tr('schedule.runsLoading', '正在加载执行日志...')} />;
  }
  if (entries.length === 0) {
    return <EmptyState label={tr('schedule.runsEmpty', '暂无执行记录')} />;
  }
  return (
    <div className="min-w-0 overflow-hidden">
      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted backdrop-blur-xl">
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
  selectedId,
  isLoading,
  onSelect,
  onEdit,
  tr,
}: {
  automations: Automation[];
  selectedId: string | null;
  isLoading: boolean;
  onSelect: (automation: Automation) => void;
  onEdit: () => void;
  tr: (key: string, fallback: string) => string;
}) {
  if (isLoading) {
    return <LoadingState label={tr('schedule.loadingTasks', '正在加载自动化...')} />;
  }
  if (automations.length === 0) {
    return <EmptyState label={tr('schedule.empty', '还没有自动化')} />;
  }
  return (
    <div className="min-w-0 overflow-hidden">
      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted backdrop-blur-xl">
            <th className="w-[3%] px-3">
              <span className="sr-only">{tr('schedule.selection', '选择')}</span>
            </th>
            <th className="w-[39%] whitespace-nowrap px-2">
              {tr('schedule.columns.name', '名称')}
            </th>
            <th className="w-[14%] whitespace-nowrap px-2">
              {tr('schedule.columns.status', '状态')}
            </th>
            <th className="w-[10%] whitespace-nowrap px-2">
              {tr('schedule.columns.actions', '动作')}
            </th>
            <th className="w-[24%] whitespace-nowrap px-2">
              {tr('schedule.columns.nextRun', '下次执行')}
            </th>
            <th className="w-[10%] whitespace-nowrap px-2">
              <span className="inline-flex items-center gap-1">
                {tr('schedule.columns.updatedAt', '更新时间')}
                <ArrowUpDown className="h-3 w-3" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {automations.map((automation, index) => {
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
                    ? 'bg-accent/10 ring-1 ring-inset ring-accent/20'
                    : 'hover:bg-surface-hover/35'
                }`}
              >
                <td className="px-3">
                  <input
                    type="radio"
                    name="automation-selection"
                    checked={selected}
                    onChange={() => onSelect(automation)}
                    onClick={(event) => event.stopPropagation()}
                    className="h-3.5 w-3.5 accent-accent"
                    aria-label={automation.name}
                  />
                </td>
                <td className="px-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${icon.className}`}
                    >
                      <RowIcon className="h-4 w-4" />
                    </div>
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
                <td className="truncate whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                  <span className="truncate">{formatAppDateTime(automation.updatedAt)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const AUTOMATION_ICON_STYLES: Array<{ Icon: LucideIcon; className: string }> = [
  { Icon: CalendarClock, className: 'bg-accent/10 text-accent' },
  { Icon: Database, className: 'bg-[#E9F7F5] text-[#238C80]' },
  { Icon: Bell, className: 'bg-warning/10 text-warning' },
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
    return tr('schedule.manualNextRun', '手动执行');
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
          : 'text-text-secondary hover:border-accent/30 hover:bg-accent/10 hover:text-accent'
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
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
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

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center px-4 py-10 text-center text-xs text-text-muted">
      {label}
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center px-4 py-10 text-center text-xs font-medium text-text-muted">
      <div className="inline-flex items-center gap-2 rounded-lg border border-border-muted bg-background/42 px-3 py-2 shadow-soft">
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" />
        {label}
      </div>
    </div>
  );
}

function PaginationFooter({
  count,
  currentPage,
  onPageChange,
  tr,
  embedded = false,
}: {
  count: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  tr: (key: string, fallback: string) => string;
  embedded?: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(count / AUTOMATION_TABLE_PAGE_SIZE));
  const totalLabel = tr('schedule.paginationTotal', '共 {{count}} 条').replace(
    '{{count}}',
    String(count)
  );
  const pageSizeLabel = tr('schedule.paginationPageSize', '{{count}} 条/页').replace(
    '{{count}}',
    String(AUTOMATION_TABLE_PAGE_SIZE)
  );

  return (
    <div
      className={`flex min-h-11 flex-col items-center justify-between gap-2 px-4 text-xs font-medium text-text-secondary sm:flex-row ${
        embedded ? 'border-t border-border-muted py-2.5' : 'mt-3'
      }`}
    >
      <span>{totalLabel}</span>
      <div className="flex items-center gap-2">
        <button className="inline-flex h-8 min-w-[7rem] items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-text-secondary shadow-soft">
          {pageSizeLabel}
        </button>
        <button
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-border-muted bg-surface px-2 text-text-secondary shadow-soft disabled:cursor-not-allowed disabled:opacity-45"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          ‹
        </button>
        <span className="min-w-[4rem] text-center">
          {currentPage} / {pageCount}
        </span>
        <button
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-border-muted bg-surface px-2 text-text-secondary shadow-soft disabled:cursor-not-allowed disabled:opacity-45"
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(currentPage + 1)}
        >
          ›
        </button>
      </div>
    </div>
  );
}
