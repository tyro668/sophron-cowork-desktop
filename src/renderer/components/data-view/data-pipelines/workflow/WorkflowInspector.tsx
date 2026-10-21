import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, CircleAlert, MousePointerClick, PencilLine, Play } from 'lucide-react';
import type {
  DataRawTable,
  DataRawTablePreview,
  DataResultTable,
  DataWorkflowEdge,
  DataWorkflowNode,
  WorkflowNodeRunStat,
} from '../../../../types';
import {
  exportPrepOperatorDsl,
  parsePrepOperatorDsl,
  type PrepDiagnostic,
} from '../../../../../shared/prep-dsl';
import type { DataColumnTypeInfo } from '../../../../../shared/data-field-types';
import { RAW_TABLE_PREVIEW_PAGE_SIZE, fixedTabWidthClass } from '../../shared';
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

const NODE_PREVIEW_PAGE_SIZES = [50, RAW_TABLE_PREVIEW_PAGE_SIZE, 200] as const;

export function WorkflowInspector({
  pipelineId,
  node,
  workflowNodes,
  workflowEdges,
  rawTables,
  isRawTablesLoading,
  resultTables,
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
  /** Owning pipeline — the logs tab lists its recorded runs. */
  pipelineId: string;
  node: DataWorkflowNode | null;
  workflowNodes: DataWorkflowNode[];
  workflowEdges: DataWorkflowEdge[];
  rawTables: DataRawTable[];
  isRawTablesLoading: boolean;
  resultTables: DataResultTable[];
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
  const [operatorFieldTypes, setOperatorFieldTypes] = useState<DataColumnTypeInfo[]>([]);
  const [isEditingNodeTitle, setIsEditingNodeTitle] = useState(false);
  const [nodePreviewData, setNodePreviewData] = useState<DataRawTablePreview | null>(null);
  const [nodePreviewLoading, setNodePreviewLoading] = useState(false);
  const [nodePreviewError, setNodePreviewError] = useState<string | null>(null);
  const [nodePreviewPage, setNodePreviewPage] = useState(1);
  const [nodePreviewPageSize, setNodePreviewPageSize] = useState<number>(
    RAW_TABLE_PREVIEW_PAGE_SIZE
  );
  const [nodePreviewFetchedAt, setNodePreviewFetchedAt] = useState<number | null>(null);
  const nodeTitleInputRef = useRef<HTMLInputElement | null>(null);
  const nodePreviewRequestSeq = useRef(0);
  const operatorFieldsRequestSeq = useRef(0);
  const workflowData = useWorkflowDataContext();
  // The cache row stamps the upstream signature + generation time of the run
  // that produced it — authoritative basis for staleness and "updated at".
  // Signature-less sources (bound rawTable/output tables, pre-migration rows)
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

    if (
      !node ||
      !(usesOperatorDsl || node.type === 'output') ||
      operatorFieldSourceCandidates.length === 0
    ) {
      setOperatorFieldCompletions([]);
      setOperatorFieldTypes([]);
      return;
    }
    if (!dataClient.has('getWorkflowNodeColumns')) return;

    void (async () => {
      for (const candidate of operatorFieldSourceCandidates) {
        try {
          const input = {
            pipelineId: candidate.pipelineId,
            nodeId: candidate.id,
            nodeType: candidate.type,
            nodeConfig: candidate.config,
            workflow: workflowData.workflow,
          };
          const columns = dataClient.has('getWorkflowNodeColumnTypes')
            ? await dataClient.getWorkflowNodeColumnTypes(input)
            : (await dataClient.getWorkflowNodeColumns(input)).map((name) => ({
                name,
                type: 'text' as const,
                storageType: 'VARCHAR',
              }));
          if (requestSeq !== operatorFieldsRequestSeq.current) return;
          if (columns.length > 0) {
            setOperatorFieldCompletions(columns.map((column) => column.name));
            setOperatorFieldTypes(columns);
            return;
          }
        } catch {
          if (requestSeq !== operatorFieldsRequestSeq.current) return;
        }
      }
      if (requestSeq === operatorFieldsRequestSeq.current) {
        setOperatorFieldCompletions([]);
        setOperatorFieldTypes([]);
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
        pipelineId: node.pipelineId,
        nodeId: node.id,
        nodeType: node.type,
        nodeConfig: node.config,
        workflow: workflowData.workflow,
        limit: nodePreviewPageSize,
        offset: (nodePreviewPage - 1) * nodePreviewPageSize,
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
  }, [
    activeTab,
    node,
    nodeDataRefreshVersion,
    nodePreviewPage,
    nodePreviewPageSize,
    t,
    workflowData,
  ]);

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
      <aside
        data-testid="inspector-empty"
        className="flex min-h-0 flex-col items-center justify-center gap-2 overflow-y-auto border-t border-border-subtle bg-surface p-3 text-xs text-text-muted"
      >
        <MousePointerClick className="h-5 w-5" aria-hidden />
        <span>{t('data.workflow.noNodeSelected')}</span>
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
        <div className="flex h-10 shrink-0 items-stretch justify-between border-b border-border-subtle pl-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
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
          <div
            className="flex min-w-0 flex-shrink items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
            data-testid="inspector-tabs"
          >
            {/* Flush segmented tabs: fixed shared width; scrolls horizontally if the panel is narrow. */}
            <TabsList className="flex h-full flex-none gap-0 rounded-none border-0 border-l border-border-subtle bg-transparent p-0 text-xs">
              {inspectorTabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  title={tab.label}
                  data-fixed-tab
                  className={`${fixedTabWidthClass} h-full rounded-none border-r border-border-subtle text-[12px] font-medium text-text-secondary shadow-none last:border-r-0 data-[state=active]:bg-accent-muted data-[state=active]:text-accent-text data-[state=active]:shadow-[inset_0_-2px_0_var(--color-accent)]`}
                >
                  <span className="truncate">{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>
        <TabsContent
          value={resolvedTab}
          forceMount
          className={`min-h-0 flex-1 overflow-hidden ${
            resolvedTab === 'data' ||
            ((resolvedTab === 'config' || resolvedTab === 'dsl') &&
              (usesOperatorDsl || node.type === 'output' || node.type === 'input_source'))
              ? 'p-0'
              : 'p-2.5'
          }`}
        >
          {resolvedTab === 'logs' ? (
            <WorkflowRunLogsPanel
              pipelineId={pipelineId}
              node={node}
              workflowNodes={workflowNodes}
              runStat={runStat}
              refreshKey={runRefreshKey}
              onSelectNode={onSelectNode}
            />
          ) : resolvedTab === 'data' ? (
            <div className="flex h-full min-h-0 flex-col">
              {firstZeroOutputNode && nodePreviewData && nodePreviewData.totalRows === 0 ? (
                <div className="mx-2 mt-2 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
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
                  pageSizeOptions={NODE_PREVIEW_PAGE_SIZES}
                  onPageSizeChange={(size) => {
                    setNodePreviewPageSize(size);
                    setNodePreviewPage(1);
                  }}
                  footerLeading={
                    <>
                      <button
                        type="button"
                        onClick={onPreviewToHere}
                        disabled={!onPreviewToHere || isPreviewRunning}
                        title={t('data.workflow.previewToThisStepHint')}
                        data-testid="preview-to-here"
                        className="-ml-3 inline-flex h-full flex-shrink-0 items-center gap-1.5 border-r border-border-subtle px-3 text-xs font-semibold text-accent transition-colors hover:bg-accent-muted/60 disabled:cursor-not-allowed disabled:text-text-muted disabled:opacity-60"
                      >
                        <Play className="h-3.5 w-3.5" />
                        {isPreviewRunning
                          ? t('common.loading')
                          : t('data.workflow.previewToThisStep')}
                      </button>
                      {runStat ? (
                        <span className="flex-shrink-0 text-[11px] text-text-muted">
                          {formatNodeRunStatLine(runStat, t)}
                        </span>
                      ) : null}
                      {nodePreviewGeneratedAt ? (
                        <span className="flex-shrink-0 text-[11px] text-text-muted">
                          {t('data.workflow.nodeDataUpdatedAt', {
                            time: new Date(nodePreviewGeneratedAt).toLocaleTimeString(),
                          })}
                        </span>
                      ) : null}
                      {nodePreviewStale ? (
                        <span
                          data-testid="node-data-stale"
                          className="inline-flex h-5 flex-shrink-0 items-center gap-1 rounded-[4px] bg-warning/10 px-[7px] text-[11px] font-medium text-warning"
                        >
                          <CircleAlert className="h-3 w-3" />
                          {t('data.workflow.nodeDataStale')}
                        </span>
                      ) : null}
                    </>
                  }
                />
              </div>
            </div>
          ) : usesOperatorDsl ? (
            <WorkflowOperatorConfigPanel
              mode={resolvedTab === 'dsl' ? 'dsl' : 'form'}
              node={node}
              workflowNodes={workflowNodes}
              workflowEdges={workflowEdges}
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
              fieldTypes={operatorFieldTypes}
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
              rawTables={rawTables}
              isLoading={isRawTablesLoading}
              onNodeChange={onNodeChange}
            />
          ) : node.type === 'output' ? (
            <WorkflowOutputConfig
              node={node}
              resultTables={resultTables}
              fieldCompletions={operatorFieldCompletions}
              onNodeChange={onNodeChange}
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div className="grid content-start gap-3 sm:grid-cols-2">
                <SelectLike
                  label={t('data.workflow.input')}
                  value={t('data.workflow.previousOutput')}
                />
                <SelectLike label={t('data.workflow.output')} value={t(catalog.labelKey)} />
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
