import { v4 as uuidv4 } from 'uuid';
import type {
  DataWorkflowEdge,
  DataWorkflowEdgeInput,
  DataWorkflowNode,
  DataWorkflowNodeInput,
  DataWorkflowOperatorType,
  DataWorkflowSaveInput,
} from '../../../renderer/types';
import { toFiniteNumber, toNumber } from '../operators';

export const WORKFLOW_TEMP_CACHE_TTL_MS = 86_400_000;

export interface DataWorkflowNodeRow {
  id: string;
  task_id: string;
  node_key: string;
  label: string;
  ordinal: number | string;
  operator_type: string | null;
  x: number | string | null;
  y: number | string | null;
  config_json: string | null;
  created_at: number | string;
  updated_at: number | string | null;
}

export interface DataWorkflowEdgeRow {
  id: string;
  task_id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle: string | null;
  target_handle: string | null;
  created_at: number | string;
}

export interface DataWorkflowNodeCacheRow {
  id: string;
  task_id: string;
  node_id: string;
  node_type: string;
  table_name: string;
  cache_scope: string;
  expires_at: number | string | null;
  created_at: number | string;
  updated_at: number | string;
}

export interface RuntimeWorkflow {
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
}

export type WorkflowOutputMode = 'persisted' | 'temporary';

export type WorkflowCacheScope = 'permanent' | 'temporary';

export const WORKFLOW_OPERATOR_TYPES: readonly DataWorkflowOperatorType[] = [
  'input_source',
  'filter',
  'field_select',
  'deduplicate',
  'missing_value',
  'type_convert',
  'sort',
  'join',
  'aggregate',
  'calculate_field',
  'field_mapping',
  'limit',
  'pivot',
  'unpivot',
  'set_op',
  'unnest',
  'output',
];

export const WORKFLOW_OPERATOR_TYPE_SET = new Set<string>(WORKFLOW_OPERATOR_TYPES);

export const DEFAULT_OPERATOR_LABELS: Record<DataWorkflowOperatorType, string> = {
  input_source: '输入',
  filter: '筛选',
  field_select: '字段选择',
  deduplicate: '去重',
  missing_value: '缺失值处理',
  type_convert: '类型转换',
  sort: '排序',
  join: '表连接',
  aggregate: '聚合',
  calculate_field: '计算字段',
  field_mapping: '字段映射',
  limit: '限制行数',
  pivot: '透视',
  unpivot: '反透视',
  set_op: '集合操作',
  unnest: '嵌套展开',
  output: '输出',
};

export const LEGACY_DEFAULT_WORKFLOW_NODES: ReadonlyArray<{
  key: string;
  type: DataWorkflowOperatorType;
  label: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
}> = [
  {
    key: 'source',
    type: 'input_source',
    label: DEFAULT_OPERATOR_LABELS.input_source,
    x: 48,
    y: 128,
    config: { output: 'raw_dataset' },
  },
  {
    key: 'filter',
    type: 'filter',
    label: DEFAULT_OPERATOR_LABELS.filter,
    x: 190,
    y: 128,
    config: { condition: '' },
  },
  {
    key: 'deduplicate',
    type: 'deduplicate',
    label: DEFAULT_OPERATOR_LABELS.deduplicate,
    x: 332,
    y: 128,
    config: { strategy: 'all_columns' },
  },
  {
    key: 'missing',
    type: 'missing_value',
    label: DEFAULT_OPERATOR_LABELS.missing_value,
    x: 474,
    y: 128,
    config: {
      strategy: 'by_column',
      rules: [
        { column: 'user_id', ratio: '0.02%', method: 'skip' },
        { column: 'device_id', ratio: '1.15%', method: 'skip' },
        { column: 'event_time', ratio: '3.24%', method: 'forward_fill' },
        { column: 'event_type', ratio: '0.85%', method: 'mode_fill' },
        { column: 'page_id', ratio: '12.41%', method: 'drop' },
      ],
    },
  },
  {
    key: 'calculate',
    type: 'calculate_field',
    label: DEFAULT_OPERATOR_LABELS.calculate_field,
    x: 190,
    y: 270,
    config: { expression: '' },
  },
  {
    key: 'mapping',
    type: 'field_mapping',
    label: DEFAULT_OPERATOR_LABELS.field_mapping,
    x: 474,
    y: 270,
    config: { mappings: [] },
  },
  {
    key: 'output',
    type: 'output',
    label: DEFAULT_OPERATOR_LABELS.output,
    x: 474,
    y: 412,
    config: { destination: 'duckdb_table' },
  },
];

export function mapWorkflowNodeRow(row: DataWorkflowNodeRow): DataWorkflowNode {
  const type = normalizeOperatorType(row.operator_type ?? row.node_key);
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    type,
    label: row.label ? String(row.label) : DEFAULT_OPERATOR_LABELS[type],
    x: toFiniteNumber(row.x, 48),
    y: toFiniteNumber(row.y, 128),
    config: parseWorkflowConfig(row.config_json),
    createdAt: toNumber(row.created_at),
    updatedAt: row.updated_at === null ? toNumber(row.created_at) : toNumber(row.updated_at),
  };
}

export function mapWorkflowEdgeRow(row: DataWorkflowEdgeRow): DataWorkflowEdge {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    sourceNodeId: String(row.source_node_id),
    targetNodeId: String(row.target_node_id),
    sourceHandle: row.source_handle ? String(row.source_handle) : null,
    targetHandle: row.target_handle ? String(row.target_handle) : null,
    createdAt: toNumber(row.created_at),
  };
}

export function isLegacyDefaultWorkflow(rows: DataWorkflowNodeRow[]): boolean {
  if (rows.length !== LEGACY_DEFAULT_WORKFLOW_NODES.length) {
    return false;
  }
  return rows.every((row, index) => {
    const legacyNode = LEGACY_DEFAULT_WORKFLOW_NODES[index];
    const normalizedType = normalizeOperatorType(row.operator_type ?? row.node_key);
    const legacyLabel = String(row.label);
    const isLegacyInputLabel =
      legacyNode.type === 'input_source' &&
      (legacyLabel === '数据源' || legacyLabel === '输入数据源');
    return (
      normalizedType === legacyNode.type &&
      (legacyLabel === legacyNode.label || isLegacyInputLabel) &&
      Math.abs(toFiniteNumber(row.x, Number.NaN) - legacyNode.x) < 0.001 &&
      Math.abs(toFiniteNumber(row.y, Number.NaN) - legacyNode.y) < 0.001
    );
  });
}

export function normalizeWorkflowNodeInputs(
  nodes: DataWorkflowNodeInput[]
): DataWorkflowNodeInput[] {
  return nodes.map((node, index) => {
    const type = normalizeOperatorType(node.type);
    const label = node.label.trim() || DEFAULT_OPERATOR_LABELS[type];
    return {
      id: node.id.trim() || uuidv4(),
      type,
      label,
      x: toFiniteNumber(node.x, 80 + index * 28),
      y: toFiniteNumber(node.y, 120 + index * 24),
      config: node.config ?? {},
    };
  });
}

export function normalizeWorkflowEdgeInputs(
  edges: DataWorkflowEdgeInput[],
  nodeIds: Set<string>
): DataWorkflowEdgeInput[] {
  const seen = new Set<string>();
  const normalized: DataWorkflowEdgeInput[] = [];
  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      continue;
    }
    const key = `${edge.sourceNodeId}:${edge.targetNodeId}:${edge.sourceHandle ?? ''}:${
      edge.targetHandle ?? ''
    }`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      id: edge.id.trim() || uuidv4(),
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sourceHandle: edge.sourceHandle ?? 'output',
      targetHandle: edge.targetHandle ?? 'input',
    });
  }
  return normalized;
}

export function normalizeScopedWorkflowInputs(
  taskId: string,
  input: DataWorkflowSaveInput
): { nodes: DataWorkflowNodeInput[]; edges: DataWorkflowEdgeInput[] } {
  const nodes = normalizeWorkflowNodeInputs(input.nodes);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const idByOriginalNodeId = new Map(
    nodes.map((node) => [node.id, scopedWorkflowEntityId(taskId, node.id)])
  );
  const scopedNodes = nodes.map((node) => ({
    ...node,
    id: idByOriginalNodeId.get(node.id) ?? node.id,
  }));
  const edges = normalizeWorkflowEdgeInputs(input.edges, nodeIds);
  const scopedEdges = edges.flatMap((edge) => {
    const sourceNodeId = idByOriginalNodeId.get(edge.sourceNodeId);
    const targetNodeId = idByOriginalNodeId.get(edge.targetNodeId);
    if (!sourceNodeId || !targetNodeId) return [];
    return [
      {
        ...edge,
        id: scopedWorkflowEntityId(taskId, edge.id),
        sourceNodeId,
        targetNodeId,
      },
    ];
  });
  return { nodes: scopedNodes, edges: scopedEdges };
}

export function scopedWorkflowEntityId(taskId: string, id: string): string {
  const prefix = `${taskId.replace(/[^A-Za-z0-9]+/g, '_') || 'task'}__`;
  return id.startsWith(prefix) ? id : `${prefix}${id}`;
}

export function normalizeRuntimeWorkflowInput(
  taskId: string,
  input: DataWorkflowSaveInput,
  timestamp: number
): RuntimeWorkflow {
  const nodes = normalizeWorkflowNodeInputs(input.nodes).map<DataWorkflowNode>((node) => ({
    id: node.id,
    taskId,
    type: node.type,
    label: node.label,
    x: node.x,
    y: node.y,
    config: node.config ?? {},
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = normalizeWorkflowEdgeInputs(input.edges, nodeIds).map<DataWorkflowEdge>((edge) => ({
    id: edge.id,
    taskId,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    sourceHandle: edge.sourceHandle ?? 'output',
    targetHandle: edge.targetHandle ?? 'input',
    createdAt: timestamp,
  }));
  return { nodes, edges };
}

export function workflowRequiresTaskSource(nodes: DataWorkflowNode[]): boolean {
  if (nodes.length === 0) return true;
  return nodes.some((node) => {
    if (node.type !== 'input_source') return false;
    const source =
      typeof node.config.source === 'string'
        ? node.config.source
        : stringConfigValue(node.config.datasetId)
          ? 'dataset'
          : 'task';
    return source === 'task' || (source === 'file' && !stringConfigValue(node.config.filePath));
  });
}

export function parseWorkflowConfig(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

export function normalizeOperatorType(value: string | null | undefined): DataWorkflowOperatorType {
  if (value && WORKFLOW_OPERATOR_TYPE_SET.has(value)) {
    return value as DataWorkflowOperatorType;
  }
  switch (value) {
    case 'load_source':
      return 'input_source';
    case 'profile_schema':
      return 'field_select';
    case 'drop_empty_rows':
      return 'missing_value';
    case 'deduplicate_rows':
      return 'deduplicate';
    case 'join_table':
    case 'asof_join':
      return 'join';
    case 'write_duckdb_table':
    case 'publish_dataset':
      return 'output';
    default:
      return 'filter';
  }
}

export function getOutputTableName(node: DataWorkflowNode | undefined, fallback: string): string {
  if (!node) return fallback;
  const table = node.config.table;
  return typeof table === 'string' && table.trim() ? table.trim() : fallback;
}

export function stringConfigValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function findWorkflowTerminalNodeId(
  nodes: DataWorkflowNode[],
  edges: DataWorkflowEdge[]
): string | null {
  const nonOutputIds = new Set(
    nodes.filter((node) => node.type !== 'output').map((node) => node.id)
  );
  const sourceIdsWithOutgoingEdges = new Set(
    edges.filter((edge) => nonOutputIds.has(edge.sourceNodeId)).map((edge) => edge.sourceNodeId)
  );
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.type !== 'output' && !sourceIdsWithOutgoingEdges.has(node.id)) return node.id;
  }
  return [...nonOutputIds].pop() ?? null;
}

export function toPersistentCreateTableSql(sql: string): string {
  return sql.replace(/\bCREATE\s+TEMP\s+TABLE\b/i, 'CREATE TABLE');
}
