// @vitest-environment happy-dom
/**
 * AI-generate dialog multi-turn flow: ambiguous analysis items keep the
 * conversation open — follow-up turns re-analyze the accumulated text and
 * generation then uses the confirmed requirement (matching the backend's
 * analysis-receipt contract).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './i18n-test';
import { WorkflowAiGenerateDialog } from '../../src/renderer/components/data-view/data-tasks/workflow/WorkflowAiGenerateDialog';

const analyzeTaskRequirement = vi.fn();
const generateTaskFromRequirement = vi.fn();

function setupBridge() {
  (window as { electronAPI?: unknown }).electronAPI = {
    data: { analyzeTaskRequirement, generateTaskFromRequirement },
  };
}

function ambiguousResult(analysisId: string) {
  return {
    status: 'needs_confirmation',
    analysisId,
    items: [
      {
        requirement: '计算各个省份的总销售额',
        status: 'ambiguous',
        reason: '输入列中没有“省份”字段；只有 region',
        operations: [],
      },
    ],
  };
}

function supportedResult(analysisId: string) {
  return {
    status: 'supported',
    analysisId,
    items: [
      {
        requirement: '按 region 汇总销售额并筛选大于 100 万的记录',
        status: 'supported',
        operations: ['aggregate', 'filter'],
      },
    ],
  };
}

describe('WorkflowAiGenerateDialog', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setupBridge();
    await i18n.changeLanguage('zh');
  });

  it('supports multi-turn clarification before generation', async () => {
    const onApplied = vi.fn();
    analyzeTaskRequirement
      .mockResolvedValueOnce(ambiguousResult('a1'))
      .mockResolvedValueOnce(supportedResult('a2'));
    generateTaskFromRequirement.mockResolvedValue({});

    render(
      <WorkflowAiGenerateDialog
        open
        taskId="task-1"
        boundInputTable={{ id: 'ds1', name: 'sales' }}
        anchorNode={{ id: 'n_filter', label: '筛选', type: 'filter' }}
        draftWorkflow={{ nodes: [], edges: [] }}
        hasExistingNodes
        isCanvasDirty={false}
        onApplied={onApplied}
        onOpenChange={vi.fn()}
      />
    );

    // Anchor hint instead of the replace warning.
    expect(screen.getByText(/将以所选算子「筛选」为起点继续生成/)).toBeTruthy();

    const composer = screen.getByPlaceholderText(/描述想要的处理流程/);
    fireEvent.change(composer, { target: { value: '计算各个省份的总销售额' } });
    fireEvent.click(screen.getByText('分析可行性'));

    await screen.findByText(/输入列中没有“省份”字段/);
    expect(screen.getByText('需确认')).toBeTruthy();
    // Generation stays disabled while items need confirmation.
    expect((screen.getByText('生成流程') as HTMLButtonElement).disabled).toBe(true);
    // The first turn shows as a chat bubble plus the analysis item.
    expect(screen.getAllByText('计算各个省份的总销售额').length).toBeGreaterThanOrEqual(2);

    const firstCall = analyzeTaskRequirement.mock.calls[0][0];
    expect(firstCall.processRequirement).toBe('计算各个省份的总销售额');
    expect(firstCall.startFromNodeId).toBe('n_filter');
    expect(firstCall.workflow).toEqual({ nodes: [], edges: [] });

    const followUp = screen.getByPlaceholderText(/补充说明或逐项回答/);
    fireEvent.change(followUp, { target: { value: 'region 就是省份' } });
    fireEvent.click(screen.getByText('发送并重新分析'));

    await screen.findByText('可生成');
    // Once the analysis is fully supported, the clarification row goes away.
    expect(screen.queryByPlaceholderText(/补充说明或逐项回答/)).toBeNull();
    // Follow-up turn re-analyzes the accumulated conversation.
    const secondCall = analyzeTaskRequirement.mock.calls[1][0];
    expect(secondCall.processRequirement).toBe('计算各个省份的总销售额\n\nregion 就是省份');
    expect(secondCall.usageTraceId).toBe(firstCall.usageTraceId);

    const generateButton = screen.getByText('生成流程') as HTMLButtonElement;
    expect(generateButton.disabled).toBe(false);
    fireEvent.click(generateButton);

    await vi.waitFor(() => expect(generateTaskFromRequirement).toHaveBeenCalledTimes(1));
    const generateCall = generateTaskFromRequirement.mock.calls[0][0];
    expect(generateCall.processRequirement).toBe('计算各个省份的总销售额\n\nregion 就是省份');
    expect(generateCall.analysisId).toBe('a2');
    expect(generateCall.reuseTaskId).toBe('task-1');
    expect(generateCall.startFromNodeId).toBe('n_filter');
    expect(onApplied).toHaveBeenCalled();
  });

  it('shows the replace warning without an anchor and keeps generate disabled', async () => {
    render(
      <WorkflowAiGenerateDialog
        open
        taskId="task-1"
        boundInputTable={{ id: 'ds1', name: 'sales' }}
        anchorNode={null}
        draftWorkflow={null}
        hasExistingNodes
        isCanvasDirty={false}
        onApplied={vi.fn()}
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByText(/生成将替换当前画布上的流程/)).toBeTruthy();
    expect((screen.getByText('生成流程') as HTMLButtonElement).disabled).toBe(true);
  });
});
