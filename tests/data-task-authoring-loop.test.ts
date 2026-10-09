import { describe, expect, it, vi } from 'vitest';
import type { Message, DataGenerateTaskFromRequirementResult } from '../src/shared/contracts';
import type { DataTaskAuthoringRequest } from '../src/shared/data-task-authoring';
import { pendingDataTaskRequest } from '../src/shared/data-task-authoring';
import { IPC_INPUT_SCHEMAS, clientEventSchema } from '../src/shared/contracts/ipc/schemas';
import { DataToolService } from '../src/main/data/data-tool-service';
import type { DataCommandService } from '../src/main/data/data-command-service';
import type { AnalyzeTaskRequirementCommand } from '../src/main/data/data-command-types';
import { RequirementAnalysisReceiptStore } from '../src/main/data/requirement-analysis-receipt-store';
import { hashColumns } from '../src/main/data/workflow';
import { AI_PREP_DSL_RUNTIME_PROFILE_VERSION } from '../src/main/data/workflow/prep-dsl-capability-profile';
const request: DataTaskAuthoringRequest = {
  id: 'request',
  source: { location: 'local', tableId: 'selected-input' },
  output: { location: 'local', writeMode: 'replace', targetTableId: 'selected-output' },
  reuseTaskId: 'existing-task',
  startFromNodeId: 'filter',
  workflow: { nodes: [], edges: [] },
};
const message: Message = {
  id: 'first',
  sessionId: 'chat',
  role: 'user',
  timestamp: 1,
  content: [{ type: 'data_task_request', request }],
};
const generated: DataGenerateTaskFromRequirementResult = {
  taskId: 'existing-task',
  taskName: 'Saved task',
  outputTableId: 'selected-output',
  outputTableName: 'Output',
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
describe('data-task authoring loop', () => {
  it('exposes no direct renderer analysis/generation bypass', () => {
    expect(IPC_INPUT_SCHEMAS).not.toHaveProperty('data.analyzeTaskRequirement');
    expect(IPC_INPUT_SCHEMAS).not.toHaveProperty('data.generateTaskFromRequirement');
  });
  it('validates structured requests at the session IPC boundary', () => {
    const event = {
      type: 'session.start',
      payload: { title: 'Task', prompt: 'Generate', content: message.content },
    };
    expect(clientEventSchema.safeParse(event).success).toBe(true);
    expect(
      clientEventSchema.safeParse({
        ...event,
        payload: {
          ...event.payload,
          content: [
            { type: 'data_task_request', request: { ...request, source: { tableId: '' } } },
          ],
        },
      }).success
    ).toBe(false);
  });
  it('keeps bindings through analysis, a later confirmation, generation, persistence, and reopening', async () => {
    const receipts = new RequirementAnalysisReceiptStore();
    const columns = [{ name: 'DerivedColumn', type: 'integer' }];
    const analyze = vi.fn(async (input: AnalyzeTaskRequirementCommand) => {
      const analysis = {
        status: 'supported' as const,
        items: [{ requirement: 'Filter', status: 'supported' as const, operations: ['filter'] }],
        inputTableId: 'selected-input',
        inputTableName: 'Input',
        columnsSnapshot: columns,
        sourceSummaryHash: hashColumns(columns),
        capabilityProfileVersion: AI_PREP_DSL_RUNTIME_PROFILE_VERSION,
      };
      const receipt = receipts.create({
        authoringRequest: input.authoringRequest,
        sessionId: input.usageTraceId!,
        sourceUserMessageId: input.sourceUserMessageId,
        inputTableId: analysis.inputTableId,
        inputTableName: analysis.inputTableName,
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
        analyzeTaskRequirement: analyze,
        generateTaskFromRequirement: generate,
        previewTable: async () => ({
          preview: { columnTypes: [{ name: 'OriginalColumn', type: 'integer' }] },
        }),
      } as unknown as DataCommandService,
      receipts
    );
    const context = {
      sessionId: 'chat',
      currentUserMessageId: 'first',
      authoringRequest: pendingDataTaskRequest([message]),
      requirementConversation: [{ role: 'assistant' as const, text: 'Which threshold?' }],
    };
    const analysis = await service.analyzeTaskRequirement(
      { inputTableId: 'model-invented-input', processRequirement: 'Filter' },
      context
    );
    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        source: request.source,
        reuseTaskId: request.reuseTaskId,
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
      outputTableName: 'wrong-output',
    };
    await expect(service.generateTaskFromAnalysis(args, context)).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    });
    const result = await service.generateTaskFromAnalysis(args, {
      sessionId: context.sessionId,
      // Confirmation turns need not retain the originating UI request.
      currentUserMessageId: 'confirmation',
    });
    // The receipt owns a snapshot, not a live reference to UI context.
    expect(receipts.get(analysisId)!.authoringRequest).not.toBe(request);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        reuseTaskId: 'existing-task',
        startFromNodeId: 'filter',
        workflow: request.workflow,
        output: request.output,
      })
    );
    const completion = (result.details as { dataTaskCompletion: unknown }).dataTaskCompletion;
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
              dataTaskCompletion: completion,
            },
          ],
        },
      ])
    ) as Message[];
    expect(pendingDataTaskRequest(persisted)).toBeUndefined();
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
    expect(dataContext.selectedDataTaskId).toBe('existing-task');
    expect(dataContext.selectedOutputTableId).toBe('selected-output');
    expect(dataContext.authoringRequest).toBeUndefined();
  });
});
