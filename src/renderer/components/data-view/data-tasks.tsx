import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Background,
  ConnectionMode,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type HandleType,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnectStartParams,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GlassDropdownMenu, GlassMenuItem } from '../GlassDropdownMenu';
import { GlassSelect } from '../GlassSelect';
import { useConfirmDialog } from '../ConfirmDialog';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  Ban,
  BarChart3,
  Calculator,
  ChevronDown,
  Cloud,
  Columns3,
  Copy,
  Database,
  Droplet,
  Filter,
  Folder,
  GitMerge,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  Repeat2,
  RefreshCw,
  Save,
  Sigma,
  Table2,
  Trash2,
  Upload,
  UploadCloud,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import type {
  DataCleaningTask,
  DataDataset,
  DataInputTablePreview,
  DataOutputTable,
  DataRunTaskInput,
  DataTaskWorkflow,
  DataWorkflowEdge,
  DataWorkflowNode,
  DataWorkflowOperatorType,
  DataWorkflowSaveInput,
} from '../../types';
import {
  compilePrepWorkflowToFlow,
  exportPrepOperatorDsl,
  exportPrepWorkflowDsl,
  parsePrepDsl,
  parsePrepOperatorDsl,
  type PrepDiagnostic,
} from '../../../shared/prep-dsl';
import { dataFieldTypeLabel } from '../../../shared/data-field-types';
import { GlassDataGridPreview } from '../GlassDataGridPreview';
import {
  DataMoreMenu,
  DataTableSearch,
  DataToolbarButton,
  EmptyState,
  INPUT_TABLE_PREVIEW_PAGE_SIZE,
  LoadingState,
  OUTPUT_TABLE_INPUT_CHOICES_LIMIT,
  PaginationFooter,
  StatusBadge,
  formatTimestamp,
  makeLocalId,
  type TranslateFn,
} from './shared';
import { WorkflowOperatorConfigPanel } from './WorkflowOperatorConfigPanel';

function toWorkflowSaveInput(workflow: DataTaskWorkflow): DataWorkflowSaveInput {
  return {
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      x: node.x,
      y: node.y,
      config: node.config,
    })),
    edges: workflow.edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  };
}

function getWorkflowSaveInputSignature(workflow: DataTaskWorkflow): string {
  return JSON.stringify(toWorkflowSaveInput(workflow));
}

const TASK_ICON_STYLES = [
  { Icon: Database, className: 'bg-accent/10 text-accent' },
  { Icon: BarChart3, className: 'bg-[#E9F7F5] text-[#238C80]' },
  { Icon: Folder, className: 'bg-warning/10 text-warning' },
  { Icon: UploadCloud, className: 'bg-surface-active/70 text-text-secondary' },
  { Icon: Cloud, className: 'bg-[#E7F8EF] text-success' },
];

const WORKFLOW_NODE_WIDTH = 116;
const WORKFLOW_NODE_HEIGHT = 36;
const WORKFLOW_OPERATOR_MIME = 'application/x-sophron-workflow-operator';
const WORKFLOW_ALIGNMENT_THRESHOLD = 6;
const WORKFLOW_ALIGNMENT_GUIDE_PADDING = 32;

type WorkflowFlowNode = Node<{ workflowNode: DataWorkflowNode }, 'operator'>;
type WorkflowFlowEdge = Edge<Record<string, never>>;
type WorkflowInspectorTab = 'config' | 'data' | 'logs';
type WorkflowAlignmentLine =
  | { id: string; orientation: 'horizontal'; x1: number; x2: number; y: number }
  | { id: string; orientation: 'vertical'; x: number; y1: number; y2: number };

interface WorkflowAlignmentGuides {
  horizontal: WorkflowAlignmentLine | null;
  vertical: WorkflowAlignmentLine | null;
}

const EMPTY_WORKFLOW_ALIGNMENT_GUIDES: WorkflowAlignmentGuides = {
  horizontal: null,
  vertical: null,
};

const OPERATOR_CATALOG: Array<{
  type: DataWorkflowOperatorType;
  labelKey: string;
  Icon: LucideIcon;
  colorClassName: string;
  nodeClassName: string;
}> = [
  {
    type: 'input_source',
    labelKey: 'data.workflow.operators.input_source',
    Icon: Database,
    colorClassName: 'text-success bg-success/10',
    nodeClassName: 'border-success/35 bg-success/5 text-success',
  },
  {
    type: 'filter',
    labelKey: 'data.workflow.operators.filter',
    Icon: Filter,
    colorClassName: 'text-accent bg-accent/10',
    nodeClassName: 'border-accent/35 bg-accent/5 text-accent',
  },
  {
    type: 'field_select',
    labelKey: 'data.workflow.operators.field_select',
    Icon: Columns3,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
  },
  {
    type: 'deduplicate',
    labelKey: 'data.workflow.operators.deduplicate',
    Icon: Copy,
    colorClassName: 'text-text-secondary bg-surface-active/70',
    nodeClassName: 'border-border-muted bg-[var(--glass-card-strong)] text-text-secondary',
  },
  {
    type: 'missing_value',
    labelKey: 'data.workflow.operators.missing_value',
    Icon: Droplet,
    colorClassName: 'text-warning bg-warning/10',
    nodeClassName: 'border-warning/40 bg-warning/5 text-warning',
  },
  {
    type: 'type_convert',
    labelKey: 'data.workflow.operators.type_convert',
    Icon: Repeat2,
    colorClassName: 'text-accent bg-accent/10',
    nodeClassName: 'border-accent/35 bg-accent/5 text-accent',
  },
  {
    type: 'sort',
    labelKey: 'data.workflow.operators.sort',
    Icon: ArrowUpDown,
    colorClassName: 'text-success bg-success/10',
    nodeClassName: 'border-success/35 bg-success/5 text-success',
  },
  {
    type: 'join',
    labelKey: 'data.workflow.operators.join',
    Icon: GitMerge,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
  },
  {
    type: 'aggregate',
    labelKey: 'data.workflow.operators.aggregate',
    Icon: Sigma,
    colorClassName: 'text-text-secondary bg-surface-active/70',
    nodeClassName: 'border-border-muted bg-[var(--glass-card-strong)] text-text-secondary',
  },
  {
    type: 'calculate_field',
    labelKey: 'data.workflow.operators.calculate_field',
    Icon: Calculator,
    colorClassName: 'text-text-secondary bg-surface-active/70',
    nodeClassName: 'border-border-muted bg-[var(--glass-card-strong)] text-text-secondary',
  },
  {
    type: 'field_mapping',
    labelKey: 'data.workflow.operators.field_mapping',
    Icon: Table2,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
  },
  {
    type: 'limit',
    labelKey: 'data.workflow.operators.limit',
    Icon: ArrowUpDown,
    colorClassName: 'text-success bg-success/10',
    nodeClassName: 'border-success/35 bg-success/5 text-success',
  },
  {
    type: 'pivot',
    labelKey: 'data.workflow.operators.pivot',
    Icon: BarChart3,
    colorClassName: 'text-text-secondary bg-surface-active/70',
    nodeClassName: 'border-border-muted bg-[var(--glass-card-strong)] text-text-secondary',
  },
  {
    type: 'unpivot',
    labelKey: 'data.workflow.operators.unpivot',
    Icon: Columns3,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
  },
  {
    type: 'set_op',
    labelKey: 'data.workflow.operators.set_op',
    Icon: GitMerge,
    colorClassName: 'text-accent bg-accent/10',
    nodeClassName: 'border-accent/35 bg-accent/5 text-accent',
  },
  {
    type: 'unnest',
    labelKey: 'data.workflow.operators.unnest',
    Icon: Workflow,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
  },
  {
    type: 'output',
    labelKey: 'data.workflow.operators.output',
    Icon: UploadCloud,
    colorClassName: 'text-accent bg-accent/10',
    nodeClassName: 'border-accent/35 bg-accent/5 text-accent',
  },
];

const WORKFLOW_NODE_TYPES = {
  operator: WorkflowOperatorNode,
};

export function TaskEditor({
  task,
  outputTables,
  actionId,
  onBack,
  onRun,
  onWorkflowSaved,
}: {
  task: DataCleaningTask;
  outputTables: DataOutputTable[];
  actionId: string | null;
  onBack: () => void;
  onRun: (task: DataCleaningTask, payload?: DataRunTaskInput) => void | Promise<void>;
  onWorkflowSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { confirmDelete } = useConfirmDialog();
  const [workflow, setWorkflow] = useState<DataTaskWorkflow | null>(null);
  const [savedWorkflowSignature, setSavedWorkflowSignature] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeInspectorTab, setActiveInspectorTab] = useState<WorkflowInspectorTab>('config');
  const [saving, setSaving] = useState(false);
  const [renamingTask, setRenamingTask] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
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
    if (!window.electronAPI?.data) return;
    setLocalError(null);
    try {
      const nextWorkflow = await window.electronAPI.data.getTaskWorkflow(task.id);
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
    if (!window.electronAPI?.data?.getDashboard) return undefined;
    let cancelled = false;
    const loadInputTableChoices = async () => {
      setInputTableChoicesLoading(true);
      try {
        const dashboard = await window.electronAPI.data.getDashboard({
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
        const dashboard = await window.electronAPI.data.getDashboard({
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
    if (!window.electronAPI?.data?.updateTask) {
      setIsEditingTaskTitle(false);
      return;
    }
    setRenamingTask(true);
    setLocalError(null);
    try {
      const updated = await window.electronAPI.data.updateTask({ id: task.id, name: nextTitle });
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
        return {
          ...current,
          nodes: current.nodes.map((node) => (node.id === selectedNodeId ? updater(node) : node)),
        };
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
          config: {},
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
        const exists = current.edges.some(
          (edge) =>
            edge.sourceNodeId === sourceNodeId &&
            edge.targetNodeId === targetNodeId &&
            edge.sourceHandle === sourceHandle &&
            edge.targetHandle === targetHandle
        );
        if (exists) return current;
        // When connecting to a join's right handle, sync the rightInput config
        let nextNodes = current.nodes;
        if (targetHandle === 'right') {
          const sourceNode = current.nodes.find((n) => n.id === sourceNodeId);
          if (sourceNode) {
            const alias = (sourceNode.config?.alias as string) || sourceNode.label || '';
            nextNodes = current.nodes.map((n) =>
              n.id === targetNodeId
                ? { ...n, config: { ...n.config, rightInput: alias, rightAlias: alias } }
                : n
            );
          }
        }
        return {
          ...current,
          nodes: nextNodes,
          edges: [
            ...current.edges,
            {
              id: makeLocalId('edge'),
              taskId: task.id,
              sourceNodeId,
              targetNodeId,
              sourceHandle,
              targetHandle,
              createdAt: Date.now(),
            },
          ],
        };
      });
    },
    [task.id]
  );
  const reconnectWorkflowEdge = useCallback((edgeId: string, connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    setWorkflow((current) => {
      if (!current) return current;
      const oldEdge = current.edges.find((e) => e.id === edgeId);
      const duplicate = current.edges.some(
        (edge) =>
          edge.id !== edgeId &&
          edge.sourceNodeId === connection.source &&
          edge.targetNodeId === connection.target &&
          edge.sourceHandle === (connection.sourceHandle ?? 'output') &&
          edge.targetHandle === (connection.targetHandle ?? 'input')
      );
      if (duplicate) {
        // If removing a right-handle edge, clear config.rightInput
        let nextNodes = current.nodes;
        if (oldEdge?.targetHandle === 'right') {
          nextNodes = current.nodes.map((n) =>
            n.id === oldEdge.targetNodeId
              ? { ...n, config: { ...n.config, rightInput: undefined, rightAlias: undefined } }
              : n
          );
        }
        return {
          ...current,
          nodes: nextNodes,
          edges: current.edges.filter((e) => e.id !== edgeId),
        };
      }
      // Sync config when reconnecting to/from right handle
      let nextNodes = current.nodes;
      const newTargetHandle = connection.targetHandle ?? 'input';
      if (newTargetHandle === 'right') {
        // Reconnecting TO right handle: set config.rightInput
        const sourceNode = current.nodes.find((n) => n.id === connection.source);
        if (sourceNode) {
          const alias = (sourceNode.config?.alias as string) || sourceNode.label || '';
          nextNodes = current.nodes.map((n) =>
            n.id === connection.target
              ? { ...n, config: { ...n.config, rightInput: alias, rightAlias: alias } }
              : n
          );
        }
      } else if (oldEdge?.targetHandle === 'right' && newTargetHandle !== 'right') {
        // Reconnecting AWAY from right handle: clear config.rightInput
        nextNodes = current.nodes.map((n) =>
          n.id === oldEdge.targetNodeId
            ? { ...n, config: { ...n.config, rightInput: undefined, rightAlias: undefined } }
            : n
        );
      }
      return {
        ...current,
        nodes: nextNodes,
        edges: current.edges.map((edge) =>
          edge.id === edgeId
            ? {
                ...edge,
                sourceNodeId: connection.source,
                targetNodeId: connection.target,
                sourceHandle: connection.sourceHandle ?? 'output',
                targetHandle: newTargetHandle,
              }
            : edge
        ),
      };
    });
  }, []);
  const removeWorkflowEdge = useCallback((edgeId: string) => {
    setWorkflow((current) => {
      if (!current) return current;
      const removedEdge = current.edges.find((e) => e.id === edgeId);
      const wasRightEdge = removedEdge?.targetHandle === 'right';
      let nextNodes = current.nodes;
      if (wasRightEdge && removedEdge) {
        nextNodes = current.nodes.map((n) =>
          n.id === removedEdge.targetNodeId
            ? { ...n, config: { ...n.config, rightInput: undefined, rightAlias: undefined } }
            : n
        );
      }
      return {
        ...current,
        nodes: nextNodes,
        edges: current.edges.filter((edge) => edge.id !== edgeId),
      };
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
    setWorkflow((current) =>
      current
        ? {
            ...current,
            nodes: current.nodes.filter((node) => node.id !== selectedNode.id),
            edges: current.edges.filter(
              (edge) =>
                edge.sourceNodeId !== selectedNode.id && edge.targetNodeId !== selectedNode.id
            ),
          }
        : current
    );
    setSelectedNodeId((current) => (current === selectedNode.id ? null : current));
  }, [confirmDelete, selectedNode, t]);

  const saveWorkflow = useCallback(async (): Promise<DataTaskWorkflow | null> => {
    if (!workflow || !window.electronAPI?.data) return null;
    setSaving(true);
    setLocalError(null);
    try {
      const saved = await window.electronAPI.data.saveTaskWorkflow(
        task.id,
        toWorkflowSaveInput(workflow)
      );
      setWorkflow(saved);
      setSavedWorkflowSignature(getWorkflowSaveInputSignature(saved));
      setSelectedNodeId((current) => current ?? saved.nodes[0]?.id ?? null);
      await onWorkflowSaved();
      return saved;
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSaving(false);
    }
  }, [onWorkflowSaved, task.id, workflow]);

  const handleRun = useCallback(async () => {
    if (!workflowSaveInput) return;
    await onRun(task, {
      workflow: workflowSaveInput,
      outputMode: isWorkflowDirty ? 'temporary' : 'persisted',
    });
  }, [isWorkflowDirty, onRun, task, workflowSaveInput]);

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
      setWorkflow(nextWorkflow);
      setSelectedNodeId(nodeId);
      await onRun(task, {
        workflow: toWorkflowSaveInput(nextWorkflow),
        outputMode: 'temporary',
      });
      setNodeDataRefreshVersion((current) => current + 1);
    },
    [onRun, task, workflow]
  );

  const openImportDsl = useCallback(() => {
    setLocalError(null);
    setDslError(null);
    setDslText('');
    setDslMode('import');
  }, []);

  const openExportDsl = useCallback(() => {
    if (!workflow) return;
    setLocalError(null);
    setDslError(null);
    setDslText(exportPrepWorkflowDsl(workflow.nodes, workflow.edges));
    setDslMode('export');
  }, [workflow]);

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
    <section className="flex flex-1 min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <button
            onClick={onBack}
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
            onClick={() => void handleRun()}
            disabled={isBusy || !workflow}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Play className="h-3.5 w-3.5" />
            {t('data.editor.runTask')}
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

      {localError && (
        <div className="mb-3 flex shrink-0 items-start gap-2 whitespace-pre-line rounded-lg border border-error/20 bg-error/10 px-3.5 py-2.5 text-[13px] text-error">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{localError}</span>
        </div>
      )}

      {!workflow ? (
        <div className="flex flex-1 min-h-0 items-center justify-center rounded-xl border border-border-muted bg-background/42 text-xs text-text-muted shadow-card">
          {t('common.loading')}
        </div>
      ) : (
        <div className="grid flex-1 min-h-0 grid-cols-[13rem_minmax(0,1fr)] items-stretch gap-3">
          <WorkflowOperatorPalette operators={OPERATOR_CATALOG} onAddOperator={addOperator} />
          <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_400px] gap-3">
            <WorkflowCanvas
              nodes={nodes}
              edges={edges}
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
    </section>
  );
}

function WorkflowDslDialog({
  mode,
  value,
  error,
  onChange,
  onApply,
  onCopy,
  onClose,
}: {
  mode: 'import' | 'export';
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onApply: () => void;
  onCopy: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isImport = mode === 'import';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/28 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label={isImport ? t('data.workflow.importDsl') : t('data.workflow.viewExportDsl')}
    >
      <div className="flex h-[34rem] max-h-[calc(100vh-3rem)] w-[54rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-muted bg-[var(--glass-card-strong)] shadow-card backdrop-blur-xl">
        <div className="glass-panel-header flex h-12 flex-shrink-0 items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              {isImport ? <Upload className="h-3.5 w-3.5" /> : <Workflow className="h-3.5 w-3.5" />}
            </span>
            <div className="truncate text-[14px] font-semibold text-text-primary">
              {isImport ? t('data.workflow.importDsl') : t('data.workflow.viewExportDsl')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent"
            title={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 bg-background/24 p-3">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            readOnly={!isImport}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none rounded-lg border border-border-muted bg-background/48 px-3 py-2.5 font-mono text-[12px] leading-5 text-text-secondary outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 read-only:bg-surface-active/40"
            placeholder={t('data.workflow.dslPlaceholder')}
          />
          {error && (
            <div className="max-h-24 overflow-y-auto whitespace-pre-line rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-xs font-medium text-error">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex h-12 flex-shrink-0 items-center justify-end gap-2 border-t border-border-muted px-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
          >
            {isImport ? t('common.cancel') : t('common.close')}
          </button>
          {isImport ? (
            <button
              type="button"
              onClick={onApply}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors"
            >
              <Workflow className="h-3.5 w-3.5" />
              {t('data.workflow.applyDsl')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onCopy}
              disabled={!value}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Copy className="h-3.5 w-3.5" />
              {t('data.workflow.copyDsl')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkflowOperatorPalette({
  operators,
  onAddOperator,
}: {
  operators: typeof OPERATOR_CATALOG;
  onAddOperator: (type: DataWorkflowOperatorType) => void;
}) {
  const { t } = useTranslation();
  const handleDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>, type: DataWorkflowOperatorType) => {
      event.dataTransfer.setData(WORKFLOW_OPERATOR_MIME, type);
      event.dataTransfer.effectAllowed = 'copy';
    },
    []
  );

  return (
    <aside className="glass-card flex min-h-0 flex-col overflow-hidden rounded-xl p-2">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {operators.map(({ type, labelKey, Icon, colorClassName }) => (
          <button
            key={type}
            draggable
            onDragStart={(event) => handleDragStart(event, type)}
            onClick={() => onAddOperator(type)}
            className="flex h-9 w-full items-center gap-2 rounded-lg border border-border-muted bg-surface px-2.5 text-left text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
          >
            <span
              className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${colorClassName}`}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="truncate">{t(labelKey)}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function WorkflowCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onDuplicateNode,
  onToggleNodeDisabled,
  onDeleteNode,
  onAddNode,
  onMoveNode,
  onConnectNodes,
  onReconnectEdge,
  onRemoveEdge,
}: {
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onDuplicateNode: () => void;
  onToggleNodeDisabled: () => void;
  onDeleteNode: () => void;
  onAddNode: (type: DataWorkflowOperatorType, position?: { x: number; y: number }) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onConnectNodes: (
    sourceNodeId: string,
    targetNodeId: string,
    sourceHandle?: string,
    targetHandle?: string
  ) => void;
  onReconnectEdge: (edgeId: string, connection: Connection) => void;
  onRemoveEdge: (edgeId: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasContent
        nodes={nodes}
        edges={edges}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
        onDuplicateNode={onDuplicateNode}
        onToggleNodeDisabled={onToggleNodeDisabled}
        onDeleteNode={onDeleteNode}
        onAddNode={onAddNode}
        onMoveNode={onMoveNode}
        onConnectNodes={onConnectNodes}
        onReconnectEdge={onReconnectEdge}
        onRemoveEdge={onRemoveEdge}
      />
    </ReactFlowProvider>
  );
}

function WorkflowCanvasContent({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onDuplicateNode,
  onToggleNodeDisabled,
  onDeleteNode,
  onAddNode,
  onMoveNode,
  onConnectNodes,
  onReconnectEdge,
  onRemoveEdge,
}: {
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onDuplicateNode: () => void;
  onToggleNodeDisabled: () => void;
  onDeleteNode: () => void;
  onAddNode: (type: DataWorkflowOperatorType, position?: { x: number; y: number }) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onConnectNodes: (
    sourceNodeId: string,
    targetNodeId: string,
    sourceHandle?: string,
    targetHandle?: string
  ) => void;
  onReconnectEdge: (edgeId: string, connection: Connection) => void;
  onRemoveEdge: (edgeId: string) => void;
}) {
  const { t } = useTranslation();
  const { screenToFlowPosition } = useReactFlow();
  const [connectionStart, setConnectionStart] = useState<OnConnectStartParams | null>(null);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );
  const selectedNodeCatalog = selectedNode ? getOperatorCatalog(selectedNode.type) : null;
  const SelectedNodeIcon = selectedNodeCatalog?.Icon;
  const selectedNodeDisabled = selectedNode?.config.disabled === true;
  const mappedFlowNodes = useMemo<WorkflowFlowNode[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: 'operator',
        position: { x: node.x, y: node.y },
        width: WORKFLOW_NODE_WIDTH,
        height: WORKFLOW_NODE_HEIGHT,
        initialWidth: WORKFLOW_NODE_WIDTH,
        initialHeight: WORKFLOW_NODE_HEIGHT,
        dragHandle: '.workflow-node-drag-handle',
        draggable: true,
        selectable: true,
        selected: node.id === selectedNodeId,
        data: { workflowNode: node },
      })),
    [nodes, selectedNodeId]
  );
  const mappedFlowEdges = useMemo<WorkflowFlowEdge[]>(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        sourceHandle: edge.sourceHandle ?? 'output',
        targetHandle: edge.targetHandle ?? 'input',
        type: 'smoothstep',
        reconnectable: true,
        interactionWidth: 18,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: 'rgba(100, 116, 139, 0.82)',
        },
        style: {
          stroke: 'rgba(100, 116, 139, 0.68)',
          strokeWidth: 1.8,
        },
      })),
    [edges]
  );
  const [flowNodes, setFlowNodes] = useState<WorkflowFlowNode[]>(mappedFlowNodes);
  const [flowEdges, setFlowEdges] = useState<WorkflowFlowEdge[]>(mappedFlowEdges);
  const [alignmentGuides, setAlignmentGuides] = useState<WorkflowAlignmentGuides>(
    EMPTY_WORKFLOW_ALIGNMENT_GUIDES
  );
  const flowNodesRef = useRef<WorkflowFlowNode[]>(mappedFlowNodes);
  const connectSucceededRef = useRef(false);
  const reconnectSucceededRef = useRef(false);

  useEffect(() => {
    flowNodesRef.current = mappedFlowNodes;
    setFlowNodes(mappedFlowNodes);
  }, [mappedFlowNodes]);

  useEffect(() => {
    setFlowEdges(mappedFlowEdges);
  }, [mappedFlowEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<WorkflowFlowNode>[]) => {
      let nextGuides = EMPTY_WORKFLOW_ALIGNMENT_GUIDES;
      const snappedChanges = changes.map((change) => {
        if (change.type !== 'position' || !change.dragging || !change.position) {
          return change;
        }
        const snap = getWorkflowAlignmentSnap(change.id, change.position, flowNodesRef.current);
        nextGuides = snap.guides;
        return {
          ...change,
          position: snap.position,
          positionAbsolute: snap.position,
        };
      });
      setAlignmentGuides(nextGuides);
      setFlowNodes((currentNodes) => {
        const nextNodes = applyNodeChanges(snappedChanges, currentNodes);
        flowNodesRef.current = nextNodes;
        for (const change of snappedChanges) {
          if (change.type === 'select' && change.selected) {
            onSelectNode(change.id);
          }
        }
        return nextNodes;
      });
    },
    [onSelectNode]
  );

  const handleEdgesChange = useCallback((changes: EdgeChange<WorkflowFlowEdge>[]) => {
    setFlowEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));
  }, []);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      connectSucceededRef.current = true;
      onConnectNodes(
        connection.source,
        connection.target,
        connection.sourceHandle ?? 'output',
        connection.targetHandle ?? 'input'
      );
      onSelectNode(connection.target);
    },
    [onConnectNodes, onSelectNode]
  );
  const handleConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      connectSucceededRef.current = false;
      setConnectionStart(params);
    },
    []
  );
  const isValidWorkflowConnection = useCallback(
    (connection: Edge | Connection) =>
      Boolean(connection.source && connection.target && connection.source !== connection.target),
    []
  );
  const handleReconnectStart = useCallback(
    (_event: ReactMouseEvent, _edge: WorkflowFlowEdge, _handleType: HandleType) => {
      reconnectSucceededRef.current = false;
    },
    []
  );
  const handleReconnect = useCallback(
    (oldEdge: WorkflowFlowEdge, newConnection: Connection) => {
      reconnectSucceededRef.current = true;
      setFlowEdges((currentEdges) =>
        reconnectEdge(oldEdge, newConnection, currentEdges, { shouldReplaceId: false })
      );
      onReconnectEdge(oldEdge.id, newConnection);
    },
    [onReconnectEdge]
  );
  const handleReconnectEnd = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      edge: WorkflowFlowEdge,
      _handleType: HandleType,
      connectionState: FinalConnectionState
    ) => {
      if (!reconnectSucceededRef.current && connectionState.isValid !== true) {
        setFlowEdges((currentEdges) => currentEdges.filter((item) => item.id !== edge.id));
        onRemoveEdge(edge.id);
      }
      reconnectSucceededRef.current = false;
    },
    [onRemoveEdge]
  );
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectSucceededRef.current) {
        connectSucceededRef.current = false;
        setConnectionStart(null);
        return;
      }
      const sourceNodeId = connectionStart?.nodeId ?? connectionState.fromNode?.id ?? null;
      if (!sourceNodeId) {
        setConnectionStart(null);
        return;
      }
      const dropTarget = getWorkflowConnectionDropTarget(event, connectionState);
      if (dropTarget && dropTarget.nodeId !== sourceNodeId) {
        onConnectNodes(
          sourceNodeId,
          dropTarget.nodeId,
          connectionStart?.handleId ?? 'output',
          dropTarget.handleId
        );
        onSelectNode(dropTarget.nodeId);
      }
      setConnectionStart(null);
    },
    [connectionStart, onConnectNodes, onSelectNode]
  );
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(WORKFLOW_OPERATOR_MIME);
      if (!isWorkflowOperatorType(type)) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onAddNode(type, {
        x: position.x - WORKFLOW_NODE_WIDTH / 2,
        y: position.y - WORKFLOW_NODE_HEIGHT / 2,
      });
    },
    [onAddNode, screenToFlowPosition]
  );
  const handleNodeDragStop = useCallback(
    (_event: ReactMouseEvent, node: WorkflowFlowNode) => {
      const currentNode = flowNodesRef.current.find((item) => item.id === node.id);
      const position = currentNode?.position ?? node.position;
      const snap = getWorkflowAlignmentSnap(node.id, position, flowNodesRef.current);
      setAlignmentGuides(EMPTY_WORKFLOW_ALIGNMENT_GUIDES);
      setFlowNodes((currentNodes) => {
        const nextNodes = currentNodes.map((item) =>
          item.id === node.id
            ? {
                ...item,
                position: snap.position,
              }
            : item
        );
        flowNodesRef.current = nextNodes;
        return nextNodes;
      });
      onMoveNode(node.id, snap.position.x, snap.position.y);
    },
    [onMoveNode]
  );

  return (
    <section className="glass-card flex min-h-0 flex-col overflow-hidden rounded-xl">
      <div className="glass-panel-header flex h-12 shrink-0 items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {selectedNodeCatalog && SelectedNodeIcon ? (
              <span
                className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${selectedNodeCatalog.colorClassName}`}
              >
                <SelectedNodeIcon className="h-3.5 w-3.5" />
              </span>
            ) : (
              <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-surface-active text-text-muted">
                <Workflow className="h-3.5 w-3.5" />
              </span>
            )}
            <span className="truncate text-[13px] font-medium text-text-secondary">
              {selectedNode
                ? t('data.workflow.selectedOperator', { count: 1, name: selectedNode.label })
                : t('data.workflow.noOperatorSelected')}
            </span>
            {selectedNode && <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />}
          </div>

          {!toolbarCollapsed && (
            <>
              <div className="hidden h-5 w-px flex-shrink-0 bg-border-muted md:block" />
              <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                <DataToolbarButton
                  icon={<Copy className="h-3.5 w-3.5" />}
                  label={t('data.workflow.copySelected')}
                  disabled={!selectedNode}
                  onClick={onDuplicateNode}
                />
                <DataToolbarButton
                  icon={<Ban className="h-3.5 w-3.5" />}
                  label={
                    selectedNodeDisabled
                      ? t('data.workflow.enableSelected')
                      : t('data.workflow.disableSelected')
                  }
                  disabled={!selectedNode}
                  onClick={onToggleNodeDisabled}
                />
                <DataToolbarButton
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  label={t('data.workflow.deleteSelected')}
                  disabled={!selectedNode}
                  danger
                  onClick={onDeleteNode}
                />
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setToolbarCollapsed((current) => !current)}
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-muted shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
          title={
            toolbarCollapsed
              ? t('data.workflow.expandCanvasToolbar')
              : t('data.workflow.collapseCanvasToolbar')
          }
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${toolbarCollapsed ? '' : 'rotate-180'}`}
          />
        </button>
      </div>
      <div className="relative min-h-0 flex-1" onDragOver={handleDragOver} onDrop={handleDrop}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={WORKFLOW_NODE_TYPES}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          onReconnectStart={handleReconnectStart}
          onReconnect={handleReconnect}
          onReconnectEnd={handleReconnectEnd}
          onNodeDragStop={handleNodeDragStop}
          onNodeClick={(_, node) => onSelectNode(node.id)}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          nodesDraggable
          edgesReconnectable
          proOptions={{ hideAttribution: true }}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={48}
          reconnectRadius={12}
          isValidConnection={isValidWorkflowConnection}
          defaultEdgeOptions={{
            type: 'smoothstep',
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color: 'var(--workflow-edge)',
            },
            style: {
              stroke: 'var(--workflow-edge)',
              strokeWidth: 1.8,
            },
          }}
          className="workflow-react-flow bg-transparent"
        >
          <Background color="var(--workflow-canvas-dot)" gap={18} size={1.3} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            style={{ width: 100, height: 75 }}
            nodeColor={() => 'var(--workflow-minimap-node)'}
            maskColor="var(--workflow-minimap-mask)"
          />
          <ViewportPortal>
            <WorkflowAlignmentGuidesOverlay guides={alignmentGuides} />
          </ViewportPortal>
        </ReactFlow>
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-text-muted">
            {t('data.workflow.emptyCanvas')}
          </div>
        )}
      </div>
    </section>
  );
}

function WorkflowOperatorNode({ data, selected }: NodeProps<WorkflowFlowNode>) {
  const node = data.workflowNode;
  const catalog = getOperatorCatalog(node.type);
  const Icon = catalog.Icon;
  const disabled = node.config.disabled === true;
  return (
    <div
      data-node-id={node.id}
      style={{ width: WORKFLOW_NODE_WIDTH, height: WORKFLOW_NODE_HEIGHT }}
      className={`workflow-node-drag-handle relative flex items-center gap-2 rounded-lg border bg-[var(--glass-card-strong)] px-2.5 text-left shadow-soft backdrop-blur-xl transition-colors ${
        selected ? 'border-accent text-accent ring-2 ring-accent/15' : catalog.nodeClassName
      } ${disabled ? 'opacity-45 grayscale' : ''}`}
    >
      {node.type === 'join' || node.type === 'set_op' ? (
        <>
          <Handle
            id="left"
            type="target"
            position={Position.Left}
            style={{ top: '35%' }}
            className="workflow-node-handle !left-[-6px] !h-3 !w-3 !rounded-full !border-2 !border-current !bg-background !opacity-100"
          />
          <Handle
            id="right"
            type="target"
            position={Position.Left}
            style={{ top: '65%' }}
            className="workflow-node-handle !left-[-6px] !h-3 !w-3 !rounded-full !border-2 !border-current !bg-background !opacity-100"
          />
        </>
      ) : (
        <Handle
          id="input"
          type="target"
          position={Position.Left}
          className="workflow-node-handle !left-[-6px] !h-3 !w-3 !rounded-full !border-2 !border-current !bg-background !opacity-100"
        />
      )}
      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className="workflow-node-handle !right-[-6px] !h-3 !w-3 !rounded-full !border-2 !border-current !bg-background !opacity-100"
      />
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="min-w-0 truncate text-xs font-medium text-text-secondary">{node.label}</span>
    </div>
  );
}

function WorkflowAlignmentGuidesOverlay({ guides }: { guides: WorkflowAlignmentGuides }) {
  const lines = [guides.horizontal, guides.vertical].filter((line): line is WorkflowAlignmentLine =>
    Boolean(line)
  );
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute left-0 top-0">
      {lines.map((line) =>
        line.orientation === 'vertical' ? (
          <div
            key={line.id}
            className="workflow-alignment-guide absolute border-l border-dashed border-accent/75 shadow-[0_0_0_1px_rgba(25,169,154,0.16)]"
            style={{
              left: line.x,
              top: line.y1,
              height: Math.max(1, line.y2 - line.y1),
            }}
          />
        ) : (
          <div
            key={line.id}
            className="workflow-alignment-guide absolute border-t border-dashed border-accent/75 shadow-[0_0_0_1px_rgba(25,169,154,0.16)]"
            style={{
              left: line.x1,
              top: line.y,
              width: Math.max(1, line.x2 - line.x1),
            }}
          />
        )
      )}
    </div>
  );
}

function WorkflowInspector({
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
}: {
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
}) {
  const { t } = useTranslation();
  const [operatorDsl, setOperatorDsl] = useState('');
  const [operatorDslBeforeEdit, setOperatorDslBeforeEdit] = useState('');
  const [isEditingOperatorDsl, setIsEditingOperatorDsl] = useState(false);
  const [operatorDslDiagnostics, setOperatorDslDiagnostics] = useState<PrepDiagnostic[]>([]);
  const [operatorDslStatus, setOperatorDslStatus] = useState<string | null>(null);
  const [operatorFieldCompletions, setOperatorFieldCompletions] = useState<string[]>([]);
  const [isEditingNodeTitle, setIsEditingNodeTitle] = useState(false);
  const [nodePreviewData, setNodePreviewData] = useState<DataInputTablePreview | null>(null);
  const [nodePreviewLoading, setNodePreviewLoading] = useState(false);
  const [nodePreviewError, setNodePreviewError] = useState<string | null>(null);
  const [nodePreviewPage, setNodePreviewPage] = useState(1);
  const operatorDslNodeKeyRef = useRef('');
  const nodeTitleInputRef = useRef<HTMLInputElement | null>(null);
  const nodePreviewRequestSeq = useRef(0);
  const operatorFieldsRequestSeq = useRef(0);
  const usesOperatorDsl = Boolean(node && node.type !== 'input_source' && node.type !== 'output');
  const operatorFieldSourceNode = useMemo(
    () => getWorkflowFieldSourceNode(node, workflowNodes, workflowEdges),
    [node, workflowEdges, workflowNodes]
  );
  const operatorRightSourceNode = useMemo(
    () => getWorkflowRightSourceNode(node, workflowNodes, workflowEdges),
    [node, workflowEdges, workflowNodes]
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
    setOperatorFieldCompletions([]);

    if (!node || !usesOperatorDsl || !operatorFieldSourceNode) return;
    if (!window.electronAPI?.data?.getWorkflowNodeColumns) return;

    void window.electronAPI.data
      .getWorkflowNodeColumns({
        taskId: operatorFieldSourceNode.taskId,
        nodeId: operatorFieldSourceNode.id,
        nodeType: operatorFieldSourceNode.type,
        nodeConfig: operatorFieldSourceNode.config,
      })
      .then((columns) => {
        if (requestSeq === operatorFieldsRequestSeq.current) {
          setOperatorFieldCompletions(columns);
        }
      })
      .catch(() => {
        if (requestSeq === operatorFieldsRequestSeq.current) {
          setOperatorFieldCompletions([]);
        }
      });
  }, [node, operatorFieldSourceNode, usesOperatorDsl]);

  useEffect(() => {
    if (!operatorDslStatus) return undefined;
    const timeoutId = window.setTimeout(() => setOperatorDslStatus(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [operatorDslStatus]);

  useEffect(() => {
    setIsEditingNodeTitle(false);
    setNodePreviewPage(1);
    setNodePreviewData(null);
    setNodePreviewError(null);
  }, [node?.id]);

  useEffect(() => {
    if (activeTab !== 'data' || !node) return;
    if (!window.electronAPI?.data?.previewWorkflowNode) {
      setNodePreviewData(null);
      setNodePreviewError(t('data.workflow.nodeDataUnavailable'));
      return;
    }
    const requestSeq = nodePreviewRequestSeq.current + 1;
    nodePreviewRequestSeq.current = requestSeq;
    setNodePreviewLoading(true);
    setNodePreviewError(null);
    void window.electronAPI.data
      .previewWorkflowNode({
        taskId: node.taskId,
        nodeId: node.id,
        nodeType: node.type,
        nodeConfig: node.config,
        limit: INPUT_TABLE_PREVIEW_PAGE_SIZE,
        offset: (nodePreviewPage - 1) * INPUT_TABLE_PREVIEW_PAGE_SIZE,
      })
      .then((preview) => {
        if (requestSeq === nodePreviewRequestSeq.current) {
          setNodePreviewData(preview);
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
  }, [activeTab, node, nodeDataRefreshVersion, nodePreviewPage, t]);

  useEffect(() => {
    if (!isEditingNodeTitle) return;
    nodeTitleInputRef.current?.focus();
    nodeTitleInputRef.current?.select();
  }, [isEditingNodeTitle]);

  const handleOperatorDslChange = useCallback((value: string) => {
    setOperatorDsl(value);
    setOperatorDslStatus(null);
  }, []);

  const handleStartOperatorDslEdit = useCallback(() => {
    if (!node || !usesOperatorDsl) return;
    flushSync(() => {
      setOperatorDslBeforeEdit(operatorDsl);
      setOperatorDslStatus(null);
      setOperatorDslDiagnostics([]);
      setIsEditingOperatorDsl(true);
      onActiveTabChange('config');
    });
  }, [node, onActiveTabChange, operatorDsl, usesOperatorDsl]);

  const handleCancelOperatorDslEdit = useCallback(() => {
    if (!node || !usesOperatorDsl) return;
    const nextDsl = operatorDslBeforeEdit || exportPrepOperatorDsl(node);
    setOperatorDsl(nextDsl);
    setOperatorDslStatus(null);
    setOperatorDslDiagnostics([]);
    setIsEditingOperatorDsl(false);
  }, [node, operatorDslBeforeEdit, usesOperatorDsl]);

  const handleFormatOperatorDsl = useCallback(() => {
    if (!node || !usesOperatorDsl || !isEditingOperatorDsl) return;
    const result = parsePrepOperatorDsl(operatorDsl, node.type);
    setOperatorDslDiagnostics(result.diagnostics);
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    if (!result.operator || errors.length > 0) {
      setOperatorDslStatus(null);
      return;
    }
    setOperatorDsl(
      exportPrepOperatorDsl({ id: node.id, type: node.type, config: result.operator.config })
    );
    setOperatorDslStatus(null);
  }, [isEditingOperatorDsl, node, operatorDsl, usesOperatorDsl]);

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
      <aside className="glass-card min-h-0 overflow-y-auto rounded-xl p-3 text-xs text-text-muted">
        {t('data.workflow.noNodeSelected')}
      </aside>
    );
  }

  const catalog = getOperatorCatalog(node.type);
  const Icon = catalog.Icon;
  const summary = getWorkflowConfigSummary(node, t);
  const dslSummaryLabel = t('data.workflow.summaryLabels.dsl');
  const configInfoRows = [...summary.primary, ...summary.details].filter(
    (row) => row.label !== dslSummaryLabel
  );

  return (
    <aside className="glass-card flex min-h-0 flex-col overflow-hidden rounded-xl">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-muted px-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 pr-2">
          <span
            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${catalog.colorClassName}`}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="flex min-w-0 items-center gap-1.5">
            {isEditingNodeTitle ? (
              <span className="flex h-7 min-w-0 max-w-[16rem] items-center rounded-lg border border-accent/40 bg-background/48 px-2 shadow-soft ring-2 ring-accent/15">
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
              className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-accent/10 hover:text-accent"
              title={t('common.edit')}
            >
              <PencilLine className="h-3.5 w-3.5" />
              <span className="sr-only">{t('common.edit')}</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-surface-active p-0.5 text-xs font-medium">
            <button
              onClick={() => onActiveTabChange('config')}
              className={`h-7 rounded-md px-3 ${
                activeTab === 'config'
                  ? 'bg-background text-accent shadow-soft'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t('data.workflow.config')}
            </button>
            <button
              onClick={() => onActiveTabChange('data')}
              className={`h-7 rounded-md px-3 ${
                activeTab === 'data'
                  ? 'bg-background text-accent shadow-soft'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t('data.workflow.data')}
            </button>
            <button
              onClick={() => onActiveTabChange('logs')}
              className={`h-7 rounded-md px-3 ${
                activeTab === 'logs'
                  ? 'bg-background text-accent shadow-soft'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t('data.workflow.logs')}
            </button>
          </div>
          <X className="h-4 w-4 text-text-muted" />
        </div>
      </div>
      <div
        className={`min-h-0 flex-1 overflow-hidden ${
          activeTab === 'config' && usesOperatorDsl ? 'p-0' : 'p-2.5'
        }`}
      >
        {activeTab === 'logs' ? (
          <div className="h-full min-h-0 rounded-lg border border-border-muted bg-background/34 p-2.5 text-xs text-text-muted">
            {t('data.workflow.noLogs')}
          </div>
        ) : activeTab === 'data' ? (
          <WorkflowNodeDataPreview
            preview={nodePreviewData}
            isLoading={nodePreviewLoading}
            error={nodePreviewError}
            currentPage={nodePreviewPage}
            onPageChange={setNodePreviewPage}
          />
        ) : usesOperatorDsl ? (
          <WorkflowOperatorConfigPanel
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
            summaryRows={configInfoRows}
            summaryTitle={t('data.workflow.summary')}
            summaryEmptyText={t('data.workflow.noConfig')}
            operatorDsl={operatorDsl}
            operatorDslStatus={operatorDslStatus}
            operatorDslDiagnostics={operatorDslDiagnostics}
            isEditingOperatorDsl={isEditingOperatorDsl}
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
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-3 sm:grid-cols-2">
              {node.type === 'input_source' ? (
                <WorkflowInputSourceConfig
                  node={node}
                  inputTables={inputTables}
                  isLoading={isInputTablesLoading}
                  onNodeChange={onNodeChange}
                />
              ) : node.type === 'output' ? (
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
      </div>
    </aside>
  );
}

function WorkflowNodeDataPreview({
  preview,
  isLoading,
  error,
  currentPage,
  onPageChange,
}: {
  preview: DataInputTablePreview | null;
  isLoading: boolean;
  error: string | null;
  currentPage: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <GlassDataGridPreview
      preview={preview}
      isLoading={isLoading}
      error={error}
      currentPage={currentPage}
      onPageChange={onPageChange}
      labels={{
        loading: t('data.workflow.nodeDataLoading'),
        empty: t('data.workflow.nodeDataEmpty'),
        total: (count) => t('data.workflow.nodeDataTotal', { count }),
        pageSize: (count) => t('data.workflow.nodeDataPageSize', { count }),
      }}
      rowHeight={32}
      headerHeight={34}
    />
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

function WorkflowInputSourceConfig({
  node,
  inputTables,
  isLoading,
  onNodeChange,
}: {
  node: DataWorkflowNode;
  inputTables: DataDataset[];
  isLoading: boolean;
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
}) {
  const { t } = useTranslation();
  const selectedInputTableId = stringValue(node.config.datasetId);
  const selectedInputTableName =
    stringValue(node.config.inputTableName) || stringValue(node.config.name);
  const hasSelectedInputTableInChoices = inputTables.some(
    (inputTable) => inputTable.id === selectedInputTableId
  );

  const handleInputTableChange = useCallback(
    (inputTableId: string) => {
      const selectedInputTable = inputTables.find((inputTable) => inputTable.id === inputTableId);
      onNodeChange((current) => {
        const nextConfig: Record<string, unknown> = { ...current.config };
        if (selectedInputTable) {
          nextConfig.source = 'dataset';
          nextConfig.datasetId = selectedInputTable.id;
          nextConfig.inputTableName = selectedInputTable.name;
          nextConfig.name = selectedInputTable.name;
        } else {
          delete nextConfig.source;
          delete nextConfig.datasetId;
          delete nextConfig.inputTableName;
          delete nextConfig.name;
        }
        delete nextConfig.filePath;
        delete nextConfig.sheet;
        delete nextConfig.encoding;
        return {
          ...current,
          config: nextConfig,
          updatedAt: Date.now(),
        };
      });
    },
    [inputTables, onNodeChange]
  );

  return (
    <label className="block sm:col-span-2">
      <span className="mb-1.5 block text-xs font-medium text-text-secondary">
        {t('data.workflow.inputTable')}
      </span>
      <GlassSelect
        value={selectedInputTableId || undefined}
        onValueChange={handleInputTableChange}
        options={[
          ...(selectedInputTableId && !hasSelectedInputTableInChoices
            ? [
                {
                  value: selectedInputTableId,
                  label: selectedInputTableName || selectedInputTableId,
                },
              ]
            : []),
          ...inputTables.map((inputTable) => ({ value: inputTable.id, label: inputTable.name })),
        ]}
        placeholder={
          isLoading
            ? t('data.workflow.loadingInputTables')
            : t('data.workflow.noAvailableInputTables')
        }
        disabled={isLoading || (!selectedInputTableId && inputTables.length === 0)}
        triggerClassName="h-8 w-full justify-between rounded-lg bg-surface px-2 text-xs font-medium text-text-secondary"
        contentClassName="w-[var(--radix-select-trigger-width)]"
      />
    </label>
  );
}

function WorkflowOutputConfig({
  node,
  outputTables,
  onNodeChange,
}: {
  node: DataWorkflowNode;
  outputTables: DataOutputTable[];
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
}) {
  const { t } = useTranslation();
  const selectedOutputDatasetId =
    stringValue(node.config.outputDatasetId) || stringValue(node.config.outputTableId);
  const configuredStrategy = stringValue(node.config.outputStrategy);
  const strategy =
    configuredStrategy === 'auto' || configuredStrategy === 'existing'
      ? configuredStrategy
      : selectedOutputDatasetId
        ? 'existing'
        : 'auto';
  const autoOutputTableName =
    stringValue(node.config.outputTableName) || stringValue(node.config.table);
  const availableOutputTables = outputTables.filter(
    (outputTable) =>
      outputTable.relatedTaskNames.length === 0 || outputTable.id === selectedOutputDatasetId
  );

  const updateOutputConfig = useCallback(
    (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      onNodeChange((current) => ({
        ...current,
        config: updater(current.config),
        updatedAt: Date.now(),
      }));
    },
    [onNodeChange]
  );

  const handleStrategyChange = useCallback(
    (nextStrategy: string) => {
      updateOutputConfig((config) => {
        const nextConfig: Record<string, unknown> = {
          ...config,
          outputStrategy: nextStrategy,
          destination: 'duckdb_table',
          mode: stringValue(config.mode, 'replace'),
        };
        if (nextStrategy === 'auto') {
          delete nextConfig.outputDatasetId;
          delete nextConfig.outputTableId;
          delete nextConfig.table;
          return nextConfig;
        }

        const selected =
          availableOutputTables.find((outputTable) => outputTable.id === selectedOutputDatasetId) ??
          availableOutputTables[0];
        if (selected) {
          nextConfig.outputDatasetId = selected.id;
          nextConfig.table = selected.tableName;
        } else {
          delete nextConfig.outputDatasetId;
          delete nextConfig.outputTableId;
        }
        return nextConfig;
      });
    },
    [availableOutputTables, selectedOutputDatasetId, updateOutputConfig]
  );

  const handleAutoTableNameChange = useCallback(
    (tableName: string) => {
      updateOutputConfig((config) => {
        const nextConfig: Record<string, unknown> = {
          ...config,
          outputStrategy: 'auto',
          destination: 'duckdb_table',
          mode: stringValue(config.mode, 'replace'),
          outputTableName: tableName,
        };
        delete nextConfig.outputDatasetId;
        delete nextConfig.outputTableId;
        delete nextConfig.table;
        return nextConfig;
      });
    },
    [updateOutputConfig]
  );

  const handleOutputTableChange = useCallback(
    (outputDatasetId: string) => {
      updateOutputConfig((config) => {
        const selectedOutputTable = outputTables.find(
          (outputTable) => outputTable.id === outputDatasetId
        );
        const nextConfig: Record<string, unknown> = {
          ...config,
          outputStrategy: 'existing',
          destination: 'duckdb_table',
          mode: stringValue(config.mode, 'replace'),
        };
        if (selectedOutputTable) {
          nextConfig.outputDatasetId = selectedOutputTable.id;
          nextConfig.table = selectedOutputTable.tableName;
          nextConfig.outputTableName = selectedOutputTable.name;
        } else {
          delete nextConfig.outputDatasetId;
          delete nextConfig.outputTableId;
        }
        return nextConfig;
      });
    },
    [outputTables, updateOutputConfig]
  );

  return (
    <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-text-secondary">
          {t('data.workflow.outputStrategy')}
        </span>
        <GlassSelect
          value={strategy}
          onValueChange={handleStrategyChange}
          options={[
            { value: 'auto', label: t('data.workflow.values.outputStrategies.auto') },
            { value: 'existing', label: t('data.workflow.values.outputStrategies.existing') },
          ]}
          triggerClassName="h-8 w-full justify-between rounded-lg bg-surface px-2 text-xs font-medium text-text-secondary"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
      </label>

      {strategy === 'auto' ? (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-text-secondary">
            {t('data.workflow.outputTableName')}
          </span>
          <input
            value={autoOutputTableName}
            onChange={(event) => handleAutoTableNameChange(event.target.value)}
            placeholder={t('data.workflow.autoOutputTable')}
            className="h-8 w-full rounded-lg border border-border-muted bg-surface px-2 text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
      ) : (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-text-secondary">
            {t('data.workflow.outputTable')}
          </span>
          <GlassSelect
            value={selectedOutputDatasetId || undefined}
            onValueChange={handleOutputTableChange}
            options={[
              ...(selectedOutputDatasetId &&
              !availableOutputTables.some(
                (outputTable) => outputTable.id === selectedOutputDatasetId
              )
                ? [{ value: selectedOutputDatasetId, label: selectedOutputDatasetId }]
                : []),
              ...availableOutputTables.map((outputTable) => ({
                value: outputTable.id,
                label: outputTable.name,
              })),
            ]}
            placeholder={t('data.workflow.noAvailableOutputTables')}
            disabled={!selectedOutputDatasetId && availableOutputTables.length === 0}
            triggerClassName="h-8 w-full justify-between rounded-lg bg-surface px-2 text-xs font-medium text-text-secondary"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        </label>
      )}
    </div>
  );
}

interface WorkflowSummaryRow {
  label: string;
  value: string;
  mono?: boolean;
}

function WorkflowSummaryPanel({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: WorkflowSummaryRow[];
  emptyText: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 text-[13px] font-medium text-text-secondary">{title}</div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-border-muted text-xs">
        {rows.length > 0 ? (
          rows.map((row) => (
            <div
              key={`${row.label}-${row.value}`}
              className="grid grid-cols-[5.5rem_minmax(0,1fr)] border-b border-border-muted last:border-b-0"
            >
              <div className="bg-background/72 px-2 py-1.5 text-text-muted">{row.label}</div>
              <div
                className={`min-w-0 break-words px-2 py-1.5 text-text-secondary ${
                  row.mono ? 'font-mono text-[10.5px]' : ''
                }`}
              >
                {row.value}
              </div>
            </div>
          ))
        ) : (
          <div className="px-2 py-2 text-text-muted">{emptyText}</div>
        )}
      </div>
    </div>
  );
}

function getOperatorCatalog(type: DataWorkflowOperatorType) {
  return OPERATOR_CATALOG.find((operator) => operator.type === type) ?? OPERATOR_CATALOG[0];
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

function isWorkflowOperatorType(value: string): value is DataWorkflowOperatorType {
  return OPERATOR_CATALOG.some((operator) => operator.type === value);
}

function formatPrepDiagnosticForUi(
  diagnostic: PrepDiagnostic,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (!diagnostic.code) {
    return diagnostic.message;
  }
  return t(`data.workflow.dslDiagnostics.${diagnostic.code}`, {
    defaultValue: diagnostic.message,
    ...(diagnostic.params ?? {}),
  });
}

function getNextWorkflowNodePosition(index: number): { x: number; y: number } {
  return {
    x: 64 + (index % 4) * 150,
    y: 72 + Math.floor(index / 4) * 64,
  };
}

function getWorkflowAlignmentSnap(
  nodeId: string,
  position: { x: number; y: number },
  nodes: WorkflowFlowNode[]
): { position: { x: number; y: number }; guides: WorkflowAlignmentGuides } {
  const otherNodes = nodes.filter((node) => node.id !== nodeId);
  if (otherNodes.length === 0) {
    return { position, guides: EMPTY_WORKFLOW_ALIGNMENT_GUIDES };
  }

  let verticalMatch: {
    distance: number;
    x: number;
    snappedX: number;
    node: WorkflowFlowNode;
  } | null = null;
  let horizontalMatch: {
    distance: number;
    y: number;
    snappedY: number;
    node: WorkflowFlowNode;
  } | null = null;
  const activeLeft = position.x;
  const activeRight = position.x + WORKFLOW_NODE_WIDTH;
  const activeCenterY = position.y + WORKFLOW_NODE_HEIGHT / 2;

  for (const node of otherNodes) {
    const otherLeft = node.position.x;
    const otherRight = node.position.x + WORKFLOW_NODE_WIDTH;
    const otherCenterY = node.position.y + WORKFLOW_NODE_HEIGHT / 2;
    const leftDistance = Math.abs(activeLeft - otherLeft);
    const rightDistance = Math.abs(activeRight - otherRight);
    const centerYDistance = Math.abs(activeCenterY - otherCenterY);

    if (
      leftDistance <= WORKFLOW_ALIGNMENT_THRESHOLD &&
      (!verticalMatch || leftDistance < verticalMatch.distance)
    ) {
      verticalMatch = {
        distance: leftDistance,
        x: otherLeft,
        snappedX: otherLeft,
        node,
      };
    }
    if (
      rightDistance <= WORKFLOW_ALIGNMENT_THRESHOLD &&
      (!verticalMatch || rightDistance < verticalMatch.distance)
    ) {
      verticalMatch = {
        distance: rightDistance,
        x: otherRight,
        snappedX: otherRight - WORKFLOW_NODE_WIDTH,
        node,
      };
    }
    if (
      centerYDistance <= WORKFLOW_ALIGNMENT_THRESHOLD &&
      (!horizontalMatch || centerYDistance < horizontalMatch.distance)
    ) {
      horizontalMatch = {
        distance: centerYDistance,
        y: otherCenterY,
        snappedY: otherCenterY - WORKFLOW_NODE_HEIGHT / 2,
        node,
      };
    }
  }

  const snappedPosition = {
    x: verticalMatch ? verticalMatch.snappedX : position.x,
    y: horizontalMatch ? horizontalMatch.snappedY : position.y,
  };
  const guides: WorkflowAlignmentGuides = {
    horizontal: horizontalMatch
      ? {
          id: `horizontal-${horizontalMatch.node.id}`,
          orientation: 'horizontal',
          x1:
            Math.min(snappedPosition.x, horizontalMatch.node.position.x) -
            WORKFLOW_ALIGNMENT_GUIDE_PADDING,
          x2:
            Math.max(
              snappedPosition.x + WORKFLOW_NODE_WIDTH,
              horizontalMatch.node.position.x + WORKFLOW_NODE_WIDTH
            ) + WORKFLOW_ALIGNMENT_GUIDE_PADDING,
          y: horizontalMatch.y,
        }
      : null,
    vertical: verticalMatch
      ? {
          id: `vertical-${verticalMatch.node.id}`,
          orientation: 'vertical',
          x: verticalMatch.x,
          y1:
            Math.min(snappedPosition.y, verticalMatch.node.position.y) -
            WORKFLOW_ALIGNMENT_GUIDE_PADDING,
          y2:
            Math.max(
              snappedPosition.y + WORKFLOW_NODE_HEIGHT,
              verticalMatch.node.position.y + WORKFLOW_NODE_HEIGHT
            ) + WORKFLOW_ALIGNMENT_GUIDE_PADDING,
        }
      : null,
  };

  return { position: snappedPosition, guides };
}

function getElementFromConnectEndEvent(event: MouseEvent | TouchEvent): Element | null {
  if ('changedTouches' in event && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0];
    return document.elementFromPoint(touch.clientX, touch.clientY);
  }
  return event.target instanceof Element ? event.target : null;
}

function getWorkflowConnectionDropTarget(
  event: MouseEvent | TouchEvent,
  connectionState: FinalConnectionState
): { nodeId: string; handleId: string } | null {
  if (connectionState.toNode?.id && connectionState.toHandle?.id) {
    return {
      nodeId: connectionState.toNode.id,
      handleId: connectionState.toHandle.id,
    };
  }
  const targetElement = getElementFromConnectEndEvent(event);
  const handleElement = targetElement?.closest<HTMLElement>('[data-handleid]');
  const nodeElement = handleElement?.closest<HTMLElement>('[data-node-id]');
  const nodeId = nodeElement?.dataset.nodeId;
  const handleId = handleElement?.dataset.handleid;
  if (!nodeId || !handleId) {
    return null;
  }
  return { nodeId, handleId };
}

interface WorkflowConfigSummary {
  primary: WorkflowSummaryRow[];
  details: WorkflowSummaryRow[];
}

function getWorkflowConfigSummary(node: DataWorkflowNode, t: TranslateFn): WorkflowConfigSummary {
  const config = node.config;
  let summary: WorkflowConfigSummary;

  switch (node.type) {
    case 'input_source': {
      const inputTableName =
        stringValue(config.inputTableName) ||
        stringValue(config.name) ||
        stringValue(config.datasetId);
      summary = {
        primary: [summaryRow(t, 'inputTable', inputTableName, true)],
        details: [],
      };
      break;
    }
    case 'field_select':
      summary = {
        primary: [
          summaryRow(t, 'mode', translateWorkflowValue(t, 'selectModes', 'include')),
          summaryRow(t, 'columns', formatCount(stringArray(config.columns).length)),
        ],
        details: [summaryRow(t, 'fields', formatList(stringArray(config.columns), t), true)],
      };
      break;
    case 'field_mapping':
      summary = {
        primary: [
          summaryRow(t, 'mappings', formatCount(recordArray(config.mappings).length)),
          summaryRow(t, 'mode', translateWorkflowValue(t, 'mappingModes', getMappingMode(config))),
        ],
        details: [summaryRow(t, 'fields', formatMappings(config.mappings, t), true)],
      };
      break;
    case 'filter':
      summary = {
        primary: [summaryRow(t, 'condition', stringValue(config.condition), true)],
        details: [],
      };
      break;
    case 'deduplicate':
      summary = {
        primary: [
          summaryRow(
            t,
            'strategy',
            translateWorkflowValue(
              t,
              'deduplicateStrategies',
              stringValue(config.strategy, 'all_columns')
            )
          ),
          summaryRow(
            t,
            'keep',
            translateWorkflowValue(t, 'keepRules', stringValue(config.keep, 'first'))
          ),
        ],
        details: [
          summaryRow(t, 'columns', formatList(stringArray(config.columns), t), true),
          summaryRow(t, 'orderBy', formatSortKeys(config.orderBy, t), true),
        ],
      };
      break;
    case 'missing_value':
      summary = {
        primary: [
          summaryRow(
            t,
            'strategy',
            translateWorkflowValue(
              t,
              'missingStrategies',
              stringValue(config.strategy, 'by_column')
            )
          ),
          summaryRow(t, 'rules', formatCount(recordArray(config.rules).length)),
        ],
        details: [
          summaryRow(t, 'condition', stringValue(config.condition)),
          summaryRow(t, 'rules', formatMissingRules(config.rules, t), true),
        ],
      };
      break;
    case 'type_convert':
      summary = {
        primary: [
          summaryRow(t, 'conversions', formatCount(recordArray(config.conversions).length)),
        ],
        details: [summaryRow(t, 'fields', formatConversions(config.conversions, t), true)],
      };
      break;
    case 'sort':
      summary = {
        primary: [summaryRow(t, 'sortKeys', formatCount(recordArray(config.keys).length))],
        details: [summaryRow(t, 'orderBy', formatSortKeys(config.keys, t), true)],
      };
      break;
    case 'calculate_field':
      summary = {
        primary: [
          summaryRow(t, 'calculations', formatCount(recordArray(config.calculations).length)),
        ],
        details: [summaryRow(t, 'expression', formatCalculations(config.calculations, t), true)],
      };
      break;
    case 'aggregate':
      summary = {
        primary: [
          summaryRow(t, 'groupBy', formatList(stringArray(config.groupBy), t), true),
          summaryRow(t, 'metrics', formatCount(recordArray(config.metrics).length)),
        ],
        details: [summaryRow(t, 'metrics', formatMetrics(config.metrics, t), true)],
      };
      break;
    case 'join':
      summary = getJoinConfigSummary(config, t);
      break;
    case 'limit':
      summary = {
        primary: [
          summaryRow(t, 'mode', stringValue(config.mode, 'limit')),
          summaryRow(t, 'limit', String(config.limit ?? '')),
        ],
        details: [summaryRow(t, 'orderBy', formatSortKeys(config.orderBy, t), true)],
      };
      break;
    case 'pivot':
      summary = {
        primary: [
          summaryRow(t, 'columns', formatList(stringArray(config.on), t), true),
          summaryRow(t, 'metrics', formatCount(recordArray(config.using).length)),
        ],
        details: [summaryRow(t, 'groupBy', formatList(stringArray(config.groupBy), t), true)],
      };
      break;
    case 'unpivot':
      summary = {
        primary: [
          summaryRow(t, 'columns', formatList(stringArray(config.columns), t), true),
          summaryRow(t, 'mode', stringValue(config.mode, 'include')),
        ],
        details: [
          summaryRow(t, 'name', stringValue(config.nameColumn)),
          summaryRow(t, 'value', stringValue(config.valueColumn)),
        ],
      };
      break;
    case 'set_op': {
      const rawOperation = stringValue(config.operation, 'union');
      const opValue = t(`data.workflow.summaryLabels.operation_${rawOperation}`);
      summary = {
        primary: [
          summaryRow(t, 'operation', opValue || rawOperation),
          summaryRow(t, 'rightInput', stringValue(config.rightInput)),
        ],
        details: [
          summaryRow(t, 'mode', stringValue(config.mode, 'distinct')),
          summaryRow(t, 'match', stringValue(config.match, 'by_position')),
        ],
      };
      break;
    }
    case 'unnest':
      summary = {
        primary: [
          summaryRow(t, 'source', stringValue(config.column), false),
          summaryRow(t, 'alias', stringValue(config.alias, 'item'), false),
        ],
        details: [summaryRow(t, 'mode', stringValue(config.sourceKind, 'list'))],
      };
      break;
    case 'output': {
      const configuredStrategy = stringValue(config.outputStrategy);
      const outputStrategy =
        configuredStrategy === 'auto' || configuredStrategy === 'existing'
          ? configuredStrategy
          : stringValue(config.outputDatasetId) || stringValue(config.outputTableId)
            ? 'existing'
            : 'auto';
      const outputDisplayName = stringValue(config.outputTableName) || stringValue(config.table);
      summary = {
        primary: [
          summaryRow(
            t,
            'outputStrategy',
            translateWorkflowValue(t, 'outputStrategies', outputStrategy)
          ),
          summaryRow(
            t,
            'destination',
            translateWorkflowValue(
              t,
              'destinations',
              stringValue(config.destination, 'duckdb_table')
            )
          ),
          summaryRow(t, 'outputTable', outputDisplayName, true),
        ],
        details: [],
      };
      break;
    }
    default:
      summary = { primary: [], details: [] };
  }

  const dsl = stringValue(config.dsl);
  return dsl
    ? {
        ...summary,
        details: [...summary.details, summaryRow(t, 'dsl', dsl, true)],
      }
    : summary;
}

function getJoinConfigSummary(
  config: Record<string, unknown>,
  t: TranslateFn
): WorkflowConfigSummary {
  const joinType = stringValue(config.joinType, 'left');
  const asof = recordValue(config.asof);
  const primary = [
    summaryRow(t, 'joinType', translateWorkflowValue(t, 'joinTypes', joinType)),
    summaryRow(t, 'rightInput', stringValue(config.rightInput)),
  ];
  const details = [
    summaryRow(
      t,
      'conditions',
      joinType === 'asof' ? formatAsof(asof, t) : formatConditions(config.conditions, t),
      true
    ),
    summaryRow(t, 'by', formatConditions(asof?.by, t), true),
    summaryRow(t, 'direction', stringValue(asof?.direction)),
    summaryRow(t, 'tolerance', stringValue(asof?.tolerance)),
    summaryRow(t, 'keep', formatJoinKeep(config.keep, t), true),
    summaryRow(t, 'conflict', formatConflict(config.conflict, t)),
  ];
  return { primary, details };
}

function summaryRow(
  t: TranslateFn,
  label: string,
  value: string,
  mono = false
): WorkflowSummaryRow {
  return {
    label: t(`data.workflow.summaryLabels.${label}`),
    value: value || t('data.workflow.values.notSet'),
    mono,
  };
}

function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cloneWorkflowNodeConfig(config: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(config);
  } catch {
    return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      )
    : [];
}

function formatCount(value: number): string {
  return String(value);
}

function formatList(values: string[], t: TranslateFn, limit = 6): string {
  if (values.length === 0) return t('data.workflow.values.notSet');
  const head = values.slice(0, limit).join(', ');
  const remaining = values.length - limit;
  return remaining > 0 ? `${head}, ${t('data.workflow.values.more', { count: remaining })}` : head;
}

function translateWorkflowValue(
  t: TranslateFn,
  group: string,
  value: string,
  fallback?: string
): string {
  if (!value) return t('data.workflow.values.notSet');
  return t(`data.workflow.values.${group}.${value}`, { defaultValue: fallback ?? value });
}

function getMappingMode(config: Record<string, unknown>): string {
  const dsl = stringValue(config.dsl);
  return dsl.startsWith('rename ') ? 'rename' : 'map';
}

function formatMappings(value: unknown, t: TranslateFn): string {
  const mappings = recordArray(value).map(
    (item) => `${stringValue(item.source, '?')} -> ${stringValue(item.target, '?')}`
  );
  return formatList(mappings, t);
}

function formatMissingRules(value: unknown, t: TranslateFn): string {
  const rules = recordArray(value).map((rule) => {
    const method = stringValue(rule.method, 'skip');
    const methodLabel = t(`data.workflow.ruleMethods.${method}`, { defaultValue: method });
    const values = Array.isArray(rule.values)
      ? ` (${rule.values.map((item) => String(item)).join(', ')})`
      : '';
    const fillValue = rule.value === undefined ? '' : ` = ${String(rule.value)}`;
    return `${stringValue(rule.column, '?')}: ${methodLabel}${values}${fillValue}`;
  });
  return formatList(rules, t);
}

function formatConversions(value: unknown, t: TranslateFn): string {
  const conversions = recordArray(value).map((item) => {
    const onError = stringValue(item.onError);
    const suffix = onError ? ` (${onError})` : '';
    return `${stringValue(item.column, '?')} -> ${dataFieldTypeLabel(
      stringValue(item.type, 'text')
    )}${suffix}`;
  });
  return formatList(conversions, t);
}

function formatSortKeys(value: unknown, t: TranslateFn): string {
  const keys = recordArray(value).map((item) => {
    const nulls = stringValue(item.nulls);
    return `${stringValue(item.field, '?')} ${stringValue(item.direction, 'asc')}${
      nulls ? ` nulls ${nulls}` : ''
    }`;
  });
  return formatList(keys, t);
}

function formatCalculations(value: unknown, t: TranslateFn): string {
  const calculations = recordArray(value).map(
    (item) => `${stringValue(item.field, '?')} = ${stringValue(item.expression, '?')}`
  );
  return formatList(calculations, t, 4);
}

function formatMetrics(value: unknown, t: TranslateFn): string {
  const metrics = recordArray(value).map(
    (item) =>
      `${stringValue(item.function, 'count')}(${stringValue(item.expression, '*')}) as ${stringValue(
        item.alias,
        '?'
      )}`
  );
  return formatList(metrics, t, 4);
}

function formatConditions(value: unknown, t: TranslateFn): string {
  const conditions = recordArray(value).map(
    (item) =>
      `${stringValue(item.left, '?')} ${stringValue(item.operator, '=')} ${stringValue(item.right, '?')}`
  );
  return formatList(conditions, t, 4);
}

function formatAsof(asof: Record<string, unknown> | null, t: TranslateFn): string {
  if (!asof) return t('data.workflow.values.notSet');
  return `${stringValue(asof.leftTime, '?')} ${stringValue(asof.operator, '>=')} ${stringValue(
    asof.rightTime,
    '?'
  )}`;
}

function formatJoinKeep(value: unknown, t: TranslateFn): string {
  const keep = recordArray(value).map((item) => {
    if (item.wildcard) {
      return `${stringValue(item.side, '?')} *`;
    }
    const alias = stringValue(item.alias);
    return `${stringValue(item.source, '?')}${alias ? ` as ${alias}` : ''}`;
  });
  return formatList(keep, t, 4);
}

function formatConflict(value: unknown, t: TranslateFn): string {
  const conflict = recordValue(value);
  if (!conflict) return t('data.workflow.values.notSet');
  const strategy = stringValue(conflict.strategy, 'right_prefix');
  if (strategy === 'right_prefix') {
    return `${strategy}: ${stringValue(conflict.rightPrefix, '')}`;
  }
  if (strategy === 'suffix') {
    return `${strategy}: ${stringValue(conflict.leftSuffix, '_left')} / ${stringValue(
      conflict.rightSuffix,
      '_right'
    )}`;
  }
  return strategy;
}

export function TasksPanel({
  tasks,
  totalTasks,
  currentPage,
  searchQuery,
  actionId,
  isLoading,
  isCreateDisabled,
  onCreate,
  onSearchChange,
  onRefresh,
  onPageChange,
  onRun,
  onEdit,
  onDelete,
  onDeleteAll,
}: {
  tasks: DataCleaningTask[];
  totalTasks: number;
  currentPage: number;
  searchQuery: string;
  actionId: string | null;
  isLoading: boolean;
  isCreateDisabled: boolean;
  onCreate: () => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onRun: (task: DataCleaningTask) => void;
  onEdit: (task: DataCleaningTask) => void;
  onDelete: (task: DataCleaningTask) => void;
  onDeleteAll: () => void;
}) {
  const { t } = useTranslation();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedTaskBusy = selectedTask ? actionId === selectedTask.id : false;
  const bulkBusy = actionId === 'delete-all-tasks';

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (selectedTaskId && !tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [isLoading, selectedTaskId, tasks]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="mb-3 flex flex-shrink-0 flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button
            onClick={onCreate}
            disabled={isCreateDisabled || bulkBusy}
            className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('data.newCleaningTask')}
          </button>
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
            disabled={!selectedTask || selectedTaskBusy || bulkBusy}
            onClick={() => {
              if (selectedTask) {
                onRun(selectedTask);
              }
            }}
          />
          <DataToolbarButton
            icon={<PencilLine className="h-3.5 w-3.5" />}
            label={t('data.actions.edit')}
            disabled={!selectedTask || selectedTaskBusy || bulkBusy}
            onClick={() => {
              if (selectedTask) {
                onEdit(selectedTask);
              }
            }}
          />
          <DataToolbarButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={t('data.actions.delete')}
            disabled={!selectedTask || selectedTaskBusy || bulkBusy}
            danger
            onClick={() => {
              if (selectedTask) {
                onDelete(selectedTask);
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
                disabled: totalTasks <= 0 || bulkBusy,
                onClick: onDeleteAll,
              },
            ]}
          />
        </div>
      </div>
      <div className="glass-table flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <TasksTable
            tasks={tasks}
            isLoading={isLoading}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            onEdit={onEdit}
          />
        </div>
        <PaginationFooter
          count={totalTasks}
          currentPage={currentPage}
          onPageChange={onPageChange}
          embedded
        />
      </div>
    </div>
  );
}

function TasksTable({
  tasks,
  isLoading,
  selectedTaskId,
  onSelectTask,
  onEdit,
}: {
  tasks: DataCleaningTask[];
  isLoading: boolean;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onEdit: (task: DataCleaningTask) => void;
}) {
  const { t } = useTranslation();
  const visibleTasks = tasks;

  if (isLoading) {
    return <LoadingState label={t('data.loadingTasks')} />;
  }

  if (visibleTasks.length === 0) {
    return <EmptyState label={t('data.emptyTasks')} />;
  }

  return (
    <div className="min-w-full overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted backdrop-blur-xl">
            <th className="w-[4%] px-4">
              <span className="sr-only">{t('data.tasks.selection')}</span>
            </th>
            <th className="w-[42%] whitespace-nowrap px-2">{t('data.columns.taskName')}</th>
            <th className="w-[16%] whitespace-nowrap px-2">{t('data.columns.status')}</th>
            <th className="w-[12%] whitespace-nowrap px-2">{t('data.columns.nodes')}</th>
            <th className="w-[26%] whitespace-nowrap px-2">
              <span className="inline-flex items-center gap-1">
                {t('data.columns.updatedAt')}
                <ArrowUpDown className="h-3 w-3" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleTasks.map((task, index) => {
            const icon = TASK_ICON_STYLES[index % TASK_ICON_STYLES.length];
            const RowIcon = icon.Icon;
            const selected = task.id === selectedTaskId;
            return (
              <tr
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                onDoubleClick={() => onEdit(task)}
                className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
                  selected
                    ? 'bg-accent/10 ring-1 ring-inset ring-accent/20'
                    : 'hover:bg-surface-hover/35'
                }`}
              >
                <td className="px-4">
                  <input
                    type="radio"
                    name="task-selection"
                    checked={selected}
                    onChange={() => onSelectTask(task.id)}
                    onClick={(event) => event.stopPropagation()}
                    className="h-3.5 w-3.5 accent-accent"
                    aria-label={task.name}
                  />
                </td>
                <td className="px-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${icon.className}`}
                    >
                      <RowIcon className="h-4 w-4" />
                    </div>
                    <div className="flex min-w-0 items-center">
                      <span className="truncate text-[13px] font-medium text-text-secondary">
                        {task.name}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-2">
                  <StatusBadge status={task.status} />
                </td>
                <td className="px-2 text-[13px] font-medium text-text-secondary">
                  {task.nodeCount}
                </td>
                <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                  {formatTimestamp(task.updatedAt, t)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
