/**
 * Starter-graph builder for an empty workflow canvas: a ready-to-edit
 * input_source → sql_query → output chain so a new pipeline never lands on a
 * blank canvas. Node ids/positions follow the editor's own conventions
 * (makeLocalId / getNextWorkflowNodePosition); the graph is a draft — it
 * persists only when the user saves.
 */
import { DEFAULT_SQL_QUERY } from '../../../../../shared/sql-query';
import type {
  DataWorkflowEdge,
  DataWorkflowNode,
  DataWorkflowOperatorType,
} from '../../../../types';
import { makeLocalId } from '../../shared';
import { getNextWorkflowNodePosition } from './canvas-utils';

export interface WorkflowStarterGraph {
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
}

function starterNode({
  pipelineId,
  type,
  label,
  index,
  config,
  createdAt,
}: {
  pipelineId: string;
  type: DataWorkflowOperatorType;
  label: string;
  index: number;
  config: Record<string, unknown>;
  createdAt: number;
}): DataWorkflowNode {
  return {
    id: makeLocalId('node'),
    pipelineId,
    type,
    label,
    ...getNextWorkflowNodePosition(index),
    config,
    createdAt,
    updatedAt: createdAt,
  };
}

export function buildWorkflowStarterGraph({
  pipelineId,
  sourceRawTableId,
  sourceName,
  resultTableName,
  labels,
}: {
  pipelineId: string;
  /** Bound input table when the pipeline carries one (created "from this table"). */
  sourceRawTableId?: string | null;
  sourceName?: string | null;
  /**
   * Display name for the auto-created output table. Omit when seeding a
   * persisted graph — an unnamed auto output stays unbound instead of
   * creating an output table before the user confirms anything.
   */
  resultTableName?: string;
  /** Localized operator labels (t(catalog.labelKey)). */
  labels: Record<'input_source' | 'sql_query' | 'output', string>;
}): WorkflowStarterGraph {
  const createdAt = Date.now();
  const inputConfig: Record<string, unknown> = { source: 'rawTable' };
  if (sourceRawTableId) {
    inputConfig.rawTableId = sourceRawTableId;
    inputConfig.rawTableName = sourceName ?? sourceRawTableId;
    inputConfig.name = sourceName ?? sourceRawTableId;
    inputConfig.alias = 'source';
  }
  const source = starterNode({
    pipelineId,
    type: 'input_source',
    label: labels.input_source,
    index: 0,
    config: inputConfig,
    createdAt,
  });
  const sql = starterNode({
    pipelineId,
    type: 'sql_query',
    label: labels.sql_query,
    index: 1,
    config: { sql: DEFAULT_SQL_QUERY },
    createdAt,
  });
  const output = starterNode({
    pipelineId,
    type: 'output',
    label: labels.output,
    index: 2,
    config: {
      destination: 'duckdb_table',
      outputStrategy: 'auto',
      ...(resultTableName ? { resultTableName } : {}),
      mode: 'replace',
    },
    createdAt,
  });
  const link = (from: DataWorkflowNode, to: DataWorkflowNode): DataWorkflowEdge => ({
    id: makeLocalId('edge'),
    pipelineId,
    sourceNodeId: from.id,
    targetNodeId: to.id,
    sourceHandle: 'output',
    targetHandle: 'input',
    createdAt,
  });
  return { nodes: [source, sql, output], edges: [link(source, sql), link(sql, output)] };
}
