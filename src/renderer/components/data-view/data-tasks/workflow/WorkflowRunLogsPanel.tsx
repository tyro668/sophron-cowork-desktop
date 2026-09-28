/**
 * Inspector "日志" tab — run history + per-node row stats. Each recorded run
 * shows seq/status/trigger/times/row totals/workflow version; selecting a run
 * lists every node's stats for that execution (selected node highlighted).
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Crosshair } from 'lucide-react';
import type { DataTaskRun, DataWorkflowNode, WorkflowNodeRunStat } from '../../../../types';
import type { BadgeTone } from '../../../ui/badge';
import { Badge } from '../../../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select';
import { dataClient } from '../../../../features/data/api/data-client';
import { useWorkflowDataContext } from '../../../../hooks/workflow-data-context';
import { closestFieldName, parseWorkflowRunError } from './run-error';
import { formatNodeRunStatLine } from './workflow-summary';

const RUN_LIST_LIMIT = 20;

function runStatusTone(status: DataTaskRun['status']): BadgeTone {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  return 'accent';
}

function formatDuration(run: DataTaskRun): string {
  if (run.finishedAt === null) return '—';
  const ms = Math.max(0, run.finishedAt - run.startedAt);
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatTime(value: number | null): string {
  return value === null ? '—' : new Date(value).toLocaleTimeString();
}

export function WorkflowRunLogsPanel({
  taskId,
  node,
  workflowNodes,
  runStat,
  refreshKey,
  onSelectNode,
}: {
  taskId: string;
  node: DataWorkflowNode;
  /** Current graph nodes — resolves stat nodeIds to labels. */
  workflowNodes: DataWorkflowNode[];
  /** Live in-memory stat for the selected node (matched by runId). */
  runStat?: WorkflowNodeRunStat;
  /** Changes whenever a run finishes (lastRunAt / failure timestamp). */
  refreshKey?: number | string | null;
  /** Selects the failed node on the canvas + its config tab. */
  onSelectNode?: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const available =
    dataClient.isAvailable() &&
    dataClient.has('listTaskRuns') &&
    dataClient.has('getTaskRunNodeStats');
  const [runs, setRuns] = useState<DataTaskRun[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runStats, setRunStats] = useState<WorkflowNodeRunStat[] | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    dataClient
      .listTaskRuns(taskId, RUN_LIST_LIMIT)
      .then((list) => {
        if (cancelled) return;
        setRuns(list);
        setRunsError(null);
        setSelectedRunId((current) =>
          current && list.some((run) => run.id === current) ? current : (list[0]?.id ?? null)
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setRunsError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [available, taskId, refreshKey]);

  const selectedRun = useMemo(
    () => runs?.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  );

  useEffect(() => {
    if (!available || !selectedRun) {
      setRunStats(null);
      return;
    }
    let cancelled = false;
    setStatsLoading(true);
    dataClient
      .getTaskRunNodeStats(taskId, selectedRun.id)
      .then((stats) => {
        if (!cancelled) {
          setRunStats(stats);
          setStatsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRunStats([]);
          setStatsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [available, taskId, selectedRun]);

  const nodeLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of workflowNodes) map.set(item.id, item.label || item.id);
    return map;
  }, [workflowNodes]);

  // Live stats from the just-finished run carry its runId; they win over a
  // reread so the panel updates even before the next listTaskRuns refresh.
  const mergedStats = useMemo(() => {
    const merged = new Map<string, WorkflowNodeRunStat>();
    for (const stat of runStats ?? []) merged.set(stat.nodeId, stat);
    if (runStat && runStat.runId === selectedRun?.id) merged.set(node.id, runStat);
    return merged;
  }, [runStats, runStat, selectedRun, node.id]);

  if (!available) {
    return (
      <div className="h-full min-h-0 rounded-lg border border-border-muted bg-surface p-2.5 text-xs text-text-muted">
        {t('data.workflow.noLogs')}
      </div>
    );
  }
  if (runsError) {
    return (
      <div className="h-full min-h-0 rounded-lg border border-error/20 bg-error/5 p-2.5 text-xs text-error">
        {runsError}
      </div>
    );
  }
  if (!runs) {
    return (
      <div className="h-full min-h-0 rounded-lg border border-border-muted bg-surface p-2.5 text-xs text-text-muted">
        {t('common.loading')}
      </div>
    );
  }
  if (runs.length === 0) {
    return (
      <div className="h-full min-h-0 rounded-lg border border-border-muted bg-surface p-2.5 text-xs text-text-muted">
        {t('data.workflow.runEmpty')}
      </div>
    );
  }

  const triggerLabel = (run: DataTaskRun) =>
    run.trigger === 'trial' ? t('data.workflow.runKindTrial') : t('data.workflow.runKindRun');
  const statusLabel = (run: DataTaskRun) => t(`data.status.${run.status}`);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
      <Select
        value={selectedRunId ?? ''}
        onValueChange={(value) => setSelectedRunId(value || null)}
      >
        <SelectTrigger className="h-7 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {runs.map((run) => (
            <SelectItem key={run.id} value={run.id} className="text-xs">
              {`#${run.seq} · ${triggerLabel(run)} · ${statusLabel(run)} · ${formatTime(run.startedAt)}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedRun && (
        <>
          <div className="rounded-lg border border-border-muted bg-surface p-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-text-secondary">#{selectedRun.seq}</span>
              <Badge tone={selectedRun.trigger === 'trial' ? 'default' : 'accent'}>
                {triggerLabel(selectedRun)}
              </Badge>
              <Badge tone={runStatusTone(selectedRun.status)}>{statusLabel(selectedRun)}</Badge>
            </div>
            <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-text-muted">
              <span>{t('data.workflow.runStartedAt')}</span>
              <span className="text-text-secondary">{formatTime(selectedRun.startedAt)}</span>
              <span>{t('data.workflow.runFinishedAt')}</span>
              <span className="text-text-secondary">{formatTime(selectedRun.finishedAt)}</span>
              <span>{t('data.workflow.runDuration')}</span>
              <span className="text-text-secondary">{formatDuration(selectedRun)}</span>
              <span>{t('data.workflow.runRows')}</span>
              <span className="text-text-secondary">
                {t('data.workflow.runRowsValue', {
                  input: selectedRun.inputRows ?? '—',
                  output: selectedRun.outputRows ?? '—',
                })}
              </span>
              {selectedRun.workflowSignature ? (
                <>
                  <span>{t('data.workflow.runVersion')}</span>
                  <span className="font-mono text-[11px] text-text-secondary">
                    {selectedRun.workflowSignature.slice(0, 12)}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          {selectedRun.status === 'failed' && selectedRun.error ? (
            <RunErrorDetail
              raw={selectedRun.error}
              failedNodeId={selectedRun.failedNodeId}
              nodes={workflowNodes}
              taskId={taskId}
              onSelectNode={onSelectNode}
            />
          ) : null}
          <div className="rounded-lg border border-border-muted bg-surface p-2.5 text-xs">
            <div className="mb-1 font-medium text-text-secondary">
              {t('data.workflow.runNodeStats')}
            </div>
            {statsLoading ? (
              <span className="text-text-muted">{t('common.loading')}</span>
            ) : mergedStats.size > 0 ? (
              <div className="flex flex-col gap-1">
                {[...mergedStats.values()].map((stat) => (
                  <div
                    key={stat.nodeId}
                    className={`truncate ${
                      stat.nodeId === node.id ? 'text-accent' : 'text-text-muted'
                    }`}
                  >
                    <span className="text-text-secondary">
                      {stat.nodeId === node.id ? '▸ ' : ''}
                      {nodeLabelById.get(stat.nodeId) ?? stat.nodeId}
                    </span>{' '}
                    {formatNodeRunStatLine(stat, t)}
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-text-muted">
                {selectedRun.status === 'running'
                  ? t('data.workflow.runInProgress')
                  : t('data.workflow.runNoNodeStats')}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Structured presentation of a failed run: a readable headline, the failed
 * node (jump-to-config), the missing field with the columns that were
 * available plus a did-you-mean hint — raw engine text tucked under 技术详情.
 */
function RunErrorDetail({
  raw,
  failedNodeId,
  nodes,
  taskId,
  onSelectNode,
}: {
  raw: string;
  failedNodeId: string | null;
  nodes: DataWorkflowNode[];
  taskId: string;
  onSelectNode?: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const workflowData = useWorkflowDataContext();
  const parsed = useMemo(() => parseWorkflowRunError(raw), [raw]);
  const nodeId = failedNodeId ?? parsed.nodeId ?? null;
  const failedNode = nodeId ? nodes.find((item) => item.id === nodeId) : undefined;
  const [upstreamFields, setUpstreamFields] = useState<string[]>([]);

  // Columns available at the failed node — the "what you can use" list.
  useEffect(() => {
    if (!failedNode || !dataClient.has('getWorkflowNodeColumns')) return;
    let cancelled = false;
    dataClient
      .getWorkflowNodeColumns({
        taskId,
        nodeId: failedNode.id,
        nodeType: failedNode.type,
        nodeConfig: failedNode.config,
        workflow: workflowData.workflow,
      })
      .then((columns) => {
        if (!cancelled) setUpstreamFields(columns);
      })
      .catch(() => {
        if (!cancelled) setUpstreamFields([]);
      });
    return () => {
      cancelled = true;
    };
  }, [failedNode, taskId, workflowData.workflow]);

  const availableFields =
    parsed.candidateFields.length > 0 ? parsed.candidateFields : upstreamFields;
  const suggestion =
    parsed.suggestion ??
    (parsed.missingField ? closestFieldName(parsed.missingField, availableFields) : null);

  return (
    <div className="rounded-lg border border-error/20 bg-error/10 px-2.5 py-2 text-[11px]">
      <div className="flex items-start gap-1.5 text-error">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-4">
            {parsed.missingField
              ? t('data.workflow.runErrorMissingField', { field: parsed.missingField })
              : parsed.headline}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-text-muted">
            {parsed.kind ? (
              <span className="rounded border border-border-subtle bg-surface px-1 py-px font-mono text-[10px]">
                {parsed.kind}
              </span>
            ) : null}
            {parsed.line ? (
              <span>{t('data.workflow.runErrorAtLine', { line: parsed.line })}</span>
            ) : null}
            {failedNode ? (
              <button
                type="button"
                onClick={() => onSelectNode?.(failedNode.id)}
                title={t('data.workflow.runErrorNodeHint')}
                className="inline-flex items-center gap-1 rounded border border-border-subtle bg-surface px-1.5 py-px text-[10px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:text-accent"
              >
                <Crosshair className="h-3 w-3" />
                {t('data.workflow.runErrorNode', {
                  name: failedNode.label || failedNode.id,
                })}
              </button>
            ) : null}
          </div>
          {parsed.missingField && availableFields.length > 0 ? (
            <div className="mt-1.5">
              <span className="text-text-muted">{t('data.workflow.runErrorFields')}：</span>
              <span className="font-mono text-[10px] text-text-secondary">
                {availableFields.slice(0, 10).join(' · ')}
                {availableFields.length > 10 ? ' …' : ''}
              </span>
            </div>
          ) : null}
          {suggestion ? (
            <div className="mt-1 text-text-secondary">
              {t('data.workflow.runErrorSuggestion', { field: suggestion })}
            </div>
          ) : null}
          <details className="mt-1.5">
            <summary className="cursor-pointer select-none text-[10px] text-text-muted">
              {t('data.workflow.runErrorDetails')}
            </summary>
            <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded border border-border-subtle bg-surface p-1.5 font-mono text-[10px] text-text-muted">
              {raw}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}
