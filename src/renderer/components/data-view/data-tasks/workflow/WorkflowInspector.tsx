import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, PencilLine, Play } from 'lucide-react';
import type {
  DataDataset,
  DataInputTablePreview,
  DataOutputTable,
  DataWorkflowEdge,
  DataWorkflowNode,
  WorkflowNodeRunStat,
} from '../../../../types';
import {
  exportPrepOperatorDsl,
  parsePrepOperatorDsl,
  type PrepDiagnostic,
} from '../../../../../shared/prep-dsl';
import { INPUT_TABLE_PREVIEW_PAGE_SIZE } from '../../shared';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../ui/tabs';
import { dataClient } from '../../../../features/data/api/data-client';
import { useWorkflowDataContext } from '../../../../hooks/workflow-data-context';
import { WorkflowOperatorConfigPanel } from '../../WorkflowOperatorConfigPanel';
import { getOperatorCatalog } from './operator-catalog';
import { formatNodeRunStatLine, getWorkflowConfigSummary } from './workflow-summary';
import { WorkflowRunLogsPanel } from './WorkflowRunLogsPanel';
import { WorkflowInputSourceConfig } from './WorkflowInputSourceConfig';
import { WorkflowOutputConfig } from './WorkflowOutputConfig';
import { WorkflowNodeDataPreview, WorkflowSummaryPanel } from './WorkflowUi';
import { formatPrepDiagnosticForUi } from './workflow-diagnostics';
import { getWorkflowFieldSourceCandidates } from './workflow-field-candidates';
import type { WorkflowInspectorTab } from './workflow-model';

export function WorkflowInspector({
  taskId,
  node,
  workflowNodes,
  workflowEdges,
  inputTables,
  isInputTablesLoading,
  outputTables,
  activeTab,
  onActiveTabChange,
  onNodeChange,
  onApplyOperatorDsl,
  isRunningOperatorDsl,
  nodeDataRefreshVersion,
  runStat,
  runRefreshKey,
  onSelectNode,
  firstZeroOutputNode,
  isPreviewStale,
  upstreamSignature,
  onPreviewToHere,
  isPreviewRunning,
}: {
  /** Owning task — the logs tab lists its recorded runs. */
  taskId: string;
  node: DataWorkflowNode | null;
  workflowNodes: DataWorkflowNode[];
  workflowEdges: DataWorkflowEdge[];
  inputTables: DataDataset[];
  isInputTablesLoading: boolean;
  outputTables: DataOutputTable[];
  activeTab: WorkflowInspectorTab;
  onActiveTabChange: (tab: WorkflowInspectorTab) => void;
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
  onApplyOperatorDsl: (nodeId: string, config: Record<string, unknown>) => Promise<void>;
  isRunningOperatorDsl: boolean;
  nodeDataRefreshVersion: number;
  runStat?: WorkflowNodeRunStat;
  /** Bumped when a run finishes — refetches the run list on the logs tab. */
  runRefreshKey?: number | string | null;
  /** Logs tab "locate failed node" — selects the node + opens its config. */
  onSelectNode?: (nodeId: string) => void;
  firstZeroOutputNode?: DataWorkflowNode | null;
  isPreviewStale?: boolean;
  /** Current draft's upstream-subgraph signature for the selected node. */
  upstreamSignature?: string | null;
  onPreviewToHere?: () => void;
  isPreviewRunning?: boolean;
}) {
  const { t } = useTranslation();
  const [operatorDsl, setOperatorDsl] = useState('');
  const [operatorDslBeforeEdit, setOperatorDslBeforeEdit] = useState('');
  const [isEditingOperatorDsl, setIsEditingOperatorDsl] = useState(false);
  const [isDslDialogOpen, setIsDslDialogOpen] = useState(false);
  const [operatorDslDiagnostics, setOperatorDslDiagnostics] = useState<PrepDiagnostic[]>([]);
  const [operatorDslStatus, setOperatorDslStatus] = useState<string | null>(null);
  const [operatorFieldCompletions, setOperatorFieldCompletions] = useState<string[]>([]);
  const [isEditingNodeTitle, setIsEditingNodeTitle] = useState(false);
  const [nodePreviewData, setNodePreviewData] = useState<DataInputTablePreview | null>(null);
  const [nodePreviewLoading, setNodePreviewLoading] = useState(false);
  const [nodePreviewError, setNodePreviewError] = useState<string | null>(null);
  const [nodePreviewPage, setNodePreviewPage] = useState(1);
  const [nodePreviewFetchedAt, setNodePreviewFetchedAt] = useState<number | null>(null);
  const nodeTitleInputRef = useRef<HTMLInputElement | null>(null);
  const nodePreviewRequestSeq = useRef(0);
  const operatorFieldsRequestSeq = useRef(0);
  const workflowData = useWorkflowDataContext();
  // The cache row stamps the upstream signature + generation time of the run
  // that produced it — authoritative basis for staleness and "updated at".
  // Signature-less sources (bound dataset/output tables, pre-migration rows)
  // fall back to the loaded-workflow comparison passed in via isPreviewStale.
  const nodePreviewStale = nodePreviewData?.workflowSignature
    ? nodePreviewData.workflowSignature !== upstreamSignature
    : (isPreviewStale ?? false);
  const nodePreviewGeneratedAt = nodePreviewData?.generatedAt ?? nodePreviewFetchedAt;
  const usesOperatorDsl = Boolean(node && node.type !== 'input_source' && node.type !== 'output');
  const operatorFieldSourceNode = useMemo(
    () => getWorkflowFieldSourceNode(node, workflowNodes, workflowEdges),
    [node, workflowEdges, workflowNodes]
  );
  const operatorRightSourceNode = useMemo(
    () => getWorkflowRightSourceNode(node, workflowNodes, workflowEdges),
    [node, workflowEdges, workflowNodes]
  );
  const operatorFieldSourceCandidates = useMemo(
    () => getWorkflowFieldSourceCandidates(operatorFieldSourceNode, workflowNodes, workflowEdges),
    [operatorFieldSourceNode, workflowEdges, workflowNodes]
  );
  const editorCompletionLabels = useMemo(
    () => ({
      keywords: t('data.workflow.completionGroups.keywords'),
      snippets: t('data.workflow.completionGroups.snippets'),
      types: t('data.workflow.completionGroups.types'),
      fields: t('data.workflow.completionGroups.fields'),
    }),
    [t]
  );
  const formatEditorDiagnostic = useCallback(
    (diagnostic: PrepDiagnostic) => formatPrepDiagnosticForUi(diagnostic, t),
    [t]
  );

  useEffect(() => {
    if (!node || !usesOperatorDsl || isEditingOperatorDsl) return;
    const cleanNode = { ...node, config: { ...node.config, dsl: undefined } };
    const nextDsl = exportPrepOperatorDsl(cleanNode);
    setOperatorDsl(nextDsl);
    setOperatorDslBeforeEdit(nextDsl);
    setOperatorDslDiagnostics([]);
    setOperatorDslStatus(null);
  }, [
    isEditingOperatorDsl,
    node,
    node?.config,
    node?.config?.calculations,
    node?.label,
    usesOperatorDsl,
  ]);

  useEffect(() => {
    const requestSeq = operatorFieldsRequestSeq.current + 1;
    operatorFieldsRequestSeq.current = requestSeq;

    if (!node || !usesOperatorDsl || operatorFieldSourceCandidates.length === 0) {
      setOperatorFieldCompletions([]);
      return;
    }
    if (!dataClient.has('getWorkflowNodeColumns')) return;

    void (async () => {
      for (const candidate of operatorFieldSourceCandidates) {
        try {
          const columns = await dataClient.getWorkflowNodeColumns({
            taskId: candidate.taskId,
            nodeId: candidate.id,
            nodeType: candidate.type,
            nodeConfig: candidate.config,
            workflow: workflowData.workflow,
          });
          if (requestSeq !== operatorFieldsRequestSeq.current) return;
          if (columns.length > 0) {
            setOperatorFieldCompletions(columns);
            return;
          }
        } catch {
          if (requestSeq !== operatorFieldsRequestSeq.current) return;
        }
      }
      if (requestSeq === operatorFieldsRequestSeq.current) {
        setOperatorFieldCompletions([]);
      }
    })();
  }, [node, operatorFieldSourceCandidates, usesOperatorDsl, workflowData]);

  useEffect(() => {
    if (!operatorDslStatus) return undefined;
    const timeoutId = window.setTimeout(() => setOperatorDslStatus(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [operatorDslStatus]);

  useEffect(() => {
    setIsEditingNodeTitle(false);
    setIsEditingOperatorDsl(false);
    setIsDslDialogOpen(false);
    setNodePreviewPage(1);
    setNodePreviewData(null);
    setNodePreviewError(null);
    setNodePreviewFetchedAt(null);
  }, [node?.id]);

  useEffect(() => {
    if (activeTab === 'dsl' && !usesOperatorDsl) {
      onActiveTabChange('config');
    }
  }, [activeTab, onActiveTabChange, usesOperatorDsl]);

  useEffect(() => {
    if (activeTab !== 'data' || !node) return;
    if (!dataClient.has('previewWorkflowNode')) {
      setNodePreviewData(null);
      setNodePreviewError(t('data.workflow.nodeDataUnavailable'));
      return;
    }
    const requestSeq = nodePreviewRequestSeq.current + 1;
    nodePreviewRequestSeq.current = requestSeq;
    setNodePreviewLoading(true);
    setNodePreviewError(null);
    void dataClient
      .previewWorkflowNode({
        taskId: node.taskId,
        nodeId: node.id,
        nodeType: node.type,
        nodeConfig: node.config,
        workflow: workflowData.workflow,
        limit: INPUT_TABLE_PREVIEW_PAGE_SIZE,
        offset: (nodePreviewPage - 1) * INPUT_TABLE_PREVIEW_PAGE_SIZE,
      })
      .then((preview) => {
        if (requestSeq === nodePreviewRequestSeq.current) {
          setNodePreviewData(preview);
          setNodePreviewFetchedAt(Date.now());
        }
      })
      .catch((err) => {
        if (requestSeq === nodePreviewRequestSeq.current) {
          setNodePreviewData(null);
          setNodePreviewError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (requestSeq === nodePreviewRequestSeq.current) {
          setNodePreviewLoading(false);
        }
      });
  }, [activeTab, node, nodeDataRefreshVersion, nodePreviewPage, t, workflowData]);

  useEffect(() => {
    if (!isEditingNodeTitle) return;
    nodeTitleInputRef.current?.focus();
    nodeTitleInputRef.current?.select();
  }, [isEditingNodeTitle]);

  const handleOperatorDslChange = useCallback(
    (value: string) => {
      setOperatorDsl(value);
      setOperatorDslStatus(null);
      setIsEditingOperatorDsl(value !== operatorDslBeforeEdit);
    },
    [operatorDslBeforeEdit]
  );

  const handleStartOperatorDslEdit = useCallback(() => {
    if (!node || !usesOperatorDsl) return;
    flushSync(() => {
      if (!isEditingOperatorDsl) {
        setOperatorDslBeforeEdit(operatorDsl);
        setOperatorDslStatus(null);
        setOperatorDslDiagnostics([]);
        setIsEditingOperatorDsl(true);
      }
      setIsDslDialogOpen(true);
      onActiveTabChange('dsl');
    });
  }, [isEditingOperatorDsl, node, onActiveTabChange, operatorDsl, usesOperatorDsl]);

  const handleCancelOperatorDslEdit = useCallback(() => {
    if (!node || !usesOperatorDsl) return;
    const nextDsl = operatorDslBeforeEdit || exportPrepOperatorDsl(node);
    setOperatorDsl(nextDsl);
    setOperatorDslStatus(null);
    setOperatorDslDiagnostics([]);
    setIsEditingOperatorDsl(false);
    setIsDslDialogOpen(false);
  }, [node, operatorDslBeforeEdit, usesOperatorDsl]);

  const handleFormatOperatorDsl = useCallback(() => {
    if (!node || !usesOperatorDsl) return;
    const result = parsePrepOperatorDsl(operatorDsl, node.type);
    setOperatorDslDiagnostics(result.diagnostics);
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    if (!result.operator || errors.length > 0) {
      setOperatorDslStatus(null);
      return;
    }
    setIsEditingOperatorDsl(true);
    setOperatorDsl(
      exportPrepOperatorDsl({ id: node.id, type: node.type, config: result.operator.config })
    );
    setOperatorDslStatus(null);
  }, [node, operatorDsl, usesOperatorDsl]);

  const handleApplyOperatorDsl = useCallback(async () => {
    if (!node || !usesOperatorDsl || !isEditingOperatorDsl || isRunningOperatorDsl) return;
    const result = parsePrepOperatorDsl(operatorDsl, node.type);
    setOperatorDslDiagnostics(result.diagnostics);
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    if (!result.operator || errors.length > 0) {
      setOperatorDslStatus(null);
      return;
    }
    const nextDsl = result.operator.config.dsl as string;
    setOperatorDsl(nextDsl);
    setOperatorDslBeforeEdit(nextDsl);
    setOperatorDslStatus(t('data.workflow.operatorDslApplied'));
    setOperatorDslDiagnostics([]);
    setIsEditingOperatorDsl(false);
    setIsDslDialogOpen(false);
    setNodePreviewPage(1);
    setNodePreviewData(null);
    setNodePreviewError(null);
    await onApplyOperatorDsl(node.id, result.operator.config);
  }, [
    isEditingOperatorDsl,
    isRunningOperatorDsl,
    node,
    onApplyOperatorDsl,
    operatorDsl,
    t,
    usesOperatorDsl,
  ]);

  const handleNodeTitleChange = useCallback(
    (value: string) => {
      onNodeChange((current) => ({
        ...current,
        label: value.slice(0, 50),
        updatedAt: Date.now(),
      }));
    },
    [onNodeChange]
  );

  if (!node) {
    return (
      <aside className="min-h-0 overflow-y-auto border-t border-border-subtle bg-surface p-3 text-xs text-text-muted">
        {t('data.workflow.noNodeSelected')}
      </aside>
    );
  }

  const catalog = getOperatorCatalog(node.type);
  const Icon = catalog.Icon;
  const summary = getWorkflowConfigSummary(node, t);
  const resolvedTab = activeTab === 'dsl' && !usesOperatorDsl ? 'config' : activeTab;
  const inspectorTabs: { id: WorkflowInspectorTab; label: string }[] = usesOperatorDsl
    ? [
        { id: 'config', label: t('data.workflow.visualConfig') },
        { id: 'dsl', label: t('data.workflow.dsl') },
        { id: 'data', label: t('data.workflow.data') },
        { id: 'logs', label: t('data.workflow.logs') },
      ]
    : [
        { id: 'config', label: t('data.workflow.visualConfig') },
        { id: 'data', label: t('data.workflow.data') },
        { id: 'logs', label: t('data.workflow.logs') },
      ];

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-t border-border-subtle bg-surface">
      <Tabs
        value={resolvedTab}
        onValueChange={(v) => onActiveTabChange(v as WorkflowInspectorTab)}
        className="contents"
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-muted px-3">
          <div className="flex min-w-0 flex-1 items-center gap-3 pr-2">
            <span
              className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${catalog.colorClassName}`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="flex min-w-0 items-center gap-1.5">
              {isEditingNodeTitle ? (
                <span className="flex h-7 min-w-0 max-w-[16rem] items-center rounded-lg border border-accent/40 bg-surface px-2 shadow-soft ring-2 ring-accent/15">
                  <input
                    ref={nodeTitleInputRef}
                    value={node.label}
                    maxLength={50}
                    onChange={(event) => handleNodeTitleChange(event.target.value)}
                    onBlur={() => setIsEditingNodeTitle(false)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'Escape') {
                        event.currentTarget.blur();
                      }
                    }}
                    className="min-w-0 flex-1 bg-transparent text-[14px] font-medium text-text-secondary outline-none"
                  />
                  <span className="ml-2 text-[10px] text-text-muted">{node.label.length}/50</span>
                </span>
              ) : (
                <div className="min-w-0 truncate text-[14px] font-medium text-text-secondary">
                  {node.label || t(catalog.labelKey)}
                </div>
              )}
              <button
                onClick={() => setIsEditingNodeTitle(true)}
                className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-accent-muted hover:text-accent"
                title={t('common.edit')}
              >
                <PencilLine className="h-3.5 w-3.5" />
                <span className="sr-only">{t('common.edit')}</span>
              </button>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <TabsList className="flex gap-0 rounded-lg border-0 bg-surface-active p-0.5 text-xs">
              {inspectorTabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="h-7 whitespace-nowrap rounded-md px-3 data-[state=active]:bg-background data-[state=active]:text-accent"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>
        <TabsContent
          value={resolvedTab}
          forceMount
          className={`min-h-0 flex-1 overflow-hidden ${
            (resolvedTab === 'config' || resolvedTab === 'dsl') && usesOperatorDsl ? 'p-0' : 'p-2.5'
          }`}
        >
          {resolvedTab === 'logs' ? (
            <WorkflowRunLogsPanel
              taskId={taskId}
              node={node}
              workflowNodes={workflowNodes}
              runStat={runStat}
              refreshKey={runRefreshKey}
              onSelectNode={onSelectNode}
            />
          ) : resolvedTab === 'data' ? (
            <div className="flex h-full min-h-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <button
                  type="button"
                  onClick={onPreviewToHere}
                  disabled={!onPreviewToHere || isPreviewRunning}
                  title={t('data.workflow.previewToThisStepHint')}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-2.5 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <Play className="h-3 w-3" />
                  {isPreviewRunning ? t('common.loading') : t('data.workflow.previewToThisStep')}
                </button>
                {runStat ? (
                  <span className="text-[11px] text-text-muted">
                    {formatNodeRunStatLine(runStat, t)}
                  </span>
                ) : null}
                {nodePreviewGeneratedAt ? (
                  <span className="text-[11px] text-text-muted">
                    {t('data.workflow.nodeDataUpdatedAt', {
                      time: new Date(nodePreviewGeneratedAt).toLocaleTimeString(),
                    })}
                  </span>
                ) : null}
                {nodePreviewStale ? (
                  <span className="rounded-md border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                    {t('data.workflow.nodeDataStale')}
                  </span>
                ) : null}
              </div>
              {firstZeroOutputNode && nodePreviewData && nodePreviewData.totalRows === 0 ? (
                <div className="rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
                  {firstZeroOutputNode.id === node?.id
                    ? t('data.workflow.firstZeroOutputHere')
                    : t('data.workflow.firstZeroOutputUpstream', {
                        name: firstZeroOutputNode.label || firstZeroOutputNode.id,
                      })}
                </div>
              ) : null}
              <div className="min-h-0 flex-1">
                <WorkflowNodeDataPreview
                  preview={nodePreviewData}
                  isLoading={nodePreviewLoading}
                  error={nodePreviewError}
                  currentPage={nodePreviewPage}
                  onPageChange={setNodePreviewPage}
                />
              </div>
            </div>
          ) : usesOperatorDsl ? (
            <WorkflowOperatorConfigPanel
              mode={resolvedTab === 'dsl' ? 'dsl' : 'form'}
              node={node}
              workflowNodes={workflowNodes}
              sourceNode={
                operatorFieldSourceNode
                  ? {
                      id: operatorFieldSourceNode.id,
                      type: operatorFieldSourceNode.type,
                      config: operatorFieldSourceNode.config,
                    }
                  : undefined
              }
              rightSourceNode={
                operatorRightSourceNode
                  ? {
                      id: operatorRightSourceNode.id,
                      type: operatorRightSourceNode.type,
                      config: operatorRightSourceNode.config,
                    }
                  : undefined
              }
              fieldCompletions={operatorFieldCompletions}
              upstreamRowCount={nodePreviewData?.totalRows}
              operatorDsl={operatorDsl}
              operatorDslStatus={operatorDslStatus}
              operatorDslDiagnostics={operatorDslDiagnostics}
              isEditingOperatorDsl={isEditingOperatorDsl}
              isDslDialogOpen={isDslDialogOpen}
              isRunningOperatorDsl={isRunningOperatorDsl}
              editorCompletionLabels={editorCompletionLabels}
              formatEditorDiagnostic={formatEditorDiagnostic}
              onNodeChange={onNodeChange}
              onDslChange={handleOperatorDslChange}
              onDiagnosticsChange={setOperatorDslDiagnostics}
              onStartDslEdit={handleStartOperatorDslEdit}
              onCancelDslEdit={handleCancelOperatorDslEdit}
              onFormatDsl={handleFormatOperatorDsl}
              onApplyDsl={() => void handleApplyOperatorDsl()}
            />
          ) : node.type === 'input_source' ? (
            <WorkflowInputSourceConfig
              node={node}
              inputTables={inputTables}
              isLoading={isInputTablesLoading}
              onNodeChange={onNodeChange}
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div className="grid content-start gap-3 sm:grid-cols-2">
                {node.type === 'output' ? (
                  <WorkflowOutputConfig
                    node={node}
                    outputTables={outputTables}
                    onNodeChange={onNodeChange}
                  />
                ) : (
                  <>
                    <SelectLike
                      label={t('data.workflow.input')}
                      value={t('data.workflow.previousOutput')}
                    />
                    <SelectLike label={t('data.workflow.output')} value={t(catalog.labelKey)} />
                  </>
                )}
              </div>
              <WorkflowSummaryPanel
                title={t('data.workflow.summary')}
                rows={summary.primary}
                emptyText={t('data.workflow.noConfig')}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function SelectLike({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-secondary">{label}</span>
      <button className="flex h-8 w-full items-center justify-between rounded-lg border border-border-muted bg-surface px-2 text-left text-xs font-medium text-text-secondary shadow-soft">
        <span className="truncate">{value}</span>
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
        </span>
      </button>
    </label>
  );
}

function getWorkflowFieldSourceNode(
  node: DataWorkflowNode | null,
  nodes: DataWorkflowNode[],
  edges: DataWorkflowEdge[]
): DataWorkflowNode | null {
  if (!node) return null;
  const preferredHandle = node.type === 'join' || node.type === 'set_op' ? 'left' : 'input';
  const edge =
    edges.find(
      (item) => item.targetNodeId === node.id && (item.targetHandle ?? 'input') === preferredHandle
    ) ?? edges.find((item) => item.targetNodeId === node.id);
  if (!edge) return null;
  return nodes.find((item) => item.id === edge.sourceNodeId) ?? null;
}

function getWorkflowRightSourceNode(
  node: DataWorkflowNode | null,
  nodes: DataWorkflowNode[],
  edges: DataWorkflowEdge[]
): DataWorkflowNode | null {
  if (!node || (node.type !== 'join' && node.type !== 'set_op')) return null;
  const edge = edges.find((item) => item.targetNodeId === node.id && item.targetHandle === 'right');
  if (!edge) return null;
  return nodes.find((item) => item.id === edge.sourceNodeId) ?? null;
}
