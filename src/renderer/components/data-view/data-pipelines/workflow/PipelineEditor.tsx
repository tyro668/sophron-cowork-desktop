import {
  detectFieldRenames,
  propagateFieldRenames,
} from '../../../../../shared/workflow-plan/field-rename';
import { useDataWorkspaceActivation } from '../../../../features/data/hooks/use-data-workspace-activation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Connection } from '@xyflow/react';
import {
  AlertCircle,
  ArrowLeft,
  FileText,
  MoreHorizontal,
  PencilLine,
  Play,
  Save,
  Sparkles,
  Upload,
  Waypoints,
  Workflow,
  X,
  Undo2,
  Redo2,
  LoaderCircle,
} from 'lucide-react';
import type {
  DataPipeline,
  DataRawTable,
  DataRawTablePreview,
  DataResultTable,
  DataRunPipelineInput,
  DataPipelineWorkflow,
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
import { dataFieldTypeFromDuckDbType } from '../../../../../shared/data-field-types';
import { dataClient } from '../../../../features/data/api/data-client';
import { WorkflowDataContext } from '../../../../hooks/workflow-data-context';
import { GlassDropdownMenu, GlassMenuItem } from '../../../GlassDropdownMenu';
import { useConfirmDialog } from '../../../ConfirmDialog';
import { RESULT_TABLE_INPUT_CHOICES_LIMIT, makeLocalId } from '../../shared';
import { incompleteConfigMessageKey } from '../../workflow-config-guards';
import { getNextWorkflowNodePosition } from './canvas-utils';
import { getOperatorCatalog, isWorkflowOperatorType } from './operator-catalog';
import { buildWorkflowStarterGraph } from './workflow-starter';
import { stringValue } from './workflow-summary';
import { WorkflowAiGenerateDialog } from './WorkflowAiGenerateDialog';
import { WorkflowExplainDialog } from './WorkflowExplainDialog';
import { getOperatorDefinition } from '../../../../../shared/operators';
import { WorkflowCanvas } from './WorkflowCanvas';
import { WorkflowInspector } from './WorkflowInspector';
import { WorkflowDslDialog, WorkflowNodeDataPreview, WorkflowOperatorPalette } from './WorkflowUi';
import { Button } from '../../../ui/button';
import { Dialog } from '../../../ui/dialog';
import { InlineBanner } from '../../../ui/inline-banner';
import { formatPrepDiagnosticForUi } from './workflow-diagnostics';
import {
  connectWorkflowNodes as connectWorkflowGraphNodes,
  reconnectWorkflowEdge as reconnectWorkflowGraphEdge,
  removeWorkflowEdge as removeWorkflowGraphEdge,
  removeWorkflowNode,
  synchronizeRightInputConfigs,
} from './workflow-graph-operations';
import { layoutWorkflowNodes } from './workflow-layout';
import {
  getWorkflowSaveInputSignature,
  getWorkflowUpstreamSignature,
  toWorkflowSaveInput,
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
  type WorkflowInspectorTab,
} from './workflow-model';

function hasOverlappingNodes(nodes: Array<{ x: number; y: number }>): boolean {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (
        Math.abs(nodes[i].x - nodes[j].x) < WORKFLOW_NODE_WIDTH + 12 &&
        Math.abs(nodes[i].y - nodes[j].y) < WORKFLOW_NODE_HEIGHT + 8
      ) {
        return true;
      }
    }
  }
  return false;
}

export function PipelineEditor({
  pipeline,
  resultTables,
  actionId,
  runNodeStats,
  lastRunFailure,
  onBack,
  onRun,
  onWorkflowSaved,
  autoEditTitle,
}: {
  pipeline: DataPipeline;
  resultTables: DataResultTable[];
  actionId: string | null;
  runNodeStats?: WorkflowNodeRunStat[];
  lastRunFailure?: { message: string; at: number; temporary?: boolean } | null;
  onBack: () => void;
  onRun: (pipeline: DataPipeline, payload?: DataRunPipelineInput) => void | Promise<void>;
  onWorkflowSaved: () => void | Promise<void>;
  /** Opened from a create flow: start with the title in edit mode. */
  autoEditTitle?: boolean;
}) {
  const { t } = useTranslation();
  const { confirm, confirmDelete } = useConfirmDialog();
  const [workflow, setWorkflow] = useState<DataPipelineWorkflow | null>(null);
  const [savedWorkflowSignature, setSavedWorkflowSignature] = useState<string | null>(null);
  // The workflow as loaded — fallback basis for staleness on signature-less
  // resolutions (legacy caches, bound rawTable/output tables). Cache-backed
  // previews carry their own workflow_signature so saving must NOT update
  // this: stale means "config differs from what generated the preview".
  const [loadedWorkflowInput, setLoadedWorkflowInput] = useState<DataWorkflowSaveInput | null>(
    null
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [activeInspectorTab, setActiveInspectorTab] = useState<WorkflowInspectorTab>('config');
  const [saving, setSaving] = useState(false);
  const [renamingPipeline, setRenamingPipeline] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [configIssuesVisible, setConfigIssuesVisible] = useState(false);
  const [planErrorNodeIds, setPlanErrorNodeIds] = useState<Set<string>>(new Set());
  const [dslMode, setDslMode] = useState<'import' | 'export' | null>(null);
  const [dslText, setDslText] = useState('');
  const [dslError, setDslError] = useState<string | null>(null);
  const [pipelineTitle, setPipelineTitle] = useState(pipeline.name);
  const [isEditingPipelineTitle, setIsEditingPipelineTitle] = useState(
    () => autoEditTitle === true
  );
  const [workflowMenuOpen, setWorkflowMenuOpen] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [explainDialogOpen, setExplainDialogOpen] = useState(false);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const [nodeDataRefreshVersion, setNodeDataRefreshVersion] = useState(0);
  const [rawTableChoices, setRawTableChoices] = useState<DataRawTable[]>([]);
  const [rawTableChoicesLoading, setRawTableChoicesLoading] = useState(false);
  const [resultTableChoices, setResultTableChoices] = useState<DataResultTable[]>(resultTables);
  const pipelineTitleInputRef = useRef<HTMLInputElement | null>(null);
  const canvasViewportSizeRef = useRef({ width: 0, height: 0 });
  const skipPipelineTitleSaveRef = useRef(false);
  // A create flow mounts the editor already in title-edit mode; the reset
  // effect below must not cancel that on the first run.
  const skipInitialTitleResetRef = useRef(autoEditTitle === true);

  // --- Undo / redo history (design 10, B06) -------------------------------
  // Snapshot-based: every workflow change pushes the previous state; rapid
  // successive changes (e.g. drag moves) within 400ms collapse into one step.
  const historyRef = useRef<{ past: DataPipelineWorkflow[]; future: DataPipelineWorkflow[] }>({
    past: [],
    future: [],
  });
  const lastWorkflowRef = useRef<DataPipelineWorkflow | null>(null);
  const skipHistoryRef = useRef(true);
  const burstOpenRef = useRef(false);
  const burstTimerRef = useRef<number | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  useEffect(() => {
    const previous = lastWorkflowRef.current;
    lastWorkflowRef.current = workflow;
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      return;
    }
    if (!previous || !workflow || previous === workflow) return;
    if (!burstOpenRef.current) {
      historyRef.current.past = [...historyRef.current.past.slice(-49), previous];
      historyRef.current.future = [];
      burstOpenRef.current = true;
      setHistoryVersion((v) => v + 1);
    }
    if (burstTimerRef.current) window.clearTimeout(burstTimerRef.current);
    burstTimerRef.current = window.setTimeout(() => {
      burstOpenRef.current = false;
    }, 400);
  }, [workflow]);
  const resetHistory = useCallback(() => {
    historyRef.current = { past: [], future: [] };
    skipHistoryRef.current = true;
    burstOpenRef.current = false;
    setHistoryVersion((v) => v + 1);
  }, []);
  const canUndo = historyVersion >= 0 && historyRef.current.past.length > 0;
  const canRedo = historyVersion >= 0 && historyRef.current.future.length > 0;
  const undo = useCallback(() => {
    const { past, future } = historyRef.current;
    const previous = past[past.length - 1];
    const current = lastWorkflowRef.current;
    if (!previous || !current) return;
    historyRef.current = { past: past.slice(0, -1), future: [current, ...future] };
    skipHistoryRef.current = true;
    burstOpenRef.current = false;
    setWorkflow(previous);
    setHistoryVersion((v) => v + 1);
  }, []);
  const redo = useCallback(() => {
    const { past, future } = historyRef.current;
    const next = future[0];
    const current = lastWorkflowRef.current;
    if (!next || !current) return;
    historyRef.current = { past: [...past, current], future: future.slice(1) };
    skipHistoryRef.current = true;
    burstOpenRef.current = false;
    setWorkflow(next);
    setHistoryVersion((v) => v + 1);
  }, []);

  const loadWorkflow = useCallback(async () => {
    if (!dataClient.isAvailable()) return;
    setLocalError(null);
    try {
      const fetchedWorkflow = await dataClient.getPipelineWorkflow(pipeline.id);
      // Layouts saved for the old 116px node width can overlap at 148px; re-layout
      // once on open (treated as the baseline so it does not mark the editor dirty).
      const nextWorkflow = hasOverlappingNodes(fetchedWorkflow.nodes)
        ? {
            ...fetchedWorkflow,
            nodes: layoutWorkflowNodes(
              fetchedWorkflow.nodes,
              fetchedWorkflow.edges,
              canvasViewportSizeRef.current.width || Number.POSITIVE_INFINITY
            ),
          }
        : fetchedWorkflow;
      resetHistory();
      setWorkflow(nextWorkflow);
      setSavedWorkflowSignature(getWorkflowSaveInputSignature(nextWorkflow));
      setLoadedWorkflowInput(toWorkflowSaveInput(nextWorkflow));
      setSelectedNodeIds((current) =>
        current.length > 0 ? current : nextWorkflow.nodes[0] ? [nextWorkflow.nodes[0].id] : []
      );
      setSelectedNodeId((current) => current ?? nextWorkflow.nodes[0]?.id ?? null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [pipeline.id, resetHistory]);

  useEffect(() => {
    void loadWorkflow();
  }, [loadWorkflow]);

  useEffect(() => {
    if (skipInitialTitleResetRef.current) {
      skipInitialTitleResetRef.current = false;
      return;
    }
    setPipelineTitle(pipeline.name);
    setIsEditingPipelineTitle(false);
  }, [pipeline.id, pipeline.name]);

  useEffect(() => {
    if (!isEditingPipelineTitle) return;
    pipelineTitleInputRef.current?.focus();
    pipelineTitleInputRef.current?.select();
  }, [isEditingPipelineTitle]);

  useEffect(() => {
    setResultTableChoices(resultTables);
  }, [resultTables]);

  const loadResultTableChoices = useCallback(async () => {
    try {
      const dashboard = await dataClient.getDashboard({
        includeSummary: false,
        includePipelines: false,
        includeRawTables: false,
        includeResultTables: true,
        outputLimit: RESULT_TABLE_INPUT_CHOICES_LIMIT,
      });
      setResultTableChoices(dashboard.resultTables);
    } catch {
      // The workflow editor can still run with the already-loaded choices.
    }
  }, []);

  useEffect(() => {
    if (!dataClient.has('getDashboard')) return undefined;
    let cancelled = false;
    const loadRawTableChoices = async () => {
      setRawTableChoicesLoading(true);
      try {
        const dashboard = await dataClient.getDashboard({
          includeSummary: false,
          includePipelines: false,
          includeRawTables: true,
          includeResultTables: false,
          rawTableLimit: RESULT_TABLE_INPUT_CHOICES_LIMIT,
          rawTableSourceKind: 'all',
        });
        if (!cancelled) {
          setRawTableChoices(dashboard.rawTables);
        }
      } catch {
        if (!cancelled) {
          setRawTableChoices([]);
        }
      } finally {
        if (!cancelled) {
          setRawTableChoicesLoading(false);
        }
      }
    };
    void loadRawTableChoices();
    void loadResultTableChoices();
    return () => {
      cancelled = true;
    };
  }, [loadResultTableChoices]);

  const nodes = useMemo(() => workflow?.nodes ?? [], [workflow?.nodes]);
  const edges = useMemo(() => workflow?.edges ?? [], [workflow?.edges]);
  // The input table AI generation binds to: first enabled input_source node
  // with a rawTable, else the pipeline-level source binding.
  const boundRawTable = useMemo(() => {
    for (const node of nodes) {
      if (node.type !== 'input_source' || node.config.disabled === true) continue;
      const rawTableId =
        stringValue(node.config.rawTableId) ||
        stringValue(node.config.rawTableId) ||
        stringValue(node.config.sourceRawTableId);
      if (!rawTableId) continue;
      const name =
        stringValue(node.config.rawTableName) ||
        stringValue(node.config.name) ||
        rawTableChoices.find((table) => table.id === rawTableId)?.name ||
        rawTableId;
      return { id: rawTableId, name };
    }
    if (pipeline.sourceRawTableId) {
      return {
        id: pipeline.sourceRawTableId,
        name:
          rawTableChoices.find((table) => table.id === pipeline.sourceRawTableId)?.name ??
          pipeline.sourceRawTableId,
      };
    }
    return null;
  }, [nodes, rawTableChoices, pipeline.sourceRawTableId]);
  const workflowSaveInput = useMemo(
    () => (workflow ? toWorkflowSaveInput(workflow) : null),
    [workflow]
  );
  const workflowSignature = useMemo(
    () => (workflowSaveInput ? JSON.stringify(workflowSaveInput) : null),
    [workflowSaveInput]
  );
  // Schema inference ignores node positions — keep the draft graph handed to
  // field/type lookups referentially stable while nodes are dragged.
  const workflowStructureSignature = useMemo(
    () =>
      JSON.stringify([
        nodes.map((node) => [node.id, node.type, node.config]),
        edges.map((edge) => [
          edge.id,
          edge.sourceNodeId,
          edge.targetNodeId,
          edge.sourceHandle,
          edge.targetHandle,
        ]),
      ]),
    [nodes, edges]
  );
  const draftWorkflowInput = useMemo(
    () => workflowSaveInput,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workflowStructureSignature]
  );
  const workflowDataContext = useMemo(
    () => ({ version: nodeDataRefreshVersion, workflow: draftWorkflowInput }),
    [draftWorkflowInput, nodeDataRefreshVersion]
  );
  const isWorkflowDirty =
    Boolean(workflowSignature) &&
    Boolean(savedWorkflowSignature) &&
    workflowSignature !== savedWorkflowSignature;
  useDataWorkspaceActivation(() => {
    if (isWorkflowDirty) return;
    void loadWorkflow();
    void loadResultTableChoices();
  });
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? nodes[0] ?? null,
    [nodes, selectedNodeId]
  );
  // The effective selection: the user's multi-select set, or the single
  // resolved node when nothing is multi-selected.
  const selectionTargets = useMemo(
    () =>
      selectedNodeIds.length > 0
        ? nodes.filter((node) => selectedNodeIds.includes(node.id))
        : selectedNode
          ? [selectedNode]
          : [],
    [nodes, selectedNodeIds, selectedNode]
  );
  const selectionIdSet = useMemo(
    () => new Set(selectionTargets.map((node) => node.id)),
    [selectionTargets]
  );
  const selectNodes = useCallback((ids: string[], primaryId?: string | null) => {
    setSelectedNodeIds(ids);
    setSelectedNodeId(primaryId ?? ids[ids.length - 1] ?? null);
  }, []);
  const selectSingleNode = useCallback((id: string | null) => {
    setSelectedNodeIds(id ? [id] : []);
    setSelectedNodeId(id);
  }, []);
  // Preview staleness compares the current upstream config against the
  // signature stamped on the cache row that produced the preview (persisted,
  // per-node, only updated for nodes that actually materialized). For
  // signature-less sources the loaded workflow stands in as the basis.
  const selectedUpstreamSignature = useMemo(
    () =>
      selectedNode && workflowSaveInput
        ? getWorkflowUpstreamSignature(workflowSaveInput, selectedNode.id)
        : null,
    [selectedNode, workflowSaveInput]
  );
  const isPreviewStale = useMemo(() => {
    if (!selectedNode || !selectedUpstreamSignature || !loadedWorkflowInput) return false;
    return (
      getWorkflowUpstreamSignature(loadedWorkflowInput, selectedNode.id) !==
      selectedUpstreamSignature
    );
  }, [selectedNode, selectedUpstreamSignature, loadedWorkflowInput]);
  const isBusy = saving || renamingPipeline || actionId === pipeline.id;
  const [runKind, setRunKind] = useState<'trial' | 'run' | null>(null);
  const runningKind = actionId === pipeline.id ? (runKind ?? 'trial') : null;

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

  const savePipelineTitle = useCallback(async () => {
    if (skipPipelineTitleSaveRef.current) {
      skipPipelineTitleSaveRef.current = false;
      return;
    }
    if (!isEditingPipelineTitle || renamingPipeline) return;
    const nextTitle = pipelineTitle.trim();
    if (!nextTitle) {
      setLocalError(t('data.editor.pipelineNameRequired'));
      setPipelineTitle(pipeline.name);
      setIsEditingPipelineTitle(false);
      return;
    }
    if (nextTitle === pipeline.name) {
      setPipelineTitle(pipeline.name);
      setIsEditingPipelineTitle(false);
      return;
    }
    if (!dataClient.has('updatePipeline')) {
      setIsEditingPipelineTitle(false);
      return;
    }
    setRenamingPipeline(true);
    setLocalError(null);
    try {
      const updated = await dataClient.updatePipeline({ id: pipeline.id, name: nextTitle });
      setPipelineTitle(updated.name);
      setIsEditingPipelineTitle(false);
      await onWorkflowSaved();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenamingPipeline(false);
    }
  }, [
    isEditingPipelineTitle,
    onWorkflowSaved,
    renamingPipeline,
    t,
    pipeline.id,
    pipeline.name,
    pipelineTitle,
  ]);

  const updateSelectedNode = useCallback(
    (updater: (node: DataWorkflowNode) => DataWorkflowNode) => {
      if (!selectedNodeId) return;
      setWorkflow((current) => {
        if (!current) return current;
        const before = current.nodes.find((node) => node.id === selectedNodeId);
        const updated = before ? updater(before) : undefined;
        const next = {
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === selectedNodeId && updated ? updated : node
          ),
        };
        // Renamed output fields follow into downstream configs.
        const renames =
          before && updated ? detectFieldRenames(before.type, before.config, updated.config) : [];
        return synchronizeRightInputConfigs(propagateFieldRenames(next, selectedNodeId, renames));
      });
    },
    [selectedNodeId]
  );

  const addOperator = useCallback(
    (type: DataWorkflowOperatorType, position?: { x: number; y: number }) => {
      const catalog = getOperatorCatalog(type);
      const createdAt = Date.now();
      const id = makeLocalId('node');
      selectSingleNode(id);
      setWorkflow((current) => {
        if (!current) return current;
        const fallbackPosition = getNextWorkflowNodePosition(current.nodes.length);
        const x = Math.max(0, Math.round(position?.x ?? fallbackPosition.x));
        const y = Math.max(0, Math.round(position?.y ?? fallbackPosition.y));
        const nextNode: DataWorkflowNode = {
          id,
          pipelineId: pipeline.id,
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
    [selectSingleNode, t, pipeline.id]
  );

  /**
   * Palette click/keyboard insertion: places the operator downstream of the
   * selected node. When the anchor has exactly one `output` edge, the new node
   * is spliced into it (anchor → new → old target); with no outgoing edge it
   * simply links anchor → new. Fan-out anchors (2+ output edges) get an
   * unconnected placement so no branch is chosen implicitly.
   */
  const addOperatorAfterSelected = useCallback(
    (type: DataWorkflowOperatorType) => {
      const catalog = getOperatorCatalog(type);
      const createdAt = Date.now();
      const id = makeLocalId('node');
      const ports = getOperatorDefinition(type)?.ports ?? { inputs: ['input'], outputs: [] };
      const primaryInput = ports.inputs[0];
      selectSingleNode(id);
      setActiveInspectorTab('config');
      setWorkflow((current) => {
        if (!current) return current;
        const anchor = current.nodes.find((node) => node.id === selectedNode?.id) ?? null;
        const anchorOutputs = anchor
          ? (getOperatorDefinition(anchor.type)?.ports.outputs ?? [])
          : [];
        const outEdges = anchor
          ? current.edges.filter(
              (edge) =>
                edge.sourceNodeId === anchor.id && (edge.sourceHandle ?? 'output') === 'output'
            )
          : [];
        const spliceEdge = outEdges.length === 1 ? outEdges[0] : undefined;
        const spliceTarget = spliceEdge
          ? current.nodes.find((node) => node.id === spliceEdge.targetNodeId)
          : undefined;
        const canLink = Boolean(anchor && primaryInput && anchorOutputs.includes('output'));
        // Splicing requires the new node to re-emit on `output`; a sink added
        // mid-chain would otherwise sever the existing downstream edge.
        const canSplice = Boolean(spliceEdge && ports.outputs.includes('output'));

        const fallback = getNextWorkflowNodePosition(current.nodes.length);
        const x = Math.max(
          0,
          Math.round(
            anchor && spliceTarget ? anchor.x + WORKFLOW_NODE_WIDTH + 52 : (anchor?.x ?? fallback.x)
          )
        );
        const y = Math.max(
          0,
          Math.round(
            anchor && spliceTarget
              ? anchor.y
              : anchor
                ? anchor.y + WORKFLOW_NODE_HEIGHT + 56
                : fallback.y
          )
        );
        const nextNode: DataWorkflowNode = {
          id,
          pipelineId: pipeline.id,
          type,
          label: t(catalog.labelKey),
          x,
          y,
          config: getOperatorDefinition(type)?.createDefaultConfig() ?? {},
          createdAt,
          updatedAt: createdAt,
        };
        // Splicing: push the downstream chain right so the new node gets its own slot.
        let baseNodes = current.nodes;
        if (spliceTarget && spliceTarget.x < x + WORKFLOW_NODE_WIDTH + 52) {
          const shift = x + WORKFLOW_NODE_WIDTH + 52 - spliceTarget.x;
          const downstream = new Set<string>([spliceTarget.id]);
          const queue = [spliceTarget.id];
          while (queue.length > 0) {
            const from = queue.shift()!;
            for (const edge of current.edges) {
              if (edge.sourceNodeId === from && !downstream.has(edge.targetNodeId)) {
                downstream.add(edge.targetNodeId);
                queue.push(edge.targetNodeId);
              }
            }
          }
          baseNodes = current.nodes.map((node) =>
            downstream.has(node.id) ? { ...node, x: node.x + shift } : node
          );
        }
        let next: DataPipelineWorkflow = { ...current, nodes: [...baseNodes, nextNode] };
        if (canLink && anchor && (canSplice || outEdges.length <= 1)) {
          const newEdge = (targetNodeId: string, targetHandle: string): DataWorkflowEdge => ({
            id: makeLocalId('edge'),
            pipelineId: pipeline.id,
            sourceNodeId: anchor.id,
            targetNodeId,
            sourceHandle: 'output',
            targetHandle,
            createdAt,
          });
          if (spliceEdge && canSplice) {
            next = removeWorkflowGraphEdge(next, spliceEdge.id);
            next = connectWorkflowGraphNodes(
              next,
              {
                sourceNodeId: anchor.id,
                targetNodeId: id,
                sourceHandle: 'output',
                targetHandle: primaryInput!,
              },
              newEdge(id, primaryInput!)
            );
            next = connectWorkflowGraphNodes(
              next,
              {
                sourceNodeId: id,
                targetNodeId: spliceEdge.targetNodeId,
                sourceHandle: 'output',
                targetHandle: spliceEdge.targetHandle ?? 'input',
              },
              {
                ...newEdge(spliceEdge.targetNodeId, spliceEdge.targetHandle ?? 'input'),
                sourceNodeId: id,
              }
            );
          } else {
            next = connectWorkflowGraphNodes(
              next,
              {
                sourceNodeId: anchor.id,
                targetNodeId: id,
                sourceHandle: 'output',
                targetHandle: primaryInput!,
              },
              newEdge(id, primaryInput!)
            );
          }
        }
        return next;
      });
    },
    [selectedNode, selectSingleNode, t, pipeline.id]
  );

  // Empty-canvas starter: input → filter → output as an unsaved draft so the
  // user reviews/adjusts before persisting.
  const applyStarterTemplate = useCallback(() => {
    setWorkflow((current) => {
      if (!current || current.nodes.length > 0) return current;
      const graph = buildWorkflowStarterGraph({
        pipelineId: pipeline.id,
        sourceRawTableId: boundRawTable?.id ?? null,
        sourceName: boundRawTable?.name ?? null,
        resultTableName: t('data.workflow.starterOutputName', { name: pipeline.name }),
        labels: {
          input_source: t(getOperatorCatalog('input_source').labelKey),
          filter: t(getOperatorCatalog('filter').labelKey),
          output: t(getOperatorCatalog('output').labelKey),
        },
      });
      selectSingleNode(graph.nodes[1]?.id ?? null);
      setActiveInspectorTab('config');
      return { ...current, nodes: graph.nodes, edges: graph.edges };
    });
  }, [boundRawTable, selectSingleNode, t, pipeline.id, pipeline.name]);

  /**
   * Auto-layout: relayers the whole canvas (wrapping rows to the pane width so
   * the flow reads at 100% zoom), then lets RF refit the viewport — fitView's
   * maxZoom cap keeps 100% whenever the wrapped layout already fits.
   */
  const tidyCanvas = useCallback(() => {
    setWorkflow((current) =>
      current
        ? {
            ...current,
            nodes: layoutWorkflowNodes(
              current.nodes,
              current.edges,
              canvasViewportSizeRef.current.width || Number.POSITIVE_INFINITY
            ),
          }
        : current
    );
    setLayoutEpoch((current) => current + 1);
  }, []);

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
            pipelineId: pipeline.id,
            sourceNodeId,
            targetNodeId,
            sourceHandle,
            targetHandle,
            createdAt: Date.now(),
          }
        );
      });
    },
    [pipeline.id]
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
      pipelineId: pipeline.id,
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
    selectSingleNode(id);
    setActiveInspectorTab('config');
  }, [selectedNode, selectSingleNode, t, pipeline.id]);

  const toggleSelectedNodeDisabled = useCallback(() => {
    if (selectionTargets.length === 0) return;
    // Any enabled target → disable the whole set; all disabled → re-enable all.
    const nextDisabled = selectionTargets.some((node) => node.config.disabled !== true);
    setWorkflow((current) => {
      if (!current) return current;
      return {
        ...current,
        nodes: current.nodes.map((node) => {
          if (!selectionIdSet.has(node.id)) return node;
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
  }, [selectionIdSet, selectionTargets]);

  const deleteSelectedNode = useCallback(async () => {
    if (selectionTargets.length === 0) return;
    const confirmed = await confirmDelete({
      message:
        selectionTargets.length === 1
          ? t('data.workflow.deleteOperatorConfirm', { name: selectionTargets[0].label })
          : t('data.workflow.deleteOperatorsConfirm', { count: selectionTargets.length }),
    });
    if (!confirmed) return;
    setWorkflow((current) => {
      if (!current) return current;
      return selectionTargets.reduce((next, node) => removeWorkflowNode(next, node.id), current);
    });
    setSelectedNodeIds((current) => current.filter((id) => !selectionIdSet.has(id)));
    setSelectedNodeId((current) => (current && selectionIdSet.has(current) ? null : current));
  }, [confirmDelete, selectionIdSet, selectionTargets, t]);

  // Keyboard: Ctrl/Cmd+Z undo, Ctrl+Y / Ctrl/Cmd+Shift+Z redo, Delete removes the
  // selection. Ignored while typing in inputs or editors.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          target.closest('[role="dialog"], .cm-editor, .monaco-editor'))
      ) {
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
        event.preventDefault();
        redo();
      } else if (!mod && (event.key === 'Delete' || event.key === 'Backspace')) {
        if (selectionTargets.length === 0) return;
        event.preventDefault();
        void deleteSelectedNode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelectedNode, redo, selectionTargets.length, undo]);

  /**
   * Runs the shared plan validation (graph + propagated schemas) and marks the
   * offending nodes red on the canvas. Returns the first error message, or
   * null when the plan is clean or validation itself could not run.
   */
  const flagPlanDiagnostics = useCallback(
    async (saveInput: DataWorkflowSaveInput): Promise<string | null> => {
      if (!dataClient.has('validatePipelineWorkflowPlan')) return null;
      try {
        const diagnostics = await dataClient.validatePipelineWorkflowPlan(pipeline.id, saveInput);
        const errorNodeIds = new Set(
          diagnostics
            .filter((item) => item.severity === 'error' && item.nodeId)
            .map((item) => item.nodeId as string)
        );
        // Diagnostics carry scoped ids (<pipelineId>__<id>); match canvas ids both ways.
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
          selectSingleNode([...canvasIds][0]);
        }
        return firstError?.message ?? null;
      } catch {
        return null;
      }
    },
    [nodes, selectSingleNode, pipeline.id]
  );

  const saveWorkflow = useCallback(async (): Promise<DataPipelineWorkflow | null> => {
    if (!workflow || !dataClient.isAvailable()) return null;
    const submittedSignature = getWorkflowSaveInputSignature(workflow);
    setSaving(true);
    setLocalError(null);
    try {
      const saved = await dataClient.savePipelineWorkflow(
        pipeline.id,
        toWorkflowSaveInput(workflow)
      );
      const savedSignature = getWorkflowSaveInputSignature(saved);
      setWorkflow((current) =>
        current && getWorkflowSaveInputSignature(current) !== submittedSignature ? current : saved
      );
      setSavedWorkflowSignature(savedSignature);
      const remapSavedId = (current: string | null): string | null => {
        if (!current) return saved.nodes[0]?.id ?? null;
        return (
          saved.nodes.find((node) => node.id === current || node.id.endsWith(`__${current}`))?.id ??
          current
        );
      };
      setSelectedNodeId(remapSavedId);
      setSelectedNodeIds(
        (current) => current.map((id) => remapSavedId(id) ?? id).filter(Boolean) as string[]
      );
      await onWorkflowSaved();
      return saved;
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
      void flagPlanDiagnostics(toWorkflowSaveInput(workflow));
      return null;
    } finally {
      setSaving(false);
    }
  }, [onWorkflowSaved, pipeline.id, workflow, flagPlanDiagnostics]);

  const [persistedNodeStats, setPersistedNodeStats] = useState<WorkflowNodeRunStat[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (dataClient.has('getPipelineNodeStats')) {
      void dataClient
        .getPipelineNodeStats(pipeline.id)
        .then((stats) => {
          if (!cancelled) setPersistedNodeStats(stats);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [pipeline.id]);

  const runStatsByNode = useMemo(() => {
    const map = new Map<string, WorkflowNodeRunStat>();
    // In-session run stats take precedence over the persisted previous run.
    for (const stat of persistedNodeStats) map.set(stat.nodeId, stat);
    for (const stat of runNodeStats ?? []) map.set(stat.nodeId, stat);
    return map;
  }, [runNodeStats, persistedNodeStats]);

  // Structured expect-failure card: the executor names the offending node and
  // the violation counts in the failure message; this run's stats — persisted
  // for real runs, returned in-band for temporary runs — carry the samples.
  const failedExpectRun = useMemo(() => {
    if (!lastRunFailure) return null;
    const match = /Expect failed at node ([^:]+): (.+)$/.exec(lastRunFailure.message);
    if (!match) return null;
    const [, nodeId, detail] = match;
    const stat = runStatsByNode.get(nodeId);
    return {
      nodeId,
      detail,
      stat: stat?.nodeType === 'expect' ? stat : undefined,
      node: nodes.find((item) => item.id === nodeId) ?? null,
    };
  }, [lastRunFailure, nodes, runStatsByNode]);
  const failedExpectSummary = useMemo(() => {
    if (!failedExpectRun) return null;
    const nodeLabel = failedExpectRun.node?.label ?? failedExpectRun.nodeId;
    const rowsMatch = /(\d+) of (\d+) row/.exec(failedExpectRun.detail);
    if (rowsMatch) {
      return t('data.workflow.expectFailureRows', {
        node: nodeLabel,
        rejected: Number(rowsMatch[1]),
        total: Number(rowsMatch[2]),
      });
    }
    const countMatch = /row count (\d+) does not satisfy rows (\S+) (\d+)/.exec(
      failedExpectRun.detail
    );
    if (countMatch) {
      return t('data.workflow.expectFailureRowCount', {
        node: nodeLabel,
        total: Number(countMatch[1]),
        op: countMatch[2],
        value: Number(countMatch[3]),
      });
    }
    return `${nodeLabel}: ${failedExpectRun.detail}`;
  }, [failedExpectRun, t]);
  const [expectCardDismissedAt, setExpectCardDismissedAt] = useState<number | null>(null);
  const [expectSampleOpen, setExpectSampleOpen] = useState(false);
  const [expectDetailsOpen, setExpectDetailsOpen] = useState(false);
  const expectSamplePreview = useMemo<DataRawTablePreview | null>(() => {
    const sample = failedExpectRun?.stat?.sample;
    if (!sample?.length) return null;
    const columns = [...new Set(sample.flatMap((row) => Object.keys(row)))];
    const columnTypes = columns.map((name) => {
      const first = sample
        .map((row) => row[name])
        .find((value) => value !== null && value !== undefined);
      const storageType =
        typeof first === 'number'
          ? Number.isInteger(first)
            ? 'BIGINT'
            : 'DOUBLE'
          : typeof first === 'boolean'
            ? 'BOOLEAN'
            : 'VARCHAR';
      return { name, type: dataFieldTypeFromDuckDbType(storageType), storageType };
    });
    return {
      columns,
      columnTypes,
      rows: sample as Record<string, string | number | boolean | null>[],
      fileCount: 1,
      limit: sample.length,
      offset: 0,
      totalRows: failedExpectRun?.stat?.rejectedRows ?? sample.length,
    };
  }, [failedExpectRun]);

  const invalidNodeIds = useMemo(() => {
    const ids = new Set(planErrorNodeIds);
    if (!configIssuesVisible) return ids;
    nodes.filter((node) => incompleteConfigMessageKey(node)).forEach((n) => ids.add(n.id));
    return ids;
  }, [nodes, configIssuesVisible, planErrorNodeIds]);

  const flagIncompleteNodes = useCallback(
    (nodeList: DataWorkflowNode[]): string | null => {
      const firstInvalid = nodeList.find((node) => incompleteConfigMessageKey(node));
      setConfigIssuesVisible(Boolean(firstInvalid));
      if (firstInvalid) selectSingleNode(firstInvalid.id);
      return firstInvalid ? incompleteConfigMessageKey(firstInvalid) : null;
    },
    [selectSingleNode]
  );

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
    setRunKind('trial');
    try {
      await onRun(pipeline, {
        workflow: workflowSaveInput,
        outputMode: 'temporary',
      });
    } finally {
      setRunKind(null);
    }
    setNodeDataRefreshVersion((current) => current + 1);
  }, [onRun, pipeline, validateWorkflowBeforeRun, workflowSaveInput, flagPlanDiagnostics]);

  /**
   * "Preview up to this step": runs a temporary execution scoped to the
   * selected node's upstream subgraph, appending a synthetic output sink so
   * only the ancestors needed for the preview are materialized. Nothing is
   * committed — temp caches expire on their own.
   */
  const previewNodeToHere = useCallback(async () => {
    if (!workflowSaveInput || !selectedNode || !workflow) return;
    const upstream = new Set<string>([selectedNode.id]);
    const pending = [selectedNode.id];
    while (pending.length > 0) {
      const nodeId = pending.pop()!;
      for (const edge of edges) {
        if (edge.targetNodeId === nodeId && !upstream.has(edge.sourceNodeId)) {
          upstream.add(edge.sourceNodeId);
          pending.push(edge.sourceNodeId);
        }
      }
    }
    const scopedNodes = workflowSaveInput.nodes.filter((node) => upstream.has(node.id));
    const scopedEdges = workflowSaveInput.edges.filter(
      (edge) => upstream.has(edge.sourceNodeId) && upstream.has(edge.targetNodeId)
    );
    const previewInput: DataWorkflowSaveInput = {
      nodes: [...scopedNodes],
      edges: [...scopedEdges],
    };
    if (selectedNode.type !== 'output') {
      const sinkId = makeLocalId('preview_sink');
      previewInput.nodes.push({
        id: sinkId,
        type: 'output',
        label: t('data.workflow.previewToThisStep'),
        x: 0,
        y: 0,
        config: {},
      });
      previewInput.edges.push({
        id: makeLocalId('edge'),
        sourceNodeId: selectedNode.id,
        targetNodeId: sinkId,
        sourceHandle: 'output',
        targetHandle: 'input',
      });
    }
    const incompleteMessageKey = flagIncompleteNodes(nodes.filter((node) => upstream.has(node.id)));
    if (incompleteMessageKey) {
      setLocalError(t(incompleteMessageKey));
      return;
    }
    setLocalError(null);
    const planError = await flagPlanDiagnostics(previewInput);
    if (planError) {
      setLocalError(planError);
      return;
    }
    await onRun(pipeline, {
      workflow: previewInput,
      outputMode: 'temporary',
    });
    setNodeDataRefreshVersion((current) => current + 1);
  }, [
    workflowSaveInput,
    selectedNode,
    workflow,
    edges,
    nodes,
    t,
    flagIncompleteNodes,
    flagPlanDiagnostics,
    onRun,
    pipeline,
  ]);

  /**
   * Earliest zero-output node on the SELECTED node's ancestor path — the
   * first place the stream feeding this node dried up. Zero-output nodes on
   * unrelated branches must not be reported as this preview's cause.
   */
  const firstZeroOutputNode = useMemo(() => {
    if (!selectedNode || runStatsByNode.size === 0) return null;
    const upstream = new Set<string>([selectedNode.id]);
    const pending = [selectedNode.id];
    while (pending.length > 0) {
      const nodeId = pending.pop()!;
      for (const edge of edges) {
        if (edge.targetNodeId === nodeId && !upstream.has(edge.sourceNodeId)) {
          upstream.add(edge.sourceNodeId);
          pending.push(edge.sourceNodeId);
        }
      }
    }
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const inDegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const edge of edges) {
      if (!upstream.has(edge.sourceNodeId) || !upstream.has(edge.targetNodeId)) continue;
      inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) ?? 0) + 1);
      outgoing.set(edge.sourceNodeId, [
        ...(outgoing.get(edge.sourceNodeId) ?? []),
        edge.targetNodeId,
      ]);
    }
    const queue = [...upstream].filter((id) => (inDegree.get(id) ?? 0) === 0);
    const ordered: string[] = [];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      ordered.push(nodeId);
      for (const targetId of outgoing.get(nodeId) ?? []) {
        const next = (inDegree.get(targetId) ?? 0) - 1;
        inDegree.set(targetId, next);
        if (next === 0) queue.push(targetId);
      }
    }
    for (const nodeId of ordered) {
      if (runStatsByNode.get(nodeId)?.outputRows === 0) {
        return nodeById.get(nodeId) ?? null;
      }
    }
    return null;
  }, [selectedNode, nodes, edges, runStatsByNode]);

  const handleSaveAndRun = useCallback(async () => {
    if (!validateWorkflowBeforeRun()) return;
    const saved = await saveWorkflow();
    if (!saved) return;
    const savedInput = toWorkflowSaveInput(saved);
    setRunKind('run');
    try {
      await onRun(pipeline, {
        workflow: savedInput,
        outputMode: 'persisted',
      });
    } finally {
      setRunKind(null);
    }
    setNodeDataRefreshVersion((current) => current + 1);
  }, [onRun, saveWorkflow, pipeline, validateWorkflowBeforeRun]);

  const applyAndRunOperatorDsl = useCallback(
    async (nodeId: string, config: Record<string, unknown>) => {
      if (!workflow) return;
      const now = Date.now();
      const nextWorkflow: DataPipelineWorkflow = {
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
      selectSingleNode(nodeId);
      const planError = await flagPlanDiagnostics(toWorkflowSaveInput(nextWorkflow));
      if (planError) {
        setLocalError(planError);
        return;
      }
      const nextInput = toWorkflowSaveInput(nextWorkflow);
      await onRun(pipeline, {
        workflow: nextInput,
        outputMode: 'temporary',
      });
      setNodeDataRefreshVersion((current) => current + 1);
    },
    [onRun, selectSingleNode, t, pipeline, workflow, flagIncompleteNodes, flagPlanDiagnostics]
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
          pipelineId: pipeline.id,
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
        pipelineId: pipeline.id,
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
      selectSingleNode(nextNodes[0]?.id ?? null);
      closeDslDialog();
      setLocalError(null);
      return;
    }
    setDslError(
      diagnostics.map((item) => formatPrepDiagnosticForUi(item, t)).join('\n') ||
        t('data.workflow.dslInvalid')
    );
  }, [closeDslDialog, dslText, selectSingleNode, t, pipeline.id, workflow]);

  return (
    <section className="relative flex flex-1 min-h-0 flex-col">
      <div className="flex h-12 flex-shrink-0 items-stretch justify-between border-b border-border-subtle">
        <div className="flex min-w-0 items-stretch">
          <button
            onClick={() => void handleBack()}
            className="inline-flex w-[232px] flex-shrink-0 items-center gap-1.5 border-r border-border-subtle px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent"
            data-testid="pipeline-back-cell"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('data.editor.back')}
          </button>
          <div className="flex min-w-0 items-center gap-2 border-r border-border-subtle px-3">
            {isEditingPipelineTitle ? (
              <span className="flex h-8 min-w-0 max-w-[22rem] items-center rounded-lg border border-accent/40 bg-surface px-2.5 shadow-soft ring-2 ring-accent/15">
                <input
                  ref={pipelineTitleInputRef}
                  value={pipelineTitle}
                  maxLength={80}
                  onChange={(event) => setPipelineTitle(event.target.value)}
                  onBlur={() => void savePipelineTitle()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }
                    if (event.key === 'Escape') {
                      skipPipelineTitleSaveRef.current = true;
                      setPipelineTitle(pipeline.name);
                      setIsEditingPipelineTitle(false);
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-text-secondary outline-none"
                />
              </span>
            ) : (
              <h1 className="truncate text-[15px] font-medium text-text-secondary">
                {pipelineTitle}
              </h1>
            )}
            {!isEditingPipelineTitle && (
              <button
                onClick={() => setIsEditingPipelineTitle(true)}
                disabled={isBusy}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
                title={t('common.edit')}
              >
                <PencilLine className="h-3.5 w-3.5" />
                <span className="sr-only">{t('common.edit')}</span>
              </button>
            )}
          </div>
        </div>
        <div className="flex items-stretch">
          <div className="flex items-stretch">
            <Button
              variant="ghost"
              size="icon"
              onClick={undo}
              disabled={isBusy || !canUndo}
              className="h-full w-10 rounded-none border-l border-border-subtle"
              title={t('data.workflow.undo')}
              aria-label={t('data.workflow.undo')}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={redo}
              disabled={isBusy || !canRedo}
              className="h-full w-10 rounded-none border-l border-border-subtle"
              title={t('data.workflow.redo')}
              aria-label={t('data.workflow.redo')}
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button
            variant="secondary"
            onClick={() => setAiDialogOpen(true)}
            disabled={isBusy || !workflow}
            className="h-full rounded-none border-0 border-l border-border-subtle px-3 text-xs shadow-none"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('data.workflow.aiGenerate')}
          </Button>
          <Button
            variant="secondary"
            onClick={tidyCanvas}
            disabled={isBusy || nodes.length === 0}
            className="h-full rounded-none border-0 border-l border-border-subtle px-3 text-xs shadow-none"
            title={t('data.workflow.tidyLayoutHint')}
          >
            <Waypoints className="h-3.5 w-3.5" />
            {t('data.workflow.tidyLayout')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void saveWorkflow()}
            disabled={isBusy || !workflow || !isWorkflowDirty}
            className="h-full rounded-none border-0 border-l border-border-subtle px-3 text-xs shadow-none"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? t('common.saving') : t('common.save')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void handleTrialRun()}
            disabled={isBusy || !workflow}
            data-testid="pipeline-trial-run"
            className={`h-full rounded-none border-0 border-l border-border-subtle px-3 text-xs shadow-none ${
              runningKind === 'trial' ? 'bg-accent-muted/60 text-accent disabled:opacity-100' : ''
            }`}
          >
            {runningKind === 'trial' ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {runningKind === 'trial' ? t('data.workflow.runningShort') : t('data.editor.trialRun')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => void handleSaveAndRun()}
            disabled={isBusy || !workflow}
            data-testid="pipeline-save-and-run"
            className={`h-full rounded-none border-0 border-l border-border-subtle px-3 text-xs font-semibold text-accent shadow-none hover:bg-accent-muted/60 hover:text-accent ${
              runningKind === 'run' ? 'bg-accent-muted/60 disabled:opacity-100' : ''
            }`}
          >
            {runningKind === 'run' ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {runningKind === 'run' ? t('data.workflow.runningShort') : t('data.editor.saveAndRun')}
          </Button>
          <GlassDropdownMenu
            open={workflowMenuOpen}
            onOpenChange={setWorkflowMenuOpen}
            align="end"
            contentClassName="w-40"
            trigger={
              <button
                type="button"
                disabled={isBusy || !workflow}
                className="inline-flex h-full w-10 items-center justify-center border-l border-border-subtle text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
                title={t('data.actions.more')}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          >
            <GlassMenuItem
              icon={<FileText className="h-3.5 w-3.5" />}
              onSelect={() => setExplainDialogOpen(true)}
              disabled={nodes.length === 0}
            >
              {t('data.workflow.explainTitle')}
            </GlassMenuItem>
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
        <div className="flex flex-1 min-h-0 items-center justify-center bg-surface text-xs text-text-muted">
          {t('common.loading')}
        </div>
      ) : (
        <div className="grid flex-1 min-h-0 grid-cols-[232px_minmax(0,1fr)] items-stretch">
          <WorkflowOperatorPalette onAddOperator={addOperatorAfterSelected} />
          <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_400px]">
            {/* grid + stretch keeps WorkflowCanvas at the full row height so the
                empty-state overlay can anchor absolute to this wrapper */}
            <div className="relative grid min-h-0 grid-rows-[minmax(0,1fr)]">
              {localError && (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-16">
                  <InlineBanner
                    tone="error"
                    className="pointer-events-auto w-full max-w-xl bg-surface shadow-md"
                    title={t('data.workflow.errorBannerTitle')}
                    description={localError}
                    onDismiss={() => setLocalError(null)}
                    actions={
                      invalidNodeIds.size > 0 ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => selectSingleNode([...invalidNodeIds][0])}
                        >
                          {t('data.workflow.locateNode', { count: invalidNodeIds.size })}
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              )}
              <WorkflowCanvas
                fitKey={pipeline.id}
                nodes={nodes}
                edges={edges}
                invalidNodeIds={invalidNodeIds}
                selectedNodeIds={selectionTargets.map((node) => node.id)}
                primaryNodeId={selectedNode?.id ?? null}
                layoutEpoch={layoutEpoch}
                onViewportSizeChange={(size) => {
                  canvasViewportSizeRef.current = size;
                }}
                onSelectionChange={selectNodes}
                onDuplicateNode={duplicateSelectedNode}
                onToggleNodeDisabled={toggleSelectedNodeDisabled}
                onDeleteNode={deleteSelectedNode}
                onAddNode={addOperator}
                onMoveNode={moveNode}
                onConnectNodes={connectNodes}
                onReconnectEdge={reconnectWorkflowEdge}
                onRemoveEdge={removeWorkflowEdge}
              />
              {nodes.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                  <div className="pointer-events-auto flex w-[26rem] max-w-full flex-col items-center gap-4 rounded-xl border border-border-muted bg-surface px-6 py-5 text-center shadow-card">
                    <div className="text-[13px] font-semibold text-text-secondary">
                      {t('data.workflow.starterTitle')}
                    </div>
                    <div className="text-[12px] leading-5 text-text-muted">
                      {t('data.workflow.starterHint')}
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={applyStarterTemplate}
                        disabled={isBusy}
                        className="h-8 px-3 text-xs"
                      >
                        <Workflow className="h-3.5 w-3.5" />
                        {t('data.workflow.starterTemplate')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setAiDialogOpen(true)}
                        disabled={isBusy || !boundRawTable}
                        className="h-8 px-3 text-xs"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {t('data.workflow.starterAi')}
                      </Button>
                    </div>
                    {!boundRawTable && (
                      <div className="text-[11px] leading-5 text-text-muted">
                        {t('data.workflow.aiInputMissing')}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <WorkflowDataContext.Provider value={workflowDataContext}>
              <WorkflowInspector
                pipelineId={pipeline.id}
                node={selectedNode}
                workflowNodes={nodes}
                workflowEdges={edges}
                rawTables={rawTableChoices}
                isRawTablesLoading={rawTableChoicesLoading}
                resultTables={resultTableChoices}
                activeTab={activeInspectorTab}
                onActiveTabChange={setActiveInspectorTab}
                onNodeChange={updateSelectedNode}
                onApplyOperatorDsl={applyAndRunOperatorDsl}
                isRunningOperatorDsl={actionId === pipeline.id}
                nodeDataRefreshVersion={nodeDataRefreshVersion}
                runStat={selectedNode ? runStatsByNode.get(selectedNode.id) : undefined}
                runRefreshKey={`${pipeline.lastRunAt ?? ''}:${runNodeStats?.[0]?.runId ?? ''}:${
                  lastRunFailure?.at ?? ''
                }`}
                onSelectNode={(id) => {
                  selectSingleNode(id);
                  setActiveInspectorTab('config');
                }}
                firstZeroOutputNode={firstZeroOutputNode}
                isPreviewStale={isPreviewStale}
                upstreamSignature={selectedUpstreamSignature}
                onPreviewToHere={() => void previewNodeToHere()}
                isPreviewRunning={actionId === pipeline.id}
              />
            </WorkflowDataContext.Provider>
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
      <WorkflowAiGenerateDialog
        open={aiDialogOpen}
        pipelineId={pipeline.id}
        boundRawTable={boundRawTable}
        anchorNode={
          selectionIdSet.size === 1
            ? (nodes.find((node) => node.id === selectedNode?.id) ?? null)
            : null
        }
        draftWorkflow={workflowSaveInput}
        hasExistingNodes={nodes.length > 0}
        isCanvasDirty={isWorkflowDirty}
        onApplied={async () => {
          await loadWorkflow();
          await loadResultTableChoices();
          await onWorkflowSaved();
        }}
        onOpenChange={setAiDialogOpen}
      />
      <WorkflowExplainDialog
        open={explainDialogOpen}
        nodes={nodes}
        edges={edges}
        onOpenChange={setExplainDialogOpen}
      />
      {failedExpectRun && lastRunFailure && (
        <div className="absolute bottom-4 left-1/2 z-40 flex w-[min(92%,36rem)] -translate-x-1/2 flex-col items-center gap-2">
          {failedExpectRun && lastRunFailure && expectCardDismissedAt !== lastRunFailure.at && (
            <div
              role="alert"
              className="w-full rounded-lg border border-error/30 bg-surface px-3.5 py-3 text-[13px] shadow-card"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-error" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-error">
                    {t('data.workflow.expectFailureTitle')}
                  </div>
                  <div className="mt-0.5 text-text-secondary">{failedExpectSummary}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {expectSamplePreview && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setExpectSampleOpen(true)}
                        className="h-7 text-[11px]"
                      >
                        {t('data.workflow.expectViewSample')}
                      </Button>
                    )}
                    {failedExpectRun.node && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          selectSingleNode(failedExpectRun.node!.id);
                          setActiveInspectorTab('data');
                        }}
                        className="h-7 text-[11px]"
                      >
                        {t('data.workflow.expectLocateNode')}
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setExpectDetailsOpen((open) => !open)}
                      className="h-7 text-[11px]"
                    >
                      {t('data.workflow.expectTechDetails')}
                    </Button>
                  </div>
                  {expectDetailsOpen && (
                    <pre className="scrollbar-hover mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border-muted/60 bg-background p-2 font-mono text-[10.5px] leading-4 text-text-muted">
                      {lastRunFailure.message}
                    </pre>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setExpectCardDismissedAt(lastRunFailure.at)}
                  aria-label={t('common.close')}
                  className="flex-shrink-0 rounded-md p-1 text-text-muted transition-colors hover:bg-surface hover:text-text-secondary"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {expectSamplePreview && (
        <Dialog
          open={expectSampleOpen}
          onOpenChange={setExpectSampleOpen}
          ariaLabel={t('data.workflow.expectSampleTitle')}
          overlayClassName="operator-ui bg-black/15 px-4 py-6 dark:bg-black/50"
          className="h-[28rem] w-[56rem] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-xl p-0 shadow-card"
        >
          <div className="glass-panel-header flex h-12 flex-shrink-0 items-center justify-between gap-3 px-4">
            <div className="text-[14px] font-semibold text-text-primary">
              {t('data.workflow.expectSampleTitle')}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExpectSampleOpen(false)}
              className="text-[11px]"
            >
              <X className="h-3.5 w-3.5" />
              {t('common.close')}
            </Button>
          </div>
          <div className="min-h-0 flex-1 p-3">
            <WorkflowNodeDataPreview
              preview={expectSamplePreview}
              isLoading={false}
              error={null}
              currentPage={1}
              onPageChange={() => {}}
            />
          </div>
        </Dialog>
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
