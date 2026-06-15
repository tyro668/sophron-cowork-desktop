import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
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
import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  type StringStream,
} from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import '@xyflow/react/dist/style.css';
import { GlassDropdownMenu, GlassMenuItem } from './GlassDropdownMenu';
import { GlassDataGridPreview } from './GlassDataGridPreview';
import { GlassSelect } from './GlassSelect';
import { MessageCard } from './MessageCard';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  Ban,
  BarChart3,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  Code2,
  Columns3,
  Copy,
  Database,
  Droplet,
  Eye,
  FileText,
  Filter,
  Folder,
  GitMerge,
  Info,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  Repeat2,
  RefreshCw,
  Save,
  Search,
  Sigma,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  UploadCloud,
  Workflow,
  Maximize2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type {
  DataCleaningTask,
  DataDashboard,
  DataDataset,
  DataInputTableConfig,
  DataInputTableExcelConfig,
  DataInputTableFolderConfig,
  DataInputTableNormalizerDraftProgressEvent,
  DataInputTableNormalizerArtifactVersion,
  DataInputTableProcessingConfig,
  DataNormalizerLanguage,
  DataInputTablePreview,
  DataInputTableSourceKind,
  DataOutputTable,
  DataNormalizerProjectFile,
  DataRunTaskInput,
  DataTaskStatus,
  DataTaskWorkflow,
  DataWorkflowEdge,
  DataWorkflowNode,
  DataWorkflowOperatorType,
  DataWorkflowSaveInput,
  Message,
} from '../types';
import { PrepDslEditor } from './PrepDslEditor';
import { OperatorFormWrapper } from './workflow-forms/OperatorFormWrapper';
import {
  compilePrepWorkflowToFlow,
  exportPrepOperatorDsl,
  exportPrepWorkflowDsl,
  parsePrepDsl,
  parsePrepOperatorDsl,
  type PrepDiagnostic,
} from '../../shared/prep-dsl';
import { dataFieldTypeLabel } from '../../shared/data-field-types';
import { useAppStore } from '../store';

type DataTab = 'tasks' | 'input_tables' | 'output_tables';
type WorkflowInspectorTab = 'config' | 'data' | 'logs';
type InputTableSourceFilter = 'all' | 'excel' | 'csv' | 'folder';
type InputTableSourceKind = Exclude<InputTableSourceFilter, 'all'> | 'file' | 'draft';

interface InputTableDraft {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

type StoredPreviewTarget =
  | { kind: 'input'; dataset: DataDataset }
  | { kind: 'output'; outputTable: DataOutputTable };

const EMPTY_DASHBOARD: DataDashboard = {
  summary: {
    taskCount: 0,
    workflowNodeCount: 0,
    runningCount: 0,
    todayScheduleCount: 0,
    statusCounts: {
      running: 0,
      completed: 0,
      stopped: 0,
      draft: 0,
      pending: 0,
      failed: 0,
    },
  },
  tasks: [],
  datasets: [],
  outputTables: [],
  totalTasks: 0,
  totalDatasets: 0,
  totalOutputTables: 0,
};

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

const TABLE_PAGE_SIZE = 10;
const INPUT_TABLE_PREVIEW_PAGE_SIZE = 100;
const OUTPUT_TABLE_INPUT_CHOICES_LIMIT = 200;
const DATA_DELETE_BATCH_SIZE = 200;
const WORKFLOW_NODE_WIDTH = 116;
const WORKFLOW_NODE_HEIGHT = 36;
const WORKFLOW_OPERATOR_MIME = 'application/x-sophron-workflow-operator';
const WORKFLOW_ALIGNMENT_THRESHOLD = 6;
const WORKFLOW_ALIGNMENT_GUIDE_PADDING = 32;
const WORKFLOW_OPERATOR_DSL_TOP_MIN_HEIGHT = 160;
const WORKFLOW_OPERATOR_DSL_BOTTOM_MIN_HEIGHT = 96;
const WORKFLOW_OPERATOR_DSL_SPLIT_HANDLE_HEIGHT = 20;
const WORKFLOW_OPERATOR_DSL_TOTAL_MIN_HEIGHT =
  WORKFLOW_OPERATOR_DSL_TOP_MIN_HEIGHT +
  WORKFLOW_OPERATOR_DSL_BOTTOM_MIN_HEIGHT +
  WORKFLOW_OPERATOR_DSL_SPLIT_HANDLE_HEIGHT;
const WORKFLOW_OPERATOR_DSL_DEFAULT_SPLIT_RATIO = 0.68;

const INPUT_TABLE_SOURCE_FILTERS: Array<{
  value: InputTableSourceFilter;
  labelKey: string;
}> = [
  { value: 'all', labelKey: 'data.inputTables.sources.all' },
  { value: 'excel', labelKey: 'data.inputTables.sources.excel' },
  { value: 'csv', labelKey: 'data.inputTables.sources.csv' },
  { value: 'folder', labelKey: 'data.inputTables.sources.folder' },
];

type CodePreviewLanguageKind = 'python' | 'javascript' | 'json' | 'toml' | 'markdown' | 'text';

const CODE_PREVIEW_KEYWORDS: Record<Exclude<CodePreviewLanguageKind, 'text'>, Set<string>> = {
  python: new Set([
    'and',
    'as',
    'async',
    'await',
    'break',
    'class',
    'continue',
    'def',
    'elif',
    'else',
    'except',
    'finally',
    'for',
    'from',
    'if',
    'import',
    'in',
    'is',
    'lambda',
    'not',
    'or',
    'pass',
    'raise',
    'return',
    'try',
    'while',
    'with',
    'yield',
  ]),
  javascript: new Set([
    'async',
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'default',
    'else',
    'export',
    'extends',
    'finally',
    'for',
    'from',
    'function',
    'if',
    'import',
    'let',
    'new',
    'return',
    'switch',
    'throw',
    'try',
    'var',
    'while',
  ]),
  json: new Set(['true', 'false', 'null']),
  toml: new Set(['true', 'false']),
  markdown: new Set([]),
};

const codePreviewHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--code-token-keyword)', fontWeight: '500' },
  { tag: tags.string, color: 'var(--code-token-string)' },
  { tag: tags.number, color: 'var(--code-token-number)' },
  { tag: tags.atom, color: 'var(--code-token-atom)' },
  { tag: tags.propertyName, color: 'var(--code-token-property)' },
  { tag: tags.variableName, color: 'var(--code-token-variable)' },
  { tag: tags.typeName, color: 'var(--code-token-property)', fontWeight: '500' },
  { tag: tags.heading, color: 'var(--code-token-keyword)', fontWeight: '600' },
  { tag: tags.strong, color: 'var(--code-token-variable)', fontWeight: '500' },
  { tag: tags.comment, color: 'var(--code-token-comment)', fontStyle: 'italic' },
]);

const codePreviewTheme = EditorView.theme({
  '&': {
    height: '100%',
    minHeight: '100%',
    backgroundColor: 'var(--code-preview-background)',
    color: 'var(--code-preview-text)',
    fontSize: '11px',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: '1.55',
    overflow: 'auto',
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '0.5rem 1rem 0.75rem 0.25rem',
  },
  '.cm-line': {
    padding: '0 0.125rem',
  },
  '.cm-gutters': {
    borderRight: '1px solid var(--code-preview-gutter-border)',
    backgroundColor: 'var(--code-preview-gutter-background)',
    color: 'var(--code-preview-muted)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '2.75rem',
    padding: '0 0.75rem 0 0.5rem',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--code-preview-selection) !important',
  },
  '.cm-scroller::-webkit-scrollbar': {
    width: '8px',
    height: '8px',
  },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    backgroundColor: 'var(--code-preview-muted)',
    borderRadius: '999px',
  },
  '.cm-scroller::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
});

const codePreviewLanguages = {
  python: createCodePreviewStreamLanguage('python'),
  javascript: createCodePreviewStreamLanguage('javascript'),
  json: createCodePreviewStreamLanguage('json'),
  toml: createCodePreviewStreamLanguage('toml'),
  markdown: createCodePreviewStreamLanguage('markdown'),
};

function createCodePreviewStreamLanguage(kind: Exclude<CodePreviewLanguageKind, 'text'>) {
  return StreamLanguage.define({
    name: kind,
    token(stream) {
      return tokenCodePreviewStream(stream, kind);
    },
  });
}

function tokenCodePreviewStream(
  stream: StringStream,
  kind: Exclude<CodePreviewLanguageKind, 'text'>
): string | null {
  if (stream.eatSpace()) return null;
  if (kind === 'markdown' && stream.sol() && stream.match(/#{1,6}\s.*/)) return 'heading';
  if (kind === 'markdown' && stream.match(/\*\*[^*]+\*\*/)) return 'strong';
  if (kind === 'markdown' && stream.match(/`[^`]+`/)) return 'string';
  if ((kind === 'python' || kind === 'toml') && stream.match(/#.*/)) return 'comment';
  if (kind === 'javascript' && stream.match(/\/\/.*/)) return 'comment';
  if (kind === 'javascript' && stream.match(/\/\*.*?\*\//)) return 'comment';
  if (stream.match(/"(?:[^"\\]|\\.)*"/)) return 'string';
  if ((kind === 'python' || kind === 'javascript') && stream.match(/'(?:[^'\\]|\\.)*'/)) {
    return 'string';
  }
  if (kind === 'javascript' && stream.match(/`(?:[^`\\]|\\.)*`/)) return 'string';
  if (stream.match(/-?(?:0x[\da-f]+|\d+(?:\.\d+)?)(?:e[+-]?\d+)?/i)) return 'number';
  if ((kind === 'json' || kind === 'toml') && stream.match(/[A-Za-z0-9_.-]+(?=\s*=)/)) {
    return 'propertyName';
  }
  if (kind === 'json' && stream.match(/"(?:[^"\\]|\\.)*"(?=\s*:)/)) return 'propertyName';
  if (stream.match(/[A-Za-z_$][\w$]*/)) {
    const token = stream.current();
    if (CODE_PREVIEW_KEYWORDS[kind].has(token)) {
      return token === 'true' || token === 'false' || token === 'null' ? 'atom' : 'keyword';
    }
    if (/^[A-Z][A-Za-z0-9_]*$/.test(token)) return 'typeName';
    return 'variableName';
  }
  stream.next();
  return null;
}

function getCodePreviewLanguage(filePath: string) {
  const normalized = filePath.toLowerCase();
  if (/\.(py|pyw)$/.test(normalized)) return codePreviewLanguages.python;
  if (/\.(js|jsx|mjs|cjs|ts|tsx)$/.test(normalized)) {
    return codePreviewLanguages.javascript;
  }
  if (/\.json$/.test(normalized)) return codePreviewLanguages.json;
  if (/\.(toml|lock)$/.test(normalized)) return codePreviewLanguages.toml;
  if (/\.(md|markdown)$/.test(normalized)) return codePreviewLanguages.markdown;
  return [];
}

type WorkflowFlowNode = Node<{ workflowNode: DataWorkflowNode }, 'operator'>;
type WorkflowFlowEdge = Edge<Record<string, never>>;
type TranslateFn = (key: string, options?: Record<string, unknown>) => string;
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

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function DataView() {
  const { t } = useTranslation();
  const pendingDataNavigation = useAppStore((state) => state.pendingDataNavigation);
  const clearDataNavigation = useAppStore((state) => state.clearDataNavigation);
  const [dashboard, setDashboard] = useState<DataDashboard>(EMPTY_DASHBOARD);
  const [activeTab, setActiveTab] = useState<DataTab>('tasks');
  const [inputTableSourceFilter, setInputTableSourceFilter] =
    useState<InputTableSourceFilter>('all');
  const [inputTableDrafts, setInputTableDrafts] = useState<InputTableDraft[]>([]);
  const [inputTableDatasets, setInputTableDatasets] = useState<DataDataset[]>([]);
  const [totalInputTableDatasets, setTotalInputTableDatasets] = useState(0);
  const [inputTablesLoading, setInputTablesLoading] = useState(false);
  const [editingInputTableDraftId, setEditingInputTableDraftId] = useState<string | null>(null);
  const [editingInputTableDatasetId, setEditingInputTableDatasetId] = useState<string | null>(null);
  const [editingOutputTableId, setEditingOutputTableId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [taskPage, setTaskPage] = useState(1);
  const [datasetPage, setDatasetPage] = useState(1);
  const [outputPage, setOutputPage] = useState(1);
  const [loadingTab, setLoadingTab] = useState<DataTab | null>('tasks');
  const [pendingNavigationTab, setPendingNavigationTab] = useState<DataTab | null>('tasks');
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [outputEditorInputTables, setOutputEditorInputTables] = useState<DataDataset[]>([]);
  const [outputEditorInputTablesLoading, setOutputEditorInputTablesLoading] = useState(false);
  const [storedPreviewOpen, setStoredPreviewOpen] = useState(false);
  const [storedPreviewLoading, setStoredPreviewLoading] = useState(false);
  const [storedPreviewError, setStoredPreviewError] = useState<string | null>(null);
  const [storedPreviewData, setStoredPreviewData] = useState<DataInputTablePreview | null>(null);
  const [storedPreviewPage, setStoredPreviewPage] = useState(1);
  const [storedPreviewTarget, setStoredPreviewTarget] = useState<StoredPreviewTarget | null>(null);
  const [focusedTask, setFocusedTask] = useState<DataCleaningTask | null>(null);
  const [focusedInputTable, setFocusedInputTable] = useState<DataDataset | null>(null);
  const [focusedOutputTable, setFocusedOutputTable] = useState<DataOutputTable | null>(null);
  const dashboardRequestSeq = useRef(0);
  const inputTablesRequestSeq = useRef(0);
  const hasLoadedDashboardSummary = useRef(false);

  const isDataApiAvailable = Boolean(window.electronAPI?.data);

  useEffect(() => {
    if (!pendingDataNavigation || !isDataApiAvailable || !window.electronAPI?.data) {
      return undefined;
    }

    const target = pendingDataNavigation;
    let cancelled = false;

    const run = async () => {
      setError(null);
      setStoredPreviewOpen(false);
      setEditingTaskId(null);
      setEditingInputTableDraftId(null);
      setEditingInputTableDatasetId(null);
      setEditingOutputTableId(null);

      if (target.kind === 'task') {
        setActiveTab('tasks');
        setPendingNavigationTab('tasks');
        setLoadingTab('tasks');
        const task = await window.electronAPI?.data?.getTask(target.id);
        if (cancelled) return;
        if (!task) {
          setError(t('data.navigationNotFound'));
          return;
        }
        setFocusedTask(task);
        setDashboard((current) => ({
          ...current,
          tasks: [task, ...current.tasks.filter((item) => item.id !== task.id)],
          totalTasks: Math.max(current.totalTasks, current.tasks.length + 1),
        }));
        setSearchQuery('');
        setTaskPage(1);
        setEditingTaskId(task.id);
        return;
      }

      if (target.kind === 'input_table') {
        setActiveTab('input_tables');
        setPendingNavigationTab('input_tables');
        setLoadingTab('input_tables');
        setInputTablesLoading(true);
        const inputTable = await window.electronAPI?.data?.getInputTable(target.id);
        if (cancelled) return;
        if (!inputTable) {
          setError(t('data.navigationNotFound'));
          return;
        }
        setFocusedInputTable(inputTable);
        setInputTableSourceFilter('all');
        setInputTableDatasets((current) => [
          inputTable,
          ...current.filter((item) => item.id !== inputTable.id),
        ]);
        setTotalInputTableDatasets((current) => Math.max(current, 1));
        setDatasetPage(1);
        setEditingInputTableDatasetId(inputTable.id);
        return;
      }

      setActiveTab('output_tables');
      setPendingNavigationTab('output_tables');
      setLoadingTab('output_tables');
      const outputTable = await window.electronAPI?.data?.getOutputTable(target.id);
      if (cancelled) return;
      if (!outputTable) {
        setError(t('data.navigationNotFound'));
        return;
      }
      setFocusedOutputTable(outputTable);
      setDashboard((current) => ({
        ...current,
        outputTables: [
          outputTable,
          ...current.outputTables.filter((item) => item.id !== outputTable.id),
        ],
        totalOutputTables: Math.max(current.totalOutputTables, current.outputTables.length + 1),
      }));
      setOutputPage(1);
      setEditingOutputTableId(outputTable.id);
    };

    void run()
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPendingNavigationTab(null);
          setLoadingTab(null);
          setInputTablesLoading(false);
          clearDataNavigation(target.nonce);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clearDataNavigation, isDataApiAvailable, pendingDataNavigation, t]);

  const loadDashboard = useCallback(
    async (
      options: {
        preserveError?: boolean;
        query?: string;
        taskPage?: number;
        datasetPage?: number;
        outputPage?: number;
        tab?: DataTab;
      } = {}
    ) => {
      if (!window.electronAPI?.data) return;
      const requestSeq = dashboardRequestSeq.current + 1;
      dashboardRequestSeq.current = requestSeq;
      const targetTab = options.tab ?? activeTab;
      const requestedTaskPage = Math.max(1, options.taskPage ?? taskPage);
      const requestedOutputPage = Math.max(1, options.outputPage ?? outputPage);
      const shouldLoadTasks = targetTab === 'tasks';
      const shouldLoadOutputTables = targetTab === 'output_tables';
      const shouldLoadSummary = shouldLoadTasks || !hasLoadedDashboardSummary.current;
      setLoadingTab(targetTab);
      if (!options.preserveError) {
        setError(null);
      }
      try {
        const nextDashboard = await window.electronAPI.data.getDashboard({
          query: options.query ?? (shouldLoadTasks || shouldLoadOutputTables ? searchQuery : ''),
          includeSummary: shouldLoadSummary,
          includeTasks: shouldLoadTasks,
          includeDatasets: false,
          includeOutputTables: shouldLoadOutputTables,
          taskOffset: (requestedTaskPage - 1) * TABLE_PAGE_SIZE,
          taskLimit: shouldLoadTasks ? TABLE_PAGE_SIZE : 0,
          datasetOffset: 0,
          datasetLimit: 0,
          outputOffset: (requestedOutputPage - 1) * TABLE_PAGE_SIZE,
          outputLimit: shouldLoadOutputTables ? TABLE_PAGE_SIZE : 0,
          datasetSourceKind: 'all',
        });
        if (requestSeq === dashboardRequestSeq.current) {
          if (shouldLoadSummary) {
            hasLoadedDashboardSummary.current = true;
          }
          setDashboard((current) => ({
            summary: shouldLoadSummary ? nextDashboard.summary : current.summary,
            tasks: shouldLoadTasks ? nextDashboard.tasks : current.tasks,
            outputTables: shouldLoadOutputTables
              ? nextDashboard.outputTables
              : current.outputTables,
            datasets: current.datasets,
            totalTasks:
              shouldLoadTasks || shouldLoadSummary ? nextDashboard.totalTasks : current.totalTasks,
            totalDatasets: current.totalDatasets,
            totalOutputTables: shouldLoadOutputTables
              ? nextDashboard.totalOutputTables
              : current.totalOutputTables,
          }));
        }
      } catch (err) {
        if (requestSeq === dashboardRequestSeq.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (requestSeq === dashboardRequestSeq.current) {
          setPendingNavigationTab((current) => (current === targetTab ? null : current));
          setLoadingTab((current) => (current === targetTab ? null : current));
        }
      }
    },
    [activeTab, outputPage, searchQuery, taskPage]
  );

  const loadInputTables = useCallback(
    async (
      options: {
        preserveError?: boolean;
        page?: number;
        sourceFilter?: InputTableSourceFilter;
        query?: string;
      } = {}
    ) => {
      if (!window.electronAPI?.data) return;
      const requestSeq = inputTablesRequestSeq.current + 1;
      inputTablesRequestSeq.current = requestSeq;
      const requestedPage = Math.max(1, options.page ?? datasetPage);
      const sourceFilter = options.sourceFilter ?? inputTableSourceFilter;
      setInputTablesLoading(true);
      setLoadingTab('input_tables');
      if (!options.preserveError) {
        setError(null);
      }
      try {
        const nextDashboard = await window.electronAPI.data.getDashboard({
          query: options.query ?? searchQuery,
          includeSummary: false,
          includeTasks: false,
          includeDatasets: true,
          includeOutputTables: false,
          taskLimit: 0,
          datasetOffset: (requestedPage - 1) * TABLE_PAGE_SIZE,
          datasetLimit: TABLE_PAGE_SIZE,
          datasetSourceKind: sourceFilter,
          outputLimit: 0,
        });
        if (requestSeq === inputTablesRequestSeq.current) {
          setInputTableDatasets(nextDashboard.datasets);
          setTotalInputTableDatasets(nextDashboard.totalDatasets);
        }
      } catch (err) {
        if (requestSeq === inputTablesRequestSeq.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (requestSeq === inputTablesRequestSeq.current) {
          setPendingNavigationTab((current) => (current === 'input_tables' ? null : current));
          setLoadingTab((current) => (current === 'input_tables' ? null : current));
          setInputTablesLoading(false);
        }
      }
    },
    [datasetPage, inputTableSourceFilter, searchQuery]
  );

  useEffect(() => {
    if (!isDataApiAvailable) {
      setPendingNavigationTab(null);
      setLoadingTab(null);
      return;
    }
    dashboardRequestSeq.current += 1;
    const delay = activeTab === 'tasks' && searchQuery ? 180 : 0;
    let timer: number | null = null;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          if (activeTab === 'input_tables') {
            void loadInputTables();
          } else {
            void loadDashboard({ tab: activeTab });
          }
        }, delay);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [activeTab, isDataApiAvailable, loadDashboard, loadInputTables, searchQuery]);

  useEffect(() => {
    const pageCount = getTablePageCount(dashboard.totalTasks);
    if (taskPage > pageCount) {
      setTaskPage(pageCount);
    }
  }, [dashboard.totalTasks, taskPage]);

  useEffect(() => {
    const draftCount = inputTableSourceFilter === 'all' ? inputTableDrafts.length : 0;
    const pageCount = getTablePageCount(totalInputTableDatasets + draftCount);
    if (datasetPage > pageCount) {
      setDatasetPage(pageCount);
    }
  }, [datasetPage, inputTableDrafts.length, inputTableSourceFilter, totalInputTableDatasets]);

  useEffect(() => {
    const pageCount = getTablePageCount(dashboard.totalOutputTables);
    if (outputPage > pageCount) {
      setOutputPage(pageCount);
    }
  }, [dashboard.totalOutputTables, outputPage]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setLoadingTab(activeTab);
      if (activeTab === 'input_tables') {
        setInputTablesLoading(true);
        setDatasetPage(1);
      } else if (activeTab === 'output_tables') {
        setOutputPage(1);
      } else {
        setTaskPage(1);
      }
      setSearchQuery(value);
    },
    [activeTab]
  );

  const handleInputTableSourceFilterChange = useCallback((value: InputTableSourceFilter) => {
    setLoadingTab('input_tables');
    setInputTablesLoading(true);
    setInputTableSourceFilter(value);
    setDatasetPage(1);
  }, []);

  const handleTabChange = useCallback(
    (tab: DataTab) => {
      if (tab === activeTab) return;
      dashboardRequestSeq.current += 1;
      setPendingNavigationTab(tab);
      setLoadingTab(tab);
      setActiveTab(tab);
      setSearchQuery('');
    },
    [activeTab]
  );

  const handleTaskPageChange = useCallback((page: number) => {
    setLoadingTab('tasks');
    setTaskPage(page);
  }, []);

  const handleDatasetPageChange = useCallback((page: number) => {
    setLoadingTab('input_tables');
    setInputTablesLoading(true);
    setDatasetPage(page);
  }, []);

  const handleOutputPageChange = useCallback((page: number) => {
    setLoadingTab('output_tables');
    setOutputPage(page);
  }, []);

  const summaryCards = useMemo(
    () => [
      {
        key: 'taskCount',
        label: t('data.summary.tasks'),
        description: t('data.summary.tasksDesc'),
        value: dashboard.summary.taskCount,
        Icon: Database,
        iconClassName: 'bg-accent/10 text-accent',
      },
      {
        key: 'workflowNodeCount',
        label: t('data.summary.workflowNodes'),
        description: t('data.summary.workflowNodesDesc'),
        value: dashboard.summary.workflowNodeCount,
        Icon: Workflow,
        iconClassName: 'bg-accent/10 text-accent',
      },
      {
        key: 'runningCount',
        label: t('data.summary.running'),
        description: t('data.summary.runningDesc'),
        value: dashboard.summary.runningCount,
        Icon: CheckCircle2,
        iconClassName: 'bg-surface-active/70 text-text-secondary',
      },
      {
        key: 'todayScheduleCount',
        label: t('data.summary.todaySchedule'),
        description: t('data.summary.todayScheduleDesc'),
        value: dashboard.summary.todayScheduleCount,
        Icon: Clock3,
        iconClassName: 'bg-warning/10 text-warning',
      },
    ],
    [dashboard.summary, t]
  );
  const editingTask = useMemo(
    () =>
      dashboard.tasks.find((task) => task.id === editingTaskId) ??
      (focusedTask?.id === editingTaskId ? focusedTask : null),
    [dashboard.tasks, editingTaskId, focusedTask]
  );
  const editingInputTableDraft = useMemo(
    () => inputTableDrafts.find((draft) => draft.id === editingInputTableDraftId) ?? null,
    [editingInputTableDraftId, inputTableDrafts]
  );
  const editingInputTableDataset = useMemo(
    () =>
      inputTableDatasets.find((dataset) => dataset.id === editingInputTableDatasetId) ??
      (focusedInputTable?.id === editingInputTableDatasetId ? focusedInputTable : null),
    [editingInputTableDatasetId, focusedInputTable, inputTableDatasets]
  );
  const editingOutputTable = useMemo(
    () =>
      dashboard.outputTables.find((outputTable) => outputTable.id === editingOutputTableId) ??
      (focusedOutputTable?.id === editingOutputTableId ? focusedOutputTable : null),
    [dashboard.outputTables, editingOutputTableId, focusedOutputTable]
  );

  useEffect(() => {
    if (!editingOutputTableId || !window.electronAPI?.data?.getDashboard) {
      setOutputEditorInputTables([]);
      setOutputEditorInputTablesLoading(false);
      return undefined;
    }

    let cancelled = false;
    setOutputEditorInputTablesLoading(true);
    void window.electronAPI.data
      .getDashboard({
        includeSummary: false,
        includeTasks: false,
        includeDatasets: true,
        includeOutputTables: false,
        datasetOffset: 0,
        datasetLimit: OUTPUT_TABLE_INPUT_CHOICES_LIMIT,
        datasetSourceKind: 'all',
      })
      .then((nextDashboard) => {
        if (!cancelled) {
          setOutputEditorInputTables(nextDashboard.datasets);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setOutputEditorInputTables([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOutputEditorInputTablesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [editingOutputTableId]);

  const isInputTableEditor = Boolean(editingInputTableDraft || editingInputTableDataset);
  const isTasksLoading =
    loadingTab === 'tasks' || (activeTab === 'tasks' && pendingNavigationTab === 'tasks');
  const isInputTablesLoading =
    inputTablesLoading ||
    loadingTab === 'input_tables' ||
    (activeTab === 'input_tables' && pendingNavigationTab === 'input_tables');
  const isOutputTablesLoading =
    loadingTab === 'output_tables' ||
    (activeTab === 'output_tables' && pendingNavigationTab === 'output_tables');
  const selectOneFile = useCallback(async (): Promise<string | null> => {
    if (!window.electronAPI?.selectFiles) return null;
    const files = await window.electronAPI.selectFiles();
    return files[0] ?? null;
  }, []);

  const handleCreateTask = useCallback(async () => {
    if (!window.electronAPI?.data) return;
    setActionId('create');
    setError(null);
    try {
      setActiveTab('tasks');
      setSearchQuery('');
      setTaskPage(1);
      await window.electronAPI.data.createTask({
        name: `${t('data.defaultTaskName')} ${dashboard.summary.taskCount + 1}`,
      });
      await loadDashboard({ query: '', taskPage: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, query: '' });
    } finally {
      setActionId(null);
    }
  }, [dashboard.summary.taskCount, loadDashboard, t]);

  const handleRunTask = useCallback(
    async (task: DataCleaningTask, payload?: DataRunTaskInput) => {
      if (!window.electronAPI?.data) return;
      setActionId(task.id);
      setError(null);
      try {
        await window.electronAPI.data.runTask(task.id, payload);
        await loadDashboard();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadDashboard]
  );

  const handleCreateInputTableDraft = useCallback(() => {
    const now = Date.now();
    const draft: InputTableDraft = {
      id: makeLocalId('input_table'),
      name: `${t('data.inputTables.defaultName')} ${totalInputTableDatasets + inputTableDrafts.length + 1}`,
      createdAt: now,
      updatedAt: now,
    };
    setInputTableDrafts((current) => [draft, ...current]);
    setInputTableSourceFilter('all');
    setActiveTab('input_tables');
    setSearchQuery('');
    setEditingInputTableDatasetId(null);
    setEditingInputTableDraftId(draft.id);
  }, [inputTableDrafts.length, t, totalInputTableDatasets]);

  const handleRenameInputTableDraft = useCallback((id: string, name: string) => {
    setInputTableDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, name, updatedAt: Date.now() } : draft))
    );
  }, []);

  const handleDeleteInputTableDraft = useCallback((id: string) => {
    setInputTableDrafts((current) => current.filter((draft) => draft.id !== id));
    setEditingInputTableDraftId((current) => (current === id ? null : current));
  }, []);

  const handleImportInputTableSource = useCallback(
    async (
      draft: InputTableDraft,
      sourceKind: DataInputTableSourceKind,
      config: DataInputTableConfig,
      name?: string
    ) => {
      if (!window.electronAPI?.data) return;
      setActionId(draft.id);
      setError(null);
      try {
        const source = window.electronAPI.selectInputTableSource
          ? await window.electronAPI.selectInputTableSource(sourceKind)
          : { path: await selectOneFile(), kind: 'file' as const };
        const sourcePath = source?.path;
        if (!sourcePath) return;
        setActiveTab('input_tables');
        const imported = await window.electronAPI.data.importDataset({
          filePath: sourcePath,
          name: name?.trim() || draft.name,
          sourceKind,
          config,
        });
        setInputTableDrafts((current) => current.filter((item) => item.id !== draft.id));
        setInputTableDatasets((current) => [
          imported,
          ...current.filter((dataset) => dataset.id !== imported.id),
        ]);
        setTotalInputTableDatasets((current) => current + 1);
        setEditingInputTableDraftId(null);
        setEditingInputTableDatasetId(imported.id);
        setDatasetPage(1);
        await loadInputTables({ preserveError: true, page: 1, sourceFilter: 'all' });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadInputTables, selectOneFile]
  );

  const handleEditInputTableDataset = useCallback((id: string) => {
    setActiveTab('input_tables');
    setEditingInputTableDraftId(null);
    setEditingInputTableDatasetId(id);
  }, []);

  const handleRenameInputTableDataset = useCallback(
    async (dataset: DataDataset, name: string) => {
      const trimmedName = name.trim();
      if (
        !trimmedName ||
        trimmedName === dataset.name ||
        !window.electronAPI?.data?.updateDataset
      ) {
        return;
      }
      setActionId(dataset.id);
      setError(null);
      try {
        const updated = await window.electronAPI.data.updateDataset({
          id: dataset.id,
          name: trimmedName,
        });
        setInputTableDatasets((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
        await loadInputTables({ preserveError: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadInputTables]
  );

  const handleUpdateInputTableSource = useCallback(
    async (
      dataset: DataDataset,
      sourceKind: DataInputTableSourceKind,
      config: DataInputTableConfig,
      name?: string
    ) => {
      if (!window.electronAPI?.data?.updateDataset) return;
      setActionId(dataset.id);
      setError(null);
      try {
        const source = window.electronAPI.selectInputTableSource
          ? await window.electronAPI.selectInputTableSource(sourceKind)
          : { path: await selectOneFile(), kind: 'file' as const };
        const sourcePath = source?.path;
        if (!sourcePath) return;
        const updated = await window.electronAPI.data.updateDataset({
          id: dataset.id,
          filePath: sourcePath,
          name: name?.trim() || dataset.name,
          sourceKind,
          config,
        });
        setInputTableDatasets((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
        await loadInputTables({ preserveError: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadInputTables, selectOneFile]
  );

  const handleUpdateInputTableConfig = useCallback(
    async (dataset: DataDataset, config: DataInputTableConfig, name?: string) => {
      if (!window.electronAPI?.data?.updateDataset) return;
      setActionId(dataset.id);
      setError(null);
      try {
        const updated = await window.electronAPI.data.updateDataset({
          id: dataset.id,
          name: name?.trim() || dataset.name,
          sourceKind: config.sourceKind,
          config,
        });
        setInputTableDatasets((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
        await loadInputTables({ preserveError: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadInputTables]
  );

  const handleDeleteTask = useCallback(
    async (task: DataCleaningTask) => {
      if (!window.electronAPI?.data) return;
      const confirmed = window.confirm(t('data.deleteTaskConfirm', { name: task.name }));
      if (!confirmed) return;
      setActionId(task.id);
      setError(null);
      try {
        const result = await window.electronAPI.data.deleteTask(task.id);
        if (!result.success) {
          throw new Error(t('data.deleteTaskNotFound'));
        }
        if (editingTaskId === task.id) {
          setEditingTaskId(null);
        }
        await loadDashboard();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [editingTaskId, loadDashboard, t]
  );

  const handleDeleteAllTasks = useCallback(async () => {
    if (!window.electronAPI?.data) return;
    const count = dashboard.totalTasks;
    if (count <= 0) return;
    const confirmed = window.confirm(t('data.deleteAllTasksConfirm', { count }));
    if (!confirmed) return;
    setActionId('delete-all-tasks');
    setError(null);
    try {
      let hasMoreTasks = true;
      while (hasMoreTasks) {
        const page = await window.electronAPI.data.getDashboard({
          query: searchQuery,
          includeSummary: false,
          includeTasks: true,
          includeDatasets: false,
          includeOutputTables: false,
          taskOffset: 0,
          taskLimit: DATA_DELETE_BATCH_SIZE,
          datasetLimit: 0,
          outputLimit: 0,
        });
        hasMoreTasks = page.tasks.length > 0;
        if (!hasMoreTasks) break;
        for (const task of page.tasks) {
          await window.electronAPI.data.deleteTask(task.id);
        }
      }
      setEditingTaskId(null);
      setTaskPage(1);
      await loadDashboard({ preserveError: true, tab: 'tasks', taskPage: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, tab: 'tasks' });
    } finally {
      setActionId(null);
    }
  }, [dashboard.totalTasks, loadDashboard, searchQuery, t]);

  const handleDeleteInputTable = useCallback(
    async (dataset: DataDataset) => {
      if (!window.electronAPI?.data?.deleteDataset) return;
      const confirmed = window.confirm(t('data.inputTables.deleteConfirm', { name: dataset.name }));
      if (!confirmed) return;
      setActionId(dataset.id);
      setError(null);
      try {
        const result = await window.electronAPI.data.deleteDataset(dataset.id);
        if (!result.success) {
          throw new Error(t('data.inputTables.deleteNotFound'));
        }
        setInputTableDatasets((current) => current.filter((item) => item.id !== dataset.id));
        setTotalInputTableDatasets((current) => Math.max(0, current - 1));
        await loadInputTables({ preserveError: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadInputTables, t]
  );

  const handleDeleteAllInputTables = useCallback(async () => {
    if (!window.electronAPI?.data?.deleteDataset) return;
    const draftIds =
      inputTableSourceFilter === 'all'
        ? inputTableDrafts
            .filter((draft) => matchesSearchText(draft.name, searchQuery))
            .map((draft) => draft.id)
        : [];
    const count = totalInputTableDatasets + draftIds.length;
    if (count <= 0) return;
    const confirmed = window.confirm(t('data.inputTables.deleteAllConfirm', { count }));
    if (!confirmed) return;
    setActionId('delete-all-input-tables');
    setError(null);
    try {
      if (draftIds.length > 0) {
        setInputTableDrafts((current) => current.filter((draft) => !draftIds.includes(draft.id)));
        setEditingInputTableDraftId((current) =>
          current && draftIds.includes(current) ? null : current
        );
      }
      let hasMoreInputTables = true;
      while (hasMoreInputTables) {
        const page = await window.electronAPI.data.getDashboard({
          query: searchQuery,
          includeSummary: false,
          includeTasks: false,
          includeDatasets: true,
          includeOutputTables: false,
          taskLimit: 0,
          datasetOffset: 0,
          datasetLimit: DATA_DELETE_BATCH_SIZE,
          datasetSourceKind: inputTableSourceFilter,
          outputLimit: 0,
        });
        hasMoreInputTables = page.datasets.length > 0;
        if (!hasMoreInputTables) break;
        for (const dataset of page.datasets) {
          await window.electronAPI.data.deleteDataset(dataset.id);
        }
      }
      setEditingInputTableDatasetId(null);
      setDatasetPage(1);
      await loadInputTables({ preserveError: true, page: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadInputTables({ preserveError: true });
    } finally {
      setActionId(null);
    }
  }, [
    inputTableDrafts,
    inputTableSourceFilter,
    loadInputTables,
    searchQuery,
    t,
    totalInputTableDatasets,
  ]);

  const handlePreviewStoredInputTable = useCallback(async (dataset: DataDataset, page = 1) => {
    if (!window.electronAPI?.data?.previewDataset) return;
    setStoredPreviewOpen(true);
    setStoredPreviewTarget({ kind: 'input', dataset });
    setStoredPreviewLoading(true);
    setStoredPreviewError(null);
    setStoredPreviewPage(page);
    try {
      const preview = await window.electronAPI.data.previewDataset({
        id: dataset.id,
        limit: INPUT_TABLE_PREVIEW_PAGE_SIZE,
        offset: (page - 1) * INPUT_TABLE_PREVIEW_PAGE_SIZE,
      });
      setStoredPreviewData(preview);
    } catch (err) {
      setStoredPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setStoredPreviewLoading(false);
    }
  }, []);

  const handlePreviewStoredOutputTable = useCallback(
    async (outputTable: DataOutputTable, page = 1) => {
      if (!window.electronAPI?.data?.previewDataset) return;
      setStoredPreviewOpen(true);
      setStoredPreviewTarget({ kind: 'output', outputTable });
      setStoredPreviewLoading(true);
      setStoredPreviewError(null);
      setStoredPreviewPage(page);
      try {
        const preview = await window.electronAPI.data.previewDataset({
          id: outputTable.id,
          limit: INPUT_TABLE_PREVIEW_PAGE_SIZE,
          offset: (page - 1) * INPUT_TABLE_PREVIEW_PAGE_SIZE,
        });
        setStoredPreviewData(preview);
      } catch (err) {
        setStoredPreviewError(err instanceof Error ? err.message : String(err));
      } finally {
        setStoredPreviewLoading(false);
      }
    },
    []
  );

  const handleCreateOutputTable = useCallback(async () => {
    if (!window.electronAPI?.data?.createOutputTable) return;
    setActionId('create-output');
    setError(null);
    try {
      setActiveTab('output_tables');
      setSearchQuery('');
      setOutputPage(1);
      const outputTable = await window.electronAPI.data.createOutputTable({
        name: `${t('data.outputTables.defaultName')} ${dashboard.totalOutputTables + 1}`,
      });
      setEditingOutputTableId(outputTable.id);
      await loadDashboard({ preserveError: true, tab: 'output_tables', outputPage: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, tab: 'output_tables' });
    } finally {
      setActionId(null);
    }
  }, [dashboard.totalOutputTables, loadDashboard, t]);

  const handleUpdateOutputTable = useCallback(
    async (outputTable: DataOutputTable, name: string, sourceDatasetId: string | null) => {
      const trimmedName = name.trim();
      const nextSourceDatasetId = sourceDatasetId || null;
      if (
        !trimmedName ||
        (trimmedName === outputTable.name && nextSourceDatasetId === outputTable.sourceDatasetId) ||
        !window.electronAPI?.data?.updateOutputTable
      ) {
        return;
      }
      setActionId(outputTable.id);
      setError(null);
      try {
        await window.electronAPI.data.updateOutputTable({
          id: outputTable.id,
          name: trimmedName,
          sourceDatasetId: nextSourceDatasetId,
        });
        await loadDashboard({ preserveError: true, tab: 'output_tables' });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true, tab: 'output_tables' });
      } finally {
        setActionId(null);
      }
    },
    [loadDashboard]
  );

  const handleDeleteOutputTable = useCallback(
    async (outputTable: DataOutputTable) => {
      if (!window.electronAPI?.data?.deleteDataset) return;
      const confirmed = window.confirm(
        t('data.outputTables.deleteConfirm', { name: outputTable.name })
      );
      if (!confirmed) return;
      setActionId(outputTable.id);
      setError(null);
      try {
        const result = await window.electronAPI.data.deleteDataset(outputTable.id);
        if (!result.success) {
          throw new Error(t('data.outputTables.deleteNotFound'));
        }
        if (editingOutputTableId === outputTable.id) {
          setEditingOutputTableId(null);
        }
        await loadDashboard({ preserveError: true, tab: 'output_tables' });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true, tab: 'output_tables' });
      } finally {
        setActionId(null);
      }
    },
    [editingOutputTableId, loadDashboard, t]
  );

  const handleDeleteAllOutputTables = useCallback(async () => {
    if (!window.electronAPI?.data?.deleteDataset) return;
    const count = dashboard.totalOutputTables;
    if (count <= 0) return;
    const confirmed = window.confirm(t('data.outputTables.deleteAllConfirm', { count }));
    if (!confirmed) return;
    setActionId('delete-all-output-tables');
    setError(null);
    try {
      let hasMoreOutputTables = true;
      while (hasMoreOutputTables) {
        const page = await window.electronAPI.data.getDashboard({
          query: searchQuery,
          includeSummary: false,
          includeTasks: false,
          includeDatasets: false,
          includeOutputTables: true,
          taskLimit: 0,
          datasetLimit: 0,
          outputOffset: 0,
          outputLimit: DATA_DELETE_BATCH_SIZE,
        });
        hasMoreOutputTables = page.outputTables.length > 0;
        if (!hasMoreOutputTables) break;
        for (const outputTable of page.outputTables) {
          await window.electronAPI.data.deleteDataset(outputTable.id);
        }
      }
      setEditingOutputTableId(null);
      setOutputPage(1);
      await loadDashboard({
        preserveError: true,
        tab: 'output_tables',
        outputPage: 1,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, tab: 'output_tables' });
    } finally {
      setActionId(null);
    }
  }, [dashboard.totalOutputTables, loadDashboard, searchQuery, t]);

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-transparent">
      <div
        className={`mx-auto w-full px-3 py-3 sm:px-4 ${
          isInputTableEditor ? 'max-w-[1500px]' : 'max-w-[1120px]'
        } flex h-full min-h-0 flex-col`}
      >
        {error && (
          <div className="mb-4 flex shrink-0 items-start gap-2 rounded-lg border border-error/20 bg-error/10 px-3.5 py-2.5 text-[13px] text-error">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {editingTask ? (
          <TaskEditor
            task={editingTask}
            outputTables={dashboard.outputTables}
            actionId={actionId}
            onBack={() => setEditingTaskId(null)}
            onRun={handleRunTask}
            onWorkflowSaved={() => loadDashboard({ preserveError: true })}
          />
        ) : editingInputTableDraft ? (
          <InputTableEditor
            draft={editingInputTableDraft}
            isBusy={actionId === editingInputTableDraft.id}
            onBack={() => setEditingInputTableDraftId(null)}
            onRenameDraft={handleRenameInputTableDraft}
            onChooseDraftSource={handleImportInputTableSource}
          />
        ) : editingInputTableDataset ? (
          <InputTableEditor
            dataset={editingInputTableDataset}
            isBusy={actionId === editingInputTableDataset.id}
            onBack={() => setEditingInputTableDatasetId(null)}
            onRenameDataset={handleRenameInputTableDataset}
            onChooseDatasetSource={handleUpdateInputTableSource}
            onUpdateDatasetConfig={handleUpdateInputTableConfig}
          />
        ) : editingOutputTable ? (
          <OutputTableEditor
            outputTable={editingOutputTable}
            inputTables={outputEditorInputTables}
            isInputTablesLoading={outputEditorInputTablesLoading}
            isBusy={actionId === editingOutputTable.id}
            onBack={() => setEditingOutputTableId(null)}
            onSave={handleUpdateOutputTable}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <section className="grid flex-shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summaryCards.map(({ key, label, description, value, Icon, iconClassName }) => (
                <StatCard
                  key={key}
                  label={label}
                  description={description}
                  value={value}
                  Icon={Icon}
                  iconClassName={iconClassName}
                />
              ))}
            </section>

            <section className="mt-3 flex min-h-0 flex-1 flex-col">
              <div className="mb-2 flex min-h-10 flex-shrink-0 flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex items-end gap-5">
                  <TabButton
                    active={activeTab === 'tasks'}
                    onClick={() => handleTabChange('tasks')}
                    label={t('data.tabs.tasks')}
                  />
                  <TabButton
                    active={activeTab === 'input_tables'}
                    onClick={() => handleTabChange('input_tables')}
                    label={t('data.tabs.inputTables')}
                  />
                  <TabButton
                    active={activeTab === 'output_tables'}
                    onClick={() => handleTabChange('output_tables')}
                    label={t('data.tabs.outputTables')}
                  />
                </div>
              </div>

              {activeTab === 'tasks' ? (
                <TasksPanel
                  tasks={dashboard.tasks}
                  totalTasks={dashboard.totalTasks}
                  currentPage={taskPage}
                  searchQuery={searchQuery}
                  actionId={actionId}
                  isLoading={isTasksLoading}
                  isCreateDisabled={!isDataApiAvailable || actionId === 'create'}
                  onCreate={handleCreateTask}
                  onSearchChange={handleSearchChange}
                  onRefresh={() => loadDashboard({ preserveError: true, tab: 'tasks' })}
                  onPageChange={handleTaskPageChange}
                  onRun={handleRunTask}
                  onEdit={(task) => setEditingTaskId(task.id)}
                  onDelete={handleDeleteTask}
                  onDeleteAll={handleDeleteAllTasks}
                />
              ) : (
                <div className="min-h-0 flex-1 bg-transparent">
                  {activeTab === 'input_tables' ? (
                    <InputTablesPanel
                      datasets={inputTableDatasets}
                      drafts={inputTableDrafts}
                      totalDatasets={totalInputTableDatasets}
                      currentPage={datasetPage}
                      searchQuery={searchQuery}
                      isLoading={isInputTablesLoading}
                      sourceFilter={inputTableSourceFilter}
                      onSearchChange={handleSearchChange}
                      onSourceFilterChange={handleInputTableSourceFilterChange}
                      onPageChange={handleDatasetPageChange}
                      onCreate={handleCreateInputTableDraft}
                      onRefresh={() => loadInputTables({ preserveError: true })}
                      onPreviewDataset={handlePreviewStoredInputTable}
                      onDelete={handleDeleteInputTable}
                      onDeleteAll={handleDeleteAllInputTables}
                      onDeleteDraft={handleDeleteInputTableDraft}
                      onEditDraft={setEditingInputTableDraftId}
                      onEditDataset={handleEditInputTableDataset}
                      isCreateDisabled={!isDataApiAvailable}
                      actionId={actionId}
                    />
                  ) : (
                    <OutputTablesPanel
                      outputTables={dashboard.outputTables}
                      totalOutputTables={dashboard.totalOutputTables}
                      currentPage={outputPage}
                      searchQuery={searchQuery}
                      isLoading={isOutputTablesLoading}
                      actionId={actionId}
                      isCreateDisabled={!isDataApiAvailable || actionId === 'create-output'}
                      onCreate={handleCreateOutputTable}
                      onSearchChange={handleSearchChange}
                      onRefresh={() => loadDashboard({ preserveError: true, tab: 'output_tables' })}
                      onPageChange={handleOutputPageChange}
                      onPreview={handlePreviewStoredOutputTable}
                      onEdit={(outputTable) => setEditingOutputTableId(outputTable.id)}
                      onDelete={handleDeleteOutputTable}
                      onDeleteAll={handleDeleteAllOutputTables}
                    />
                  )}
                </div>
              )}
            </section>
            {storedPreviewOpen && (
              <InputTablePreviewDialog
                tableKind={storedPreviewTarget?.kind ?? 'input'}
                preview={storedPreviewData}
                isLoading={storedPreviewLoading}
                error={storedPreviewError}
                currentPage={storedPreviewPage}
                onPageChange={(page) => {
                  if (storedPreviewTarget?.kind === 'input') {
                    void handlePreviewStoredInputTable(storedPreviewTarget.dataset, page);
                  } else if (storedPreviewTarget?.kind === 'output') {
                    void handlePreviewStoredOutputTable(storedPreviewTarget.outputTable, page);
                  }
                }}
                onClose={() => setStoredPreviewOpen(false)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskEditor({
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

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    const confirmed = window.confirm(
      t('data.workflow.deleteOperatorConfirm', { name: selectedNode.label })
    );
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
  }, [selectedNode, t]);

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
      setActiveInspectorTab('data');
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
          <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(26rem,36vh)] gap-3">
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
      {node.type === 'join' ? (
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
  const [isConfigInfoOpen, setIsConfigInfoOpen] = useState(false);
  const [operatorDslSplitRatio, setOperatorDslSplitRatio] = useState(
    WORKFLOW_OPERATOR_DSL_DEFAULT_SPLIT_RATIO
  );
  const [operatorDslPaneHeight, setOperatorDslPaneHeight] = useState(0);
  const [isOperatorDslSplitDragging, setIsOperatorDslSplitDragging] = useState(false);
  const [nodePreviewData, setNodePreviewData] = useState<DataInputTablePreview | null>(null);
  const [nodePreviewLoading, setNodePreviewLoading] = useState(false);
  const [nodePreviewError, setNodePreviewError] = useState<string | null>(null);
  const [nodePreviewPage, setNodePreviewPage] = useState(1);
  const operatorDslNodeKeyRef = useRef('');
  const operatorDslSplitRatioRef = useRef(operatorDslSplitRatio);
  const operatorDslPaneRef = useRef<HTMLDivElement | null>(null);
  const operatorDslSplitDragCleanupRef = useRef<(() => void) | null>(null);
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
    operatorDslSplitRatioRef.current = operatorDslSplitRatio;
  }, [operatorDslSplitRatio]);

  useEffect(() => {
    const nextNodeKey = node && usesOperatorDsl ? `${node.id}:${node.type}` : '';
    if (operatorDslNodeKeyRef.current === nextNodeKey) return;
    operatorDslNodeKeyRef.current = nextNodeKey;
    if (!node || !usesOperatorDsl) {
      setOperatorDsl('');
      setOperatorDslBeforeEdit('');
      setIsEditingOperatorDsl(false);
      setOperatorFieldCompletions([]);
      setOperatorDslDiagnostics([]);
      setOperatorDslStatus(null);
      setIsConfigInfoOpen(false);
      return;
    }
    const nextDsl = exportPrepOperatorDsl(node);
    setOperatorDsl(nextDsl);
    setOperatorDslBeforeEdit(nextDsl);
    setIsEditingOperatorDsl(false);
    setOperatorFieldCompletions([]);
    setOperatorDslDiagnostics([]);
    setOperatorDslStatus(null);
    setIsConfigInfoOpen(false);
  }, [node, node?.id, node?.type, usesOperatorDsl]);

  useEffect(() => {
    if (!node || !usesOperatorDsl || isEditingOperatorDsl) return;
    const nextDsl = exportPrepOperatorDsl(node);
    setOperatorDsl(nextDsl);
    setOperatorDslBeforeEdit(nextDsl);
    setOperatorDslDiagnostics([]);
    setOperatorDslStatus(null);
  }, [isEditingOperatorDsl, node, node?.config, node?.label, usesOperatorDsl]);

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
    operatorDslSplitDragCleanupRef.current?.();
    setIsOperatorDslSplitDragging(false);
  }, [node?.id]);

  useEffect(() => {
    const element = operatorDslPaneRef.current;
    if (!element || activeTab !== 'config' || !usesOperatorDsl) {
      setOperatorDslPaneHeight(0);
      return undefined;
    }

    const updatePaneHeight = () => {
      setOperatorDslPaneHeight(element.getBoundingClientRect().height);
    };

    updatePaneHeight();

    const observer = new ResizeObserver(updatePaneHeight);
    observer.observe(element);

    return () => observer.disconnect();
  }, [activeTab, usesOperatorDsl, node?.id]);

  useEffect(
    () => () => {
      operatorDslSplitDragCleanupRef.current?.();
    },
    []
  );

  useEffect(() => {
    if (activeTab !== 'config' || !usesOperatorDsl) {
      operatorDslSplitDragCleanupRef.current?.();
    }
  }, [activeTab, usesOperatorDsl]);

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
    });
  }, [node, operatorDsl, usesOperatorDsl]);

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

  const operatorDslSplitLayout = useMemo(() => {
    const availableHeight = Math.max(
      0,
      operatorDslPaneHeight - WORKFLOW_OPERATOR_DSL_SPLIT_HANDLE_HEIGHT
    );
    const maxTopHeight = Math.max(
      WORKFLOW_OPERATOR_DSL_TOP_MIN_HEIGHT,
      availableHeight - WORKFLOW_OPERATOR_DSL_BOTTOM_MIN_HEIGHT
    );
    const minTopHeight = Math.min(WORKFLOW_OPERATOR_DSL_TOP_MIN_HEIGHT, maxTopHeight);
    const desiredTopHeight = availableHeight * operatorDslSplitRatio;
    const topHeight = clampNumber(desiredTopHeight, minTopHeight, maxTopHeight);
    const bottomHeight = Math.max(
      WORKFLOW_OPERATOR_DSL_BOTTOM_MIN_HEIGHT,
      availableHeight - topHeight
    );
    return {
      topHeight,
      bottomHeight,
      canDrag:
        availableHeight >
        WORKFLOW_OPERATOR_DSL_TOP_MIN_HEIGHT + WORKFLOW_OPERATOR_DSL_BOTTOM_MIN_HEIGHT,
    };
  }, [operatorDslPaneHeight, operatorDslSplitRatio]);

  const handleOperatorDslSplitPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !usesOperatorDsl || activeTab !== 'config') return;

      const pane = operatorDslPaneRef.current;
      if (!pane) return;

      const paneRect = pane.getBoundingClientRect();
      const availableHeight = Math.max(
        0,
        paneRect.height - WORKFLOW_OPERATOR_DSL_SPLIT_HANDLE_HEIGHT
      );
      if (
        availableHeight <=
        WORKFLOW_OPERATOR_DSL_TOP_MIN_HEIGHT + WORKFLOW_OPERATOR_DSL_BOTTOM_MIN_HEIGHT
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const maxTopHeight = Math.max(
        WORKFLOW_OPERATOR_DSL_TOP_MIN_HEIGHT,
        availableHeight - WORKFLOW_OPERATOR_DSL_BOTTOM_MIN_HEIGHT
      );
      const minTopHeight = Math.min(WORKFLOW_OPERATOR_DSL_TOP_MIN_HEIGHT, maxTopHeight);

      const updateRatio = (clientY: number) => {
        const nextTopHeight = clampNumber(clientY - paneRect.top, minTopHeight, maxTopHeight);
        const nextRatio = availableHeight > 0 ? nextTopHeight / availableHeight : 0;
        operatorDslSplitRatioRef.current = nextRatio;
        setOperatorDslSplitRatio(nextRatio);
      };

      updateRatio(event.clientY);
      setIsOperatorDslSplitDragging(true);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        updateRatio(moveEvent.clientY);
      };

      const handlePointerUp = () => {
        setIsOperatorDslSplitDragging(false);
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerUp);
        operatorDslSplitDragCleanupRef.current = null;
      };

      operatorDslSplitDragCleanupRef.current = handlePointerUp;
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      document.addEventListener('pointercancel', handlePointerUp);
    },
    [activeTab, usesOperatorDsl]
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
  const configInfoRows = [...summary.primary, ...summary.details].filter(
    (row) => row.label !== t('data.workflow.summaryLabels.dsl')
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
          <>
            <div
              ref={operatorDslPaneRef}
              className={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden ${
                isOperatorDslSplitDragging ? 'select-none' : ''
              }`}
              style={{ minHeight: `${WORKFLOW_OPERATOR_DSL_TOTAL_MIN_HEIGHT}px` }}
            >
              <button
                type="button"
                onClick={() => setIsConfigInfoOpen((current) => !current)}
                className={`absolute right-0 top-0 z-20 inline-flex h-8 items-center gap-1.5 rounded-none border px-3 text-[11px] font-medium transition-colors ${
                  isConfigInfoOpen
                    ? 'border-accent/30 bg-accent/10 text-accent'
                    : 'border-border-muted bg-background/82 text-text-secondary hover:border-accent/30 hover:bg-accent/10 hover:text-accent'
                }`}
                title={t('data.workflow.summary', 'Config summary')}
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${isConfigInfoOpen ? 'rotate-180' : ''}`}
                />
                {t('data.workflow.summary', 'Config summary')}
              </button>
              {isConfigInfoOpen && (
                <section className="absolute right-0 top-8 z-20 w-60 overflow-hidden rounded-none border border-border-muted bg-[var(--glass-card-strong)] p-2.5 shadow-elevated backdrop-blur-xl">
                  <div className="mb-2 flex h-6 items-center justify-between gap-2">
                    <h3 className="text-[12px] font-medium text-text-secondary">
                      {t('data.workflow.summary', 'Config summary')}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setIsConfigInfoOpen(false)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-accent/10 hover:text-accent"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="max-h-[14rem] overflow-y-auto rounded-lg border border-border-muted text-[11px]">
                    {configInfoRows.length > 0 ? (
                      configInfoRows.map((row) => (
                        <div
                          key={`${row.label}-${row.value}`}
                          className="grid grid-cols-[4.5rem_minmax(0,1fr)] border-b border-border-muted last:border-b-0"
                        >
                          <div className="bg-background/72 px-2 py-1.5 text-text-muted">
                            {row.label}
                          </div>
                          <div className="min-w-0 break-words px-2 py-1.5 text-text-secondary">
                            {row.value}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="px-2 py-2 text-text-muted">{t('data.workflow.noConfig')}</div>
                    )}
                  </div>
                </section>
              )}
              <div
                className="min-h-0 overflow-y-auto px-1.5 pt-1.5"
                style={{ height: operatorDslSplitLayout.topHeight }}
              >
                <OperatorFormWrapper
                  key={`${node.id}-form`}
                  node={node}
                  taskId={node.taskId}
                  fieldCompletions={operatorFieldCompletions}
                  otherNodes={workflowNodes}
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
                  upstreamRowCount={nodePreviewData?.totalRows}
                  onNodeChange={onNodeChange}
                />
              </div>
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={t('data.workflow.resizeOperatorDslSplit', 'Drag to resize')}
                onPointerDown={handleOperatorDslSplitPointerDown}
                className={`group relative flex h-5 items-center justify-center ${
                  operatorDslSplitLayout.canDrag ? 'cursor-ns-resize' : 'cursor-default'
                } ${isOperatorDslSplitDragging ? 'text-accent' : 'text-border-muted'}`}
                style={{ touchAction: 'none', userSelect: 'none' }}
              >
                <div
                  className={`pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-colors ${
                    isOperatorDslSplitDragging
                      ? 'bg-accent/60'
                      : 'bg-border-muted/70 group-hover:bg-accent/35'
                  }`}
                />
                <div className="pointer-events-none absolute inset-x-0 flex items-center justify-center">
                  <span className="relative block h-4 w-5">
                    <span
                      className={`absolute left-1/2 top-0 -translate-x-1/2 border-l-[8px] border-r-[8px] border-b-[6px] border-l-transparent border-r-transparent transition-colors ${
                        isOperatorDslSplitDragging
                          ? 'border-b-accent'
                          : 'border-b-border-muted/80 group-hover:border-b-accent/70'
                      }`}
                    />
                    <span
                      className={`absolute left-1/2 bottom-0 -translate-x-1/2 border-l-[8px] border-r-[8px] border-t-[6px] border-l-transparent border-r-transparent transition-colors ${
                        isOperatorDslSplitDragging
                          ? 'border-t-accent'
                          : 'border-t-border-muted/80 group-hover:border-t-accent/70'
                      }`}
                    />
                  </span>
                </div>
              </div>
              <section
                className="min-h-0 px-1.5 pb-1 pt-1"
                style={{ height: operatorDslSplitLayout.bottomHeight }}
              >
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex h-7 shrink-0 items-center justify-between gap-2 px-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-[13px] font-medium text-text-secondary">DSL</span>
                      {operatorDslStatus && (
                        <div className="flex h-6 min-w-0 items-center rounded-full border border-success/20 bg-success/5 px-2 text-[11px] text-success">
                          <CheckCircle2 className="mr-1 h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{operatorDslStatus}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard?.writeText(operatorDsl)}
                        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-background/50 px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {t('data.workflow.copyDsl', 'Copy DSL')}
                      </button>
                      <button
                        type="button"
                        onClick={handleStartOperatorDslEdit}
                        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-background/50 px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                        {t('common.expand', 'Expand')}
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 min-h-0 flex-1 overflow-hidden rounded-[14px] border border-border-muted/80 bg-[var(--glass-card-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_1px_0_rgba(15,23,42,0.03)]">
                    <PrepDslEditor
                      value={operatorDsl}
                      operatorType={node.type}
                      placeholderText={t('data.workflow.operatorDslPlaceholder')}
                      completionLabels={editorCompletionLabels}
                      formatDiagnostic={formatEditorDiagnostic}
                      onChange={handleOperatorDslChange}
                      onDiagnosticsChange={setOperatorDslDiagnostics}
                      onRequestEdit={handleStartOperatorDslEdit}
                      fieldCompletions={operatorFieldCompletions}
                      editable={false}
                      height="100%"
                    />
                  </div>
                </div>
              </section>
            </div>
            {isEditingOperatorDsl && (
              <WorkflowOperatorDslDialog
                nodeLabel={node.label || t(catalog.labelKey)}
                operatorType={node.type}
                operatorDsl={operatorDsl}
                operatorDslStatus={operatorDslStatus}
                operatorDslDiagnostics={operatorDslDiagnostics}
                editorCompletionLabels={editorCompletionLabels}
                fieldCompletions={operatorFieldCompletions}
                formatEditorDiagnostic={formatEditorDiagnostic}
                isRunningOperatorDsl={isRunningOperatorDsl}
                onChange={handleOperatorDslChange}
                onDiagnosticsChange={setOperatorDslDiagnostics}
                onClose={handleCancelOperatorDslEdit}
                onCopy={() => void navigator.clipboard?.writeText(operatorDsl)}
                onFormat={handleFormatOperatorDsl}
                onApply={() => void handleApplyOperatorDsl()}
              />
            )}
          </>
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
  const preferredHandle = node.type === 'join' ? 'left' : 'input';
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
  if (!node || node.type !== 'join') return null;
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

function makeLocalId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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
          summaryRow(
            t,
            'mode',
            translateWorkflowValue(t, 'selectModes', stringValue(config.mode, 'include'))
          ),
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
    summaryRow(t, 'cardinality', stringValue(config.cardinality)),
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

function StatCard({
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

function TabButton({
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

function TasksPanel({
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

function InputTablesPanel({
  datasets,
  drafts,
  totalDatasets,
  currentPage,
  searchQuery,
  isLoading,
  sourceFilter,
  onSearchChange,
  onSourceFilterChange,
  onPageChange,
  onCreate,
  onRefresh,
  onPreviewDataset,
  onDelete,
  onDeleteAll,
  onDeleteDraft,
  onEditDraft,
  onEditDataset,
  isCreateDisabled,
  actionId,
}: {
  datasets: DataDataset[];
  drafts: InputTableDraft[];
  totalDatasets: number;
  currentPage: number;
  searchQuery: string;
  isLoading: boolean;
  sourceFilter: InputTableSourceFilter;
  onSearchChange: (value: string) => void;
  onSourceFilterChange: (source: InputTableSourceFilter) => void;
  onPageChange: (page: number) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onPreviewDataset: (dataset: DataDataset) => void;
  onDelete: (dataset: DataDataset) => void;
  onDeleteAll: () => void;
  onDeleteDraft: (id: string) => void;
  onEditDraft: (id: string) => void;
  onEditDataset: (id: string) => void;
  isCreateDisabled: boolean;
  actionId: string | null;
}) {
  const { t } = useTranslation();
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const filteredDrafts = useMemo(
    () =>
      sourceFilter === 'all'
        ? drafts.filter((draft) => matchesSearchText(draft.name, searchQuery))
        : [],
    [drafts, searchQuery, sourceFilter]
  );
  const draftCount = filteredDrafts.length;
  const totalRows = totalDatasets + draftCount;
  const pageCount = getTablePageCount(totalRows);
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);
  const pageNumbers = getVisiblePageNumbers(safeCurrentPage, pageCount);
  const draftStart = (safeCurrentPage - 1) * TABLE_PAGE_SIZE;
  const pageDrafts = useMemo(
    () =>
      !isLoading && sourceFilter === 'all'
        ? filteredDrafts.slice(draftStart, draftStart + TABLE_PAGE_SIZE)
        : [],
    [draftStart, filteredDrafts, isLoading, sourceFilter]
  );
  const visibleRows = useMemo(
    () =>
      isLoading
        ? []
        : [
            ...pageDrafts.map((draft) => ({ kind: 'draft' as const, id: draft.id, draft })),
            ...datasets.map((dataset) => ({ kind: 'dataset' as const, id: dataset.id, dataset })),
          ],
    [datasets, isLoading, pageDrafts]
  );
  const pageRows = visibleRows;
  const emptyLabel =
    sourceFilter === 'all' ? t('data.inputTables.empty') : t('data.inputTables.emptyFiltered');
  const selectedRow = visibleRows.find((row) => row.id === selectedDatasetId) ?? null;
  const selectedDataset = selectedRow?.kind === 'dataset' ? selectedRow.dataset : null;
  const selectedDraft = selectedRow?.kind === 'draft' ? selectedRow.draft : null;
  const selectedRowBusy = selectedRow ? actionId === selectedRow.id : false;
  const bulkBusy = actionId === 'delete-all-input-tables';

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (selectedDatasetId && !visibleRows.some((row) => row.id === selectedDatasetId)) {
      setSelectedDatasetId(null);
    }
  }, [isLoading, selectedDatasetId, visibleRows]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="mb-3 flex flex-shrink-0 flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button
            onClick={onCreate}
            disabled={isCreateDisabled || bulkBusy}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('data.inputTables.add')}
          </button>
          <DataTableSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={t('data.inputTables.searchPlaceholder')}
          />
          <label className="block w-32">
            <span className="sr-only">{t('data.inputTables.sourceFilter')}</span>
            <GlassSelect
              value={sourceFilter}
              onValueChange={(value) => onSourceFilterChange(value as InputTableSourceFilter)}
              options={INPUT_TABLE_SOURCE_FILTERS.map((option) => ({
                value: option.value,
                label: t(option.labelKey),
              }))}
              disabled={bulkBusy}
              triggerClassName="h-8 w-full justify-between rounded-lg bg-surface pl-3 text-xs font-medium text-text-secondary hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:opacity-45"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <DataToolbarButton
            icon={<Eye className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.preview')}
            disabled={!selectedDataset || bulkBusy}
            onClick={() => {
              if (selectedDataset) {
                onPreviewDataset(selectedDataset);
              }
            }}
          />
          <DataToolbarButton
            icon={<PencilLine className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.edit')}
            disabled={!selectedRow || bulkBusy}
            onClick={() => {
              if (selectedDraft) {
                onEditDraft(selectedDraft.id);
              } else if (selectedDataset) {
                onEditDataset(selectedDataset.id);
              }
            }}
          />
          <DataToolbarButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.delete')}
            disabled={!selectedRow || selectedRowBusy || bulkBusy}
            danger
            onClick={() => {
              if (selectedDraft) {
                onDeleteDraft(selectedDraft.id);
              } else if (selectedDataset) {
                onDelete(selectedDataset);
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
                disabled: totalRows <= 0 || bulkBusy,
                onClick: onDeleteAll,
              },
            ]}
          />
        </div>
      </div>

      <div className="glass-table flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <LoadingState label={t('data.inputTables.loading')} />
          ) : visibleRows.length === 0 ? (
            <EmptyState label={emptyLabel} />
          ) : (
            <>
              <div className="min-w-full overflow-x-auto">
                <table className="w-full table-fixed border-collapse text-left">
                  <thead>
                    <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted backdrop-blur-xl">
                      <th className="w-[4%] px-4">
                        <span className="sr-only">{t('data.inputTables.selection')}</span>
                      </th>
                      <th className="w-[22%] whitespace-nowrap px-2">
                        {t('data.columns.inputTableName')}
                      </th>
                      <th className="w-[9%] whitespace-nowrap px-2">
                        {t('data.columns.sourceType')}
                      </th>
                      <th className="w-[22%] whitespace-nowrap px-2">
                        {t('data.columns.sourceLocation')}
                      </th>
                      <th className="w-[17%] whitespace-nowrap px-2">
                        {t('data.columns.relatedTasks')}
                      </th>
                      <th className="w-[16%] whitespace-nowrap px-2">
                        <span className="inline-flex items-center gap-1">
                          {t('data.columns.updatedAt')}
                          <ArrowUpDown className="h-3 w-3" />
                        </span>
                      </th>
                      <th className="w-[10%] whitespace-nowrap px-2">{t('data.columns.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row, index) => {
                      const dataset = row.kind === 'dataset' ? row.dataset : null;
                      const draft = row.kind === 'draft' ? row.draft : null;
                      const sourceKind = dataset ? dataset.sourceKind : 'draft';
                      const sourceMeta = getInputTableSourceMeta(sourceKind);
                      const SourceIcon = sourceMeta.Icon;
                      const selected = row.id === selectedDatasetId;
                      const rowName = dataset?.name ?? draft?.name ?? '';
                      const rowUpdatedAt = dataset?.updatedAt ?? draft?.updatedAt ?? null;
                      return (
                        <tr
                          key={row.id}
                          onClick={() => setSelectedDatasetId(row.id)}
                          onDoubleClick={() => {
                            if (draft) {
                              onEditDraft(draft.id);
                            } else if (dataset) {
                              onEditDataset(dataset.id);
                            }
                          }}
                          className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
                            selected
                              ? 'bg-accent/10 ring-1 ring-inset ring-accent/20'
                              : index === 1
                                ? 'bg-accent/5'
                                : 'hover:bg-surface-hover/35'
                          }`}
                        >
                          <td className="px-4">
                            <input
                              type="radio"
                              name="input-table-selection"
                              checked={selected}
                              onChange={() => setSelectedDatasetId(row.id)}
                              onClick={(event) => event.stopPropagation()}
                              className="h-3.5 w-3.5 accent-accent"
                              aria-label={rowName}
                            />
                          </td>
                          <td className="px-2">
                            <div className="flex min-w-0 items-center gap-3">
                              <div
                                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${sourceMeta.className}`}
                              >
                                <SourceIcon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 truncate text-[13px] font-medium text-text-secondary">
                                {rowName}
                              </div>
                            </div>
                          </td>
                          <td className="px-2">
                            <span
                              className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-medium ${sourceMeta.badgeClassName}`}
                            >
                              {t(sourceMeta.labelKey)}
                            </span>
                          </td>
                          <td className="px-2">
                            <div
                              className="truncate text-[13px] font-medium text-text-secondary"
                              title={dataset?.sourcePath}
                            >
                              {dataset
                                ? formatDisplayPath(dataset.sourcePath)
                                : t('data.inputTables.notConfigured')}
                            </div>
                          </td>
                          <td className="px-2">
                            <div className="truncate text-[13px] font-medium text-text-secondary">
                              {dataset
                                ? formatRelatedTaskNames(dataset.relatedTaskNames, t)
                                : t('data.inputTables.noRelatedTasks')}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                            {formatDateTime(rowUpdatedAt)}
                          </td>
                          <td className="px-2">
                            <InputTableStatusBadge
                              label={
                                draft
                                  ? t('data.inputTables.status.draft')
                                  : t('data.inputTables.status.available')
                              }
                              tone={draft ? 'warning' : 'success'}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex min-h-11 flex-col items-center justify-between gap-2 border-t border-border-muted px-4 py-2.5 text-xs font-medium text-text-secondary sm:flex-row">
                <span>{t('data.totalCount', { count: totalRows })}</span>
                <div className="flex items-center gap-2">
                  <button className="inline-flex h-8 min-w-[6.5rem] items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-text-secondary shadow-soft">
                    {t('data.rowsPerPage', { count: TABLE_PAGE_SIZE })}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onPageChange(safeCurrentPage - 1)}
                    disabled={safeCurrentPage <= 1}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {pageNumbers.map((pageNumber) => (
                    <button
                      key={pageNumber}
                      onClick={() => onPageChange(pageNumber)}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                        pageNumber === safeCurrentPage
                          ? 'bg-accent text-white shadow-soft'
                          : 'border border-border-muted bg-surface text-text-secondary hover:border-accent/30 hover:bg-accent/10 hover:text-accent'
                      }`}
                    >
                      {pageNumber}
                    </button>
                  ))}
                  <button
                    onClick={() => onPageChange(safeCurrentPage + 1)}
                    disabled={safeCurrentPage >= pageCount}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OutputTablesPanel({
  outputTables,
  totalOutputTables,
  currentPage,
  searchQuery,
  isLoading,
  actionId,
  isCreateDisabled,
  onCreate,
  onSearchChange,
  onRefresh,
  onPageChange,
  onPreview,
  onEdit,
  onDelete,
  onDeleteAll,
}: {
  outputTables: DataOutputTable[];
  totalOutputTables: number;
  currentPage: number;
  searchQuery: string;
  isLoading: boolean;
  actionId: string | null;
  isCreateDisabled: boolean;
  onCreate: () => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onPreview: (outputTable: DataOutputTable) => void;
  onEdit: (outputTable: DataOutputTable) => void;
  onDelete: (outputTable: DataOutputTable) => void;
  onDeleteAll: () => void;
}) {
  const { t } = useTranslation();
  const [selectedOutputTableId, setSelectedOutputTableId] = useState<string | null>(null);
  const selectedOutputTable =
    outputTables.find((outputTable) => outputTable.id === selectedOutputTableId) ?? null;
  const selectedBusy = selectedOutputTable ? actionId === selectedOutputTable.id : false;
  const bulkBusy = actionId === 'delete-all-output-tables';

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (
      selectedOutputTableId &&
      !outputTables.some((outputTable) => outputTable.id === selectedOutputTableId)
    ) {
      setSelectedOutputTableId(null);
    }
  }, [isLoading, outputTables, selectedOutputTableId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="mb-3 flex flex-shrink-0 flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button
            onClick={onCreate}
            disabled={isCreateDisabled || bulkBusy}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('data.outputTables.add')}
          </button>
          <DataTableSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={t('data.outputTables.searchPlaceholder')}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DataToolbarButton
            icon={<Eye className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.preview')}
            disabled={!selectedOutputTable || bulkBusy}
            onClick={() => {
              if (selectedOutputTable) {
                onPreview(selectedOutputTable);
              }
            }}
          />
          <DataToolbarButton
            icon={<PencilLine className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.edit')}
            disabled={!selectedOutputTable || bulkBusy}
            onClick={() => {
              if (selectedOutputTable) {
                onEdit(selectedOutputTable);
              }
            }}
          />
          <DataToolbarButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.delete')}
            disabled={!selectedOutputTable || selectedBusy || bulkBusy}
            danger
            onClick={() => {
              if (selectedOutputTable) {
                onDelete(selectedOutputTable);
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
                disabled: totalOutputTables <= 0 || bulkBusy,
                onClick: onDeleteAll,
              },
            ]}
          />
        </div>
      </div>

      <div className="glass-table flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <LoadingState label={t('data.outputTables.loading')} />
          ) : outputTables.length === 0 ? (
            <EmptyState label={t('data.outputTables.empty')} />
          ) : (
            <div className="min-w-full overflow-x-auto">
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted backdrop-blur-xl">
                    <th className="w-[4%] px-4">
                      <span className="sr-only">{t('data.outputTables.selection')}</span>
                    </th>
                    <th className="w-[34%] whitespace-nowrap px-2">
                      {t('data.columns.outputTableName')}
                    </th>
                    <th className="w-[30%] whitespace-nowrap px-2">
                      {t('data.columns.relatedTasks')}
                    </th>
                    <th className="w-[18%] whitespace-nowrap px-2">
                      <span className="inline-flex items-center gap-1">
                        {t('data.columns.updatedAt')}
                        <ArrowUpDown className="h-3 w-3" />
                      </span>
                    </th>
                    <th className="w-[14%] whitespace-nowrap px-2">{t('data.columns.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {outputTables.map((outputTable, index) => {
                    const selected = outputTable.id === selectedOutputTableId;
                    return (
                      <tr
                        key={outputTable.id}
                        onClick={() => setSelectedOutputTableId(outputTable.id)}
                        onDoubleClick={() => onEdit(outputTable)}
                        className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
                          selected
                            ? 'bg-accent/10 ring-1 ring-inset ring-accent/20'
                            : index === 1
                              ? 'bg-accent/5'
                              : 'hover:bg-surface-hover/35'
                        }`}
                      >
                        <td className="px-4">
                          <input
                            type="radio"
                            name="output-table-selection"
                            checked={selected}
                            onChange={() => setSelectedOutputTableId(outputTable.id)}
                            onClick={(event) => event.stopPropagation()}
                            className="h-3.5 w-3.5 accent-accent"
                            aria-label={outputTable.name}
                          />
                        </td>
                        <td className="px-2">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                              <UploadCloud className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 truncate text-[13px] font-medium text-text-secondary">
                              {outputTable.name}
                            </div>
                          </div>
                        </td>
                        <td className="px-2">
                          <div className="truncate text-[13px] font-medium text-text-secondary">
                            {formatOutputTableRelatedTaskNames(outputTable, t)}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                          {formatDateTime(outputTable.updatedAt)}
                        </td>
                        <td className="px-2">
                          <InputTableStatusBadge
                            label={t('data.outputTables.status.available')}
                            tone="success"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <PaginationFooter
          count={totalOutputTables}
          currentPage={currentPage}
          onPageChange={onPageChange}
          embedded
        />
      </div>
    </div>
  );
}

function OutputTableEditor({
  outputTable,
  inputTables,
  isInputTablesLoading,
  isBusy,
  onBack,
  onSave,
}: {
  outputTable: DataOutputTable;
  inputTables: DataDataset[];
  isInputTablesLoading: boolean;
  isBusy: boolean;
  onBack: () => void;
  onSave: (
    outputTable: DataOutputTable,
    name: string,
    sourceDatasetId: string | null
  ) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [localName, setLocalName] = useState(outputTable.name);
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [sourceDatasetId, setSourceDatasetId] = useState(outputTable.sourceDatasetId ?? '');
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const trimmedName = localName.trim();
  const canSave = Boolean(
    trimmedName &&
    !isBusy &&
    (trimmedName !== outputTable.name || (sourceDatasetId || null) !== outputTable.sourceDatasetId)
  );
  const inputTableOptions = useMemo(() => {
    const options = inputTables.map((dataset) => ({
      value: dataset.id,
      label: dataset.name,
    }));
    if (sourceDatasetId && !options.some((option) => option.value === sourceDatasetId)) {
      options.unshift({ value: sourceDatasetId, label: sourceDatasetId });
    }
    const emptyLabel = isInputTablesLoading
      ? t('data.outputTables.editor.loadingInputTables')
      : t('data.outputTables.editor.noInputTable');
    return [{ value: '', label: emptyLabel }, ...options];
  }, [inputTables, isInputTablesLoading, sourceDatasetId, t]);

  useEffect(() => {
    setLocalName(outputTable.name);
    setIsNameEditing(false);
    setSourceDatasetId(outputTable.sourceDatasetId ?? '');
  }, [outputTable.id, outputTable.name, outputTable.sourceDatasetId]);

  useEffect(() => {
    if (!isNameEditing) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [isNameEditing]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <button
            onClick={onBack}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('data.outputTables.editor.back')}
          </button>
          <div className="flex min-w-0 items-center gap-2">
            {isNameEditing ? (
              <input
                ref={nameInputRef}
                value={localName}
                onChange={(event) => setLocalName(event.target.value)}
                onBlur={() => setIsNameEditing(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                  if (event.key === 'Escape') {
                    setLocalName(outputTable.name);
                    setIsNameEditing(false);
                  }
                }}
                disabled={isBusy}
                maxLength={50}
                aria-label={t('data.outputTables.editor.name')}
                className="h-8 min-w-0 max-w-[18rem] truncate border-0 bg-transparent px-0 text-[15px] font-medium text-text-secondary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
                placeholder={t('data.outputTables.editor.title')}
              />
            ) : (
              <div
                className="flex h-8 min-w-0 max-w-[18rem] items-center truncate text-[15px] font-medium text-text-secondary"
                title={localName || t('data.outputTables.editor.title')}
              >
                {localName || t('data.outputTables.editor.title')}
              </div>
            )}
            <button
              type="button"
              onClick={() => setIsNameEditing(true)}
              disabled={isBusy || isNameEditing}
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={t('common.edit')}
              title={t('common.edit')}
            >
              <PencilLine className="h-4 w-4" />
            </button>
            <InputTableStatusBadge label={t('data.outputTables.status.available')} tone="success" />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onSave(outputTable, localName, sourceDatasetId || null)}
          disabled={!canSave}
          className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {isBusy ? t('common.saving') : t('common.save')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border-muted bg-surface p-4 shadow-card">
        <div className="grid gap-5 lg:grid-cols-[8rem_minmax(0,1fr)] lg:items-center">
          <InputTableFormLabel>{t('data.outputTables.editor.inputTable')}</InputTableFormLabel>
          <InputTableSelect
            value={sourceDatasetId}
            options={inputTableOptions}
            disabled={isBusy || isInputTablesLoading}
            onChange={setSourceDatasetId}
          />

          <div className="lg:col-start-2">
            <InputTableInfo>{t('data.outputTables.editor.inputTableInfo')}</InputTableInfo>
          </div>
        </div>
      </div>
    </section>
  );
}

type InputTableEditorProps = {
  draft?: InputTableDraft;
  dataset?: DataDataset;
  isBusy: boolean;
  onBack: () => void;
  onRenameDraft?: (id: string, name: string) => void;
  onRenameDataset?: (dataset: DataDataset, name: string) => void | Promise<void>;
  onChooseDraftSource?: (
    draft: InputTableDraft,
    sourceKind: DataInputTableSourceKind,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
  onChooseDatasetSource?: (
    dataset: DataDataset,
    sourceKind: DataInputTableSourceKind,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
  onUpdateDatasetConfig?: (
    dataset: DataDataset,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
};

type InputTableEditorTab = 'rules' | 'code' | 'versions';

function InputTableEditorWorkbench({
  draft,
  dataset,
  isBusy,
  onBack,
  onRenameDraft,
  onRenameDataset,
  onChooseDraftSource,
  onChooseDatasetSource,
  onUpdateDatasetConfig,
}: InputTableEditorProps) {
  const { t } = useTranslation();
  const targetId = draft?.id ?? dataset?.id ?? '';
  const initialName = draft?.name ?? dataset?.name ?? '';
  const initialSourceKind = dataset?.sourceKind ?? 'excel';
  const initialConfig = useMemo(
    () => dataset?.inputConfig ?? getDefaultInputTableConfig(initialSourceKind),
    [dataset?.inputConfig, initialSourceKind]
  );
  const [localName, setLocalName] = useState(initialName);
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [localSourceKind, setLocalSourceKind] =
    useState<DataInputTableSourceKind>(initialSourceKind);
  const [localConfig, setLocalConfig] = useState<DataInputTableConfig>(initialConfig);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DataInputTablePreview | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [customizeGenerating, setCustomizeGenerating] = useState(false);
  const [customizeGenerationOutput, setCustomizeGenerationOutput] = useState('');
  const [customizeVersionActionId, setCustomizeVersionActionId] = useState<string | null>(null);
  const [deletingNormalizerVersionId, setDeletingNormalizerVersionId] = useState<string | null>(
    null
  );
  const [normalizerVersions, setNormalizerVersions] = useState<
    DataInputTableNormalizerArtifactVersion[]
  >([]);
  const [normalizerVersionsLoading, setNormalizerVersionsLoading] = useState(false);
  const [customizeGenerationError, setCustomizeGenerationError] = useState<string | null>(null);
  const [activeEditorTab, setActiveEditorTab] = useState<InputTableEditorTab>('rules');
  const [selectedNormalizerFilePath, setSelectedNormalizerFilePath] = useState('');
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const trimmedName = localName.trim();
  const isConfigured = Boolean(dataset);
  const sourceMeta = getInputTableSourceMeta(localSourceKind);
  const SourceIcon = sourceMeta.Icon;
  const excelConfig =
    localConfig.sourceKind === 'excel' ? localConfig : getDefaultExcelInputTableConfig();
  const folderConfig =
    localConfig.sourceKind === 'folder' ? localConfig : getDefaultFolderInputTableConfig();
  const dataProcessing = getInputTableDataProcessing(localConfig);
  const normalizerLanguage: DataNormalizerLanguage =
    dataProcessing.strategy === 'customize'
      ? inferNormalizerLanguageFromRulePrompt(dataProcessing.rulePrompt)
      : 'python';
  const hasNameChanges = Boolean(dataset && trimmedName && trimmedName !== dataset.name);
  const canSaveConfig =
    Boolean(dataset) &&
    localSourceKind === dataset?.sourceKind &&
    !isInputTableConfigEqual(localConfig, dataset?.inputConfig);
  const canSave = Boolean(dataset && trimmedName && !isBusy && (hasNameChanges || canSaveConfig));
  const canPreview = Boolean(
    dataset &&
    localSourceKind === dataset.sourceKind &&
    !isBusy &&
    window.electronAPI?.data?.previewInputTable
  );
  const canGenerateCustomizeDraft = Boolean(
    dataset &&
    dataProcessing.strategy === 'customize' &&
    dataProcessing.rulePrompt.trim() &&
    !customizeGenerating
  );
  const currentNormalizerVersion =
    dataProcessing.strategy === 'customize'
      ? normalizerVersions.find((version) => version.id === dataProcessing.artifactVersionId)
      : undefined;
  const customizeArtifactId =
    dataProcessing.strategy === 'customize' ? dataProcessing.artifactId : undefined;
  const customizeArtifactVersionId =
    dataProcessing.strategy === 'customize' ? dataProcessing.artifactVersionId : undefined;
  const normalizerProjectFiles = useMemo(() => {
    if (dataProcessing.strategy !== 'customize') return [];
    if (dataProcessing.projectFiles && dataProcessing.projectFiles.length > 0) {
      return dataProcessing.projectFiles;
    }
    return currentNormalizerVersion?.files ?? [];
  }, [currentNormalizerVersion, dataProcessing]);
  const normalizerProjectFileSignature = useMemo(
    () => normalizerProjectFiles.map((file) => file.path).join('\n'),
    [normalizerProjectFiles]
  );
  const selectedNormalizerFile = useMemo(() => {
    if (normalizerProjectFiles.length === 0) return undefined;
    return (
      normalizerProjectFiles.find((file) => file.path === selectedNormalizerFilePath) ??
      normalizerProjectFiles.find(
        (file) =>
          file.path === getPreferredNormalizerFilePath(normalizerProjectFiles, normalizerLanguage)
      ) ??
      normalizerProjectFiles[0]
    );
  }, [normalizerLanguage, normalizerProjectFiles, selectedNormalizerFilePath]);

  useEffect(() => {
    setLocalName(initialName);
    setIsNameEditing(false);
    setLocalSourceKind(initialSourceKind);
    setLocalConfig(initialConfig);
    setCustomizeGenerationError(null);
    setCustomizeGenerationOutput('');
    setCustomizeGenerating(false);
    setCustomizeVersionActionId(null);
    setDeletingNormalizerVersionId(null);
    setActiveEditorTab('rules');
    setSelectedNormalizerFilePath('');
  }, [initialConfig, initialName, initialSourceKind, targetId]);

  useEffect(() => {
    if (!isNameEditing) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [isNameEditing]);

  useEffect(() => {
    const preferredPath = getPreferredNormalizerFilePath(
      normalizerProjectFiles,
      normalizerLanguage
    );
    setSelectedNormalizerFilePath((current) => {
      if (current && normalizerProjectFiles.some((file) => file.path === current)) {
        return current;
      }
      return preferredPath;
    });
  }, [normalizerLanguage, normalizerProjectFileSignature, normalizerProjectFiles]);

  const handleNameChange = (value: string) => {
    setLocalName(value);
    if (draft && onRenameDraft) {
      onRenameDraft(draft.id, value);
    }
  };

  const chooseSource = (sourceKind: DataInputTableSourceKind, config = localConfig) => {
    const nextConfig =
      config.sourceKind === sourceKind ? config : getDefaultInputTableConfig(sourceKind);
    if (draft && onChooseDraftSource) {
      void onChooseDraftSource(draft, sourceKind, nextConfig, localName);
    } else if (dataset && onChooseDatasetSource) {
      void onChooseDatasetSource(dataset, sourceKind, nextConfig, localName);
    }
  };

  const handleSourceKindChange = (sourceKind: DataInputTableSourceKind) => {
    const nextConfig = getDefaultInputTableConfig(sourceKind);
    setLocalSourceKind(sourceKind);
    setLocalConfig(nextConfig);
  };

  const updateConfig = (config: DataInputTableConfig) => {
    setLocalConfig(config);
  };

  const updateDataProcessing = (dataProcessing: DataInputTableProcessingConfig) => {
    updateConfig(withInputTableDataProcessing(localConfig, dataProcessing));
  };

  const appendGenerationOutput = useCallback((line: string) => {
    setCustomizeGenerationOutput((current) => `${current}${current ? '\n' : ''}${line}`);
  }, []);

  const appendGenerationOutputChunk = useCallback((chunk: string) => {
    setCustomizeGenerationOutput((current) => `${current}${chunk}`);
  }, []);

  const refreshNormalizerVersions = useCallback(async (artifactId: string | undefined) => {
    if (!artifactId) {
      setNormalizerVersions([]);
      return;
    }
    setNormalizerVersionsLoading(true);
    try {
      const result = await window.electronAPI.data.listInputTableNormalizerVersions({
        artifactId,
      });
      setNormalizerVersions(result.versions);
    } catch (err) {
      setCustomizeGenerationError(err instanceof Error ? err.message : String(err));
    } finally {
      setNormalizerVersionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshNormalizerVersions(customizeArtifactId);
  }, [customizeArtifactId, refreshNormalizerVersions]);

  const generateCustomizeDraft = async () => {
    if (dataProcessing.strategy !== 'customize') return;
    const rulePrompt = dataProcessing.rulePrompt.trim();
    if (!rulePrompt || !dataset) {
      return;
    }
    setActiveEditorTab('rules');
    setCustomizeGenerationOutput(
      buildNormalizerGenerationStartOutput({
        inputTableName: dataset.name,
        sourceKind: localSourceKind,
        language: normalizerLanguage,
        rulePrompt,
        t,
      })
    );
    setCustomizeGenerating(true);
    setCustomizeGenerationError(null);
    const progressId = createNormalizerGenerationProgressId();
    const unsubscribeProgress = window.electronAPI.data.onInputTableNormalizerDraftProgress?.(
      (event: DataInputTableNormalizerDraftProgressEvent) => {
        if (event.progressId !== progressId) return;
        if (typeof event.text !== 'string' || event.text.length === 0) return;
        if (event.kind === 'delta') {
          appendGenerationOutputChunk(event.text);
        } else {
          appendGenerationOutput(event.text);
        }
      }
    );
    try {
      const result = await window.electronAPI.data.generateInputTableNormalizerDraft({
        artifactId: dataProcessing.artifactId,
        name: `${dataset.name} normalizer`,
        sourcePath: dataset.sourcePath,
        sourceKind: localSourceKind,
        config: localConfig,
        rulePrompt,
        primaryLanguage: normalizerLanguage,
        progressId,
      });
      updateDataProcessing({
        ...dataProcessing,
        rulePrompt: result.version.rulePrompt,
        artifactId: result.artifact.id,
        artifactVersionId: result.version.id,
        artifactVersionStatus: result.version.status,
        fileTreeHash: result.version.fileTreeHash,
        dependencyLockHash: result.version.dependencyLockHash ?? undefined,
        runtime: result.version.runtime,
        entrypoint: result.version.entrypoint,
        dependencyPrepare: result.version.dependencyPrepare,
        projectFiles: result.version.files,
        sourceSummaryHash: result.version.sourceSummaryHash ?? result.summary.hash,
      });
      setSelectedNormalizerFilePath(
        getPreferredNormalizerFilePath(result.version.files, result.version.runtime.language)
      );
      void refreshNormalizerVersions(result.artifact.id);
      appendGenerationOutput(
        buildNormalizerGenerationSuccessOutput({
          artifactId: result.artifact.id,
          versionNumber: result.version.version,
          files: result.version.files,
          language: result.artifact.primaryLanguage,
          t,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCustomizeGenerationError(message);
      appendGenerationOutput(
        `${t('data.inputTables.editor.generationOutputFailed')}\n\n${message}`
      );
    } finally {
      unsubscribeProgress?.();
      setCustomizeGenerating(false);
    }
  };

  const saveInputTable = () => {
    if (!dataset || !trimmedName) return;
    if (canSaveConfig && onUpdateDatasetConfig) {
      void onUpdateDatasetConfig(dataset, localConfig, localName);
      return;
    }
    if (hasNameChanges && onRenameDataset) {
      void onRenameDataset(dataset, localName);
    }
  };

  const loadPreviewPage = async (page: number) => {
    if (!dataset || !window.electronAPI?.data?.previewInputTable) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewPage(page);
    try {
      const nextPreview = await window.electronAPI.data.previewInputTable({
        filePath: dataset.sourcePath,
        sourceKind: localSourceKind,
        config: localConfig,
        limit: INPUT_TABLE_PREVIEW_PAGE_SIZE,
        offset: (page - 1) * INPUT_TABLE_PREVIEW_PAGE_SIZE,
      });
      setPreviewData(nextPreview);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const previewInputTable = async () => {
    setPreviewData(null);
    await loadPreviewPage(1);
  };

  const previewCustomizeDraft = async () => {
    if (dataProcessing.strategy !== 'customize' || !dataProcessing.artifactVersionId || !dataset) {
      return;
    }
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewData(null);
    setPreviewPage(1);
    try {
      const result = await window.electronAPI.data.previewInputTableNormalizerVersion({
        versionId: dataProcessing.artifactVersionId,
        sourcePath: dataset.sourcePath,
        sourceKind: localSourceKind,
        config: localConfig,
        prepareDependencies: true,
        limit: INPUT_TABLE_PREVIEW_PAGE_SIZE,
        offset: 0,
      });
      setPreviewData(result.preview);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const publishSpecificNormalizerVersion = async (
    version: DataInputTableNormalizerArtifactVersion
  ) => {
    if (dataProcessing.strategy !== 'customize' || !dataset) {
      return;
    }
    setCustomizeVersionActionId(version.id);
    setCustomizeGenerationError(null);
    try {
      const result = await window.electronAPI.data.publishInputTableNormalizerVersion({
        versionId: version.id,
      });
      updateDataProcessing({
        ...dataProcessing,
        artifactId: result.artifact.id,
        artifactVersionId: result.version.id,
        artifactVersionStatus: result.version.status,
        fileTreeHash: result.version.fileTreeHash,
        dependencyLockHash: result.version.dependencyLockHash ?? undefined,
        runtime: result.version.runtime,
        entrypoint: result.version.entrypoint,
        dependencyPrepare: result.version.dependencyPrepare,
        projectFiles: result.version.files,
        sourceSummaryHash: result.version.sourceSummaryHash ?? undefined,
      });
      void refreshNormalizerVersions(result.artifact.id);
    } catch (err) {
      setCustomizeGenerationError(err instanceof Error ? err.message : String(err));
    } finally {
      setCustomizeVersionActionId(null);
    }
  };

  const deleteSpecificNormalizerVersion = async (
    version: DataInputTableNormalizerArtifactVersion
  ) => {
    if (dataProcessing.strategy !== 'customize' || !dataset) {
      return;
    }
    if (version.status === 'published') {
      setCustomizeGenerationError(t('data.inputTables.editor.deletePublishedVersionBlocked'));
      return;
    }
    const confirmed = window.confirm(
      t('data.inputTables.editor.deleteVersionConfirm', {
        version: version.version,
      })
    );
    if (!confirmed) return;
    setDeletingNormalizerVersionId(version.id);
    setCustomizeGenerationError(null);
    try {
      await window.electronAPI.data.deleteInputTableNormalizerVersion({
        versionId: version.id,
      });
      if (dataProcessing.artifactVersionId === version.id) {
        updateDataProcessing({
          ...dataProcessing,
          artifactVersionId: undefined,
          artifactVersionStatus: undefined,
          fileTreeHash: undefined,
          dependencyLockHash: undefined,
          runtime: undefined,
          entrypoint: undefined,
          dependencyPrepare: undefined,
          projectFiles: undefined,
          sourceSummaryHash: undefined,
        });
        setSelectedNormalizerFilePath('');
      }
      void refreshNormalizerVersions(dataProcessing.artifactId);
    } catch (err) {
      setCustomizeGenerationError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingNormalizerVersionId(null);
    }
  };

  const editorTabs: Array<{ value: InputTableEditorTab; label: string }> = [
    { value: 'rules', label: t('data.inputTables.editor.ruleDescription') },
    { value: 'code', label: t('data.inputTables.editor.codePreview') },
    { value: 'versions', label: t('data.inputTables.editor.versionHistory') },
  ];

  return (
    <>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mb-3 flex h-14 shrink-0 items-center justify-between gap-3 px-1">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={onBack}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-muted bg-background/62 px-3 text-[13px] font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-text-primary"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('data.inputTables.editor.backShort')}
            </button>
            <div className="flex min-w-0 items-center gap-2">
              {isNameEditing ? (
                <input
                  ref={nameInputRef}
                  value={localName}
                  onChange={(event) => handleNameChange(event.target.value)}
                  onBlur={() => setIsNameEditing(false)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }
                    if (event.key === 'Escape') {
                      if (dataset) {
                        setLocalName(dataset.name);
                      }
                      setIsNameEditing(false);
                    }
                  }}
                  disabled={isBusy}
                  maxLength={50}
                  aria-label={t('data.inputTables.editor.name')}
                  className="h-9 min-w-0 max-w-[22rem] truncate border-0 bg-transparent px-0 text-[18px] font-medium text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder={t('data.inputTables.editor.title')}
                />
              ) : (
                <div
                  className="flex h-9 min-w-0 max-w-[22rem] items-center truncate text-[18px] font-medium text-text-primary"
                  title={localName || t('data.inputTables.editor.title')}
                >
                  {localName || t('data.inputTables.editor.title')}
                </div>
              )}
              <button
                type="button"
                onClick={() => setIsNameEditing(true)}
                disabled={isBusy || isNameEditing}
                className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
                aria-label={t('common.edit')}
                title={t('common.edit')}
              >
                <PencilLine className="h-4 w-4" />
              </button>
              <InputTableStatusBadge
                label={
                  isConfigured
                    ? t('data.inputTables.status.available')
                    : t('data.inputTables.status.draft')
                }
                tone={isConfigured ? 'success' : 'warning'}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void previewInputTable()}
              disabled={!canPreview || previewLoading}
              className="inline-flex h-9 w-fit items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-background/62 px-4 text-[13px] font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {previewLoading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {t('data.inputTables.editor.preview')}
            </button>
            <button
              type="button"
              onClick={saveInputTable}
              disabled={!canSave}
              className="inline-flex h-9 w-fit items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-background/62 px-4 text-[13px] font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {isBusy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-muted bg-[var(--glass-card)] shadow-card backdrop-blur-xl">
          <div className="grid flex-shrink-0 gap-2 border-b border-border-muted/80 px-5 py-4">
            <InputTableConfigRow label={t('data.inputTables.editor.sourceType')}>
              <GlassSelect
                value={localSourceKind}
                onValueChange={(value) => handleSourceKindChange(value as DataInputTableSourceKind)}
                options={[
                  { value: 'excel', label: t('data.inputTables.editor.excel') },
                  { value: 'csv', label: t('data.inputTables.editor.csv') },
                  { value: 'folder', label: t('data.inputTables.editor.folder') },
                ]}
                disabled={isBusy}
                triggerIcon={
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-md ${sourceMeta.className}`}
                  >
                    <SourceIcon className="h-4 w-4" />
                  </span>
                }
                triggerClassName="h-10 w-full justify-between rounded-lg bg-background/50 px-3 text-[14px] font-medium text-text-primary disabled:opacity-60"
                contentClassName="w-[var(--radix-select-trigger-width)]"
              />
            </InputTableConfigRow>

            <InputTableConfigRow
              label={
                localSourceKind === 'folder'
                  ? t('data.inputTables.editor.folderPath')
                  : t('data.inputTables.editor.file')
              }
            >
              <div className="flex min-w-0 items-stretch">
                <div className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-l-lg border border-border-muted bg-background/50 px-3 shadow-soft">
                  <span
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${sourceMeta.className}`}
                  >
                    <SourceIcon className="h-4 w-4" />
                  </span>
                  <div
                    className="min-w-0 truncate text-[14px] font-medium text-text-primary"
                    title={dataset?.sourcePath}
                  >
                    {dataset
                      ? formatDisplayPath(dataset.sourcePath)
                      : t('data.inputTables.editor.noSource')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => chooseSource(localSourceKind)}
                  disabled={isBusy || !trimmedName}
                  className="inline-flex h-10 flex-shrink-0 items-center justify-center rounded-r-lg border border-l-0 border-border-muted bg-background/62 px-5 text-[13px] font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {localSourceKind === 'folder'
                    ? t('data.inputTables.editor.changeFolder')
                    : t('data.inputTables.editor.changeFile')}
                </button>
              </div>
            </InputTableConfigRow>

            <InputTableConfigRow label={t('data.inputTables.editor.processingStrategy')}>
              <GlassSelect
                value={dataProcessing.strategy}
                onValueChange={(value) => {
                  if (value === 'customize') {
                    updateDataProcessing({
                      strategy: 'customize',
                      rulePrompt:
                        dataProcessing.strategy === 'customize' ? dataProcessing.rulePrompt : '',
                    });
                    setActiveEditorTab('rules');
                    return;
                  }
                  updateDataProcessing({ strategy: 'auto' });
                }}
                options={[
                  { value: 'auto', label: t('data.inputTables.editor.processingAuto') },
                  { value: 'customize', label: t('data.inputTables.editor.processingCustomize') },
                ]}
                disabled={isBusy || !dataset}
                triggerClassName="h-10 w-full justify-between rounded-lg bg-background/50 px-3 text-[14px] font-medium text-text-primary disabled:opacity-60"
                contentClassName="w-[var(--radix-select-trigger-width)]"
              />
            </InputTableConfigRow>
          </div>

          {dataProcessing.strategy === 'customize' ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex h-14 flex-shrink-0 items-end border-b border-border-muted/80 px-5">
                {editorTabs.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setActiveEditorTab(tab.value)}
                    className={`relative flex h-12 min-w-[8.5rem] items-center justify-center px-4 text-[13px] font-medium transition-colors ${
                      activeEditorTab === tab.value
                        ? 'text-accent'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {tab.label}
                    {activeEditorTab === tab.value ? (
                      <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-accent" />
                    ) : null}
                  </button>
                ))}
              </div>

              <div
                className={`min-h-0 flex-1 px-7 py-6 ${
                  activeEditorTab === 'versions' ? 'overflow-y-auto' : 'overflow-hidden'
                }`}
              >
                {activeEditorTab === 'rules' ? (
                  <div className="mx-auto flex h-full min-h-0 max-w-[70rem] flex-col gap-4">
                    <label className="grid flex-shrink-0 gap-2">
                      <span className="inline-flex items-center gap-2 text-[13px] font-medium text-text-secondary">
                        {t('data.inputTables.editor.rulePrompt')}
                        <Info className="h-3.5 w-3.5 text-text-muted" />
                      </span>
                      <textarea
                        value={dataProcessing.rulePrompt}
                        onChange={(event) =>
                          updateDataProcessing({
                            ...dataProcessing,
                            rulePrompt: event.target.value,
                          })
                        }
                        disabled={isBusy || !dataset}
                        rows={4}
                        maxLength={4000}
                        placeholder={t('data.inputTables.editor.rulePromptPlaceholder')}
                        className="h-24 min-h-24 w-full resize-none rounded-lg border border-border-muted bg-background/50 px-4 py-3 text-[13px] leading-6 text-text-primary shadow-soft outline-none placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </label>
                    <InputTableGenerationOutputPanel
                      isStreaming={customizeGenerating}
                      output={customizeGenerationOutput}
                      t={t}
                    />
                    {customizeGenerationError ? (
                      <div className="flex-shrink-0 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-[12px] font-medium text-danger">
                        {customizeGenerationError}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activeEditorTab === 'code' ? (
                  <div className="grid h-[30rem] max-h-full min-h-0 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_16rem]">
                    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-muted bg-background/50">
                      <div className="flex h-9 flex-shrink-0 items-center justify-between gap-2 border-b border-border-muted px-3">
                        <span className="min-w-0 truncate font-mono text-xs font-medium text-text-primary">
                          {selectedNormalizerFile?.path ??
                            t('data.inputTables.editor.noProjectFiles')}
                        </span>
                        <button
                          type="button"
                          disabled={!selectedNormalizerFile}
                          onClick={() => {
                            if (selectedNormalizerFile) {
                              void navigator.clipboard?.writeText(selectedNormalizerFile.content);
                            }
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-accent/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                          title={t('data.inputTables.editor.copyCode')}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <CodePreview file={selectedNormalizerFile} t={t} />
                    </div>
                    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-muted bg-background/42">
                      <div className="flex h-9 items-center border-b border-border-muted px-3 text-xs font-medium text-text-primary">
                        {t('data.inputTables.editor.projectStructure')}
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto p-2">
                        <NormalizerProjectTree
                          files={normalizerProjectFiles}
                          selectedPath={selectedNormalizerFile?.path ?? selectedNormalizerFilePath}
                          onSelect={setSelectedNormalizerFilePath}
                          t={t}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeEditorTab === 'versions' ? (
                  <InputTableVersionHistoryPanel
                    currentVersion={currentNormalizerVersion}
                    currentVersionId={customizeArtifactVersionId}
                    deletingVersionId={deletingNormalizerVersionId}
                    embedded
                    loading={normalizerVersionsLoading}
                    onRefresh={() => void refreshNormalizerVersions(customizeArtifactId)}
                    onDelete={(version) => void deleteSpecificNormalizerVersion(version)}
                    onPublish={(version) => void publishSpecificNormalizerVersion(version)}
                    publishingVersionId={customizeVersionActionId}
                    t={t}
                    versions={normalizerVersions}
                  />
                ) : null}
              </div>

              <div className="flex min-h-16 flex-shrink-0 items-center justify-end gap-3 border-t border-border-muted/80 px-7 py-4">
                <button
                  type="button"
                  disabled={!canGenerateCustomizeDraft}
                  onClick={() => void generateCustomizeDraft()}
                  className="inline-flex h-10 min-w-[9.5rem] items-center justify-center gap-2 rounded-lg bg-accent px-5 text-[13px] font-medium text-white shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-active disabled:text-text-muted disabled:opacity-70"
                  title={t('data.inputTables.editor.generateProjectDisabled')}
                >
                  {customizeGenerating ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {customizeGenerating
                    ? t('data.inputTables.editor.generateProjectDrafting')
                    : t('data.inputTables.editor.generateProjectDraft')}
                </button>
                <button
                  type="button"
                  disabled={!customizeArtifactVersionId || previewLoading || !dataset}
                  onClick={() => void previewCustomizeDraft()}
                  className="inline-flex h-10 min-w-[11.5rem] items-center justify-center gap-2 rounded-lg border border-border-muted bg-background/62 px-5 text-[13px] font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {previewLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                  {t('data.inputTables.editor.previewNormalizedDraft')}
                </button>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
              <div className="mx-auto grid max-w-[70rem] gap-4">
                {localSourceKind === 'excel' ? (
                  <>
                    <InputTableConfigRow label={t('data.inputTables.editor.sheetName')}>
                      <GlassSelect
                        value={excelConfig.sheetName ?? ''}
                        onValueChange={(value) =>
                          updateConfig({
                            ...excelConfig,
                            sheetName: value,
                          })
                        }
                        options={(excelConfig.sheetNames.length > 0
                          ? excelConfig.sheetNames
                          : ['Sheet1']
                        ).map((sheetName) => ({ value: sheetName, label: sheetName }))}
                        disabled={isBusy || !dataset}
                        triggerClassName="h-10 w-full justify-between rounded-lg bg-background/50 px-3 text-[14px] font-medium text-text-primary disabled:opacity-60"
                        contentClassName="w-[var(--radix-select-trigger-width)]"
                      />
                    </InputTableConfigRow>
                    <InputTableConfigRow label={t('data.inputTables.editor.headerRow')}>
                      <GlassSelect
                        value={excelConfig.headerMode}
                        onValueChange={(value) =>
                          updateConfig({
                            ...excelConfig,
                            headerMode: value as DataInputTableExcelConfig['headerMode'],
                          })
                        }
                        options={[
                          { value: 'auto', label: t('data.inputTables.editor.smartDetect') },
                          {
                            value: 'manual',
                            label: t('data.inputTables.editor.manualSpecify'),
                          },
                        ]}
                        disabled={isBusy || !dataset}
                        triggerClassName="h-10 w-full justify-between rounded-lg bg-background/50 px-3 text-[14px] font-medium text-text-primary disabled:opacity-60"
                        contentClassName="w-[var(--radix-select-trigger-width)]"
                      />
                    </InputTableConfigRow>
                  </>
                ) : null}

                {localSourceKind === 'csv' ? (
                  <div className="grid gap-3">
                    {[
                      ['header', 'data.inputTables.editor.csvHeader'],
                      ['dataRegion', 'data.inputTables.editor.csvDataRegion'],
                      ['encoding', 'data.inputTables.editor.csvEncoding'],
                      ['delimiter', 'data.inputTables.editor.csvDelimiter'],
                    ].map(([key, labelKey]) => (
                      <InputTableConfigRow key={key} label={t(labelKey)}>
                        <div className="text-[14px] font-medium text-text-primary">
                          {t('data.inputTables.editor.autoDetected')}
                        </div>
                      </InputTableConfigRow>
                    ))}
                  </div>
                ) : null}

                {localSourceKind === 'folder' ? (
                  <div className="grid gap-3">
                    <InputTableConfigRow label={t('data.inputTables.editor.fileSelectionRange')}>
                      <InputTableSelect
                        value={folderConfig.fileRange}
                        disabled={isBusy || !dataset}
                        onChange={(value) =>
                          updateConfig({
                            ...folderConfig,
                            fileRange: value as DataInputTableFolderConfig['fileRange'],
                          })
                        }
                        options={[
                          {
                            value: 'excel_csv',
                            label: t('data.inputTables.editor.includeExcelCsv'),
                          },
                          { value: 'excel', label: t('data.inputTables.editor.includeExcel') },
                          { value: 'csv', label: t('data.inputTables.editor.includeCsv') },
                        ]}
                      />
                    </InputTableConfigRow>
                    <div className="flex flex-wrap gap-4 px-1">
                      <InputTableCheckbox
                        checked={folderConfig.skipEmptyFiles}
                        disabled={isBusy || !dataset}
                        label={t('data.inputTables.editor.skipEmptyFiles')}
                        onChange={(checked) =>
                          updateConfig({ ...folderConfig, skipEmptyFiles: checked })
                        }
                      />
                      <InputTableCheckbox
                        checked={folderConfig.keepSourceFileName}
                        disabled={isBusy || !dataset}
                        label={t('data.inputTables.editor.keepSourceFileName')}
                        onChange={(checked) =>
                          updateConfig({ ...folderConfig, keepSourceFileName: checked })
                        }
                      />
                    </div>
                  </div>
                ) : null}

                <InputTableInfo>{t('data.inputTables.editor.processingAutoInfo')}</InputTableInfo>
              </div>
            </div>
          )}
        </div>
      </section>
      {previewOpen && (
        <InputTablePreviewDialog
          tableKind="input"
          preview={previewData}
          isLoading={previewLoading}
          error={previewError}
          currentPage={previewPage}
          onPageChange={(page) => void loadPreviewPage(page)}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}

function InputTableEditor({
  draft,
  dataset,
  isBusy,
  onBack,
  onRenameDraft,
  onRenameDataset,
  onChooseDraftSource,
  onChooseDatasetSource,
  onUpdateDatasetConfig,
}: {
  draft?: InputTableDraft;
  dataset?: DataDataset;
  isBusy: boolean;
  onBack: () => void;
  onRenameDraft?: (id: string, name: string) => void;
  onRenameDataset?: (dataset: DataDataset, name: string) => void | Promise<void>;
  onChooseDraftSource?: (
    draft: InputTableDraft,
    sourceKind: DataInputTableSourceKind,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
  onChooseDatasetSource?: (
    dataset: DataDataset,
    sourceKind: DataInputTableSourceKind,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
  onUpdateDatasetConfig?: (
    dataset: DataDataset,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
}) {
  return (
    <InputTableEditorWorkbench
      draft={draft}
      dataset={dataset}
      isBusy={isBusy}
      onBack={onBack}
      onRenameDraft={onRenameDraft}
      onRenameDataset={onRenameDataset}
      onChooseDraftSource={onChooseDraftSource}
      onChooseDatasetSource={onChooseDatasetSource}
      onUpdateDatasetConfig={onUpdateDatasetConfig}
    />
  );
}

function InputTableConfigRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-12 items-center gap-3 px-1 py-1 lg:grid-cols-[10rem_minmax(0,1fr)]">
      <div className="text-[14px] font-medium text-text-primary">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function InputTableGenerationOutputPanel({
  output,
  isStreaming,
  t,
}: {
  output: string;
  isStreaming: boolean;
  t: TranslateFn;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const message = useMemo<Message>(
    () => ({
      id: 'input-table-normalizer-generation-output',
      sessionId: 'data-input-table-normalizer',
      role: 'assistant',
      content: [{ type: 'text', text: output }],
      timestamp: Date.now(),
    }),
    [output]
  );

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [isStreaming, output]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-muted bg-background/42 shadow-soft">
      <div className="flex h-10 flex-shrink-0 items-center justify-between gap-3 border-b border-border-muted px-3">
        <div className="inline-flex min-w-0 items-center gap-2 text-[13px] font-medium text-text-primary">
          {isStreaming ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" />
          ) : (
            <Code2 className="h-3.5 w-3.5 text-accent" />
          )}
          <span className="truncate">{t('data.inputTables.editor.generationOutputTitle')}</span>
        </div>
        <span className="text-[11px] font-medium text-text-muted">
          {isStreaming
            ? t('data.inputTables.editor.generationOutputStreaming')
            : t('data.inputTables.editor.generationOutputIdle')}
        </span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {output ? (
          <MessageCard message={message} isStreaming={isStreaming} />
        ) : (
          <div className="flex h-full min-h-28 items-center justify-center rounded-lg border border-dashed border-border-muted bg-background/30 px-4 text-center text-[13px] font-medium text-text-muted">
            {t('data.inputTables.editor.generatedStatusEmpty')}
          </div>
        )}
      </div>
    </div>
  );
}

function CodePreview({ file, t }: { file?: DataNormalizerProjectFile; t: TranslateFn }) {
  if (!file) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs font-medium text-text-muted">
        {t('data.inputTables.editor.selectedFileEmpty')}
      </div>
    );
  }
  return <CodeMirrorFilePreview file={file} />;
}

function CodeMirrorFilePreview({ file }: { file: DataNormalizerProjectFile }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const language = useMemo(() => getCodePreviewLanguage(file.path), [file.path]);
  const extensions = useMemo(
    () => [
      lineNumbers(),
      language,
      syntaxHighlighting(codePreviewHighlightStyle),
      codePreviewTheme,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
    ],
    [language]
  );

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: file.content, extensions }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [extensions, file.content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === file.content) return;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: file.content,
      },
    });
  }, [file.content]);

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />;
}

interface NormalizerProjectTreeNode {
  name: string;
  path: string;
  type: 'folder' | 'file';
  children: NormalizerProjectTreeNode[];
}

function NormalizerProjectTree({
  files,
  selectedPath,
  onSelect,
  t,
  spacious = false,
}: {
  files: DataNormalizerProjectFile[];
  selectedPath: string;
  onSelect: (path: string) => void;
  t: TranslateFn;
  spacious?: boolean;
}) {
  const tree = useMemo(() => buildNormalizerProjectTree(files), [files]);
  if (tree.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-muted bg-background/42 px-3 py-4 text-center text-xs font-medium text-text-muted">
        {t('data.inputTables.editor.noProjectFiles')}
      </div>
    );
  }
  return (
    <div className={spacious ? 'space-y-1' : 'space-y-0.5'}>
      {tree.map((node) => (
        <NormalizerProjectTreeNodeView
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
          spacious={spacious}
        />
      ))}
    </div>
  );
}

function NormalizerProjectTreeNodeView({
  node,
  depth,
  selectedPath,
  onSelect,
  spacious,
}: {
  node: NormalizerProjectTreeNode;
  depth: number;
  selectedPath: string;
  onSelect: (path: string) => void;
  spacious: boolean;
}) {
  const isFile = node.type === 'file';
  const isSelected = isFile && node.path === selectedPath;
  const Icon = isFile ? FileText : Folder;
  return (
    <div>
      <button
        type="button"
        disabled={!isFile}
        onClick={() => {
          if (isFile) onSelect(node.path);
        }}
        className={`flex w-full min-w-0 items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs font-medium transition-colors disabled:cursor-default ${
          isSelected
            ? 'bg-accent/10 text-text-primary ring-1 ring-inset ring-accent/20'
            : 'text-text-secondary hover:bg-background/54 hover:text-text-primary'
        } ${spacious ? 'min-h-8' : 'min-h-7'}`}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        {node.type === 'folder' ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
        ) : (
          <span className="h-3.5 w-3.5 flex-shrink-0" />
        )}
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
      {node.children.length > 0 ? (
        <div>
          {node.children.map((child) => (
            <NormalizerProjectTreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              spacious={spacious}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InputTableVersionHistoryPanel({
  currentVersion,
  currentVersionId,
  deletingVersionId,
  embedded = false,
  loading,
  onRefresh,
  onDelete,
  onPublish,
  publishingVersionId,
  t,
  versions,
}: {
  currentVersion?: DataInputTableNormalizerArtifactVersion;
  currentVersionId?: string;
  deletingVersionId: string | null;
  embedded?: boolean;
  loading: boolean;
  onRefresh: () => void;
  onDelete: (version: DataInputTableNormalizerArtifactVersion) => void;
  onPublish: (version: DataInputTableNormalizerArtifactVersion) => void;
  publishingVersionId: string | null;
  t: TranslateFn;
  versions: DataInputTableNormalizerArtifactVersion[];
}) {
  return (
    <section
      className={`overflow-hidden rounded-lg border border-border-muted ${
        embedded ? 'bg-background/42' : 'mt-3 bg-[var(--glass-card)] shadow-soft backdrop-blur-xl'
      }`}
    >
      <div className="flex h-11 items-center justify-between border-b border-border-muted px-3">
        <div className="text-[13px] font-medium text-text-primary">
          {t('data.inputTables.editor.versionHistory')}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-background/62 px-3 text-xs font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </button>
      </div>
      {versions.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-xs">
            <tbody>
              {versions.map((version) => {
                const isCurrent = version.id === currentVersionId;
                const isPublished = version.status === 'published';
                const diffSummary = getNormalizerVersionDiffSummary(version, currentVersion, t);
                return (
                  <tr
                    key={version.id}
                    className="h-11 border-b border-border-muted/80 text-text-secondary last:border-b-0 hover:bg-background/32"
                  >
                    <td className="w-20 px-3 font-mono text-[13px] font-medium text-text-primary">
                      {t('data.inputTables.editor.versionNumber', {
                        version: version.version,
                      })}
                    </td>
                    <td className="w-44 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isCurrent ? (
                          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                            {t('data.inputTables.editor.currentVersion')}
                          </span>
                        ) : null}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            isPublished
                              ? 'bg-success/10 text-success'
                              : 'bg-background/58 text-text-secondary'
                          }`}
                        >
                          {isPublished
                            ? t('data.inputTables.editor.publishedVersion')
                            : version.status}
                        </span>
                      </div>
                    </td>
                    <td className="min-w-[13rem] px-3 text-text-muted">
                      {t('data.inputTables.editor.updatedAt', {
                        time: formatDateTime(version.updatedAt),
                      })}
                    </td>
                    <td className="min-w-[16rem] max-w-[28rem] px-3">
                      <span className="line-clamp-1 font-medium text-text-secondary">
                        {diffSummary || version.rulePrompt || '-'}
                      </span>
                    </td>
                    <td className="w-[13rem] px-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={isPublished || publishingVersionId === version.id}
                          onClick={() => onPublish(version)}
                          className="inline-flex h-7 min-w-[4.25rem] items-center justify-center gap-1 rounded-lg jade-primary-button px-3 text-[11px] font-medium text-white transition-colors disabled:cursor-not-allowed disabled:bg-surface-active disabled:text-text-muted disabled:opacity-70"
                        >
                          {publishingVersionId === version.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : null}
                          {isPublished
                            ? t('data.inputTables.editor.publishedVersion')
                            : t('data.inputTables.editor.publishVersionAction')}
                        </button>
                        <button
                          type="button"
                          disabled={isPublished || deletingVersionId === version.id}
                          onClick={() => onDelete(version)}
                          title={
                            isPublished
                              ? t('data.inputTables.editor.deletePublishedVersionBlocked')
                              : undefined
                          }
                          className="inline-flex h-7 min-w-[4.25rem] items-center justify-center gap-1 rounded-lg border border-danger/20 bg-danger/10 px-3 text-[11px] font-medium text-danger transition-colors hover:border-danger/40 hover:bg-danger/20 disabled:cursor-not-allowed disabled:border-border-muted disabled:bg-surface-active disabled:text-text-muted disabled:opacity-70"
                        >
                          {deletingVersionId === version.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          {deletingVersionId === version.id
                            ? t('data.inputTables.editor.deletingVersionAction')
                            : t('data.inputTables.editor.deleteVersionAction')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-3 py-6 text-center text-xs font-medium text-text-muted">
          {loading
            ? t('data.inputTables.editor.loadingVersions')
            : t('data.inputTables.editor.noVersions')}
        </div>
      )}
    </section>
  );
}

function InputTablePreviewDialog({
  tableKind = 'input',
  preview,
  isLoading,
  error,
  currentPage,
  onPageChange,
  onClose,
}: {
  tableKind?: 'input' | 'output';
  preview: DataInputTablePreview | null;
  isLoading: boolean;
  error: string | null;
  currentPage: number;
  onPageChange: (page: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const previewTitle =
    tableKind === 'output'
      ? t('data.outputTables.previewTitle')
      : t('data.inputTables.editor.previewTitle');
  const previewEmpty =
    tableKind === 'output'
      ? t('data.outputTables.previewEmpty')
      : t('data.inputTables.editor.previewEmpty');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#163526]/16 px-4 py-6 dark:bg-black/50">
      <div className="flex h-[42rem] max-h-[calc(100vh-3rem)] w-[72rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-card backdrop-blur-xl">
        <div className="glass-panel-header flex h-12 flex-shrink-0 items-center justify-between px-4">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-text-primary">{previewTitle}</div>
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

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--data-grid-cell-surface)]">
          <GlassDataGridPreview
            preview={preview}
            isLoading={isLoading}
            error={error}
            currentPage={currentPage}
            onPageChange={onPageChange}
            edgeToEdge
            labels={{
              loading: t('data.inputTables.editor.previewLoading'),
              empty: previewEmpty,
              total: (count) => t('data.inputTables.editor.previewTotal', { count }),
              pageSize: (count) => t('data.inputTables.editor.previewPageSize', { count }),
            }}
          />
        </div>
      </div>
    </div>
  );
}

function WorkflowOperatorDslDialog({
  nodeLabel,
  operatorType,
  operatorDsl,
  operatorDslStatus,
  operatorDslDiagnostics,
  editorCompletionLabels,
  fieldCompletions,
  formatEditorDiagnostic,
  isRunningOperatorDsl,
  onChange,
  onDiagnosticsChange,
  onClose,
  onCopy,
  onFormat,
  onApply,
}: {
  nodeLabel: string;
  operatorType: DataWorkflowOperatorType;
  operatorDsl: string;
  operatorDslStatus: string | null;
  operatorDslDiagnostics: PrepDiagnostic[];
  editorCompletionLabels: {
    keywords: string;
    snippets: string;
    types: string;
    fields: string;
  };
  fieldCompletions: string[];
  formatEditorDiagnostic: (diagnostic: PrepDiagnostic) => string;
  isRunningOperatorDsl: boolean;
  onChange: (value: string) => void;
  onDiagnosticsChange: (diagnostics: PrepDiagnostic[]) => void;
  onClose: () => void;
  onCopy: () => void;
  onFormat: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const hasErrors = operatorDslDiagnostics.some((diagnostic) => diagnostic.severity === 'error');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#163526]/16 px-4 py-6 dark:bg-black/50">
      <div className="flex h-[42rem] max-h-[calc(100vh-3rem)] w-[72rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-card backdrop-blur-xl">
        <div className="glass-panel-header flex h-12 flex-shrink-0 items-center justify-between px-4">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-text-primary">
              {t('data.workflow.dslEditor', 'DSL 编辑器')}
            </div>
            <div className="truncate text-[11px] text-text-muted">{nodeLabel}</div>
          </div>
          <div className="flex items-center gap-1.5">
            {operatorDslStatus && (
              <div className="flex h-6 min-w-0 items-center rounded-full border border-success/20 bg-success/5 px-2 text-[11px] text-success">
                <CheckCircle2 className="mr-1 h-3 w-3 flex-shrink-0" />
                <span className="truncate">{operatorDslStatus}</span>
              </div>
            )}
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-background/50 px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
            >
              <Copy className="h-3.5 w-3.5" />
              {t('data.workflow.copyDsl', 'Copy DSL')}
            </button>
            <button
              type="button"
              onClick={onFormat}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-background/50 px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
            >
              <Code2 className="h-3.5 w-3.5" />
              {t('data.workflow.formatDsl', 'Format')}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isRunningOperatorDsl}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-background/50 px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
            >
              <X className="h-3.5 w-3.5" />
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={isRunningOperatorDsl}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-55"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('data.workflow.applyOperatorDsl', 'Apply')}
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--data-grid-cell-surface)]">
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
            <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border-muted/80 bg-[var(--glass-card-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_1px_0_rgba(15,23,42,0.03)]">
              <PrepDslEditor
                value={operatorDsl}
                operatorType={operatorType}
                placeholderText={t('data.workflow.operatorDslPlaceholder')}
                completionLabels={editorCompletionLabels}
                formatDiagnostic={formatEditorDiagnostic}
                onChange={onChange}
                onDiagnosticsChange={onDiagnosticsChange}
                fieldCompletions={fieldCompletions}
                editable
                height="100%"
              />
            </div>
            {hasErrors && (
              <div className="max-h-24 overflow-y-auto rounded-lg border border-error/15 bg-error/5 px-2.5 py-2 text-[11px] leading-4 text-error">
                <div className="mb-1 font-medium">{t('data.workflow.syntaxInvalid')}</div>
                <div className="space-y-1">
                  {operatorDslDiagnostics
                    .filter((diagnostic) => diagnostic.severity === 'error')
                    .map((diagnostic, index) => (
                      <div
                        key={`${diagnostic.code ?? diagnostic.message}-${index}`}
                        className="rounded-md bg-background/72 px-2 py-1"
                      >
                        {formatEditorDiagnostic(diagnostic)}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InputTableFormLabel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`text-[13px] font-medium text-text-secondary ${className}`}>{children}</div>
  );
}

function InputTableInfo({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex min-h-11 items-center gap-2 rounded-lg border border-accent/15 bg-accent/5 px-3 text-xs font-medium text-text-muted ${className}`}
    >
      <Info className="h-4 w-4 flex-shrink-0 text-accent" />
      <span>{children}</span>
    </div>
  );
}

function InputTableSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <GlassSelect
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        options={options}
        triggerClassName="h-10 w-full justify-between rounded-lg bg-background/50 px-3 text-[13px] font-medium text-text-secondary disabled:opacity-60"
        contentClassName="w-[var(--radix-select-trigger-width)]"
      />
    </label>
  );
}

function InputTableCheckbox({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex w-fit items-center gap-2 text-[13px] font-medium text-text-secondary">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-border-muted accent-accent disabled:cursor-not-allowed disabled:opacity-60"
      />
      {label}
    </label>
  );
}

function InputTableStatusBadge({
  label,
  tone = 'success',
}: {
  label: string;
  tone?: 'success' | 'warning';
}) {
  return (
    <span
      className={`inline-flex h-6 whitespace-nowrap items-center gap-1.5 rounded-md px-2 text-xs font-medium ${
        tone === 'warning' ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function DataToolbarButton({
  icon,
  label,
  disabled,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border-muted bg-surface px-2.5 text-xs font-medium text-text-secondary shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        danger
          ? 'hover:border-error/30 hover:bg-error/10 hover:text-error'
          : 'hover:border-accent/30 hover:bg-accent/10 hover:text-accent'
      }`}
      title={label}
    >
      {icon}
      {label}
    </button>
  );
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

interface DataMoreMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function DataMoreMenu({ items }: { items: DataMoreMenuItem[] }) {
  const { t } = useTranslation();
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
          title={t('data.actions.more')}
          aria-label={t('data.actions.more')}
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

function StatusBadge({ status }: { status: DataTaskStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex h-6 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${statusBadgeClass(
        status
      )}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {t(`data.status.${status}`)}
    </span>
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
  embedded = false,
}: {
  count: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const pageCount = getTablePageCount(count);
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);
  const pageNumbers = getVisiblePageNumbers(safeCurrentPage, pageCount);

  return (
    <div
      className={`flex min-h-11 flex-col items-center justify-between gap-2 px-4 text-xs font-medium text-text-secondary sm:flex-row ${
        embedded ? 'border-t border-border-muted py-2.5' : 'mt-3'
      }`}
    >
      <span>{t('data.totalCount', { count })}</span>
      <div className="flex items-center gap-2">
        <button className="inline-flex h-8 min-w-[7rem] items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-text-secondary shadow-soft">
          {t('data.rowsPerPage', { count: TABLE_PAGE_SIZE })}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <div className="flex items-center gap-2">
          {pageCount > 1 && (
            <button
              onClick={() => onPageChange(safeCurrentPage - 1)}
              disabled={safeCurrentPage <= 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-muted shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {pageNumbers.map((pageNumber) => (
            <button
              key={pageNumber}
              onClick={() => onPageChange(pageNumber)}
              aria-current={pageNumber === safeCurrentPage ? 'page' : undefined}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-medium shadow-soft ${
                pageNumber === safeCurrentPage
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-muted bg-surface text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent'
              }`}
            >
              {pageNumber}
            </button>
          ))}
          {pageCount > 1 && (
            <button
              onClick={() => onPageChange(safeCurrentPage + 1)}
              disabled={safeCurrentPage >= pageCount}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function getTablePageCount(count: number): number {
  return Math.max(1, Math.ceil(count / TABLE_PAGE_SIZE));
}

function matchesSearchText(value: string, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return value.toLowerCase().includes(normalizedQuery);
}

function getVisiblePageNumbers(currentPage: number, pageCount: number): number[] {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const start = Math.max(1, Math.min(currentPage - 2, pageCount - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
}

function statusBadgeClass(status: DataTaskStatus): string {
  switch (status) {
    case 'running':
      return 'bg-success/10 text-success';
    case 'completed':
      return 'bg-accent/10 text-accent';
    case 'stopped':
      return 'bg-text-muted/10 text-text-muted';
    case 'pending':
      return 'bg-warning/10 text-warning';
    case 'failed':
      return 'bg-error/10 text-error';
    case 'draft':
    default:
      return 'bg-surface-active text-text-secondary';
  }
}

function formatTimestamp(timestamp: number | null, t: (key: string) => string): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86_400_000;
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  if (timestamp >= startToday) {
    return `${t('data.relative.today')} ${time}`;
  }
  if (timestamp >= startYesterday) {
    return `${t('data.relative.yesterday')} ${time}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDateTime(timestamp: number | null): string {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function getPreferredNormalizerFilePath(
  files: DataNormalizerProjectFile[],
  language: DataNormalizerLanguage
): string {
  const preferred = language === 'node' ? 'src/transform.js' : 'normalizer/transform.py';
  return (
    files.find((file) => file.path === preferred)?.path ??
    files.find((file) => file.path.endsWith('/transform.py') || file.path.endsWith('/transform.js'))
      ?.path ??
    files[0]?.path ??
    ''
  );
}

function createNormalizerGenerationProgressId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `normalizer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildNormalizerGenerationStartOutput(input: {
  inputTableName: string;
  sourceKind: DataInputTableSourceKind;
  language: DataNormalizerLanguage;
  rulePrompt: string;
  t: TranslateFn;
}): string {
  return [
    `**${input.t('data.inputTables.editor.generationOutputStartTitle')}**`,
    '',
    `- ${input.t('data.inputTables.editor.generationOutputInputTable')}: ${input.inputTableName}`,
    `- ${input.t('data.inputTables.editor.generationOutputSourceKind')}: ${input.sourceKind}`,
    `- ${input.t('data.inputTables.editor.generationOutputLanguage')}: ${input.language === 'node' ? 'Node.js' : 'Python'}`,
    `- ${input.t('data.inputTables.editor.rulePrompt')}: ${truncateGenerationLogText(input.rulePrompt, 220)}`,
    '',
    '```text',
    input.t('data.inputTables.editor.generationOutputPreparing'),
    '```',
  ].join('\n');
}

function buildNormalizerGenerationSuccessOutput(input: {
  artifactId: string;
  versionNumber: number;
  files: DataNormalizerProjectFile[];
  language: DataNormalizerLanguage;
  t: TranslateFn;
}): string {
  const fileLines = input.files.slice(0, 12).map((file) => `- ${file.path}`);
  const extraCount = Math.max(0, input.files.length - fileLines.length);
  if (extraCount > 0) {
    fileLines.push(`- ... +${extraCount}`);
  }
  return [
    '```text',
    `[4/4] ${input.t('data.inputTables.editor.generatedStatusReady')}`,
    `artifact=${input.artifactId}`,
    `version=v${input.versionNumber}`,
    `language=${input.language}`,
    '```',
    '',
    `**${input.t('data.inputTables.editor.generatedDraftFiles', {
      count: input.files.length,
    })}**`,
    '',
    ...fileLines,
  ].join('\n');
}

function truncateGenerationLogText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function buildNormalizerProjectTree(
  files: DataNormalizerProjectFile[]
): NormalizerProjectTreeNode[] {
  const roots: NormalizerProjectTreeNode[] = [];
  const folderMap = new Map<string, NormalizerProjectTreeNode>();
  const getFolder = (folderPath: string, name: string): NormalizerProjectTreeNode => {
    const existing = folderMap.get(folderPath);
    if (existing) return existing;
    const node: NormalizerProjectTreeNode = {
      name,
      path: folderPath,
      type: 'folder',
      children: [],
    };
    folderMap.set(folderPath, node);
    const parentPath = folderPath.includes('/')
      ? folderPath.slice(0, folderPath.lastIndexOf('/'))
      : '';
    if (parentPath) {
      const parentName = parentPath.split('/').pop() ?? parentPath;
      getFolder(parentPath, parentName).children.push(node);
    } else {
      roots.push(node);
    }
    return node;
  };

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    const fileName = parts[parts.length - 1];
    const folderParts = parts.slice(0, -1);
    const fileNode: NormalizerProjectTreeNode = {
      name: fileName,
      path: file.path,
      type: 'file',
      children: [],
    };
    if (folderParts.length === 0) {
      roots.push(fileNode);
      continue;
    }
    const folderPath = folderParts.join('/');
    const folder = getFolder(folderPath, folderParts[folderParts.length - 1]);
    folder.children.push(fileNode);
  }

  const sortTree = (nodes: NormalizerProjectTreeNode[]) => {
    nodes.sort(
      (left, right) =>
        Number(left.type === 'file') - Number(right.type === 'file') ||
        left.name.localeCompare(right.name)
    );
    nodes.forEach((node) => sortTree(node.children));
  };
  sortTree(roots);
  return roots;
}

function getNormalizerVersionDiffSummary(
  version: DataInputTableNormalizerArtifactVersion,
  current: DataInputTableNormalizerArtifactVersion | undefined,
  t: TranslateFn
): string {
  if (!current || version.id === current.id) {
    return '';
  }
  const currentFiles = new Map(current.files.map((file) => [file.path, file.content]));
  const versionFiles = new Map(version.files.map((file) => [file.path, file.content]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [path, content] of versionFiles) {
    if (!currentFiles.has(path)) {
      added += 1;
    } else if (currentFiles.get(path) !== content) {
      changed += 1;
    }
  }
  for (const path of currentFiles.keys()) {
    if (!versionFiles.has(path)) {
      removed += 1;
    }
  }
  return t('data.inputTables.editor.versionDiffSummary', {
    changed,
    added,
    removed,
    rule:
      version.rulePrompt === current.rulePrompt
        ? t('data.inputTables.editor.versionRuleSame')
        : t('data.inputTables.editor.versionRuleChanged'),
  });
}

function formatRelatedTaskNames(
  names: string[],
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (names.length === 0) return t('data.inputTables.noRelatedTasks');
  return names.join(', ');
}

function formatOutputTableRelatedTaskNames(
  outputTable: DataOutputTable,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (outputTable.relatedTaskNames.length > 0) {
    return formatRelatedTaskNames(outputTable.relatedTaskNames, t);
  }
  if (outputTable.sourceDatasetId) {
    return t('data.outputTables.relatedInputTable');
  }
  return t('data.inputTables.noRelatedTasks');
}

function formatDisplayPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.replace(/^\/Users\/[^/]+/, '~');
}

function inferNormalizerLanguageFromRulePrompt(rulePrompt: string): DataNormalizerLanguage {
  const normalized = rulePrompt.toLowerCase();
  if (/\b(node|node\.js|javascript|typescript|npm|js)\b/.test(normalized)) {
    return 'node';
  }
  return 'python';
}

function getDefaultInputTableConfig(sourceKind: DataInputTableSourceKind): DataInputTableConfig {
  if (sourceKind === 'excel') {
    return getDefaultExcelInputTableConfig();
  }
  if (sourceKind === 'folder') {
    return getDefaultFolderInputTableConfig();
  }
  return {
    sourceKind: 'csv',
    header: 'auto',
    dataRegion: 'auto',
    encoding: 'auto',
    delimiter: 'auto',
    dataProcessing: getDefaultInputTableDataProcessing(),
  };
}

function getDefaultExcelInputTableConfig(): DataInputTableExcelConfig {
  return {
    sourceKind: 'excel',
    sheetName: 'Sheet1',
    sheetNames: ['Sheet1'],
    headerMode: 'auto',
    headerRow: 1,
    dataProcessing: getDefaultInputTableDataProcessing(),
  };
}

function getDefaultFolderInputTableConfig(): DataInputTableFolderConfig {
  return {
    sourceKind: 'folder',
    mergeMode: 'append_same_schema',
    schemaStrategy: 'align_by_name',
    fileRange: 'excel_csv',
    skipEmptyFiles: true,
    keepSourceFileName: true,
    dataProcessing: getDefaultInputTableDataProcessing(),
  };
}

function getDefaultInputTableDataProcessing(): DataInputTableProcessingConfig {
  return { strategy: 'auto' };
}

function getInputTableDataProcessing(config: DataInputTableConfig): DataInputTableProcessingConfig {
  if (config.dataProcessing?.strategy === 'customize') {
    return {
      ...config.dataProcessing,
      rulePrompt: config.dataProcessing.rulePrompt ?? '',
    };
  }
  return getDefaultInputTableDataProcessing();
}

function withInputTableDataProcessing(
  config: DataInputTableConfig,
  dataProcessing: DataInputTableProcessingConfig
): DataInputTableConfig {
  return {
    ...config,
    dataProcessing,
  } as DataInputTableConfig;
}

function isInputTableConfigEqual(
  left: DataInputTableConfig,
  right: DataInputTableConfig | undefined
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getInputTableSourceMeta(kind: InputTableSourceKind): {
  Icon: LucideIcon;
  labelKey: string;
  className: string;
  badgeClassName: string;
} {
  switch (kind) {
    case 'draft':
      return {
        Icon: Table2,
        labelKey: 'data.inputTables.sources.notConfigured',
        className: 'bg-warning/10 text-warning',
        badgeClassName: 'bg-warning/10 text-warning',
      };
    case 'excel':
      return {
        Icon: Table2,
        labelKey: 'data.inputTables.sources.excel',
        className: 'bg-success/10 text-success',
        badgeClassName: 'bg-success/10 text-success',
      };
    case 'csv':
      return {
        Icon: FileText,
        labelKey: 'data.inputTables.sources.csv',
        className: 'bg-accent/10 text-accent',
        badgeClassName: 'bg-accent/10 text-accent',
      };
    case 'folder':
      return {
        Icon: Folder,
        labelKey: 'data.inputTables.sources.folder',
        className: 'bg-warning/10 text-warning',
        badgeClassName: 'bg-warning/10 text-warning',
      };
    default:
      return {
        Icon: FileText,
        labelKey: 'data.inputTables.sources.file',
        className: 'bg-surface-active/70 text-text-secondary',
        badgeClassName: 'bg-surface-active/70 text-text-secondary',
      };
  }
}
