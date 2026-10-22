import { ModelResultStore } from '../src/main/agent/model-result-store';
import { describe, expect, it, vi } from 'vitest';
import type { AgentToolResult, ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import type { DataToolDefinition } from '../src/main/data/data-tool-types';
import type { DataCommandService } from '../src/main/data/data-command-service';
import { createDataCustomTools } from '../src/main/data/data-tool-definitions';
import { DataToolService } from '../src/main/data/data-tool-service';
import type { AnalyzePipelineRequirementCommand } from '../src/main/data/data-command-types';
import { RequirementAnalysisReceiptStore } from '../src/main/data/requirement-analysis-receipt-store';
import { AI_JFLOW_RUNTIME_PROFILE_VERSION } from '../src/main/data/workflow/jflow-capability-profile';
import { hashColumns } from '../src/main/data/workflow';
import type {
  DataPipeline,
  DataRawTable,
  DataRawTablePreview,
  DataResultTable,
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
    undefined as unknown as ExtensionToolContext
  );
}

function firstText(result: AgentToolResult<unknown> | undefined): string | undefined {
  const item = result?.content[0];
  return item?.type === 'text' ? item.text : undefined;
}

describe('DataToolService', () => {
  it('formats command results as short tool content with structured details', async () => {
    const rawTable: DataRawTable = {
      id: 'rawTable_1',
      groupId: null,
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
      relatedPipelineNames: [],
      tableName: 'rawTable_1',
      rowCount: 2,
      columnCount: 2,
      createdAt: 1,
      updatedAt: 1,
    };
    const commandService = {
      listRawTables: vi.fn(async () => ({
        rawTables: [rawTable],
        total: 1,
        limit: 20,
        offset: 0,
      })),
    } as unknown as DataCommandService;
    const service = new DataToolService(commandService, new RequirementAnalysisReceiptStore());

    const result = await service.listRawTables({});

    expect(result.content[0]?.text).toContain('Found 1 of 1 input table');
    expect(result.content[0]?.text).toContain(
      '[customers](#/data/raw-tables/rawTable_1) (rawTable_1)'
    );
    expect(result.details).toMatchObject({ total: 1, rawTables: [{ id: 'rawTable_1' }] });
  });

  it('keeps table inspection schema-only by default and caps agent result previews at twenty rows with explicit coverage', async () => {
    const pipeline: DataPipeline = {
      id: 'task_compact',
      groupId: null,
      name: 'Compact preview pipeline',
      status: 'completed',
      nodeCount: 2,
      sourcePath: null,
      sourceRawTableId: 'input_compact',
      resultTable: 'output_compact',
      rowCount: 12,
      columnCount: 1,
      error: null,
      scheduledFor: null,
      createdAt: 1,
      updatedAt: 1,
      lastRunAt: 1,
    };
    const preview: DataRawTablePreview = {
      columns: ['Customer'],
      columnTypes: [{ name: 'Customer', type: 'text', storageType: 'VARCHAR' }],
      rows: [{ Customer: 'Alice' }, { Customer: 'Bob' }],
      fileCount: 1,
      limit: 2,
      offset: 0,
      totalRows: 12,
    };
    const previewTable = vi.fn(async () => ({
      tableKind: 'raw' as const,
      id: 'input_compact',
      preview,
    }));
    const runPipeline = vi.fn(async () => ({ pipeline, preview, diagnostics: [] }));
    const getRunResult = vi.fn(async () => ({ pipeline, preview }));
    const service = new DataToolService(
      {
        previewTable,
        runPipeline,
        getRunResult,
      } as unknown as DataCommandService,
      new RequirementAnalysisReceiptStore()
    );

    const schemaOnly = await service.previewTable({
      tableKind: 'raw',
      id: 'input_compact',
      limit: 2,
    });
    expect(schemaOnly.content[0]?.text).toContain('Table schema totalRows=12');
    expect(schemaOnly.content[0]?.text).toContain('Customer: 文本');
    expect(schemaOnly.content[0]?.text).not.toContain('Alice');
    expect(previewTable).toHaveBeenLastCalledWith({
      tableKind: 'raw',
      id: 'input_compact',
      limit: 1,
    });

    const withRows = await service.previewTable({
      tableKind: 'raw',
      id: 'input_compact',
      limit: 2,
      includeRows: true,
    });
    expect(withRows.content[0]?.text).toContain('Alice');
    expect(withRows.content[0]?.text).toContain('rows 1-2 of 12 shown; 10 row(s) NOT shown');
    expect(schemaOnly.content[0]?.text).toContain('Row values NOT included');

    const run = await service.runPipeline({
      pipelineId: pipeline.id,
      mode: 'persisted',
      previewRows: 50,
    });
    expect(run.content[0]?.text).toContain('10 row(s) NOT shown');
    await service.getRunResult({ pipelineId: pipeline.id, previewRows: 50 });
    expect(runPipeline).toHaveBeenCalledWith({
      pipelineId: pipeline.id,
      mode: 'persisted',
      previewRows: 20,
    });
    expect(getRunResult).toHaveBeenCalledWith({ pipelineId: pipeline.id, previewRows: 20 });

    const tools = createDataCustomTools(service);
    const runSchema = tools.find((tool) => tool.name === 'data_run_pipeline')?.parameters as {
      properties?: { previewRows?: { maximum?: number; default?: number } };
    };
    const previewSchema = tools.find((tool) => tool.name === 'data_preview_table')?.parameters as {
      properties?: { includeRows?: { default?: boolean } };
    };
    expect(runSchema.properties?.previewRows).toMatchObject({ maximum: 20, default: 20 });
    expect(previewSchema.properties?.includeRows).toMatchObject({ default: false });
  });

  it('formats output tables and data pipelines as clickable app links', async () => {
    const resultTable: DataResultTable = {
      id: 'output_1',
      groupId: null,
      name: 'customers output',
      tableName: 'output_1',
      rowCount: 2,
      columnCount: 2,
      sourceRawTableId: null,
      relatedPipelineNames: [],
      relatedPipelineIds: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const pipeline: DataPipeline = {
      id: 'task_1',
      groupId: null,
      name: 'customers cleanup',
      status: 'draft',
      nodeCount: 0,
      sourcePath: null,
      sourceRawTableId: null,
      resultTable: null,
      rowCount: null,
      columnCount: null,
      error: null,
      scheduledFor: null,
      createdAt: 1,
      updatedAt: 1,
      lastRunAt: null,
    };
    const commandService = {
      listResultTables: vi.fn(async () => ({
        resultTables: [resultTable],
        total: 1,
        limit: 20,
        offset: 0,
      })),
      listPipelines: vi.fn(async () => ({
        pipelines: [pipeline],
        total: 1,
        limit: 20,
        offset: 0,
      })),
    } as unknown as DataCommandService;
    const service = new DataToolService(commandService, new RequirementAnalysisReceiptStore());

    const outputResult = await service.listResultTables({});
    const pipelineResult = await service.listPipelines({});

    expect(outputResult.content[0]?.text).toContain(
      '[customers output](#/data/result-tables/output_1) (output_1)'
    );
    expect(pipelineResult.content[0]?.text).toContain(
      '[customers cleanup](#/data/pipelines/task_1) (task_1)'
    );
  });

  it('formats input table processing strategy creation results', async () => {
    const preview: DataRawTablePreview = {
      columns: ['id', 'name'],
      columnTypes: [],
      rows: [{ id: '1', name: 'Alice' }],
      fileCount: 1,
      limit: 20,
      offset: 0,
      totalRows: 1,
    };
    const rawTable: DataRawTable = {
      id: 'rawTable_2',
      groupId: null,
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
      relatedPipelineNames: [],
      tableName: 'rawTable_2',
      rowCount: 1,
      columnCount: 2,
      createdAt: 1,
      updatedAt: 1,
    };
    const commandService = {
      createRawTableWithProcessingStrategy: vi.fn(async () => ({
        processingStrategy: 'customize',
        rawTable,
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

    const result = await service.createRawTableWithProcessingStrategy({
      name: 'customers normalized',
      filePath: '/tmp/customers.csv',
      processingStrategy: { strategy: 'customize', rulePrompt: 'normalize' },
    });

    expect(result.content[0]?.text).toContain('Created input table with customize processing');
    expect(result.content[0]?.text).toContain('Normalizer: artifact=artifact_1 version=version_1');
    expect(result.details).toMatchObject({
      processingStrategy: 'customize',
      rawTable: { id: 'rawTable_2' },
      normalizer: { artifact: { id: 'artifact_1' } },
    });
  });

  it('normalizes tool-call strategy JSON strings and workspace-relative source paths', async () => {
    const preview: DataRawTablePreview = {
      columns: ['id'],
      columnTypes: [],
      rows: [{ id: '1' }],
      fileCount: 1,
      limit: 20,
      offset: 0,
      totalRows: 1,
    };
    const rawTable: DataRawTable = {
      id: 'rawTable_3',
      groupId: null,
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
      relatedPipelineNames: [],
      tableName: 'rawTable_3',
      rowCount: 1,
      columnCount: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const createRawTableWithProcessingStrategy = vi.fn(async () => ({
      processingStrategy: 'customize',
      rawTable,
      preview,
    }));
    const commandService = {
      createRawTableWithProcessingStrategy,
    } as unknown as DataCommandService;
    const service = new DataToolService(commandService, new RequirementAnalysisReceiptStore());
    const tool = createDataCustomTools(service, {
      sessionId: 'session_1',
      workspacePath: '/workspace',
      capabilities: {
        canCreateRawTable: true,
        canCreateResultTable: true,
        canCreatePipeline: true,
        canRunPipeline: true,
        canImportLocalFiles: true,
      },
    }).find((item) => item.name === 'data_create_raw_table_with_processing_strategy');

    const result = await executeDataTool(tool, 'call_1', {
      name: 'normalized excel',
      sourceKind: 'excel',
      filePath: '.tmp/source.xlsx',
      processingStrategy: '{"strategy":"customize","rulePrompt":"normalize"}',
    });

    expect(firstText(result)).toContain('Created input table with customize processing');
    expect(createRawTableWithProcessingStrategy).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/workspace/.tmp/source.xlsx',
        processingStrategy: {
          strategy: 'customize',
          rulePrompt: 'normalize',
        },
      })
    );
  });

  it('requires a supported analysis and a later user turn before generating a pipeline', async () => {
    const columnsSnapshot = [{ name: 'Sales', type: 'integer' }];
    const sourceSummaryHash = hashColumns(columnsSnapshot);
    const analysisReceipts = new RequirementAnalysisReceiptStore();
    const analyzePipelineRequirement = vi.fn(async (input: AnalyzePipelineRequirementCommand) => {
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
        rawTableId: 'input_1',
        rawTableName: 'Sales input',
        columnsSnapshot,
        sourceSummaryHash,
        capabilityProfileVersion: AI_JFLOW_RUNTIME_PROFILE_VERSION,
      };
      const receipt = analysisReceipts.create({
        authoringRequest: input.authoringRequest,
        sessionId: input.usageTraceId!,
        sourceUserMessageId: input.sourceUserMessageId,
        rawTableId: result.rawTableId,
        rawTableName: result.rawTableName,
        inputSchemaHash: result.sourceSummaryHash,
        processRequirement: input.processRequirement,
        analysis: result,
        capabilityProfileVersion: result.capabilityProfileVersion,
      });
      return { ...result, analysisId: receipt.id, expiresAt: receipt.expiresAt };
    });
    const previewTable = vi.fn(async () => ({
      tableKind: 'raw' as const,
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
    const generatePipelineFromRequirement = vi.fn(async () => ({
      pipelineId: 'task_1',
      pipelineName: 'Sales pipeline',
      resultTableId: 'output_1',
      resultTableName: 'Sales output',
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
        analyzePipelineRequirement,
        previewTable,
        generatePipelineFromRequirement,
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
        canCreateRawTable: true,
        canCreateResultTable: true,
        canCreatePipeline: true,
        canRunPipeline: true,
        canImportLocalFiles: true,
      },
    };
    const tools = createDataCustomTools(service, promptContext);
    const analyzeTool = tools.find((tool) => tool.name === 'data_analyze_pipeline_requirement');
    const generateTool = tools.find(
      (tool) => tool.name === 'data_generate_pipeline_from_requirement'
    );
    const generateSchema = generateTool!.parameters as {
      properties?: Record<string, unknown>;
    };
    expect(generateSchema.properties).toHaveProperty('outputMode');
    expect(generateSchema.properties).toHaveProperty('resultTableName');
    expect(generateSchema.properties).toHaveProperty('resultTableId');
    expect(generateSchema.properties).not.toHaveProperty('output');
    service.updateExecutionContext({
      sessionId: 'session_1',
      currentUserMessageId: 'user_message_1',
      runtimeConfig,
    });

    const analysis = await executeDataTool(analyzeTool, 'analysis_call_1', {
      rawTableId: 'input_1',
      processRequirement: '过滤 Sales 小于 100 的记录',
    });
    const analysisId = (analysis.details as { analysisId: string }).analysisId;

    expect(analyzePipelineRequirement).toHaveBeenCalledWith(
      expect.objectContaining({
        usageTraceId: 'session_1',
        sourceUserMessageId: 'user_message_1',
      })
    );

    await expect(
      service.generatePipelineFromAnalysis(
        {
          analysisId,
          confirmed: true,
          outputMode: 'create',
          resultTableName: 'Sales output',
        },
        { sessionId: 'session_2', currentUserMessageId: 'user_message_2' }
      )
    ).rejects.toMatchObject({ code: 'ANALYSIS_REQUIRED' });

    await expect(
      executeDataTool(generateTool, 'generation_call_1', {
        analysisId,
        confirmed: true,
        outputMode: 'create',
        resultTableName: 'Sales output',
      })
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });

    await expect(
      service.generatePipelineFromAnalysis(
        {
          analysisId,
          confirmed: true,
          outputMode: 'create',
          resultTableName: 'Sales output',
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
      pipelineName: 'Sales pipeline',
      outputMode: 'create',
      resultTableName: 'Sales output',
    });

    expect(generatePipelineFromRequirement).toHaveBeenCalledWith(
      expect.objectContaining({
        processRequirement: '过滤 Sales 小于 100 的记录',
        pipelineName: 'Sales pipeline',
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
    const nativeRequest = analysisReceipts.get(analysisId)!.authoringRequest;
    expect(nativeRequest).toMatchObject({
      id: expect.any(String),
      source: { location: 'local', tableId: 'input_1' },
    });
    expect(generated.details).toMatchObject({
      dataPipelineCompletion: { requestId: nativeRequest.id, result: { pipelineId: 'task_1' } },
    });
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
      resultTableName: 'ignored',
    });
    expect((repeated.details as { pipeline: { id: string } }).pipeline.id).toBe('task_1');
    expect(generatePipelineFromRequirement).toHaveBeenCalledTimes(1);

    const replacementAnalysis = await executeDataTool(analyzeTool, 'analysis_call_2', {
      rawTableId: 'input_1',
      processRequirement: '过滤 Sales 小于 100 的记录',
      reusePipelineId: 'task_1',
    });
    const replacementAnalysisId = (replacementAnalysis.details as { analysisId: string })
      .analysisId;
    expect(analysisReceipts.get(replacementAnalysisId)!.authoringRequest.id).not.toBe(
      nativeRequest.id
    );
    service.updateExecutionContext({
      sessionId: 'session_1',
      currentUserMessageId: 'user_message_4',
      runtimeConfig,
    });
    await executeDataTool(generateTool, 'generation_call_4', {
      analysisId: replacementAnalysisId,
      confirmed: true,
      pipelineName: 'Sales replacement pipeline',
      outputMode: 'replace',
      resultTableId: 'existing_output_1',
    });
    expect(generatePipelineFromRequirement).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reusePipelineId: 'task_1',
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
    const analyzePipelineRequirement = vi.fn(async (input: AnalyzePipelineRequirementCommand) => {
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
        rawTableId: 'input_2',
        rawTableName: 'Customers',
        columnsSnapshot,
        sourceSummaryHash,
        capabilityProfileVersion: AI_JFLOW_RUNTIME_PROFILE_VERSION,
      };
      const receipt = analysisReceipts.create({
        authoringRequest: input.authoringRequest,
        sessionId: input.usageTraceId!,
        sourceUserMessageId: input.sourceUserMessageId,
        rawTableId: result.rawTableId,
        rawTableName: result.rawTableName,
        inputSchemaHash: result.sourceSummaryHash,
        processRequirement: input.processRequirement,
        analysis: result,
        capabilityProfileVersion: result.capabilityProfileVersion,
      });
      return { ...result, analysisId: receipt.id, expiresAt: receipt.expiresAt };
    });
    const service = new DataToolService(
      { analyzePipelineRequirement } as unknown as DataCommandService,
      analysisReceipts
    );
    const analysis = await service.analyzePipelineRequirement(
      { rawTableId: 'input_2', processRequirement: '筛选优质客户' },
      { sessionId: 'session_1', currentUserMessageId: 'message_1' }
    );
    const analysisId = (analysis.details as { analysisId: string }).analysisId;

    expect(analysis.content[0]?.text).toContain('needs_confirmation');
    expect(analysis.content[0]?.text).toContain('优质客户没有明确标准');
    await expect(
      service.generatePipelineFromAnalysis(
        { analysisId, confirmed: true, outputMode: 'create' },
        { sessionId: 'session_1', currentUserMessageId: 'message_2' }
      )
    ).rejects.toMatchObject({ code: 'REQUIREMENT_NOT_SUPPORTED' });
  });

  it('returns embedded workflow DSL reference without relying on source docs', async () => {
    const commandService = {} as DataCommandService;
    const service = new DataToolService(commandService, new RequirementAnalysisReceiptStore());

    const result = await service.getWorkflowDslReference({ topic: 'examples' });

    expect(result.content[0]?.text).toContain("source orders = @id('local:raw/RAW_ID')");
    expect(result.content[0]?.text).toContain('data_apply_workflow_dsl');
    expect(result.content[0]?.text).not.toContain('design/prep');
  });

  it('reports omitted run mode as temporary / not committed', async () => {
    const pipeline: DataPipeline = {
      id: 'task_run',
      groupId: null,
      name: 'run evidence',
      status: 'completed',
      nodeCount: 1,
      sourcePath: null,
      sourceRawTableId: null,
      resultTable: 'output_1',
      rowCount: 3,
      columnCount: 1,
      error: null,
      scheduledFor: null,
      createdAt: 1,
      updatedAt: 1,
      lastRunAt: 1,
    };
    const runPipeline = vi.fn(async () => ({ pipeline, preview: undefined, diagnostics: [] }));
    const service = new DataToolService(
      { runPipeline } as unknown as DataCommandService,
      new RequirementAnalysisReceiptStore()
    );

    const omitted = await service.runPipeline({ pipelineId: pipeline.id });
    expect(omitted.content[0]?.text).toContain('mode=temporary');
    expect(omitted.content[0]?.text).toContain('not_committed');
    expect(omitted.content[0]?.text).not.toContain('commit=committed');

    const temporary = await service.runPipeline({ pipelineId: pipeline.id, mode: 'temporary' });
    expect(temporary.content[0]?.text).toContain('not_committed');

    const persisted = await service.runPipeline({ pipelineId: pipeline.id, mode: 'persisted' });
    expect(persisted.content[0]?.text).toContain('mode=persisted');
    expect(persisted.content[0]?.text).toContain('commit=committed');
    expect(persisted.content[0]?.text).toContain('physicalTableName=');
    expect(persisted.content[0]?.text).not.toContain('#/data/result-tables/output_1');
    runPipeline.mockResolvedValueOnce({
      pipeline,
      preview: undefined,
      diagnostics: [],
      resultTableId: 'actual-resource-id',
    } as never);
    const linked = await service.runPipeline({ pipelineId: pipeline.id, mode: 'persisted' });
    expect(linked.content[0]?.text).toContain('#/data/result-tables/actual-resource-id');
  });

  it('never promotes listed resources to the current selection', async () => {
    const service = new DataToolService(
      {} as DataCommandService,
      new RequirementAnalysisReceiptStore()
    );
    const context = {
      session: { id: 'session_1', cwd: '/tmp' },
      prompt: '列出任务',
      existingMessages: [],
      isColdStart: false,
    } as never;

    // A bare list result records candidates — not a selection.
    service.rememberResolvedResources(
      'session_1',
      'data_list_pipelines',
      {},
      {
        pipelines: [
          { id: 'task_a', name: 'A' },
          { id: 'task_b', name: 'B' },
          { id: 'task_c', name: 'C' },
        ],
      }
    );
    let resolved = await service.resolveConversationContext(context);
    expect(resolved.selectedDataPipelineId).toBeUndefined();
    expect(
      resolved.recentResources?.filter((ref) => ref.kind === 'Pipeline').map((ref) => ref.id)
    ).toEqual(['task_a', 'task_b', 'task_c']);
    expect(resolved.recentResources?.every((ref) => ref.listed)).toBe(true);

    // An explicit tool param selects the resource.
    service.rememberResolvedResources(
      'session_1',
      'data_get_pipeline_workflow',
      { pipelineId: 'task_b' },
      {
        pipeline: { id: 'task_b', name: 'B' },
      }
    );
    resolved = await service.resolveConversationContext(context);
    expect(resolved.selectedDataPipelineId).toBe('task_b');

    // A previously selected resource appearing later in a list must not regain selection.
    service.rememberResolvedResources(
      'session_1',
      'data_get_pipeline_workflow',
      { pipelineId: 'task_a' },
      { pipeline: { id: 'task_a', name: 'A' } }
    );
    service.rememberResolvedResources(
      'session_1',
      'data_get_pipeline_workflow',
      { pipelineId: 'task_b' },
      { pipeline: { id: 'task_b', name: 'B' } }
    );
    service.rememberResolvedResources(
      'session_1',
      'data_list_pipelines',
      {},
      { pipelines: [{ id: 'task_b' }, { id: 'task_a' }] }
    );
    expect((await service.resolveConversationContext(context)).selectedDataPipelineId).toBe(
      'task_b'
    );
    for (let i = 0; i < 12; i++)
      service.rememberResolvedResources(
        'session_1',
        'data_list_pipelines',
        {},
        { pipelines: [{ id: `other_${i}` }] }
      );
    expect((await service.resolveConversationContext(context)).selectedDataPipelineId).toBe(
      'task_b'
    );

    // Listing again afterwards must not demote the explicit selection.
    service.rememberResolvedResources(
      'session_1',
      'data_list_pipelines',
      {},
      {
        pipelines: [
          { id: 'task_a', name: 'A' },
          { id: 'task_c', name: 'C' },
        ],
      }
    );
    resolved = await service.resolveConversationContext(context);
    expect(resolved.selectedDataPipelineId).toBe('task_b');
  });

  it('bounds the model-facing preview without losing columns from the retrievable result', async () => {
    const preview: DataRawTablePreview = {
      columns: Array.from({ length: 100 }, (_, i) => `col_${i}`),
      columnTypes: Array.from({ length: 100 }, (_, i) => ({
        name: `col_${i}`,
        type: 'text',
        storageType: 'VARCHAR',
      })),
      rows: Array.from({ length: 5 }, (_, r) =>
        Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`col_${i}`, `value_${r}_${i}`]))
      ),
      fileCount: 1,
      limit: 5,
      offset: 0,
      totalRows: 5,
    };
    const service = new DataToolService(
      {
        previewTable: vi.fn(async () => ({ tableKind: 'raw', id: 't', preview })),
      } as unknown as DataCommandService,
      new RequirementAnalysisReceiptStore()
    );

    const result = await service.previewTable({
      tableKind: 'raw',
      id: 't',
      limit: 5,
      includeRows: true,
    });
    const store = new ModelResultStore();
    const bounded = store.bound(result);
    const text = bounded.content[0]?.type === 'text' ? bounded.content[0].text : '';
    expect(text.length).toBeLessThanOrEqual(6000);
    const page = JSON.parse(text);
    expect(page.truncated).toBe(true);
    expect(page.resultRef).toMatch(/^result_/);
    const recovered = await store
      .createReadTool()
      .execute(
        'read',
        { resultRef: page.resultRef, contains: 'value_4_99' },
        undefined,
        undefined,
        undefined as never
      );
    expect(JSON.stringify(recovered.content)).toContain('value_4_99');
    expect(bounded.details).toBe(result.details);
  });
});
