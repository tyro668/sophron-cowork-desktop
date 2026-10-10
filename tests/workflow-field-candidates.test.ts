import { describe, expect, it } from 'vitest';
import type { DataWorkflowEdge, DataWorkflowNode } from '../src/renderer/types';
import { getWorkflowFieldSourceCandidates } from '../src/renderer/components/data-view/data-pipelines/workflow/workflow-field-candidates';

function node(id: string, type: DataWorkflowNode['type']): DataWorkflowNode {
  return {
    id,
    pipelineId: 'pipeline',
    type,
    label: id,
    x: 0,
    y: 0,
    config: {},
    createdAt: 0,
    updatedAt: 0,
  };
}

function edge(sourceNodeId: string, targetNodeId: string): DataWorkflowEdge {
  return {
    id: `${sourceNodeId}-${targetNodeId}`,
    pipelineId: 'pipeline',
    sourceNodeId,
    targetNodeId,
    sourceHandle: null,
    targetHandle: null,
    createdAt: 0,
  };
}

describe('getWorkflowFieldSourceCandidates', () => {
  it('透传算子未缓存时可继续查询上游输入表字段', () => {
    const input = node('input', 'input_source');
    const filter = node('filter', 'filter');
    const sort = node('sort', 'sort');
    expect(
      getWorkflowFieldSourceCandidates(
        sort,
        [input, filter, sort],
        [edge('input', 'filter'), edge('filter', 'sort')]
      ).map((item) => item.id)
    ).toEqual(['sort', 'filter', 'input']);
  });

  it('字段选择算子会改变输出字段，不能越过它回退', () => {
    const input = node('input', 'input_source');
    const select = node('select', 'field_select');
    const filter = node('filter', 'filter');
    expect(
      getWorkflowFieldSourceCandidates(
        filter,
        [input, select, filter],
        [edge('input', 'select'), edge('select', 'filter')]
      ).map((item) => item.id)
    ).toEqual(['filter', 'select']);
  });

  it('异常环路不会反复请求同一节点', () => {
    const filter = node('filter', 'filter');
    const sort = node('sort', 'sort');
    expect(
      getWorkflowFieldSourceCandidates(
        sort,
        [filter, sort],
        [edge('filter', 'sort'), edge('sort', 'filter')]
      ).map((item) => item.id)
    ).toEqual(['sort', 'filter']);
  });
});
