import { getAutomationTableBindings } from '../../../../shared/automation/table-bindings';
import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ArrowUpDown,
  CalendarClock,
  FolderInput,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Hand,
  ChevronRight,
} from 'lucide-react';
import type { Automation, AutomationRun } from '../../../types';
import { formatAppDateTime, formatDurationMs } from '../../../utils/i18n-format';
import { Switch } from '../../ui/switch';
import { GlassDropdownMenu, GlassMenuItem } from '../../GlassDropdownMenu';
import type { AutomationRunLogEntry } from './types';
import { AUTOMATION_TABLE_PAGE_SIZE } from './types';

type RunStatusFilter = 'all' | 'succeeded' | 'failed' | 'running';
type RunRangeFilter = 'all' | '1d' | '7d' | '30d';
const RUN_RANGE_MS: Record<Exclude<RunRangeFilter, 'all'>, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

import {
  TabBarAction,
  tabBarNewCellClass,
  DataMoreMenu,
  DataTableSearch,
  DataToolbarButton,
  EmptyState,
  LoadingState,
  flatToolbarRowClass,
} from '../../data-view/shared';
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
import { useAppStore } from '../../../store';
import { ipcErrorMessage } from '../../../utils/ipc-error';
import { showToast } from '../../../utils/toast';
import type { ScriptRepair } from '../../../../shared/automation/script-package';
import i18n from '../../../i18n/config';
import { automationClient } from '../../../features/automation/api/automation-client';

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
  onToggleEnabled,
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
  onToggleEnabled?: (automation: Automation, enabled: boolean) => void;
  onAssignToGroup: (target: AssignGroupTarget) => void;
  onRenameGroup: (group: DataListGroup, name: string) => void;
  onDeleteGroup: (group: DataListGroup) => void;
  onSelect: (automation: Automation) => void;
  tr: (key: string, fallback?: string) => string;
}) {
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DataListGroup | null>(null);
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className={`${flatToolbarRowClass} justify-between`}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {(isLoading || automations.length > 0 || searchQuery.trim()) && (
            <TabBarAction>
              <button onClick={onCreate} className={tabBarNewCellClass}>
                <Plus className="h-3.5 w-3.5" />
                {tr('schedule.newAutomation')}
              </button>
            </TabBarAction>
          )}
          <DataTableSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={tr('schedule.searchPlaceholder')}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selectedAutomation && (
            <>
              <DataToolbarButton
                icon={<Play className="h-3.5 w-3.5" />}
                label={tr('schedule.runNow')}
                disabled={!selectedAutomation || selectedAutomation.status === 'running'}
                onClick={onRun}
              />
              <DataToolbarButton
                icon={<PencilLine className="h-3.5 w-3.5" />}
                label={tr('schedule.configure')}
                disabled={!selectedAutomation}
                onClick={onEdit}
              />
              <DataToolbarButton
                icon={<FolderInput className="h-3.5 w-3.5" />}
                label={tr('data.groups.moveToGroup')}
                disabled={!selectedAutomation}
                onClick={() => {
                  if (selectedAutomation) {
                    setAssignDialogOpen(true);
                  }
                }}
              />
            </>
          )}
          <DataMoreMenu
            items={[
              {
                key: 'refresh',
                label: tr('schedule.refresh'),
                icon: <RefreshCw className="h-3.5 w-3.5" />,
                onClick: onRefresh,
              },
              {
                key: 'delete',
                label: tr('schedule.deleteEllipsis'),
                icon: <Trash2 className="h-3.5 w-3.5" />,
                danger: true,
                disabled: !selectedAutomation,
                onClick: onDelete,
              },
            ]}
          />
        </div>
      </div>
      <div className="glass-table ui-table-flush flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {!isLoading && automations.length === 0 ? (
            <EmptyState
              label={tr('schedule.empty')}
              icon={<CalendarClock className="h-6 w-6" />}
              description={
                searchQuery.trim()
                  ? tr('workspaceEmpty.searchHint')
                  : tr('workspaceEmpty.automationHint')
              }
              action={
                searchQuery.trim() ? (
                  <Button variant="secondary" onClick={() => onSearchChange('')}>
                    {tr('workspaceEmpty.clearSearch')}
                  </Button>
                ) : (
                  <Button variant="primary" onClick={onCreate} className="shadow-soft">
                    <Plus className="h-4 w-4" />
                    {tr('schedule.newAutomation')}
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
              onToggleEnabled={onToggleEnabled}
              onGroupPageChange={onGroupPageChange}
              onRenameGroup={setRenameTarget}
              onDeleteGroup={onDeleteGroup}
              tr={tr}
            />
          )}
        </div>
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
  tr: (key: string, fallback?: string) => string;
}) {
  // A background AI 修复 rewrites its run's error when done; keep polling until it does.
  const hasRunning = entries.some(
    ({ run }) =>
      run.status === 'running' ||
      run.status === 'queued' ||
      Object.values(run.scriptRepairs ?? {}).some((repair) => repair.status === 'pending')
  );
  const [runQuery, setRunQuery] = useState('');
  const normalizedRunQuery = runQuery.trim().toLowerCase();
  const [runStatusFilter, setRunStatusFilter] = useState<RunStatusFilter>('all');
  const [runRangeFilter, setRunRangeFilter] = useState<RunRangeFilter>('all');
  const rangeStart = runRangeFilter === 'all' ? 0 : Date.now() - RUN_RANGE_MS[runRangeFilter];
  // Client-side filters over the loaded run log only.
  const visibleEntries = entries.filter(({ automation, run }) => {
    if (normalizedRunQuery && !automation.name.toLowerCase().includes(normalizedRunQuery)) {
      return false;
    }
    if (runStatusFilter !== 'all') {
      const status =
        run.status === 'queued' ? 'running' : run.status === 'succeeded' ? 'succeeded' : run.status;
      if (status !== runStatusFilter) return false;
    }
    if (rangeStart > 0) {
      const at = run.startedAt ?? run.queuedAt ?? run.createdAt;
      if (!at || at < rangeStart) return false;
    }
    return true;
  });
  const statusOptions: Array<[RunStatusFilter, string]> = [
    ['all', tr('schedule.runFilterAllStatus')],
    ['succeeded', tr('schedule.runFilterSucceeded')],
    ['failed', tr('schedule.runFilterFailed')],
    ['running', tr('schedule.runFilterRunning')],
  ];
  const rangeOptions: Array<[RunRangeFilter, string]> = [
    ['all', tr('schedule.runFilterAllTime')],
    ['1d', tr('schedule.runFilter1d')],
    ['7d', tr('schedule.runFilter7d')],
    ['30d', tr('schedule.runFilter30d')],
  ];
  const filterCell = (
    label: string,
    options: Array<[string, string]>,
    value: string,
    onChange: (value: string) => void
  ) => (
    <GlassDropdownMenu
      align="end"
      trigger={
        <button
          type="button"
          className="inline-flex h-full min-w-[104px] items-center justify-between gap-2 border-l border-border-subtle px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover"
        >
          {label}
          <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
        </button>
      }
    >
      {options.map(([key, text]) => (
        <GlassMenuItem key={key} selected={value === key} onSelect={() => onChange(key)}>
          {text}
        </GlassMenuItem>
      ))}
    </GlassDropdownMenu>
  );
  // Poll every 3s only while something is running (design 15).
  useEffect(() => {
    if (!hasRunning) return;
    const timer = window.setInterval(onRefresh, 3000);
    return () => window.clearInterval(timer);
  }, [hasRunning, onRefresh]);
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className={`${flatToolbarRowClass} justify-between`}>
        <div className="flex min-w-0 flex-1 [&>div]:border-l-0">
          <DataTableSearch
            value={runQuery}
            onChange={setRunQuery}
            placeholder={tr('schedule.runSearch')}
          />
        </div>
        {filterCell(
          statusOptions.find(([key]) => key === runStatusFilter)?.[1] ?? '',
          statusOptions,
          runStatusFilter,
          (value) => setRunStatusFilter(value as RunStatusFilter)
        )}
        {filterCell(
          rangeOptions.find(([key]) => key === runRangeFilter)?.[1] ?? '',
          rangeOptions,
          runRangeFilter,
          (value) => setRunRangeFilter(value as RunRangeFilter)
        )}
        <DataToolbarButton
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          label={tr('schedule.refresh')}
          disabled={automations.length === 0 || isLoading}
          onClick={onRefresh}
        />
      </div>
      <div className="glass-table ui-table-flush flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <AutomationRunTable
            automations={automations}
            entries={visibleEntries}
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
  automations,
  entries,
  isLoading,
  hasAutomations,
  tr,
}: {
  automations: Automation[];
  entries: AutomationRunLogEntry[];
  isLoading: boolean;
  hasAutomations: boolean;
  tr: (key: string, fallback?: string) => string;
}) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  if (!hasAutomations) {
    return (
      <EmptyState label={tr('schedule.empty')} description={tr('workspaceEmpty.automationHint')} />
    );
  }
  if (isLoading) {
    return <LoadingState label={tr('schedule.runsLoading')} />;
  }
  if (entries.length === 0) {
    return (
      <EmptyState label={tr('schedule.runsEmpty')} description={tr('workspaceEmpty.runsHint')} />
    );
  }
  return (
    <div className="min-w-0 overflow-hidden">
      <table className="data-list-table w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted">
            <th className="w-[22%] whitespace-nowrap px-3 pl-8">
              {tr('schedule.runColumns.automation')}
            </th>
            <th className="w-[12%] whitespace-nowrap px-2">{tr('schedule.runColumns.status')}</th>
            <th className="w-[10%] whitespace-nowrap px-2">{tr('schedule.runColumns.reason')}</th>
            <th className="w-[18%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.startedAt')}
            </th>
            <th className="w-[10%] whitespace-nowrap px-2">{tr('schedule.runColumns.duration')}</th>
            <th className="w-[8%] whitespace-nowrap px-2">{tr('schedule.runColumns.artifacts')}</th>
            <th className="w-[10%] whitespace-nowrap px-2">{tr('schedule.runColumns.delivery')}</th>
            <th className="w-[20%] whitespace-nowrap px-2">{tr('schedule.runColumns.error')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(({ automation, run }) => (
            <RunLogRow
              key={run.id}
              automationName={automation.name}
              graph={automations.find((item) => item.id === automation.id)?.actionGraph ?? null}
              run={run}
              expanded={expandedRunId === run.id}
              onToggle={() => setExpandedRunId((current) => (current === run.id ? null : run.id))}
              tr={tr}
            />
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
  onToggleEnabled,
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
  onToggleEnabled?: (automation: Automation, enabled: boolean) => void;
  onGroupPageChange: (groupKey: string, page: number) => void;
  onRenameGroup: (group: DataListGroup) => void;
  onDeleteGroup: (group: DataListGroup) => void;
  tr: (key: string, fallback?: string) => string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const sections = buildGroupSections(automations, groups, (automation) => automation.groupId);
  const grouped = hasNamedSections(sections);
  const renderRow = (automation: Automation, _index: number, indented = false) => {
    const selected = automation.id === selectedId;
    const inactive = !automation.enabled;
    const RowIcon = automation.trigger.kind === 'manual' ? Hand : CalendarClock;
    const icon = inactive
      ? { bgClass: 'bg-surface-active text-text-muted', textClass: 'text-text-muted' }
      : { bgClass: 'bg-accent-muted text-accent', textClass: 'text-accent' };
    return (
      <tr
        key={automation.id}
        onClick={() => onSelect(automation)}
        onDoubleClick={onEdit}
        className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
          selected ? 'bg-accent-muted' : 'hover:bg-surface-hover'
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
              <span
                className={`truncate text-[13px] font-medium ${inactive ? 'text-text-muted' : 'text-text-primary'}`}
              >
                {automation.name}
              </span>
            </div>
          </div>
        </td>
        <td className="px-2">
          <div className="flex items-center gap-2">
            {onToggleEnabled && (
              <span onClick={(event) => event.stopPropagation()} className="inline-flex">
                <Switch
                  size="sm"
                  checked={automation.enabled}
                  aria-label={tr('schedule.toggleEnabled')}
                  onCheckedChange={(checked) => onToggleEnabled(automation, checked)}
                />
              </span>
            )}
            <AutomationStatusBadge automation={automation} tr={tr} />
          </div>
        </td>
        <td
          className="truncate px-2 text-[12.5px] text-text-secondary"
          title={automation.description || undefined}
        >
          {automation.description ||
            (automation.trigger.kind === 'manual'
              ? tr('schedule.runReason.manual')
              : tr('schedule.runReason.timer'))}
        </td>
        <td className="px-2 text-[13px] font-medium text-text-secondary">
          {automation.actionGraph.nodes.length}
        </td>
        <td
          className={`truncate whitespace-nowrap px-2 text-[13px] font-medium ${inactive ? 'text-text-muted' : 'text-text-secondary'}`}
        >
          <span className="truncate">{formatAutomationNextRun(automation, tr)}</span>
        </td>
        <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
          {formatAppDateTime(automation.updatedAt)}
        </td>
      </tr>
    );
  };
  if (isLoading) {
    return <LoadingState label={tr('schedule.loadingTasks')} />;
  }
  if (automations.length === 0) {
    return <EmptyState label={tr('schedule.empty')} />;
  }
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="data-list-table w-full table-fixed border-collapse text-left">
        <colgroup>
          <col />
          <col className="w-36" />
          <col />
          <col className="w-24" />
          <col className="w-64" />
          <col className="w-52" />
        </colgroup>
        <thead>
          <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted">
            <th className="whitespace-nowrap px-2">{tr('schedule.columns.name')}</th>
            <th className="whitespace-nowrap px-2">{tr('schedule.columns.status')}</th>
            <th className="whitespace-nowrap px-2">{tr('schedule.columns.trigger')}</th>
            <th className="whitespace-nowrap px-2">{tr('schedule.columns.actions')}</th>
            <th className="whitespace-nowrap px-2">{tr('schedule.columns.nextRun')}</th>
            <th className="whitespace-nowrap px-2">
              <span className="inline-flex items-center gap-1">
                {tr('schedule.columns.updatedAt')}
                <ArrowUpDown className="h-3 w-3" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <GroupSectionRows
              key={section.key}
              colSpan={6}
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

const AUTOMATION_STATUS_TONES: Record<Automation['status'], string> = {
  enabled: 'bg-success/10 text-success',
  disabled: 'bg-surface-muted text-text-muted',
  failed: 'bg-error/10 text-error',
  paused: 'bg-surface-muted text-text-muted',
  running: 'bg-warning/10 text-warning',
};

const AUTOMATION_RUN_STATUS_TONES: Record<AutomationRun['status'], string> = {
  cancelled: 'bg-surface-muted text-text-muted',
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
  tr: (key: string, fallback?: string) => string;
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
  tr: (key: string, fallback?: string) => string;
}) {
  const tone =
    AUTOMATION_STATUS_TONES[automation.status] ??
    (automation.enabled ? 'bg-success/10 text-success' : 'bg-surface-muted text-text-muted');
  return (
    <StatusBadge status={automation.status} labelKeyPrefix="schedule.status" tone={tone} tr={tr} />
  );
}

function formatAutomationNextRun(
  automation: Automation,
  tr: (key: string, fallback?: string) => string
): string {
  if (!automation.enabled) return '—';
  if (automation.trigger.kind === 'manual') {
    if (getAutomationTableBindings(automation).some((binding) => binding.runOnChange))
      return tr('schedule.outputChangeTrigger');
    return '—';
  }
  return automation.nextRunAt ? formatAppDateTime(automation.nextRunAt) : '—';
}

function AutomationRunStatusBadge({
  status,
  tr,
}: {
  status: AutomationRun['status'];
  tr: (key: string, fallback?: string) => string;
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
  tr: (key: string, fallback?: string) => string
): string {
  return tr(`schedule.runReason.${reason}`, reason);
}

function formatDeliveryStatus(
  status: AutomationRun['deliveryStatus'],
  tr: (key: string, fallback?: string) => string
): string {
  if (!status) return '-';
  return tr(`schedule.deliveryStatus.${status}`, status);
}

function runNodeLabel(
  node: { type: string; label?: string; config?: Record<string, unknown> },
  tr: (key: string, fallback?: string) => string
): string {
  if (node.label) return node.label;
  if (node.type === 'cloud.sync') {
    return node.config?.direction === 'input'
      ? tr('schedule.cloudInput.title')
      : tr('schedule.cloudSync.title');
  }
  return tr(`schedule.actionTypeName.${node.type.replace(/\./g, '_')}`, node.type);
}

function RunLogRow({
  automationName,
  graph,
  run,
  expanded,
  onToggle,
  tr,
}: {
  automationName: string;
  graph: Automation['actionGraph'] | null;
  run: AutomationRun;
  expanded: boolean;
  onToggle: () => void;
  tr: (key: string, fallback?: string) => string;
}) {
  const executed = new Set(run.executionSummary?.executedNodeIds ?? []);
  const skipped = new Set(run.executionSummary?.skippedNodeIds ?? []);
  const nodes = graph?.nodes ?? [];
  const failed = run.status === 'failed';
  const lastExecutedId = [...nodes].reverse().find((node) => executed.has(node.id))?.id;
  const repairs = Object.values(run.scriptRepairs ?? {});
  const stepById = new Map((run.executionSummary?.steps ?? []).map((step) => [step.nodeId, step]));
  return (
    <>
      <tr
        onClick={onToggle}
        className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 transition-colors ${
          expanded ? 'bg-surface-muted' : 'hover:bg-surface-hover'
        }`}
      >
        <td className="truncate px-3 text-[13px] font-medium text-text-primary">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <ChevronRight
              className={`h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
            <span className="truncate">{automationName}</span>
          </span>
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
        <td className="truncate whitespace-nowrap px-2 text-[13px] tabular-nums text-text-secondary">
          {formatDurationMs(run.durationMs)}
        </td>
        <td className="px-2 text-[13px] text-text-secondary">
          {run.artifactCount > 0
            ? tr('schedule.artifactCount').replace('{{count}}', String(run.artifactCount))
            : '—'}
        </td>
        <td className="truncate px-2 text-[13px] text-text-secondary">
          {run.deliveryStatus
            ? formatDeliveryStatus(run.deliveryStatus, tr)
            : tr('schedule.deliveryNotConfigured')}
        </td>
        <td
          className={`truncate px-2 text-[12px] ${failed ? 'text-error' : 'text-text-muted'}`}
          title={formatExecutionSummary(run, tr)}
        >
          {formatExecutionSummary(run, tr)}
        </td>
      </tr>
      {expanded && nodes.length === 0 && (
        <tr className="h-9 border-b border-border-muted/85 bg-surface-muted">
          <td colSpan={8} className="px-8 text-xs text-text-muted">
            {tr('schedule.runNoActions')}
          </td>
        </tr>
      )}
      {expanded &&
        nodes.map((node, index) => {
          const step = stepById.get(node.id);
          const repair = run.scriptRepairs?.[node.id];
          const stepDetail = [
            step?.error ?? step?.output ?? node.type,
            repair && formatScriptRepair(repair),
          ]
            .filter(Boolean)
            .join(' · ');
          const state = step
            ? step.status
            : executed.has(node.id)
              ? failed && node.id === lastExecutedId
                ? 'failed'
                : 'succeeded'
              : skipped.has(node.id)
                ? 'skipped'
                : run.status === 'running'
                  ? 'running'
                  : 'skipped';
          return (
            <tr
              key={node.id}
              className={`h-9 border-b border-border-muted/85 text-[12.5px] ${failed ? 'bg-error/[0.04]' : 'bg-surface-muted'}`}
            >
              <td className="truncate pl-8 pr-3 text-text-secondary">
                <span className="mr-2 tabular-nums text-text-muted">{index + 1}</span>
                {runNodeLabel(node, tr)}
              </td>
              <td className="px-3">
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                    state === 'succeeded'
                      ? 'bg-success/10 text-success'
                      : state === 'failed'
                        ? 'bg-error/10 text-error'
                        : state === 'running'
                          ? 'bg-accent-muted text-accent'
                          : 'bg-surface-active text-text-muted'
                  }`}
                >
                  {tr(`schedule.actionRunState.${state}`, state)}
                </span>
              </td>
              <td className="px-2 text-text-muted" />
              <td className="whitespace-nowrap px-2 tabular-nums text-text-muted">
                {step?.startedAt ? formatAppDateTime(step.startedAt) : '—'}
              </td>
              <td className="whitespace-nowrap px-2 tabular-nums text-text-muted">
                {step ? formatDurationMs(step.durationMs) : '—'}
              </td>
              <td className="px-2 text-text-muted">—</td>
              <td className="px-2 text-text-muted">—</td>
              <td
                className={`truncate px-2 ${step?.error ? 'text-error' : 'text-text-muted'}`}
                title={stepDetail}
              >
                {stepDetail}
              </td>
            </tr>
          );
        })}
      {expanded && (run.error || repairs.length > 0) && (
        <tr className="border-b border-border-muted/85 bg-error/[0.04]">
          <td colSpan={8} className="whitespace-pre-wrap break-words px-8 py-2 text-xs text-error">
            {run.error}
            {Object.entries(run.scriptRepairs ?? {}).map(([nodeId, repair]) => (
              <div key={nodeId}>
                {formatScriptRepair(repair)}
                <ScriptRepairActions repair={repair} tr={tr} />
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

export function formatScriptRepair(repair: ScriptRepair): string {
  if (repair.status === 'failed' && repair.reasonKey) {
    return i18n.t('schedule.repair.status.failed', {
      reason: i18n.t(`schedule.scriptRunMessages.${repair.reasonKey}`),
    });
  }
  return i18n.t(`schedule.repair.status.${repair.status}`, repair);
}

export function ScriptRepairActions({
  repair,
  tr,
}: {
  repair: ScriptRepair;
  tr: (key: string, fallback?: string) => string;
}) {
  const openScriptEditor = useAppStore((state) => state.openScriptEditor);
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  if (!('version' in repair)) return null;
  const { packageId, version } = repair;
  const passed = repair.status === 'ready' || repair.status === 'awaitingReview';
  const publish = async () => {
    setState('busy');
    try {
      await automationClient.scripts.publish(packageId, version);
      setState('done');
      showToast('success', tr('schedule.repair.published').replace('{{version}}', String(version)));
    } catch (err) {
      setState('idle');
      showToast('error', ipcErrorMessage(err));
    }
  };
  return (
    <span className="mt-1.5 flex gap-2" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        data-testid="run-repair-view"
        onClick={() => openScriptEditor({ packageId, version, step: 'review' })}
        className="inline-flex h-7 items-center gap-1 rounded border border-border-subtle bg-surface px-2.5 text-[12px] font-medium text-text-secondary hover:bg-accent-muted hover:text-accent"
      >
        {tr('schedule.repair.view')}
      </button>
      {passed && (
        <button
          type="button"
          data-testid="run-repair-publish"
          disabled={state !== 'idle'}
          onClick={() => void publish()}
          className="inline-flex h-7 items-center gap-1 rounded border border-accent/30 bg-surface px-2.5 text-[12px] font-medium text-accent hover:bg-accent-muted disabled:opacity-50"
        >
          {state === 'done'
            ? tr('schedule.repair.inUse')
            : tr('schedule.repair.publish').replace('{{version}}', String(version))}
        </button>
      )}
    </span>
  );
}

export function getRunSortTime(run: AutomationRun): number {
  return run.startedAt ?? run.queuedAt ?? run.createdAt;
}

function formatExecutionSummary(
  run: AutomationRun,
  tr: (key: string, fallback?: string) => string
): string {
  if (run.error)
    return [run.error, ...Object.values(run.scriptRepairs ?? {}).map(formatScriptRepair)].join(
      ' · '
    );
  if (!run.executionSummary) return '—';
  if (run.executionSummary.skippedNodeIds.length === 0) {
    return tr('schedule.executionSummaryAll').replace(
      '{{executed}}',
      String(run.executionSummary.executedNodeIds.length)
    );
  }
  return tr('schedule.executionSummary')
    .replace('{{executed}}', String(run.executionSummary.executedNodeIds.length))
    .replace('{{skipped}}', String(run.executionSummary.skippedNodeIds.length));
}
