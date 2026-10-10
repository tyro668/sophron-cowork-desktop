import { describe, expect, it, vi } from 'vitest';
import type { Message, DataGeneratePipelineFromRequirementResult } from '../src/shared/contracts';
import type { DataPipelineAuthoringRequest } from '../src/shared/data-pipeline-authoring';
import { pendingDataPipelineRequest } from '../src/shared/data-pipeline-authoring';
import { IPC_INPUT_SCHEMAS, clientEventSchema } from '../src/shared/contracts/ipc/schemas';
import { DataToolService } from '../src/main/data/data-tool-service';
import type { DataCommandService } from '../src/main/data/data-command-service';
import type { AnalyzePipelineRequirementCommand } from '../src/main/data/data-command-types';
import { RequirementAnalysisReceiptStore } from '../src/main/data/requirement-analysis-receipt-store';
import { hashColumns } from '../src/main/data/workflow';
import { AI_PREP_DSL_RUNTIME_PROFILE_VERSION } from '../src/main/data/workflow/prep-dsl-capability-profile';
const request: DataPipelineAuthoringRequest = {
  id: 'request',
  source: { location: 'local', tableId: 'selected-input' },
  output: { location: 'local', writeMode: 'replace', targetTableId: 'selected-output' },
  reusePipelineId: 'existing-pipeline',
  startFromNodeId: 'filter',
  workflow: { nodes: [], edges: [] },
};
const message: Message = {
  id: 'first',
  sessionId: 'chat',
  role: 'user',
  timestamp: 1,
  content: [{ type: 'data_pipeline_request', request }],
};
const generated: DataGeneratePipelineFromRequirementResult = {
  pipelineId: 'existing-pipeline',
  pipelineName: 'Saved pipeline',
  resultTableId: 'selected-output',
  resultTableName: 'Output',
  workflowDslAvailable: true,
  requiredColumns: [],
  expectedOutputSchema: [],
  lineage: [],
  columnsSnapshot: [],
  sourceSummaryHash: 's',
  workflowHash: 'w',
  version: 1,
  generatedAt: 1,
};
describe('data-pipeline authoring loop', () => {
  it('exposes no direct renderer analysis/generation bypass', () => {
    expect(IPC_INPUT_SCHEMAS).not.toHaveProperty('data.analyzePipelineRequirement');
    expect(IPC_INPUT_SCHEMAS).not.toHaveProperty('data.generatePipelineFromRequirement');
  });
  it('validates structured requests at the session IPC boundary', () => {
    const event = {
      type: 'session.start',
      payload: { title: 'Pipeline', prompt: 'Generate', content: message.content },
    };
    expect(clientEventSchema.safeParse(event).success).toBe(true);
    expect(
      clientEventSchema.safeParse({
        ...event,
        payload: {
          ...event.payload,
          content: [
            { type: 'data_pipeline_request', request: { ...request, source: { tableId: '' } } },
          ],
        },
      }).success
    ).toBe(false);
  });
  it('keeps bindings through analysis, a later confirmation, generation, persistence, and reopening', async () => {
    const receipts = new RequirementAnalysisReceiptStore();
    const columns = [{ name: 'DerivedColumn', type: 'integer' }];
    const analyze = vi.fn(async (input: AnalyzePipelineRequirementCommand) => {
      const analysis = {
        status: 'supported' as const,
        items: [{ requirement: 'Filter', status: 'supported' as const, operations: ['filter'] }],
        rawTableId: 'selected-input',
        rawTableName: 'Input',
        columnsSnapshot: columns,
        sourceSummaryHash: hashColumns(columns),
        capabilityProfileVersion: AI_PREP_DSL_RUNTIME_PROFILE_VERSION,
      };
      const receipt = receipts.create({
        authoringRequest: input.authoringRequest,
        sessionId: input.usageTraceId!,
        sourceUserMessageId: input.sourceUserMessageId,
        rawTableId: analysis.rawTableId,
        rawTableName: analysis.rawTableName,
        inputSchemaHash: analysis.sourceSummaryHash,
        processRequirement: input.processRequirement,
        analysis,
        capabilityProfileVersion: analysis.capabilityProfileVersion,
      });
      return { ...analysis, analysisId: receipt.id };
    });
    const generate = vi.fn(async () => generated);
    const service = new DataToolService(
      {
        analyzePipelineRequirement: analyze,
        generatePipelineFromRequirement: generate,
        previewTable: async () => ({
          preview: { columnTypes: [{ name: 'OriginalColumn', type: 'integer' }] },
        }),
      } as unknown as DataCommandService,
      receipts
    );
    const context = {
      sessionId: 'chat',
      currentUserMessageId: 'first',
      authoringRequest: pendingDataPipelineRequest([message]),
      requirementConversation: [{ role: 'assistant' as const, text: 'Which threshold?' }],
    };
    const analysis = await service.analyzePipelineRequirement(
      { rawTableId: 'model-invented-input', processRequirement: 'Filter' },
      context
    );
    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        source: request.source,
        reusePipelineId: request.reusePipelineId,
        startFromNodeId: 'filter',
        workflow: request.workflow,
        requirementConversation: context.requirementConversation,
      })
    );
    const analysisId = (analysis.details as { analysisId: string }).analysisId;
    const args = {
      analysisId,
      confirmed: true as const,
      outputMode: 'create' as const,
      resultTableName: 'wrong-output',
    };
    await expect(service.generatePipelineFromAnalysis(args, context)).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    });
    const result = await service.generatePipelineFromAnalysis(args, {
      sessionId: context.sessionId,
      // Confirmation turns need not retain the originating UI request.
      currentUserMessageId: 'confirmation',
    });
    // The receipt owns a snapshot, not a live reference to UI context.
    expect(receipts.get(analysisId)!.authoringRequest).not.toBe(request);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        reusePipelineId: 'existing-pipeline',
        startFromNodeId: 'filter',
        workflow: request.workflow,
        output: request.output,
      })
    );
    const completion = (result.details as { dataPipelineCompletion: unknown })
      .dataPipelineCompletion;
    const persisted = JSON.parse(
      JSON.stringify([
        ...[message],
        {
          id: 'done',
          role: 'assistant',
          sessionId: 'chat',
          timestamp: 2,
          content: [
            {
              type: 'tool_result',
              toolUseId: 'generate',
              content: 'Saved',
              dataPipelineCompletion: completion,
            },
          ],
        },
      ])
    ) as Message[];
    expect(pendingDataPipelineRequest(persisted)).toBeUndefined();
    const reopened = new DataToolService(
      {} as DataCommandService,
      new RequirementAnalysisReceiptStore()
    );
    const dataContext = await reopened.resolveConversationContext({
      session: { id: 'chat' } as never,
      prompt: '运行它',
      existingMessages: persisted,
      isColdStart: true,
    });
    expect(dataContext.selectedDataPipelineId).toBe('existing-pipeline');
    expect(dataContext.selectedResultTableId).toBe('selected-output');
    expect(dataContext.authoringRequest).toBeUndefined();
  });
});
