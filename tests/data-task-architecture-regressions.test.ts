import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import { createDataTaskStore, type DataTaskStore } from '../src/main/data/data-task-store';
import { normalizeOperatorType } from '../src/main/data/store/workflow-model';
import { getOperatorConfigValidation } from '../src/shared/operator-schemas';
import type {
  DataCleaningTask,
  DataTaskWorkflow,
  DataWorkflowNode,
  DataWorkflowOperatorType,
  DataWorkflowSaveInput,
} from '../src/renderer/types';
import {
  canConnectWorkflowNodes,
  reconnectWorkflowEdge,
} from '../src/renderer/components/data-view/data-tasks/workflow/workflow-graph-operations';

const stores: DataTaskStore[] = [];
const tempRoots: string[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('data task architecture regressions', () => {
  it('preserves the last successful output when a formal rerun fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-safe-rerun-'));
    tempRoots.push(root);
    const databasePath = path.join(root, 'workspace.duckdb');
    const sourcePath = path.join(root, 'source.csv');
    fs.writeFileSync(sourcePath, 'id,value\n1,old\n', 'utf8');

    const store = createDataTaskStore(databasePath);
    stores.push(store);
    const task = await store.createTask({ name: 'Safe rerun', sourcePath });
    const completed = await store.runTask(task.id);
    expect(completed.outputTable).toBeTruthy();

    await expect(
      store.runTask(task.id, { sourcePath: path.join(root, 'missing.csv') })
    ).rejects.toThrow();
    stores.pop()?.close();

    const database = await DuckDBInstance.create(databasePath);
    const connection = await database.connect();
    try {
      const result = await connection.runAndReadAll(
        `SELECT id, value FROM "${completed.outputTable}"`
      );
      expect(result.getRowObjectsJson()).toEqual([{ id: '1', value: 'old' }]);
    } finally {
      connection.closeSync();
      database.closeSync();
    }
  });

  it('invalidates node previews when executable workflow configuration changes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-cache-invalidation-'));
    tempRoots.push(root);
    const sourcePath = path.join(root, 'source.csv');
    fs.writeFileSync(sourcePath, 'id,value\n1,old\n', 'utf8');

    const store = createDataTaskStore(path.join(root, 'workspace.duckdb'));
    stores.push(store);
    const task = await store.createTask({ name: 'Cache invalidation', sourcePath });
    const workflow: DataWorkflowSaveInput = {
      nodes: [
        {
          id: 'source',
          type: 'input_source',
          label: 'Source',
          x: 0,
          y: 0,
          config: { source: 'task' },
        },
        {
          id: 'select',
          type: 'field_select',
          label: 'Select',
          x: 0,
          y: 0,
          config: { columns: ['id'], mode: 'include' },
        },
        { id: 'output', type: 'output', label: 'Output', x: 0, y: 0, config: {} },
      ],
      edges: [
        { id: 'source-select', sourceNodeId: 'source', targetNodeId: 'select' },
        { id: 'select-output', sourceNodeId: 'select', targetNodeId: 'output' },
      ],
    };
    const saved = await store.saveTaskWorkflow(task.id, workflow);
    const selectedNode = saved.nodes.find((node) => node.type === 'field_select')!;
    await store.runTask(task.id, { outputMode: 'temporary' });
    const initialPreview = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: selectedNode.id,
      nodeType: selectedNode.type,
      nodeConfig: selectedNode.config,
    });
    expect(initialPreview.columns).toEqual(['id']);

    const moved = await store.saveTaskWorkflow(task.id, {
      nodes: saved.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        label: node.label,
        x: node.x + 40,
        y: node.y,
        config: node.config,
      })),
      edges: saved.edges,
    });
    const previewAfterMove = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: selectedNode.id,
      nodeType: selectedNode.type,
      nodeConfig: selectedNode.config,
    });
    expect(previewAfterMove.columns).toEqual(['id']);

    await store.saveTaskWorkflow(task.id, {
      nodes: moved.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        label: node.label,
        x: node.x,
        y: node.y,
        config: node.id === selectedNode.id ? { ...node.config, columns: ['value'] } : node.config,
      })),
      edges: moved.edges,
    });
    const previewAfterSave = await store.previewWorkflowNode({
      taskId: task.id,
      nodeId: selectedNode.id,
      nodeType: selectedNode.type,
      nodeConfig: { ...selectedNode.config, columns: ['value'] },
    });
    // The stale cache is gone; the schema falls back to plan inference using
    // the new executable config rather than showing the old cached columns.
    expect(previewAfterSave.columns).toEqual(['value']);
  });

  it('rejects unknown operator types at validation and normalization boundaries', () => {
    expect(getOperatorConfigValidation('unknown_operator', {}).success).toBe(false);
    expect(() => normalizeOperatorType('unknown_operator')).toThrow(
      /Unsupported workflow operator/
    );
  });

  it('keeps right-input configuration aligned when a right edge moves to another node', () => {
    const workflow = makeWorkflow(
      [
        makeNode('source', 'input_source', { alias: 'orders' }),
        makeNode('join-a', 'join', { rightInput: 'orders', rightAlias: 'orders' }),
        makeNode('join-b', 'join', {}),
      ],
      [
        {
          id: 'right-edge',
          taskId: 'task',
          sourceNodeId: 'source',
          targetNodeId: 'join-a',
          sourceHandle: 'output',
          targetHandle: 'right',
          createdAt: 1,
        },
      ]
    );
    const next = reconnectWorkflowEdge(workflow, 'right-edge', {
      sourceNodeId: 'source',
      targetNodeId: 'join-b',
      sourceHandle: 'output',
      targetHandle: 'right',
    });
    expect(next.nodes.find((node) => node.id === 'join-a')?.config.rightInput).toBeUndefined();
    expect(next.nodes.find((node) => node.id === 'join-b')?.config.rightInput).toBe('orders');
  });

  it('rejects cycles and a second edge into an occupied input port', () => {
    const nodes = [makeNode('a', 'filter'), makeNode('b', 'filter'), makeNode('c', 'filter')];
    const edges = [
      {
        id: 'a-b',
        taskId: 'task',
        sourceNodeId: 'a',
        targetNodeId: 'b',
        sourceHandle: 'output',
        targetHandle: 'input',
        createdAt: 1,
      },
      {
        id: 'b-c',
        taskId: 'task',
        sourceNodeId: 'b',
        targetNodeId: 'c',
        sourceHandle: 'output',
        targetHandle: 'input',
        createdAt: 1,
      },
    ];
    expect(
      canConnectWorkflowNodes(nodes, edges, {
        sourceNodeId: 'c',
        targetNodeId: 'a',
      })
    ).toBe(false);
    expect(
      canConnectWorkflowNodes(nodes, edges, {
        sourceNodeId: 'a',
        targetNodeId: 'c',
      })
    ).toBe(false);
  });
});

function makeNode(
  id: string,
  type: DataWorkflowOperatorType,
  config: Record<string, unknown> = {}
): DataWorkflowNode {
  return {
    id,
    taskId: 'task',
    type,
    label: id,
    x: 0,
    y: 0,
    config,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeWorkflow(
  nodes: DataWorkflowNode[],
  edges: DataTaskWorkflow['edges']
): DataTaskWorkflow {
  return {
    task: {} as DataCleaningTask,
    nodes,
    edges,
  };
}
