import { describe, expect, it, vi } from 'vitest';
import type { AgentToolResult, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { DataToolDefinition } from '../src/main/data/data-tool-types';
import type { DataCommandService } from '../src/main/data/data-command-service';
import { createDataCustomTools } from '../src/main/data/data-tool-definitions';
import { DataToolService } from '../src/main/data/data-tool-service';
import type { AnalyzeTaskRequirementCommand } from '../src/main/data/data-command-types';
import { RequirementAnalysisReceiptStore } from '../src/main/data/requirement-analysis-receipt-store';
import { AI_PREP_DSL_RUNTIME_PROFILE_VERSION } from '../src/main/data/workflow/prep-dsl-capability-profile';
import { hashColumns } from '../src/main/data/workflow';
import type {
  DataCleaningTask,
  DataDataset,
  DataInputTablePreview,
  DataOutputTable,
} from '../src/renderer/types';

// ToolDefinition.execute takes (toolCallId, params, signal, onUpdate, ctx).
// These tests only exercise the first two parameters.
function executeDataTool(
  tool: Pick<DataToolDefinition, 'execute'> | undefined,
  toolCallId: string,
  params: unknown
): Promise<AgentToolResult<unknown>> {
  if (!tool) {
    throw new Error('expected data tool to be defined');
  }
  return tool.execute(
    toolCallId,
    params,
    undefined,
    undefined,
    undefined as unknown as ExtensionContext
  );
}

function firstText(result: AgentToolResult<unknown> | undefined): string | undefined {
  const item = result?.content[0];
  return item?.type === 'text' ? item.text : undefined;
}

describe('DataToolService', () => {
  it('formats command results as short tool content with structured details', async () => {
    const inputTable: DataDataset = {
      id: 'dataset_1',
      name: 'customers',
      sourcePath: '/tmp/customers.csv',
      sourceKind: 'csv',
      inputConfig: {
        sourceKind: 'csv',
        header: 'auto',
        dataRegion: 'auto',
        encoding: 'auto',
        delimiter: 'auto',
      },
      fileCount: 1,
      relatedTaskNames: [],
      tableName: 'dataset_1',
      rowCount: 2,
      columnCount: 2,
      createdAt: 1,
      updatedAt: 1,
    };
    const commandService = {
      listInputTables: vi.fn(async () => ({
        inputTables: [inputTable],
        total: 1,
        limit: 20,
        offset: 0,
      })),
    } as unknown as DataCommandService;
    const service = new DataToolService(commandService, new RequirementAnalysisReceiptStore());

    const result = await service.listInputTables({});

    expect(result.content[0]?.text).toContain('Found 1 of 1 input table');
    expect(result.content[0]?.text).toContain(
      '[customers](#/data/input-tables/dataset_1) (dataset_1)'
    );
    expect(result.details).toMatchObject({ total: 1, inputTables: [{ id: 'dataset_1' }] });
  });

  it('keeps table inspection schema-only by default and caps agent result previews at five rows', async () => {
    const task: DataCleaningTask = {
      id: 'task_compact',
      name: 'Compact preview task',
      status: 'completed',
      nodeCount: 2,
      sourcePath: null,
      sourceDatasetId: 'input_compact',
      outputTable: 'output_compact',
      rowCount: 12,
      columnCount: 1,
      error: null,
      scheduledFor: null,
      createdAt: 1,
      updatedAt: 1,
      lastRunAt: 1,
    };
    const preview: DataInputTablePreview = {
      columns: ['Customer'],
      columnTypes: [{ name: 'Customer', type: 'text', storageType: 'VARCHAR' }],
      rows: [{ Customer: 'Alice' }, { Customer: 'Bob' }],
      fileCount: 1,
      limit: 2,
      offset: 0,
      totalRows: 12,
    };
    const previewTable = vi.fn(async () => ({
      tableKind: 'input' as const,
      id: 'input_compact',
      preview,
    }));
    const runTask = vi.fn(async () => ({ task, preview, diagnostics: [] }));
    const getRunResult = vi.fn(async () => ({ task, preview }));
    const service = new DataToolService(
      {
        previewTable,
        runTask,
        getRunResult,
      } as unknown as DataCommandService,
      new RequirementAnalysisReceiptStore()
    );

    const schemaOnly = await service.previewTable({
      tableKind: 'input',
      id: 'input_compact',
      limit: 2,
    });
    expect(schemaOnly.content[0]?.text).toContain('Table schema totalRows=12');
    expect(schemaOnly.content[0]?.text).toContain('Customer: 文本');
    expect(schemaOnly.content[0]?.text).not.toContain('Alice');
    expect(previewTable).toHaveBeenLastCalledWith({
      tableKind: 'input',
      id: 'input_compact',
      limit: 1,
    });

    const withRows = await service.previewTable({
      tableKind: 'input',
      id: 'input_compact',
      limit: 2,
      includeRows: true,
    });
    expect(withRows.content[0]?.text).toContain('Alice');

    await service.runTask({ taskId: task.id, mode: 'persisted', previewRows: 20 });
    await service.getRunResult({ taskId: task.id, previewRows: 20 });
    expect(runTask).toHaveBeenCalledWith({
      taskId: task.id,
      mode: 'persisted',
      previewRows: 5,
    });
    expect(getRunResult).toHaveBeenCalledWith({ taskId: task.id, previewRows: 5 });

    const tools = createDataCustomTools(service);
    const runSchema = tools.find((tool) => tool.name === 'data_run_task')?.parameters as {
      properties?: { previewRows?: { maximum?: number; default?: number } };
    };
    const previewSchema = tools.find((tool) => tool.name === 'data_preview_table')?.parameters as {
      properties?: { includeRows?: { default?: boolean } };
    };
    expect(runSchema.properties?.previewRows).toMatchObject({ maximum: 5, default: 5 });
    expect(previewSchema.properties?.includeRows).toMatchObject({ default: false });
  });

  it('formats output tables and data tasks as clickable app links', async () => {
    const outputTable: DataOutputTable = {
      id: 'output_1',
      name: 'customers output',
      tableName: 'output_1',
      rowCount: 2,
      columnCount: 2,
      sourceDatasetId: null,
      relatedTaskNames: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const task: DataCleaningTask = {
      id: 'task_1',
      name: 'customers cleanup',
      status: 'draft',
      nodeCount: 0,
      sourcePath: null,
      sourceDatasetId: null,
      outputTable: null,
      rowCount: null,
      columnCount: null,
      error: null,
      scheduledFor: null,
      createdAt: 1,
      updatedAt: 1,
      lastRunAt: null,
    };
    const commandService = {
      listOutputTables: vi.fn(async () => ({
        outputTables: [outputTable],
        total: 1,
        limit: 20,
        offset: 0,
      })),
      listTasks: vi.fn(async () => ({
        tasks: [task],
        total: 1,
        limit: 20,
        offset: 0,
      })),
    } as unknown as DataCommandService;
    const service = new DataToolService(commandService, new RequirementAnalysisReceiptStore());

    const outputResult = await service.listOutputTables({});
    const taskResult = await service.listTasks({});

    expect(outputResult.content[0]?.text).toContain(
      '[customers output](#/data/output-tables/output_1) (output_1)'
    );
    expect(taskResult.content[0]?.text).toContain(
      '[customers cleanup](#/data/tasks/task_1) (task_1)'
    );
  });

  it('formats input table processing strategy creation results', async () => {
    const preview: DataInputTablePreview = {
      columns: ['id', 'name'],
      columnTypes: [],
      rows: [{ id: '1', name: 'Alice' }],
      fileCount: 1,
      limit: 20,
      offset: 0,
      totalRows: 1,
    };
    const inputTable: DataDataset = {
      id: 'dataset_2',
      name: 'customers normalized',
      sourcePath: '/tmp/customers.csv',
      sourceKind: 'csv',
      inputConfig: {
        sourceKind: 'csv',
        header: 'auto',
        dataRegion: 'auto',
        encoding: 'auto',
        delimiter: 'auto',
        dataProcessing: {
          strategy: 'customize',
          rulePrompt: 'normalize',
          artifactId: 'artifact_1',
          artifactVersionId: 'version_1',
          artifactVersionStatus: 'published',
        },
      },
      fileCount: 1,
      relatedTaskNames: [],
      tableName: 'dataset_2',
      rowCount: 1,
      columnCount: 2,
      createdAt: 1,
      updatedAt: 1,
    };
    const commandService = {
      createInputTableWithProcessingStrategy: vi.fn(async () => ({
        processingStrategy: 'customize',
        inputTable,
        preview,
        normalizer: {
          artifact: {
            id: 'artifact_1',
            name: 'customers normalizer',
            sourceKind: 'csv',
            primaryLanguage: 'node',
            activeVersionId: 'version_1',
            createdAt: 1,
            updatedAt: 1,
          },
          draftVersion: { id: 'version_1', status: 'published', files: [] },
          publishedVersion: { id: 'version_1', status: 'published', files: [] },
          sourceSummary: { hash: 'hash_1' },
          preview,
        },
      })),
    } as unknown as DataCommandService;
    const service = new DataToolService(commandService, new RequirementAnalysisReceiptStore());

    const result = await service.createInputTableWithProcessingStrategy({
      name: 'customers normalized',
      filePath: '/tmp/customers.csv',
      processingStrategy: { strategy: 'customize', rulePrompt: 'normalize' },
    });

    expect(result.content[0]?.text).toContain('Created input table with customize processing');
    expect(result.content[0]?.text).toContain('Normalizer: artifact=artifact_1 version=version_1');
    expect(result.details).toMatchObject({
      processingStrategy: 'customize',
      inputTable: { id: 'dataset_2' },
      normalizer: { artifact: { id: 'artifact_1' } },
    });
  });

  it('normalizes tool-call strategy JSON strings and workspace-relative source paths', async () => {
    const preview: DataInputTablePreview = {
      columns: ['id'],
      columnTypes: [],
      rows: [{ id: '1' }],
      fileCount: 1,
      limit: 20,
      offset: 0,
      totalRows: 1,
    };
    const inputTable: DataDataset = {
      id: 'dataset_3',
      name: 'normalized excel',
      sourcePath: '/workspace/.tmp/source.xlsx',
      sourceKind: 'excel',
      inputConfig: {
        sourceKind: 'excel',
        sheetName: 'Sheet1',
        sheetNames: ['Sheet1'],
        headerMode: 'auto',
        headerRow: 1,
        dataProcessing: {
          strategy: 'customize',
          rulePrompt: 'normalize',
          artifactId: 'artifact_1',
          artifactVersionId: 'version_1',
          artifactVersionStatus: 'published',
        },
      },
      fileCount: 1,
      relatedTaskNames: [],
      tableName: 'dataset_3',
      rowCount: 1,
      columnCount: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const createInputTableWithProcessingStrategy = vi.fn(async () => ({
      processingStrategy: 'customize',
      inputTable,
      preview,
    }));
    const commandService = {
      createInputTableWithProcessingStrategy,
    } as unknown as DataCommandService;
    const service = new DataToolService(commandService, new RequirementAnalysisReceiptStore());
    const tool = createDataCustomTools(service, {
      sessionId: 'session_1',
      workspacePath: '/workspace',
      capabilities: {
        canCreateInputTable: true,
        canCreateOutputTable: true,
        canCreateTask: true,
        canRunTask: true,
        canImportLocalFiles: true,
      },
    }).find((item) => item.name === 'data_create_input_table_with_processing_strategy');

    const result = await executeDataTool(tool, 'call_1', {
      name: 'normalized excel',
      sourceKind: 'excel',
      filePath: '.tmp/source.xlsx',
      processingStrategy: '{"strategy":"customize","rulePrompt":"normalize"}',
    });

    expect(firstText(result)).toContain('Created input table with customize processing');
    expect(createInputTableWithProcessingStrategy).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/workspace/.tmp/source.xlsx',
        processingStrategy: {
          strategy: 'customize',
          rulePrompt: 'normalize',
        },
      })
    );
  });

  it('requires a supported analysis and a later user turn before generating a task', async () => {
    const columnsSnapshot = [{ name: 'Sales', type: 'integer' }];
    const sourceSummaryHash = hashColumns(columnsSnapshot);
    const analysisReceipts = new RequirementAnalysisReceiptStore();
    const analyzeTaskRequirement = vi.fn(async (input: AnalyzeTaskRequirementCommand) => {
      const result = {
        status: 'supported' as const,
        items: [
          {
            requirement: '过滤 Sales 小于 100 的记录',
            status: 'supported' as const,
            operations: ['filter'],
            capabilities: ['filter.boolean_predicate'],
          },
        ],
        inputTableId: 'input_1',
        inputTableName: 'Sales input',
        columnsSnapshot,
        sourceSummaryHash,
        capabilityProfileVersion: AI_PREP_DSL_RUNTIME_PROFILE_VERSION,
      };
      const receipt = analysisReceipts.create({
        sessionId: input.usageTraceId!,
        sourceUserMessageId: input.sourceUserMessageId,
        inputTableId: result.inputTableId,
        inputTableName: result.inputTableName,
        inputSchemaHash: result.sourceSummaryHash,
        processRequirement: input.processRequirement,
        analysis: result,
        capabilityProfileVersion: result.capabilityProfileVersion,
      });
      return { ...result, analysisId: receipt.id, expiresAt: receipt.expiresAt };
    });
    const previewTable = vi.fn(async () => ({
      tableKind: 'input' as const,
      id: 'input_1',
      preview: {
        columns: ['Sales'],
        columnTypes: columnsSnapshot,
        rows: [{ Sales: 200 }],
        fileCount: 1,
        limit: 1,
        offset: 0,
        totalRows: 1,
      },
    }));
    const generateTaskFromRequirement = vi.fn(async () => ({
      taskId: 'task_1',
      taskName: 'Sales task',
      outputTableId: 'output_1',
      outputTableName: 'Sales output',
      workflowDsl: 'must not reach the outer model',
      workflowDslAvailable: true,
      requiredColumns: columnsSnapshot,
      expectedOutputSchema: columnsSnapshot,
      lineage: [],
      columnsSnapshot,
      sourceSummaryHash,
      workflowHash: 'workflow_hash',
      version: 1,
      generatedAt: 1,
    }));
    const service = new DataToolService(
      {
        analyzeTaskRequirement,
        previewTable,
        generateTaskFromRequirement,
      } as unknown as DataCommandService,
      analysisReceipts
    );
    const runtimeConfig = {
      provider: 'custom' as const,
      apiKey: 'secret-key',
      baseUrl: 'https://example.invalid',
      customProtocol: 'openai' as const,
      model: 'test-model',
      enableThinking: false,
      thinkingLevel: 'medium' as const,
    };
    const promptContext = {
      sessionId: 'session_1',
      capabilities: {
        canCreateInputTable: true,
        canCreateOutputTable: true,
        canCreateTask: true,
        canRunTask: true,
        canImportLocalFiles: true,
      },
    };
    const tools = createDataCustomTools(service, promptContext);
    const analyzeTool = tools.find((tool) => tool.name === 'data_analyze_task_requirement');
    const generateTool = tools.find((tool) => tool.name === 'data_generate_task_from_requirement');
    const generateSchema = generateTool!.parameters as {
      properties?: Record<string, unknown>;
    };
    expect(generateSchema.properties).toHaveProperty('outputMode');
    expect(generateSchema.properties).toHaveProperty('outputTableName');
    expect(generateSchema.properties).toHaveProperty('outputTableId');
    expect(generateSchema.properties).not.toHaveProperty('output');
    service.updateExecutionContext({
      sessionId: 'session_1',
      currentUserMessageId: 'user_message_1',
      runtimeConfig,
    });

    const analysis = await executeDataTool(analyzeTool, 'analysis_call_1', {
      inputTableId: 'input_1',
      processRequirement: '过滤 Sales 小于 100 的记录',
    });
    const analysisId = (analysis.details as { analysisId: string }).analysisId;

    expect(analyzeTaskRequirement).toHaveBeenCalledWith(
      expect.objectContaining({
        usageTraceId: 'session_1',
        sourceUserMessageId: 'user_message_1',
      })
    );

    await expect(
      service.generateTaskFromAnalysis(
        {
          analysisId,
          confirmed: true,
          outputMode: 'create',
          outputTableName: 'Sales output',
        },
        { sessionId: 'session_2', currentUserMessageId: 'user_message_2' }
      )
    ).rejects.toMatchObject({ code: 'ANALYSIS_REQUIRED' });

    await expect(
      executeDataTool(generateTool, 'generation_call_1', {
        analysisId,
        confirmed: true,
        outputMode: 'create',
        outputTableName: 'Sales output',
      })
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });

    await expect(
      service.generateTaskFromAnalysis(
        {
          analysisId,
          confirmed: true,
          outputMode: 'create',
          outputTableName: 'Sales output',
        },
        { sessionId: 'session_1' }
      )
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });

    service.updateExecutionContext({
      sessionId: 'session_1',
      currentUserMessageId: 'user_message_2',
      runtimeConfig,
    });
    await expect(
      executeDataTool(generateTool, 'generation_call_invalid_output', {
        analysisId,
        confirmed: true,
        outputMode: 'replace',
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    const generated = await executeDataTool(generateTool, 'generation_call_2', {
      analysisId,
      confirmed: true,
      taskName: 'Sales task',
      outputMode: 'create',
      outputTableName: 'Sales output',
    });

    expect(generateTaskFromRequirement).toHaveBeenCalledWith(
      expect.objectContaining({
        processRequirement: '过滤 Sales 小于 100 的记录',
        taskName: 'Sales task',
        runtimeConfig,
        analysisId,
        usageTraceId: 'session_1',
        outputConflictPolicy: 'unique',
        output: {
          location: 'local',
          writeMode: 'create',
          tableName: 'Sales output',
        },
      })
    );
    expect(firstText(generated)).toContain('Temporary execution validation passed');
    expect(JSON.stringify(generated)).not.toContain('must not reach the outer model');

    service.updateExecutionContext({
      sessionId: 'session_1',
      currentUserMessageId: 'user_message_3',
      runtimeConfig,
    });
    const repeated = await executeDataTool(generateTool, 'generation_call_3', {
      analysisId,
      confirmed: true,
      outputMode: 'create',
      outputTableName: 'ignored',
    });
    expect((repeated.details as { task: { id: string } }).task.id).toBe('task_1');
    expect(generateTaskFromRequirement).toHaveBeenCalledTimes(1);

    const replacementAnalysis = await executeDataTool(analyzeTool, 'analysis_call_2', {
      inputTableId: 'input_1',
      processRequirement: '过滤 Sales 小于 100 的记录',
    });
    const replacementAnalysisId = (replacementAnalysis.details as { analysisId: string })
      .analysisId;
    service.updateExecutionContext({
      sessionId: 'session_1',
      currentUserMessageId: 'user_message_4',
      runtimeConfig,
    });
    await executeDataTool(generateTool, 'generation_call_4', {
      analysisId: replacementAnalysisId,
      confirmed: true,
      taskName: 'Sales replacement task',
      outputMode: 'replace',
      outputTableId: 'existing_output_1',
    });
    expect(generateTaskFromRequirement).toHaveBeenLastCalledWith(
      expect.objectContaining({
        output: {
          location: 'local',
          writeMode: 'replace',
          targetTableId: 'existing_output_1',
        },
      })
    );
  });

  it('does not generate ambiguous or unsupported analysis receipts', async () => {
    const columnsSnapshot = [{ name: 'Customer', type: 'text' }];
    const sourceSummaryHash = hashColumns(columnsSnapshot);
    const analysisReceipts = new RequirementAnalysisReceiptStore();
    const analyzeTaskRequirement = vi.fn(async (input: AnalyzeTaskRequirementCommand) => {
      const result = {
        status: 'needs_confirmation' as const,
        items: [
          {
            requirement: '筛选优质客户',
            status: 'ambiguous' as const,
            reason: '优质客户没有明确标准',
            suggestedRequirement: '筛选累计销售额大于 10000 的客户',
            operations: ['filter'],
          },
        ],
        inputTableId: 'input_2',
        inputTableName: 'Customers',
        columnsSnapshot,
        sourceSummaryHash,
        capabilityProfileVersion: AI_PREP_DSL_RUNTIME_PROFILE_VERSION,
      };
      const receipt = analysisReceipts.create({
        sessionId: input.usageTraceId!,
        sourceUserMessageId: input.sourceUserMessageId,
        inputTableId: result.inputTableId,
        inputTableName: result.inputTableName,
        inputSchemaHash: result.sourceSummaryHash,
        processRequirement: input.processRequirement,
        analysis: result,
        capabilityProfileVersion: result.capabilityProfileVersion,
      });
      return { ...result, analysisId: receipt.id, expiresAt: receipt.expiresAt };
    });
    const service = new DataToolService(
      { analyzeTaskRequirement } as unknown as DataCommandService,
      analysisReceipts
    );
    const analysis = await service.analyzeTaskRequirement(
      { inputTableId: 'input_2', processRequirement: '筛选优质客户' },
      { sessionId: 'session_1', currentUserMessageId: 'message_1' }
    );
    const analysisId = (analysis.details as { analysisId: string }).analysisId;

    expect(analysis.content[0]?.text).toContain('needs_confirmation');
    expect(analysis.content[0]?.text).toContain('优质客户没有明确标准');
    await expect(
      service.generateTaskFromAnalysis(
        { analysisId, confirmed: true, outputMode: 'create' },
        { sessionId: 'session_1', currentUserMessageId: 'message_2' }
      )
    ).rejects.toMatchObject({ code: 'REQUIREMENT_NOT_SUPPORTED' });
  });

  it('returns embedded workflow DSL reference without relying on source docs', async () => {
    const commandService = {} as DataCommandService;
    const service = new DataToolService(commandService, new RequirementAnalysisReceiptStore());

    const result = await service.getWorkflowDslReference({ topic: 'examples' });

    expect(result.content[0]?.text).toContain('input source dataset "<inputTableId>" as src');
    expect(result.content[0]?.text).toContain('data_apply_workflow_dsl');
    expect(result.content[0]?.text).not.toContain('design/prep');
  });
});
