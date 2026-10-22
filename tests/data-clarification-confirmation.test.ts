import { describe, expect, it, vi } from 'vitest';
import type { DataCommandService } from '../src/main/data/data-command-service';
import { DataToolService } from '../src/main/data/data-tool-service';
import { RequirementAnalysisReceiptStore } from '../src/main/data/requirement-analysis-receipt-store';
import { AI_JFLOW_RUNTIME_PROFILE_VERSION } from '../src/main/data/workflow/jflow-capability-profile';
import { hashColumns } from '../src/main/data/workflow';

const columnsSnapshot = [{ name: 'Sales', type: 'integer' }];

function analysis(status: 'supported' | 'needs_confirmation') {
  return {
    status,
    items: [
      {
        requirement: '按 Sales 汇总',
        status: status === 'supported' ? ('supported' as const) : ('ambiguous' as const),
        operations: ['aggregate'],
        capabilities: ['aggregate.group_metrics'],
      },
    ],
    rawTableId: 'input_1',
    rawTableName: 'Sales input',
    columnsSnapshot,
    sourceSummaryHash: hashColumns(columnsSnapshot),
    capabilityProfileVersion: AI_JFLOW_RUNTIME_PROFILE_VERSION,
  };
}

function setup() {
  const receipts = new RequirementAnalysisReceiptStore();
  const create = (status: 'supported' | 'needs_confirmation', messageId: string) =>
    receipts.create({
      sessionId: 'session_1',
      sourceUserMessageId: messageId,
      rawTableId: 'input_1',
      rawTableName: 'Sales input',
      inputSchemaHash: hashColumns(columnsSnapshot),
      processRequirement: '按 Sales 汇总',
      analysis: analysis(status),
      capabilityProfileVersion: AI_JFLOW_RUNTIME_PROFILE_VERSION,
    });
  const generatePipelineFromRequirement = vi.fn(async () => ({
    pipelineId: 'p1',
    pipelineName: 'Sales pipeline',
    resultTableId: 'r1',
    resultTableName: 'Sales output',
    workflowDslAvailable: true,
    requiredColumns: columnsSnapshot,
    expectedOutputSchema: columnsSnapshot,
    lineage: [],
    columnsSnapshot,
    sourceSummaryHash: hashColumns(columnsSnapshot),
    workflowHash: 'h',
    version: 1,
    generatedAt: 1,
  }));
  const service = new DataToolService(
    {
      previewTable: vi.fn(async () => ({
        tableKind: 'raw' as const,
        id: 'input_1',
        preview: { columns: ['Sales'], columnTypes: columnsSnapshot, rows: [], totalRows: 0 },
      })),
      generatePipelineFromRequirement,
    } as unknown as DataCommandService,
    receipts
  );
  return { receipts, create, service, generatePipelineFromRequirement };
}

const generateInput = (analysisId: string) => ({
  analysisId,
  confirmed: true,
  outputMode: 'create' as const,
  resultTableName: 'Sales output',
});

describe('clarification answer counts as confirmation', () => {
  it('generates on the message that answered an ambiguous analysis', async () => {
    const { create, service, generatePipelineFromRequirement } = setup();
    create('needs_confirmation', 'm1');
    const clarified = create('supported', 'm2');
    expect(clarified.answersClarification).toBe(true);

    await service.generatePipelineFromAnalysis(generateInput(clarified.id), {
      sessionId: 'session_1',
      currentUserMessageId: 'm2',
    });
    expect(generatePipelineFromRequirement).toHaveBeenCalledTimes(1);
  });

  it('still requires a later message for a first-turn supported analysis', async () => {
    const { create, service } = setup();
    const first = create('supported', 'm1');
    expect(first.answersClarification).toBeUndefined();
    await expect(
      service.generatePipelineFromAnalysis(generateInput(first.id), {
        sessionId: 'session_1',
        currentUserMessageId: 'm1',
      })
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
  });

  it('does not treat a re-analysis on the same message as a clarification answer', () => {
    const { create } = setup();
    create('needs_confirmation', 'm1');
    expect(create('supported', 'm1').answersClarification).toBeUndefined();
  });
});
