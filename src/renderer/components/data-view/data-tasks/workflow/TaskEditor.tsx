import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Connection } from '@xyflow/react';
import {
  AlertCircle,
  ArrowLeft,
  MoreHorizontal,
  PencilLine,
  Play,
  Save,
  Upload,
  Workflow,
} from 'lucide-react';
import type {
  DataCleaningTask,
  DataDataset,
  DataOutputTable,
  DataRunTaskInput,
  DataTaskWorkflow,
  DataWorkflowEdge,
  DataWorkflowNode,
  DataWorkflowOperatorType,
  DataWorkflowSaveInput,
  WorkflowNodeRunStat,
} from '../../../../types';
import {
  compilePrepWorkflowToFlow,
  exportPrepWorkflowDsl,
  parsePrepDsl,
} from '../../../../../shared/prep-dsl';
import { dataClient } from '../../../../features/data/api/data-client';
import { GlassDropdownMenu, GlassMenuItem } from '../../../GlassDropdownMenu';
import { useConfirmDialog } from '../../../ConfirmDialog';
import { OUTPUT_TABLE_INPUT_CHOICES_LIMIT, makeLocalId } from '../../shared';
import { incompleteConfigMessageKey } from '../../workflow-config-guards';
import { getNextWorkflowNodePosition } from './canvas-utils';
import { OPERATOR_CATALOG, getOperatorCatalog, isWorkflowOperatorType } from './operator-catalog';
import { getOperatorDefinition } from '../../../../../shared/operators';
import { WorkflowCanvas } from './WorkflowCanvas';
import { WorkflowInspector } from './WorkflowInspector';
import { WorkflowDslDialog, WorkflowOperatorPalette } from './WorkflowUi';
import { formatPrepDiagnosticForUi } from './workflow-diagnostics';
import {
  connectWorkflowNodes as connectWorkflowGraphNodes,
  reconnectWorkflowEdge as reconnectWorkflowGraphEdge,
  removeWorkflowEdge as removeWorkflowGraphEdge,
  removeWorkflowNode,
  synchronizeRightInputConfigs,
} from './workflow-graph-operations';
import {
  getWorkflowSaveInputSignature,
  toWorkflowSaveInput,
  type WorkflowInspectorTab,
} from './workflow-model';

export function TaskEditor({
  task,
  outputTables,
  actionId,
  runNodeStats,
  onBack,
  onRun,
  onWorkflowSaved,
}: {
  task: DataCleaningTask;
  outputTables: DataOutputTable[];
  actionId: string | null;
  runNodeStats?: WorkflowNodeRunStat[];
  onBack: () => void;
  onRun: (task: DataCleaningTask, payload?: DataRunTaskInput) => void | Promise<void>;
  onWorkflowSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { confirm, confirmDelete } = useConfirmDialog();
  const [workflow, setWorkflow] = useState<DataTaskWorkflow | null>(null);
  const [savedWorkflowSignature, setSavedWorkflowSignature] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeInspectorTab, setActiveInspectorTab] = useState<WorkflowInspectorTab>('config');
  const [saving, setSaving] = useState(false);
  const [renamingTask, setRenamingTask] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [configIssuesVisible, setConfigIssuesVisible] = useState(false);
  const [planErrorNodeIds, setPlanErrorNodeIds] = useState<Set<string>>(new Set());
  const [dslMode, setDslMode] = useState<'import' | 'export' | null>(null);
  const [dslText, setDslText] = useState('');
  const [dslError, setDslError] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState(task.name);
  const [isEditingTaskTitle, setIsEditingTaskTitle] = useState(false);
  const [workflowMenuOpen, setWorkflowMenuOpen] = useState(false);
  const [nodeDataRefreshVersion, setNodeDataRefreshVersion] = useState(0);
  const [inputTableChoices, setInputTableChoices] = useState<DataDataset[]>([]);
  const [inputTableChoicesLoading, setInputTableChoicesLoading] = useState(false);
  const [outputTableChoices, setOutputTableChoices] = useState<DataOutputTable[]>(outputTables);
  const taskTitleInputRef = useRef<HTMLInputElement | null>(null);
  const skipTaskTitleSaveRef = useRef(false);

  const loadWorkflow = useCallback(async () => {
    if (!dataClient.isAvailable()) return;
    setLocalError(null);
    try {
      const nextWorkflow = await dataClient.getTaskWorkflow(task.id);
      setWorkflow(nextWorkflow);
      setSavedWorkflowSignature(getWorkflowSaveInputSignature(nextWorkflow));
      setSelectedNodeId((current) => current ?? nextWorkflow.nodes[0]?.id ?? null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [task.id]);

  useEffect(() => {
    void loadWorkflow();
  }, [loadWorkflow]);

  useEffect(() => {
    if (!localError) return;
    const timer = window.setTimeout(() => setLocalError(null), 3000);
    return () => window.clearTimeout(timer);
  }, [localError]);

  useEffect(() => {
    setTaskTitle(task.name);
    setIsEditingTaskTitle(false);
  }, [task.id, task.name]);

  useEffect(() => {
    if (!isEditingTaskTitle) return;
    taskTitleInputRef.current?.focus();
    taskTitleInputRef.current?.select();
  }, [isEditingTaskTitle]);

  useEffect(() => {
    setOutputTableChoices(outputTables);
  }, [outputTables]);

  useEffect(() => {
    if (!dataClient.has('getDashboard')) return undefined;
    let cancelled = false;
    const loadInputTableChoices = async () => {
      setInputTableChoicesLoading(true);
      try {
        const dashboard = await dataClient.getDashboard({
          includeSummary: false,
          includeTasks: false,
          includeDatasets: true,
          includeOutputTables: false,
          datasetLimit: OUTPUT_TABLE_INPUT_CHOICES_LIMIT,
          datasetSourceKind: 'all',
        });
        if (!cancelled) {
          setInputTableChoices(dashboard.datasets);
        }
      } catch {
        if (!cancelled) {
          setInputTableChoices([]);
        }
      } finally {
        if (!cancelled) {
          setInputTableChoicesLoading(false);
        }
      }
    };
    const loadOutputTableChoices = async () => {
      try {
        const dashboard = await dataClient.getDashboard({
          includeSummary: false,
          includeTasks: false,
          includeDatasets: false,
          includeOutputTables: true,
          outputLimit: OUTPUT_TABLE_INPUT_CHOICES_LIMIT,
        });
        if (!cancelled) {
          setOutputTableChoices(dashboard.outputTables);
        }
      } catch {
        // The workflow editor can still run with the already-loaded choices.
      }
    };
    void loadInputTableChoices();
    void loadOutputTableChoices();
    return () => {
      cancelled = true;
    };
  }, []);

  const nodes = useMemo(() => workflow?.nodes ?? [], [workflow?.nodes]);
  const edges = useMemo(() => workflow?.edges ?? [], [workflow?.edges]);
  const workflowSaveInput = useMemo(
    () => (workflow ? toWorkflowSaveInput(workflow) : null),
    [workflow]
  );
  const workflowSignature = useMemo(
    () => (workflowSaveInput ? JSON.stringify(workflowSaveInput) : null),
    [workflowSaveInput]
  );
  const isWorkflowDirty =
    Boolean(workflowSignature) &&
    Boolean(savedWorkflowSignature) &&
    workflowSignature !== savedWorkflowSignature;
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? nodes[0] ?? null,
    [nodes, selectedNodeId]
  );
  const isBusy = saving || renamingTask || actionId === task.id;

  useEffect(() => {
    if (!isWorkflowDirty) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isWorkflowDirty]);

  const handleBack = useCallback(async () => {
    if (!isWorkflowDirty) {
      onBack();
      return;
    }
    const confirmed = await confirm({
      title: t('data.editor.unsavedChangesTitle'),
      message: t('data.editor.unsavedChangesMessage'),
      confirmLabel: t('data.editor.leaveWithoutSaving'),
      cancelLabel: t('common.cancel'),
    });
    if (confirmed) onBack();
  }, [confirm, isWorkflowDirty, onBack, t]);

  const saveTaskTitle = useCallback(async () => {
    if (skipTaskTitleSaveRef.current) {
      skipTaskTitleSaveRef.current = false;
      return;
    }
    if (!isEditingTaskTitle || renamingTask) return;
    const nextTitle = taskTitle.trim();
    if (!nextTitle) {
      setLocalError(t('data.editor.taskNameRequired'));
      setTaskTitle(task.name);
      setIsEditingTaskTitle(false);
      return;
    }
    if (nextTitle === task.name) {
      setTaskTitle(task.name);
      setIsEditingTaskTitle(false);
      return;
    }
    if (!dataClient.has('updateTask')) {
      setIsEditingTaskTitle(false);
      return;
    }
    setRenamingTask(true);
    setLocalError(null);
    try {
      const updated = await dataClient.updateTask({ id: task.id, name: nextTitle });
      setTaskTitle(updated.name);
      setIsEditingTaskTitle(false);
      await onWorkflowSaved();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenamingTask(false);
    }
  }, [isEditingTaskTitle, onWorkflowSaved, renamingTask, t, task.id, task.name, taskTitle]);

  const updateSelectedNode = useCallback(
    (updater: (node: DataWorkflowNode) => DataWorkflowNode) => {
      if (!selectedNodeId) return;
      setWorkflow((current) => {
        if (!current) return current;
        return synchronizeRightInputConfigs({
          ...current,
          nodes: current.nodes.map((node) => (node.id === selectedNodeId ? updater(node) : node)),
        });
      });
    },
    [selectedNodeId]
  );

  const addOperator = useCallback(
    (type: DataWorkflowOperatorType, position?: { x: number; y: number }) => {
      const catalog = getOperatorCatalog(type);
      const createdAt = Date.now();
      const id = makeLocalId('node');
      setSelectedNodeId(id);
      setWorkflow((current) => {
        if (!current) return current;
        const fallbackPosition = getNextWorkflowNodePosition(current.nodes.length);
        const x = Math.max(0, Math.round(position?.x ?? fallbackPosition.x));
        const y = Math.max(0, Math.round(position?.y ?? fallbackPosition.y));
        const nextNode: DataWorkflowNode = {
          id,
          taskId: task.id,
          type,
          label: t(catalog.labelKey),
          x,
          y,
          config: getOperatorDefinition(type)?.createDefaultConfig() ?? {},
          createdAt,
          updatedAt: createdAt,
        };
        return {
          ...current,
          nodes: [...current.nodes, nextNode],
        };
      });
    },
    [t, task.id]
  );

  const moveNode = useCallback((nodeId: string, x: number, y: number) => {
    setWorkflow((current) => {
      if (!current) return current;
      return {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                x,
                y,
                updatedAt: Date.now(),
              }
            : node
        ),
      };
    });
  }, []);

  const connectNodes = useCallback(
    (
      sourceNodeId: string,
      targetNodeId: string,
      sourceHandle = 'output',
      targetHandle = 'input'
    ) => {
      if (sourceNodeId === targetNodeId) return;
      setWorkflow((current) => {
        if (!current) return current;
        return connectWorkflowGraphNodes(
          current,
          { sourceNodeId, targetNodeId, sourceHandle, targetHandle },
          {
            id: makeLocalId('edge'),
            taskId: task.id,
            sourceNodeId,
            targetNodeId,
            sourceHandle,
            targetHandle,
            createdAt: Date.now(),
          }
        );
      });
    },
    [task.id]
  );
  const reconnectWorkflowEdge = useCallback((edgeId: string, connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    setWorkflow((current) => {
      if (!current) return current;
      return reconnectWorkflowGraphEdge(current, edgeId, {
        sourceNodeId: connection.source,
        targetNodeId: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      });
    });
  }, []);
  const removeWorkflowEdge = useCallback((edgeId: string) => {
    setWorkflow((current) => {
      if (!current) return current;
      return removeWorkflowGraphEdge(current, edgeId);
    });
  }, []);

  const duplicateSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    const now = Date.now();
    const id = makeLocalId('node');
    const nextNode: DataWorkflowNode = {
      ...selectedNode,
      id,
      taskId: task.id,
      label: `${selectedNode.label} ${t('data.workflow.copySuffix')}`,
      x: selectedNode.x + 48,
      y: selectedNode.y + 48,
      config: cloneWorkflowNodeConfig(selectedNode.config),
      createdAt: now,
      updatedAt: now,
    };
    setWorkflow((current) =>
      current
        ? {
            ...current,
            nodes: [...current.nodes, nextNode],
          }
        : current
    );
    setSelectedNodeId(id);
    setActiveInspectorTab('config');
  }, [selectedNode, t, task.id]);

  const toggleSelectedNodeDisabled = useCallback(() => {
    if (!selectedNode) return;
    const nextDisabled = selectedNode.config.disabled !== true;
    setWorkflow((current) => {
      if (!current) return current;
      return {
        ...current,
        nodes: current.nodes.map((node) => {
          if (node.id !== selectedNode.id) return node;
          const nextConfig = { ...node.config };
          if (nextDisabled) {
            nextConfig.disabled = true;
          } else {
            delete nextConfig.disabled;
          }
          return {
            ...node,
            config: nextConfig,
            updatedAt: Date.now(),
          };
        }),
      };
    });
  }, [selectedNode]);

  const deleteSelectedNode = useCallback(async () => {
    if (!selectedNode) return;
    const confirmed = await confirmDelete({
      message: t('data.workflow.deleteOperatorConfirm', { name: selectedNode.label }),
    });
    if (!confirmed) return;
    setWorkflow((current) => (current ? removeWorkflowNode(current, selectedNode.id) : current));
    setSelectedNodeId((current) => (current === selectedNode.id ? null : current));
  }, [confirmDelete, selectedNode, t]);

  /**
   * Runs the shared plan validation (graph + propagated schemas) and marks the
   * offending nodes red on the canvas. Returns the first error message, or
   * null when the plan is clean or validation itself could not run.
   */
  const flagPlanDiagnostics = useCallback(
    async (saveInput: DataWorkflowSaveInput): Promise<string | null> => {
      if (!dataClient.has('validateTaskWorkflowPlan')) return null;
      try {
        const diagnostics = await dataClient.validateTaskWorkflowPlan(task.id, saveInput);
        const errorNodeIds = new Set(
          diagnostics
            .filter((item) => item.severity === 'error' && item.nodeId)
            .map((item) => item.nodeId as string)
        );
        // Diagnostics carry scoped ids (<taskId>__<id>); match canvas ids both ways.
        const canvasIds = new Set<string>();
        for (const node of nodes) {
          for (const id of errorNodeIds) {
            if (node.id === id || node.id.endsWith(`__${id}`) || id.endsWith(`__${node.id}`)) {
              canvasIds.add(node.id);
              break;
            }
          }
        }
        setPlanErrorNodeIds(canvasIds);
        const firstError = diagnostics.find((item) => item.severity === 'error');
        if (firstError && canvasIds.size > 0) {
          setSelectedNodeId([...canvasIds][0]);
        }
        return firstError?.message ?? null;
      } catch {
        return null;
      }
    },
    [nodes, task.id]
  );

  const saveWorkflow = useCallback(async (): Promise<DataTaskWorkflow | null> => {
    if (!workflow || !dataClient.isAvailable()) return null;
    const submittedSignature = getWorkflowSaveInputSignature(workflow);
    setSaving(true);
    setLocalError(null);
    try {
      const saved = await dataClient.saveTaskWorkflow(task.id, toWorkflowSaveInput(workflow));
      const savedSignature = getWorkflowSaveInputSignature(saved);
      setWorkflow((current) =>
        current && getWorkflowSaveInputSignature(current) !== submittedSignature ? current : saved
      );
      setSavedWorkflowSignature(savedSignature);
      setSelectedNodeId((current) => {
        if (!current) return saved.nodes[0]?.id ?? null;
        return (
          saved.nodes.find((node) => node.id === current || node.id.endsWith(`__${current}`))?.id ??
          current
        );
      });
      await onWorkflowSaved();
      return saved;
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
      void flagPlanDiagnostics(toWorkflowSaveInput(workflow));
      return null;
    } finally {
      setSaving(false);
    }
  }, [onWorkflowSaved, task.id, workflow, flagPlanDiagnostics]);

  const [persistedNodeStats, setPersistedNodeStats] = useState<WorkflowNodeRunStat[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (dataClient.has('getTaskNodeStats')) {
      void dataClient
        .getTaskNodeStats(task.id)
        .then((stats) => {
          if (!cancelled) setPersistedNodeStats(stats);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  const runStatsByNode = useMemo(() => {
    const map = new Map<string, WorkflowNodeRunStat>();
    // In-session run stats take precedence over the persisted previous run.
    for (const stat of persistedNodeStats) map.set(stat.nodeId, stat);
    for (const stat of runNodeStats ?? []) map.set(stat.nodeId, stat);
    return map;
  }, [runNodeStats, persistedNodeStats]);

  const invalidNodeIds = useMemo(() => {
    const ids = new Set(planErrorNodeIds);
    if (!configIssuesVisible) return ids;
    nodes.filter((node) => incompleteConfigMessageKey(node)).forEach((n) => ids.add(n.id));
    return ids;
  }, [nodes, configIssuesVisible, planErrorNodeIds]);

  const flagIncompleteNodes = useCallback((nodeList: DataWorkflowNode[]): string | null => {
    const firstInvalid = nodeList.find((node) => incompleteConfigMessageKey(node));
    setConfigIssuesVisible(Boolean(firstInvalid));
    if (firstInvalid) setSelectedNodeId(firstInvalid.id);
    return firstInvalid ? incompleteConfigMessageKey(firstInvalid) : null;
  }, []);

  const validateWorkflowBeforeRun = useCallback(() => {
    if (!workflowSaveInput) return false;
    const incompleteMessageKey = flagIncompleteNodes(nodes);
    if (incompleteMessageKey) {
      setLocalError(t(incompleteMessageKey));
      return false;
    }
    setLocalError(null);
    return true;
  }, [nodes, t, workflowSaveInput, flagIncompleteNodes]);

  const handleTrialRun = useCallback(async () => {
    if (!workflowSaveInput || !validateWorkflowBeforeRun()) return;
    const planError = await flagPlanDiagnostics(workflowSaveInput);
    if (planError) {
      setLocalError(planError);
      return;
    }
    await onRun(task, {
      workflow: workflowSaveInput,
      outputMode: 'temporary',
    });
    setNodeDataRefreshVersion((current) => current + 1);
  }, [onRun, task, validateWorkflowBeforeRun, workflowSaveInput, flagPlanDiagnostics]);

  const handleSaveAndRun = useCallback(async () => {
    if (!validateWorkflowBeforeRun()) return;
    const saved = await saveWorkflow();
    if (!saved) return;
    await onRun(task, {
      workflow: toWorkflowSaveInput(saved),
      outputMode: 'persisted',
    });
    setNodeDataRefreshVersion((current) => current + 1);
  }, [onRun, saveWorkflow, task, validateWorkflowBeforeRun]);

  const applyAndRunOperatorDsl = useCallback(
    async (nodeId: string, config: Record<string, unknown>) => {
      if (!workflow) return;
      const now = Date.now();
      const nextWorkflow: DataTaskWorkflow = {
        ...workflow,
        nodes: workflow.nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                config,
                updatedAt: now,
              }
            : node
        ),
      };
      const incompleteMessageKey = flagIncompleteNodes(nextWorkflow.nodes);
      if (incompleteMessageKey) {
        setLocalError(t(incompleteMessageKey));
        return;
      }
      setLocalError(null);
      setWorkflow(nextWorkflow);
      setSelectedNodeId(nodeId);
      const planError = await flagPlanDiagnostics(toWorkflowSaveInput(nextWorkflow));
      if (planError) {
        setLocalError(planError);
        return;
      }
      await onRun(task, {
        workflow: toWorkflowSaveInput(nextWorkflow),
        outputMode: 'temporary',
      });
      setNodeDataRefreshVersion((current) => current + 1);
    },
    [onRun, t, task, workflow, flagIncompleteNodes, flagPlanDiagnostics]
  );

  const openImportDsl = useCallback(() => {
    setLocalError(null);
    setDslError(null);
    setDslText('');
    setDslMode('import');
  }, []);

  const openExportDsl = useCallback(() => {
    if (!workflow) return;
    const incompleteMessageKey = flagIncompleteNodes(workflow.nodes);
    if (incompleteMessageKey) {
      setLocalError(t(incompleteMessageKey));
      return;
    }
    setLocalError(null);
    setDslError(null);
    try {
      setDslText(exportPrepWorkflowDsl(workflow.nodes, workflow.edges));
      setDslMode('export');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [t, workflow, flagIncompleteNodes]);

  const closeDslDialog = useCallback(() => {
    setDslMode(null);
    setDslText('');
    setDslError(null);
  }, []);

  const copyDslText = useCallback(() => {
    if (!dslText) return;
    void navigator.clipboard?.writeText(dslText);
  }, [dslText]);

  const updateDslText = useCallback((value: string) => {
    setDslText(value);
    setDslError(null);
  }, []);

  const applyDslImport = useCallback(() => {
    if (!workflow) return;
    setDslError(null);
    const parsed = parsePrepDsl(dslText);
    const diagnostics = [...parsed.diagnostics];
    if (parsed.ast) {
      const compiled = compilePrepWorkflowToFlow(parsed.ast);
      diagnostics.push(...compiled.diagnostics);
      const errors = diagnostics.filter((item) => item.severity === 'error');
      if (errors.length > 0) {
        setDslError(errors.map((item) => formatPrepDiagnosticForUi(item, t)).join('\n'));
        return;
      }
      const now = Date.now();
      const nextNodes: DataWorkflowNode[] = compiled.nodes
        .filter((node) => isWorkflowOperatorType(node.type))
        .map((node) => ({
          id: node.id,
          taskId: task.id,
          type: node.type as DataWorkflowOperatorType,
          label: t(getOperatorCatalog(node.type as DataWorkflowOperatorType).labelKey),
          x: node.x,
          y: node.y,
          config: node.config ?? {},
          createdAt: now,
          updatedAt: now,
        }));
      const nextEdges: DataWorkflowEdge[] = compiled.edges.map((edge) => ({
        id: edge.id,
        taskId: task.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        sourceHandle: edge.sourceHandle ?? 'output',
        targetHandle: edge.targetHandle ?? 'input',
        createdAt: now,
      }));
      setWorkflow({
        ...workflow,
        nodes: nextNodes,
        edges: nextEdges,
      });
      setSelectedNodeId(nextNodes[0]?.id ?? null);
      closeDslDialog();
      setLocalError(null);
      return;
    }
    setDslError(
      diagnostics.map((item) => formatPrepDiagnosticForUi(item, t)).join('\n') ||
        t('data.workflow.dslInvalid')
    );
  }, [closeDslDialog, dslText, t, task.id, workflow]);

  return (
    <section className="relative flex flex-1 min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <button
            onClick={() => void handleBack()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('data.editor.back')}
          </button>
          <div className="flex min-w-0 items-center gap-2">
            {isEditingTaskTitle ? (
              <span className="flex h-8 min-w-0 max-w-[22rem] items-center rounded-lg border border-accent/40 bg-background/48 px-2.5 shadow-soft ring-2 ring-accent/15">
                <input
                  ref={taskTitleInputRef}
                  value={taskTitle}
                  maxLength={80}
                  onChange={(event) => setTaskTitle(event.target.value)}
                  onBlur={() => void saveTaskTitle()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }
                    if (event.key === 'Escape') {
                      skipTaskTitleSaveRef.current = true;
                      setTaskTitle(task.name);
                      setIsEditingTaskTitle(false);
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-text-secondary outline-none"
                />
              </span>
            ) : (
              <h1 className="truncate text-[15px] font-medium text-text-secondary">{taskTitle}</h1>
            )}
            {!isEditingTaskTitle && (
              <button
                onClick={() => setIsEditingTaskTitle(true)}
                disabled={isBusy}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
                title={t('common.edit')}
              >
                <PencilLine className="h-3.5 w-3.5" />
                <span className="sr-only">{t('common.edit')}</span>
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void saveWorkflow()}
            disabled={isBusy || !workflow}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? t('common.saving') : t('common.save')}
          </button>
          <button
            onClick={() => void handleTrialRun()}
            disabled={isBusy || !workflow}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Play className="h-3.5 w-3.5" />
            {t('data.editor.trialRun')}
          </button>
          <button
            onClick={() => void handleSaveAndRun()}
            disabled={isBusy || !workflow}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Play className="h-3.5 w-3.5" />
            {t('data.editor.saveAndRun')}
          </button>
          <GlassDropdownMenu
            open={workflowMenuOpen}
            onOpenChange={setWorkflowMenuOpen}
            align="end"
            contentClassName="w-40"
            trigger={
              <button
                type="button"
                disabled={isBusy || !workflow}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
                title={t('data.actions.more')}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          >
            <GlassMenuItem icon={<Upload className="h-3.5 w-3.5" />} onSelect={openImportDsl}>
              {t('data.workflow.importDsl')}
            </GlassMenuItem>
            <GlassMenuItem icon={<Workflow className="h-3.5 w-3.5" />} onSelect={openExportDsl}>
              {t('data.workflow.exportDsl')}
            </GlassMenuItem>
          </GlassDropdownMenu>
        </div>
      </div>

      {!workflow ? (
        <div className="flex flex-1 min-h-0 items-center justify-center rounded-xl border border-border-muted bg-background/42 text-xs text-text-muted shadow-card">
          {t('common.loading')}
        </div>
      ) : (
        <div className="grid flex-1 min-h-0 grid-cols-[13rem_minmax(0,1fr)] items-stretch gap-3">
          <WorkflowOperatorPalette operators={OPERATOR_CATALOG} />
          <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_400px] gap-3">
            <WorkflowCanvas
              nodes={nodes}
              edges={edges}
              invalidNodeIds={invalidNodeIds}
              runStatsByNode={runStatsByNode}
              selectedNodeId={selectedNode?.id ?? null}
              onSelectNode={setSelectedNodeId}
              onDuplicateNode={duplicateSelectedNode}
              onToggleNodeDisabled={toggleSelectedNodeDisabled}
              onDeleteNode={deleteSelectedNode}
              onAddNode={addOperator}
              onMoveNode={moveNode}
              onConnectNodes={connectNodes}
              onReconnectEdge={reconnectWorkflowEdge}
              onRemoveEdge={removeWorkflowEdge}
            />
            <WorkflowInspector
              node={selectedNode}
              workflowNodes={nodes}
              workflowEdges={edges}
              inputTables={inputTableChoices}
              isInputTablesLoading={inputTableChoicesLoading}
              outputTables={outputTableChoices}
              activeTab={activeInspectorTab}
              onActiveTabChange={setActiveInspectorTab}
              onNodeChange={updateSelectedNode}
              onApplyOperatorDsl={applyAndRunOperatorDsl}
              isRunningOperatorDsl={actionId === task.id}
              nodeDataRefreshVersion={nodeDataRefreshVersion}
            />
          </div>
        </div>
      )}
      {dslMode && (
        <WorkflowDslDialog
          mode={dslMode}
          value={dslText}
          error={dslError}
          onChange={updateDslText}
          onApply={applyDslImport}
          onCopy={copyDslText}
          onClose={closeDslDialog}
        />
      )}
      {localError && (
        <div
          role="alert"
          onClick={() => setLocalError(null)}
          className="absolute bottom-4 left-1/2 z-40 flex max-w-[min(90%,32rem)] -translate-x-1/2 cursor-pointer items-start gap-2 whitespace-pre-line rounded-lg border border-error/30 bg-[var(--glass-card-strong)] px-3.5 py-2.5 text-[13px] text-error shadow-card backdrop-blur-xl"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{localError}</span>
        </div>
      )}
    </section>
  );
}

function cloneWorkflowNodeConfig(config: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(config);
  } catch {
    return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  }
}
