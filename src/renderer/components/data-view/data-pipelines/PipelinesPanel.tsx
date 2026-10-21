import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { dataClient } from '../../../features/data/api/data-client';
import type { DataPipelineRun } from '../../../../shared/contracts/data';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpDown,
  FolderInput,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Workflow,
} from 'lucide-react';
import type { DataPipeline, DataGroup } from '../../../types';
import {
  AssignGroupDialog,
  buildGroupSections,
  GroupNameDialog,
  GroupSectionRows,
  hasNamedSections,
  toggleCollapsed,
  type AssignGroupTarget,
  type DataListGroup,
} from '../group-ui';
import {
  TabBarAction,
  tabBarNewCellClass,
  DataMoreMenu,
  DataTableSearch,
  DataToolbarButton,
  EmptyState,
  flatToolbarRowClass,
  LoadingState,
  StatusBadge,
  TABLE_PAGE_SIZE,
  formatTimestamp,
} from '../shared';
import { Button } from '../../ui/button';

type TFn = (key: string, o?: Record<string, unknown>) => string;

interface PipelineListMeta {
  inputs: string[];
  outputs: string[];
  lastRun: DataPipelineRun | null;
}

type IoNode = { label: string; config?: unknown };
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
function inputLabel(node: IoNode): string {
  const config = (node.config ?? {}) as { rawTableName?: unknown; rawTableId?: unknown };
  if (typeof config.rawTableName === 'string' && config.rawTableName) return config.rawTableName;
  if (
    typeof config.rawTableId === 'string' &&
    config.rawTableId &&
    !UUID_LIKE.test(config.rawTableId)
  )
    return config.rawTableId;
  return node.label;
}
function outputLabel(node: IoNode): string {
  const config = (node.config ?? {}) as { table?: unknown; resultTableName?: unknown };
  if (typeof config.resultTableName === 'string' && config.resultTableName)
    return config.resultTableName;
  return typeof config.table === 'string' && config.table && !config.table.startsWith('output_')
    ? config.table
    : node.label;
}

/** Lazily loads per-row I/O summary + last run for the visible pipelines. */
function usePipelineListMeta(pipelines: DataPipeline[]) {
  const [meta, setMeta] = useState<Record<string, PipelineListMeta>>({});
  const [automationNames, setAutomationNames] = useState<Record<string, string>>({});
  const key = pipelines.map((p) => `${p.id}:${p.updatedAt}:${p.lastRunAt ?? ''}`).join('|');
  useEffect(() => {
    let active = true;
    if (!dataClient.isAvailable()) return;
    for (const pipeline of pipelines) {
      void Promise.all([
        dataClient.has('getPipelineWorkflow')
          ? dataClient.getPipelineWorkflow(pipeline.id).catch(() => null)
          : Promise.resolve(null),
        dataClient.has('listPipelineRuns')
          ? dataClient.listPipelineRuns(pipeline.id, 1).catch(() => [])
          : Promise.resolve([]),
      ]).then(([workflow, runs]) => {
        if (!active) return;
        const nodes = workflow?.nodes ?? [];
        setMeta((current) => ({
          ...current,
          [pipeline.id]: {
            inputs: nodes.filter((n) => n.type === 'input_source').map(inputLabel),
            outputs: nodes.filter((n) => n.type === 'output').map(outputLabel),
            lastRun: runs[0] ?? null,
          },
        }));
      });
    }
    // .then() turns a synchronous throw (bridge missing) into a rejection.
    void Promise.resolve()
      .then(() => dataClient.listAutomations())
      .then((result) => {
        if (!active || !result) return;
        const names: Record<string, string> = {};
        for (const automation of result.automations ?? []) {
          for (const node of automation.actionGraph?.nodes ?? []) {
            const pipelineId = (node.config as { pipelineId?: unknown } | undefined)?.pipelineId;
            if (node.type === 'data.pipeline.run' && typeof pipelineId === 'string') {
              names[pipelineId] ??= automation.name;
            }
          }
        }
        setAutomationNames(names);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { meta, automationNames };
}

function formatRunDuration(run: DataPipelineRun, t: TFn) {
  if (!run.finishedAt) return '';
  const ms = Math.max(0, run.finishedAt - run.startedAt);
  return ms < 1000
    ? t('data.pipelineList.durationMs', { value: ms })
    : t('data.pipelineList.durationSec', { value: (ms / 1000).toFixed(1) });
}

function LastRunCell({ run, t }: { run: DataPipelineRun | null | undefined; t: TFn }) {
  if (!run) return <span className="text-text-muted">—</span>;
  const tone =
    run.status === 'completed'
      ? 'bg-success/10 text-success'
      : run.status === 'failed'
        ? 'bg-error/10 text-error'
        : 'bg-accent-muted text-accent-text';
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        className={`inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium ${tone}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {t(`data.pipelineList.run_${run.status}`, { defaultValue: run.status })}
      </span>
      <span className="truncate text-xs text-text-muted">{formatRunDuration(run, t)}</span>
    </span>
  );
}

export function PipelinesPanel({
  pipelines,
  totalPipelines,
  groups,
  groupCounts,
  groupPages,
  searchQuery,
  actionId,
  isLoading,
  isCreateDisabled,
  onCreate,
  onSearchChange,
  onRefresh,
  onGroupPageChange,
  onRun,
  onEdit,
  onDelete,
  onDeleteAll,
  onAssignToGroup,
  onRenameGroup,
  onDeleteGroup,
}: {
  pipelines: DataPipeline[];
  totalPipelines: number;
  groups: DataGroup[];
  groupCounts: Record<string, number>;
  groupPages: Record<string, number>;
  searchQuery: string;
  actionId: string | null;
  isLoading: boolean;
  isCreateDisabled: boolean;
  onCreate: () => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onGroupPageChange: (groupKey: string, page: number) => void;
  onRun: (pipeline: DataPipeline) => void;
  onEdit: (pipeline: DataPipeline) => void;
  onDelete: (pipeline: DataPipeline) => void;
  onDeleteAll: () => void;
  onAssignToGroup: (ids: string[], target: AssignGroupTarget) => void;
  onRenameGroup: (group: DataListGroup, name: string) => void;
  onDeleteGroup: (group: DataListGroup) => void;
}) {
  const { t } = useTranslation();
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DataListGroup | null>(null);
  const selectedPipeline = pipelines.find((pipeline) => pipeline.id === selectedPipelineId) ?? null;
  const selectedPipelineBusy = selectedPipeline ? actionId === selectedPipeline.id : false;
  const bulkBusy = actionId === 'delete-all-pipelines';

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (selectedPipelineId && !pipelines.some((pipeline) => pipeline.id === selectedPipelineId)) {
      setSelectedPipelineId(null);
    }
  }, [isLoading, selectedPipelineId, pipelines]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className={`${flatToolbarRowClass} justify-between`}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {(isLoading || pipelines.length > 0 || searchQuery.trim()) && (
            <TabBarAction>
              <button
                onClick={onCreate}
                disabled={isCreateDisabled || bulkBusy}
                className={tabBarNewCellClass}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('data.newPipeline')}
              </button>
            </TabBarAction>
          )}
          <DataTableSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={t('data.searchPlaceholder')}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DataToolbarButton
            icon={<Play className="h-3.5 w-3.5" />}
            label={t('data.actions.run')}
            disabled={!selectedPipeline || selectedPipelineBusy || bulkBusy}
            onClick={() => {
              if (selectedPipeline) {
                onRun(selectedPipeline);
              }
            }}
          />
          <DataToolbarButton
            icon={<PencilLine className="h-3.5 w-3.5" />}
            label={t('data.actions.edit')}
            disabled={!selectedPipeline || selectedPipelineBusy || bulkBusy}
            onClick={() => {
              if (selectedPipeline) {
                onEdit(selectedPipeline);
              }
            }}
          />
          <DataToolbarButton
            icon={<FolderInput className="h-3.5 w-3.5" />}
            label={t('data.groups.moveToGroup')}
            disabled={!selectedPipeline || selectedPipelineBusy || bulkBusy}
            onClick={() => {
              if (selectedPipeline) {
                setAssignDialogOpen(true);
              }
            }}
          />
          <DataToolbarButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={t('data.actions.delete')}
            disabled={!selectedPipeline || selectedPipelineBusy || bulkBusy}
            danger
            onClick={() => {
              if (selectedPipeline) {
                onDelete(selectedPipeline);
              }
            }}
          />
          <DataMoreMenu
            items={[
              {
                key: 'refresh',
                label: t('data.actions.refresh'),
                icon: <RefreshCw className="h-3.5 w-3.5" />,
                disabled: bulkBusy,
                onClick: onRefresh,
              },
              {
                key: 'delete-all',
                label: t('data.actions.deleteAll'),
                icon: <Trash2 className="h-3.5 w-3.5" />,
                danger: true,
                disabled: totalPipelines <= 0 || bulkBusy,
                onClick: onDeleteAll,
              },
            ]}
          />
        </div>
      </div>
      <div className="glass-table ui-table-flush flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {!isLoading && pipelines.length === 0 ? (
            <EmptyState
              label={t('data.emptyPipelines')}
              icon={<Workflow className="h-6 w-6" />}
              description={t(
                searchQuery.trim() ? 'workspaceEmpty.searchHint' : 'workspaceEmpty.dataHint'
              )}
              action={
                searchQuery.trim() ? (
                  <Button variant="secondary" onClick={() => onSearchChange('')}>
                    {t('workspaceEmpty.clearSearch')}
                  </Button>
                ) : (
                  !isCreateDisabled && (
                    <Button variant="primary" onClick={onCreate} className="shadow-soft">
                      <Plus className="h-4 w-4" />
                      {t('data.newPipeline')}
                    </Button>
                  )
                )
              }
            />
          ) : (
            <PipelinesTable
              pipelines={pipelines}
              groups={groups}
              groupCounts={groupCounts}
              groupPages={groupPages}
              isLoading={isLoading}
              selectedPipelineId={selectedPipelineId}
              onSelectPipeline={setSelectedPipelineId}
              onEdit={onEdit}
              onRenameGroup={setRenameTarget}
              onDeleteGroup={onDeleteGroup}
              onGroupPageChange={onGroupPageChange}
            />
          )}
        </div>
        {!isLoading && totalPipelines > 0 && (
          <div className="flex h-8 flex-shrink-0 items-center border-t border-border-muted px-3 text-xs text-text-muted">
            {t('data.pipelineList.total', { count: totalPipelines })}
          </div>
        )}
      </div>
      <AssignGroupDialog
        open={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        groups={groups}
        currentGroupId={selectedPipeline?.groupId ?? null}
        busy={actionId === 'assign-group'}
        onSubmit={(target) => {
          if (selectedPipeline) {
            onAssignToGroup([selectedPipeline.id], target);
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

function PipelinesTable({
  pipelines,
  groups,
  groupCounts,
  groupPages,
  isLoading,
  selectedPipelineId,
  onSelectPipeline,
  onEdit,
  onRenameGroup,
  onDeleteGroup,
  onGroupPageChange,
}: {
  pipelines: DataPipeline[];
  groups: DataGroup[];
  groupCounts: Record<string, number>;
  groupPages: Record<string, number>;
  isLoading: boolean;
  selectedPipelineId: string | null;
  onSelectPipeline: (pipelineId: string) => void;
  onEdit: (pipeline: DataPipeline) => void;
  onRenameGroup: (group: DataListGroup) => void;
  onDeleteGroup: (group: DataListGroup) => void;
  onGroupPageChange: (groupKey: string, page: number) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const sections = buildGroupSections(pipelines, groups, (pipeline) => pipeline.groupId);
  const grouped = hasNamedSections(sections);
  const { meta, automationNames } = usePipelineListMeta(pipelines);

  if (isLoading) {
    return <LoadingState label={t('data.loadingPipelines')} />;
  }

  if (pipelines.length === 0) {
    return <EmptyState label={t('data.emptyPipelines')} />;
  }

  return (
    <div className="min-w-full overflow-x-auto">
      <table className="data-list-table w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted">
            <th className="w-[36%] whitespace-nowrap px-2">{t('data.columns.pipelineName')}</th>
            <th className="w-[8%] whitespace-nowrap px-2">{t('data.pipelineList.nodes')}</th>
            <th className="w-[18%] whitespace-nowrap px-2">{t('data.pipelineList.lastRun')}</th>
            <th className="w-[20%] whitespace-nowrap px-2">{t('data.pipelineList.automation')}</th>
            <th className="w-[18%] whitespace-nowrap px-2">
              <span className="inline-flex items-center gap-1">
                {t('data.columns.updatedAt')}
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
              pageSize={TABLE_PAGE_SIZE}
              onPageChange={(page) => onGroupPageChange(section.key, page)}
              renderRow={(pipeline, _index, indented) => {
                const selected = pipeline.id === selectedPipelineId;
                return (
                  <PipelineRow
                    key={pipeline.id}
                    pipeline={pipeline}
                    meta={meta[pipeline.id]}
                    automationName={automationNames[pipeline.id]}
                    selected={selected}
                    onSelect={() => onSelectPipeline(pipeline.id)}
                    onEdit={() => onEdit(pipeline)}
                    t={t}
                    indented={indented}
                  />
                );
              }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PipelineRow({
  pipeline,
  meta,
  automationName,
  selected,
  onSelect,
  onEdit,
  t,
  indented,
}: {
  pipeline: DataPipeline;
  meta?: PipelineListMeta;
  automationName?: string;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  t: TFn;
  indented?: boolean;
}) {
  return (
    <tr
      onClick={onSelect}
      onDoubleClick={onEdit}
      className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
        selected ? 'bg-accent-muted ring-1 ring-inset ring-accent/20' : 'hover:bg-surface-hover/35'
      }`}
    >
      <td className={indented ? 'pl-9 pr-2' : 'px-2'}>
        <div className="flex min-w-0 items-center gap-3">
          {indented ? (
            <Workflow className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
          ) : (
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
              <Workflow className="h-4 w-4" />
            </div>
          )}
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-text-secondary">
              {pipeline.name}
            </span>
            {pipeline.status === 'draft' && <StatusBadge status={pipeline.status} />}
          </div>
        </div>
      </td>
      <td className="px-2 text-[13px] font-medium text-text-secondary">{pipeline.nodeCount}</td>
      <td className="px-2">
        <LastRunCell run={meta?.lastRun} t={t} />
      </td>
      <td className="px-2 text-[12.5px] text-text-secondary">
        {automationName ? (
          <span className="flex min-w-0 items-center gap-1" title={automationName}>
            <Clock3 className="h-3 w-3 flex-shrink-0 text-text-muted" />
            <span className="truncate">{automationName}</span>
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
        {formatTimestamp(pipeline.updatedAt, t)}
      </td>
    </tr>
  );
}
