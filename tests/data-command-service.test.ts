import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from '../src/main/utils/xlsx';
import { DataCommandService } from '../src/main/data/data-command-service';
import { DataToolService } from '../src/main/data/data-tool-service';
import { RequirementAnalysisReceiptStore } from '../src/main/data/requirement-analysis-receipt-store';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../src/main/data/data-pipeline-store';
import type { RawTableNormalizerProjectGenerator } from '../src/main/data/raw-table-normalizer-generator';
import { createRawTableNormalizerProjectTemplate } from '../src/shared/raw-table-normalizer/templates';
import { runPiAiOneShot, type PiAiOneShotResult } from '../src/main/agent/pi-ai-one-shot';
import { JFLOW_GENERATION_REPAIR_ATTEMPTS } from '../src/main/data/workflow/jflow-generator';
import type { AgentRuntimeConfig, DataPipeline } from '../src/renderer/types';
import type { PersonalAnalysisConnectionInput } from '../src/shared/personal-analysis-types';

/** A model reply carrying a jflow program; $SRC / $OUT are bound from the system prompt. */
function jflowReply(...steps: string[]): string {
  return [
    '```jflow',
    "source src = @id('$SRC')",
    'src',
    ...steps.map((step) => `  | ${step}`),
    '  | write $OUT mode: replace',
    '```',
    'summary: test program',
  ].join('\n');
}

function bindReply(result: PiAiOneShotResult, systemPrompt: unknown): PiAiOneShotResult {
  const system = String(systemPrompt ?? '');
  const src = /source src = @id\('([^']*)'\)/.exec(system)?.[1];
  const out = /\| write (@\w+\('(?:[^']|'')*'\)) mode:/.exec(system)?.[1];
  if (!src || !out) return result;
  return { ...result, text: result.text.replaceAll('$SRC', src).replaceAll('$OUT', out) };
}

vi.mock('../src/main/agent/pi-ai-one-shot', () => ({ runPiAiOneShot: vi.fn() }));

const ONE_SHOT_RESULT_DEFAULTS = {
  provider: 'test-provider',
  model: 'test-model',
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
} satisfies Pick<PiAiOneShotResult, 'provider' | 'model' | 'usage'>;

const tempRoots: string[] = [];
const stores: DataPipelineStore[] = [];
const testRuntimeConfig: AgentRuntimeConfig = {
  provider: 'openai',
  apiKey: 'test-key',
  model: 'test-model',
  enableThinking: false,
  thinkingLevel: 'medium',
};

let modelReplies: PiAiOneShotResult[] = [];
let defaultModelReply: PiAiOneShotResult;

function queueModelReply(result: PiAiOneShotResult) {
  modelReplies.push(result);
  return { mockResolvedValueOnce: (next: PiAiOneShotResult) => queueModelReply(next) };
}

beforeEach(() => {
  modelReplies = [];
  defaultModelReply = {
    text: jflowReply("where [Market] <> 'EU'"),
    hasThinking: false,
    durationMs: 1,
    ...ONE_SHOT_RESULT_DEFAULTS,
  };
  vi.mocked(runPiAiOneShot).mockImplementation(async (_user, system) =>
    bindReply(modelReplies.shift() ?? defaultModelReply, system)
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

describe('DataCommandService', () => {
  it('binds direct UI generation to the analysis flow and supported requirement', async () => {
    queueModelReply({
      text: JSON.stringify({
        items: [
          {
            requirement: '只保留 Market 不等于 EU 的记录',
            status: 'supported',
            capabilities: ['filter.boolean_predicate'],
          },
        ],
      }),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'analysis-bound.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'analysis-bound input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const analysis = await service.analyzePipelineRequirement({
      source: { location: 'local', tableId: input.rawTable.id },
      processRequirement: '只保留 Market 不等于 EU 的记录',
      usageTraceId: 'ui-analysis-flow',
      runtimeConfig: testRuntimeConfig,
    });

    expect(analysis.analysisId).toEqual(expect.any(String));
    expect(analysis.capabilityProfileVersion).toBe('jflow-runtime/r1');
    expect(analysis.items[0]?.capabilities).toEqual(['filter.boolean_predicate']);
    await expect(
      service.generatePipelineFromRequirement({
        source: { location: 'local', tableId: input.rawTable.id },
        processRequirement: '改成汇总销售额',
        output: { location: 'local', writeMode: 'create', tableName: 'analysis-bound output' },
        usageTraceId: 'ui-analysis-flow',
        analysisId: analysis.analysisId,
        runtimeConfig: testRuntimeConfig,
      })
    ).rejects.toMatchObject({ code: 'REQUIREMENT_NOT_SUPPORTED' });
    await expect(
      service.generatePipelineFromRequirement({
        source: { location: 'local', tableId: input.rawTable.id },
        processRequirement: '只保留 Market 不等于 EU 的记录',
        output: { location: 'local', writeMode: 'create', tableName: 'analysis-bound output' },
        usageTraceId: 'another-ui-flow',
        analysisId: analysis.analysisId,
        runtimeConfig: testRuntimeConfig,
      })
    ).rejects.toMatchObject({ code: 'ANALYSIS_REQUIRED' });
  });

  it('downgrades a supported analysis that cites an unknown capability variant', async () => {
    queueModelReply({
      text: JSON.stringify({
        items: [
          {
            requirement: '递归展开 JSON 对象',
            status: 'supported',
            capabilities: ['unnest.recursive_json_object'],
          },
        ],
      }),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'unsupported-capability.csv');
    fs.writeFileSync(csvPath, 'payload\n"{""a"":1}"\n', 'utf8');
    const input = await service.createRawTable({
      name: 'unsupported capability input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const analysis = await service.analyzePipelineRequirement({
      source: { location: 'local', tableId: input.rawTable.id },
      processRequirement: '递归展开 JSON 对象',
      usageTraceId: 'unsupported-capability-flow',
      runtimeConfig: testRuntimeConfig,
    });

    expect(analysis.status).toBe('unsupported');
    expect(analysis.items[0]).toMatchObject({
      status: 'unsupported',
      reason: expect.stringContaining('Unavailable capability'),
      capabilities: [],
    });
  });

  it('carries the analyzed capability variant through generation and repair', async () => {
    queueModelReply({
      text: JSON.stringify({
        items: [
          {
            requirement: '按 id 去重并保留第一条',
            status: 'supported',
            capabilities: ['deduplicate.keep_first'],
          },
        ],
      }),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'capability-variant.csv');
    fs.writeFileSync(csvPath, 'id,value\n1,first\n1,last\n', 'utf8');
    const input = await service.createRawTable({
      name: 'capability variant input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const analysis = await service.analyzePipelineRequirement({
      source: { location: 'local', tableId: input.rawTable.id },
      processRequirement: '按 id 去重并保留第一条',
      usageTraceId: 'capability-variant-flow',
      runtimeConfig: testRuntimeConfig,
    });
    queueModelReply({
      text: jflowReply('distinct by: [id] keep: last'),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    }).mockResolvedValueOnce({
      text: jflowReply('distinct by: [id] keep: first'),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });

    await service.generatePipelineFromRequirement({
      source: { location: 'local', tableId: input.rawTable.id },
      processRequirement: '按 id 去重并保留第一条',
      output: { location: 'local', writeMode: 'create', tableName: 'capability variant output' },
      usageTraceId: 'capability-variant-flow',
      analysisId: analysis.analysisId,
      runtimeConfig: testRuntimeConfig,
    });

    for (const callIndex of [1]) {
      // The confirmed contract scopes the jflow system prompt for generation and repair alike.
      const systemPrompt = String(vi.mocked(runPiAiOneShot).mock.calls[callIndex]?.[1]);
      expect(systemPrompt).toContain('operation kinds: deduplicate');
    }
  });

  it('uses the same analysis receipt across the real tool and command generation chain', async () => {
    queueModelReply({
      text: JSON.stringify({
        items: [
          {
            requirement: '按 id 去重并保留第一条',
            status: 'supported',
            capabilities: ['deduplicate.keep_first'],
          },
        ],
      }),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });
    const requirementAnalysisReceipts = new RequirementAnalysisReceiptStore();
    const { service, tempRoot } = createService({ requirementAnalysisReceipts });
    const toolService = new DataToolService(service, requirementAnalysisReceipts);
    const csvPath = path.join(tempRoot, 'tool-capability-variant.csv');
    fs.writeFileSync(csvPath, 'id,value\n1,first\n1,last\n', 'utf8');
    const input = await service.createRawTable({
      name: 'tool capability variant input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const analysis = await toolService.analyzePipelineRequirement(
      {
        rawTableId: input.rawTable.id,
        processRequirement: '按 id 去重并保留第一条',
      },
      {
        sessionId: 'tool-capability-session',
        currentUserMessageId: 'tool-user-message-1',
        runtimeConfig: testRuntimeConfig,
      }
    );
    const analysisId = (analysis.details as { analysisId: string }).analysisId;
    expect(requirementAnalysisReceipts.get(analysisId)).toMatchObject({
      sessionId: 'tool-capability-session',
      sourceUserMessageId: 'tool-user-message-1',
    });

    queueModelReply({
      text: jflowReply('distinct by: [id] keep: last'),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    }).mockResolvedValueOnce({
      text: jflowReply('distinct by: [id] keep: first'),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });

    await toolService.generatePipelineFromAnalysis(
      {
        analysisId,
        confirmed: true,
        pipelineName: 'tool capability variant pipeline',
        outputMode: 'create',
        resultTableName: 'tool capability variant output',
      },
      {
        sessionId: 'tool-capability-session',
        currentUserMessageId: 'tool-user-message-2',
        runtimeConfig: testRuntimeConfig,
      }
    );

    for (const callIndex of [1]) {
      // The confirmed contract scopes the jflow system prompt for generation and repair alike.
      const systemPrompt = String(vi.mocked(runPiAiOneShot).mock.calls[callIndex]?.[1]);
      expect(systemPrompt).toContain('operation kinds: deduplicate');
    }
  });

  it('uses configured Personal Analysis connection for cloud commands', async () => {
    const { service } = createService({
      personalAnalysis: {
        apiOrigin: 'http://configured.mock',
        apiKey: 'configured-key',
        updatedAt: 1,
      },
    });
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/api/personal/api-keys/token')) {
        return jsonResponse({ success: true, data: { accessToken: 'configured-token' } });
      }
      if (href.endsWith('/api/personal/analysis/v1/spaces')) {
        return jsonResponse({
          success: true,
          data: [{ spaceId: 'space-1', spaceName: 'Configured Space' }],
        });
      }
      throw new Error(`Unexpected request: ${href} ${init?.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.listCloudSpaces({});

    expect(result.spaces[0]?.spaceName).toBe('Configured Space');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://configured.mock/api/personal/api-keys/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-API-Key': 'configured-key' },
        signal: expect.any(AbortSignal),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://configured.mock/api/personal/analysis/v1/spaces',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer configured-token' },
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('reads the latest Personal Analysis config for each cloud command', async () => {
    let personalAnalysis = {
      apiOrigin: 'http://old.mock',
      apiKey: 'old-key',
      updatedAt: 1,
    };
    const { service } = createService({
      getPersonalAnalysisConfig: () => personalAnalysis,
    });
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith('/api/personal/api-keys/token')) {
        return jsonResponse({ success: true, data: { accessToken: 'token' } });
      }
      if (href.endsWith('/api/personal/analysis/v1/spaces')) {
        return jsonResponse({ success: true, data: [] });
      }
      throw new Error(`Unexpected request: ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await service.listCloudSpaces({});
    personalAnalysis = {
      apiOrigin: 'http://new.mock',
      apiKey: 'new-key',
      updatedAt: 2,
    };
    await service.listCloudSpaces({});

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://old.mock/api/personal/api-keys/token',
      expect.objectContaining({
        headers: { 'X-API-Key': 'old-key' },
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://new.mock/api/personal/api-keys/token',
      expect.objectContaining({
        headers: { 'X-API-Key': 'new-key' },
      })
    );
  });

  it('uses account token instead of configured API key when account mode is explicit', async () => {
    const { service } = createService({
      personalAnalysis: {
        apiOrigin: 'http://configured.mock',
        apiKey: 'configured-key',
        updatedAt: 1,
      },
      getPersonalAnalysisConnection: () => ({
        apiOrigin: 'http://account.mock',
        accessToken: 'account-token',
      }),
    });
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/api/personal/api-keys/token')) {
        throw new Error('API key token exchange should not be called in account mode');
      }
      if (href.endsWith('/api/personal/analysis/v1/spaces')) {
        return jsonResponse({
          success: true,
          data: [{ spaceId: 'space-account', spaceName: 'Account Space' }],
        });
      }
      throw new Error(`Unexpected request: ${href} ${init?.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const spacesInput: PersonalAnalysisConnectionInput = {
      connectionMode: 'account',
      apiOrigin: 'http://account.mock',
    };
    const result = await service.listCloudSpaces(spacesInput);

    expect(result.spaces[0]?.spaceName).toBe('Account Space');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://account.mock/api/personal/analysis/v1/spaces',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer account-token' },
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('rejects CREATE cloud uploads when tableId is provided', async () => {
    const { service, store } = createService();
    const exportSpy = vi.spyOn(store, 'exportRawTableCsv');

    await expect(
      service.uploadDataTableToCloud({
        tableKind: 'raw',
        id: 'input-1',
        writeMode: 'CREATE',
        tableId: 'table-should-not-be-sent',
      })
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('tableId must be omitted for CREATE upload'),
    });
    expect(exportSpy).not.toHaveBeenCalled();
  });

  it('uses the only available datasource for cloud uploads when datasourceId is omitted', async () => {
    const { service, tempRoot } = createService({
      personalAnalysis: {
        apiOrigin: 'http://configured.mock',
        apiKey: 'configured-key',
      },
    });
    const csvPath = path.join(tempRoot, 'sales.csv');
    fs.writeFileSync(csvPath, 'month,revenue\nJan,100\n', 'utf8');
    const input = await service.createRawTable({
      name: 'sales',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/api/personal/api-keys/token')) {
        return jsonResponse({ success: true, data: { accessToken: 'token' } });
      }
      if (href.endsWith('/api/personal/analysis/v1/datasources')) {
        return jsonResponse({
          success: true,
          data: [{ datasourceId: 'datasource-auto', datasourceName: 'Auto Datasource' }],
        });
      }
      if (href.endsWith('/api/personal/analysis/v1/imports/upload-url')) {
        const body = JSON.parse(String(init?.body || '{}'));
        expect(body.datasourceId).toBe('datasource-auto');
        return jsonResponse({
          success: true,
          data: {
            uploadPipelineId: 'upload-1',
            tableId: 'table-1',
            uploadUrl: 'http://upload.mock/sales.csv',
          },
        });
      }
      if (href === 'http://upload.mock/sales.csv') {
        expect(init?.method).toBe('PUT');
        return new Response('', { status: 200 });
      }
      if (href.endsWith('/api/personal/analysis/v1/imports')) {
        return jsonResponse({
          success: true,
          data: { pipelineId: 'import-1', tableId: 'table-1', status: 'PENDING' },
        });
      }
      throw new Error(`Unexpected request: ${href} ${init?.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.uploadDataTableToCloud({
      tableKind: 'raw',
      id: input.rawTable.id,
      writeMode: 'CREATE',
      waitForDone: false,
    });

    expect(result.upload.tableId).toBe('table-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://configured.mock/api/personal/analysis/v1/datasources',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('asks for datasourceId when multiple upload datasources are available', async () => {
    const { service, tempRoot } = createService({
      personalAnalysis: {
        apiOrigin: 'http://configured.mock',
        apiKey: 'configured-key',
      },
    });
    const csvPath = path.join(tempRoot, 'sales.csv');
    fs.writeFileSync(csvPath, 'month,revenue\nJan,100\n', 'utf8');
    const input = await service.createRawTable({
      name: 'sales',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith('/api/personal/api-keys/token')) {
        return jsonResponse({ success: true, data: { accessToken: 'token' } });
      }
      if (href.endsWith('/api/personal/analysis/v1/datasources')) {
        return jsonResponse({
          success: true,
          data: [
            { datasourceId: 'datasource-sales', datasourceName: 'Sales Datasource' },
            { datasourceId: 'datasource-retention', datasourceName: 'Retention Datasource' },
          ],
        });
      }
      throw new Error(`Unexpected request: ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      service.uploadDataTableToCloud({
        tableKind: 'raw',
        id: input.rawTable.id,
        writeMode: 'CREATE',
      })
    ).rejects.toMatchObject({
      code: 'RUN_FAILED',
      message: expect.stringContaining('Pass datasourceId for this upload'),
    });
  });

  it('creates input/output/pipeline resources, saves workflow DSL, and runs the pipeline', async () => {
    const { service, store, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n2,Bob\n', 'utf8');

    const input = await service.createRawTable({
      name: 'customers',
      sourceKind: 'csv',
      filePath: csvPath,
      previewRows: 2,
    });
    expect(input.rawTable.name).toBe('customers');
    expect(input.preview?.totalRows).toBe(2);

    const output = await service.createResultTable({
      name: 'customers output',
      sourceRawTableId: input.rawTable.id,
    });
    expect(output.resultTable.name).toBe('customers output');
    expect(output.resultTable.rowCount).toBe(2);

    const pipeline = await service.createPipeline({
      name: 'Copy customers',
      sourceRawTableId: input.rawTable.id,
      resultTableId: output.resultTable.id,
    });
    expect(pipeline.pipeline.sourceRawTableId).toBe(input.rawTable.id);
    expect(pipeline.pipeline.resultTable).toBe(output.resultTable.tableName);

    const listedRawTablesBeforeRun = await service.listRawTables({});
    const listedResultTablesBeforeRun = await service.listResultTables({});
    expect(listedRawTablesBeforeRun.rawTables[0]?.relatedPipelineNames).toContain('Copy customers');
    expect(listedResultTablesBeforeRun.resultTables[0]?.relatedPipelineNames).toContain(
      'Copy customers'
    );

    const dsl = `
      source customers = @id('local:raw/${input.rawTable.id}')

      customers
        | write @new('customers_copy') mode: replace
    `;
    const dryRun = await service.applyWorkflowDsl({
      pipelineId: pipeline.pipeline.id,
      dsl,
      resultTableId: output.resultTable.id,
      dryRun: true,
    });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.workflow.nodes.map((node) => node.type)).toEqual(['input', 'output']);
    expect(
      dryRun.workflow.nodes.find((node) => node.type === 'output')?.config.outputResultTableId
    ).toBe(output.resultTable.id);

    const saved = await service.applyWorkflowDsl({
      pipelineId: pipeline.pipeline.id,
      resultTableId: output.resultTable.id,
      dsl,
    });
    const outputNode = saved.workflow.nodes.find((node) => node.type === 'output');
    expect(outputNode?.config.outputResultTableId).toBe(output.resultTable.id);

    const onPipelineCompleted = vi.fn();
    const notifyingService = new DataCommandService(
      store,
      createFakeNormalizerGenerator(),
      () => ({
        apiOrigin: '',
        apiKey: '',
        updatedAt: 0,
      }),
      { onPipelineCompleted }
    );

    const temporaryRun = await notifyingService.runPipeline({
      pipelineId: pipeline.pipeline.id,
      mode: 'temporary',
      previewRows: 2,
    });
    expect(temporaryRun.pipeline.status).toBe('completed');
    expect(temporaryRun.pipeline.resultTable).toMatch(/^temp_pipeline_/);
    expect(temporaryRun.preview?.totalRows).toBe(2);

    const persistedRun = await notifyingService.runPipeline({
      pipelineId: pipeline.pipeline.id,
      mode: 'persisted',
      previewRows: 2,
    });
    expect(persistedRun.pipeline.status).toBe('completed');
    expect(persistedRun.resultTableId).toBe(output.resultTable.id);
    expect((await service.getRunResult({ pipelineId: pipeline.pipeline.id })).resultTableId).toBe(
      output.resultTable.id
    );
    expect(temporaryRun.resultTableId).toBeUndefined();
    expect(persistedRun.pipeline.sourceRawTableId).toBe(input.rawTable.id);
    expect(persistedRun.preview?.totalRows).toBe(2);
    expect(onPipelineCompleted).toHaveBeenCalledTimes(1);
    expect(onPipelineCompleted).toHaveBeenLastCalledWith(persistedRun.pipeline);

    const exported = await service.exportWorkflowDsl({ pipelineId: pipeline.pipeline.id });
    expect(exported.text).toContain(`source customers = @id('local:raw/${input.rawTable.id}'`);

    const outputPreview = await service.previewTable({
      tableKind: 'result',
      id: output.resultTable.id,
      limit: 2,
    });
    expect(outputPreview.preview.totalRows).toBe(2);
    expect(outputPreview.preview.columns).toEqual(['id', 'name']);
  });

  it('rejects JSON workflow payloads with a clear DSL format diagnostic', async () => {
    const { service } = createService();
    const pipeline = await service.createPipeline({ name: 'Bad DSL pipeline' });

    const result = await service.applyWorkflowDsl({
      pipelineId: pipeline.pipeline.id,
      dryRun: true,
      dsl: '{"nodes":[],"edges":[]}',
    });

    expect(result.diagnostics?.[0]).toMatchObject({
      severity: 'error',
      code: 'invalidDslFormat',
    });
    expect(result.diagnostics?.[0]?.message).toContain('not JSON');
  });

  it('reuses an LRU-cached compiled workflow candidate', async () => {
    const { service, store, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'candidate-cache.csv');
    fs.writeFileSync(csvPath, 'id\n1\n', 'utf8');
    const input = await service.createRawTable({
      name: 'candidate cache input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const pipeline = await service.createPipeline({ name: 'candidate cache pipeline' });
    const lookupSpy = vi.spyOn(store, 'getRawTableRecord');
    const dsl = `source src = @id('local:raw/${input.rawTable.id}')\nsrc\n  | write @new('cache result') mode: replace`;

    await service.applyWorkflowDsl({
      pipelineId: pipeline.pipeline.id,
      dsl,
      rawTableId: input.rawTable.id,
      dryRun: true,
    });
    const lookupsAfterFirstCompile = lookupSpy.mock.calls.length;
    expect(lookupsAfterFirstCompile).toBeGreaterThan(0);
    await service.applyWorkflowDsl({
      pipelineId: pipeline.pipeline.id,
      dsl,
      rawTableId: input.rawTable.id,
      dryRun: true,
    });

    expect(lookupSpy).toHaveBeenCalledTimes(lookupsAfterFirstCompile);
  });

  it('saves a requested workflow only after pipeline execution succeeds', async () => {
    const { service, store, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'save-after-run.csv');
    fs.writeFileSync(csvPath, 'id\n1\n', 'utf8');
    const input = await service.createRawTable({
      name: 'save after run input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const output = await service.createResultTable({ name: 'save after run output' });
    const pipeline = await service.createPipeline({
      name: 'save after run pipeline',
      sourceRawTableId: input.rawTable.id,
      resultTableId: output.resultTable.id,
    });
    const runSpy = vi
      .spyOn(store, 'runPipelineWithDiagnostics')
      .mockRejectedValueOnce(new Error('execution failed'));
    const saveSpy = vi.spyOn(store, 'savePipelineWorkflow');

    await expect(
      service.runPipeline({
        pipelineId: pipeline.pipeline.id,
        mode: 'persisted',
        workflowDsl: `source src = @id('local:raw/${input.rawTable.id}')\nsrc\n  | write @id('local:result/${output.resultTable.id}') mode: replace`,
        resultTableId: output.resultTable.id,
        saveWorkflow: true,
      })
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('serializes concurrent operations for the same pipeline', async () => {
    const { service, store } = createService();
    const pipeline = await service.createPipeline({ name: 'keyed lock pipeline' });
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let callCount = 0;
    vi.spyOn(store, 'runPipelineWithDiagnostics').mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) await firstBlocked;
      return { pipeline: { ...pipeline.pipeline, status: 'completed' }, diagnostics: [] };
    });

    const first = service.runPipeline({ pipelineId: pipeline.pipeline.id, mode: 'persisted' });
    await vi.waitFor(() => expect(callCount).toBe(1));
    const second = service.runPipeline({ pipelineId: pipeline.pipeline.id, mode: 'persisted' });
    await Promise.resolve();
    expect(callCount).toBe(1);

    releaseFirst();
    await Promise.all([first, second]);
    expect(callCount).toBe(2);
  });

  it('cleans temporary pipeline resources after returning the preview', async () => {
    const { service, store, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'temporary.csv');
    fs.writeFileSync(csvPath, 'id\n1\n', 'utf8');
    const input = await service.createRawTable({
      name: 'temporary input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const pipeline = await service.createPipeline({
      name: 'temporary cleanup pipeline',
      sourceRawTableId: input.rawTable.id,
    });
    const cleanupSpy = vi.spyOn(store, 'cleanupTemporaryPipelineResources');

    const result = await service.runPipeline({
      pipelineId: pipeline.pipeline.id,
      mode: 'temporary',
      workflowDsl: `source src = @id('local:raw/${input.rawTable.id}')\nsrc\n  | write @new('temporary result') mode: replace`,
    });

    expect(result.preview?.totalRows).toBe(1);
    expect(cleanupSpy).toHaveBeenCalledWith(pipeline.pipeline.id);
  });

  it('reports duplicate names with stable command errors', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');
    await service.createRawTable({ name: 'customers', filePath: csvPath });

    await expect(service.createRawTable({ name: 'customers', filePath: csvPath })).rejects.toThrow(
      '[RESOURCE_ALREADY_EXISTS]'
    );
  });

  it('generates, previews, publishes, and lists custom normalizer versions', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');

    const draft = await service.generateRawTableNormalizerDraft({
      name: 'customers normalizer',
      sourcePath: csvPath,
      sourceKind: 'csv',
      rulePrompt: 'Normalize the customer Csv into a standard table.',
      primaryLanguage: 'node',
    });

    expect(draft.version.status).toBe('draft');
    expect(draft.summary.fileCount).toBe(1);
    expect(draft.version.files.some((file) => file.path === 'src/cli.js')).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          tempRoot,
          'raw-table-normalizers',
          'projects',
          draft.artifact.id,
          draft.version.id,
          'src',
          'cli.js'
        )
      )
    ).toBe(true);

    const preview = await service.previewRawTableNormalizerVersion({
      versionId: draft.version.id,
      sourcePath: csvPath,
      sourceKind: 'csv',
      prepareDependencies: false,
      limit: 5,
    });
    expect(preview.preview.totalRows).toBe(1);
    expect(preview.preview.columns).toEqual(['id', 'name']);
    expect(preview.preview.rows[0]).toEqual({ id: '1', name: 'Alice' });

    const published = await service.publishRawTableNormalizerVersion({
      versionId: draft.version.id,
    });
    expect(published.version.status).toBe('published');
    expect(published.artifact.activeVersionId).toBe(draft.version.id);

    const versions = await service.listRawTableNormalizerVersions({
      artifactId: draft.artifact.id,
    });
    expect(versions.versions).toHaveLength(1);
    expect(versions.versions[0]).toMatchObject({
      id: draft.version.id,
      status: 'published',
    });

    const secondDraft = await service.generateRawTableNormalizerDraft({
      artifactId: draft.artifact.id,
      name: 'customers normalizer',
      sourcePath: csvPath,
      sourceKind: 'csv',
      rulePrompt: 'Normalize the customer Csv into a standard table with a second draft.',
      primaryLanguage: 'node',
    });
    expect(secondDraft.version.status).toBe('draft');
    const secondDraftProjectDir = path.join(
      tempRoot,
      'raw-table-normalizers',
      'projects',
      secondDraft.artifact.id,
      secondDraft.version.id
    );
    expect(fs.existsSync(secondDraftProjectDir)).toBe(true);

    await expect(
      service.deleteRawTableNormalizerVersion({
        versionId: published.version.id,
      })
    ).rejects.toThrow('Published normalizer versions cannot be deleted');

    await expect(
      service.deleteRawTableNormalizerVersion({
        versionId: secondDraft.version.id,
      })
    ).resolves.toEqual({ success: true });
    expect(fs.existsSync(secondDraftProjectDir)).toBe(false);

    const versionsAfterDelete = await service.listRawTableNormalizerVersions({
      artifactId: draft.artifact.id,
    });
    expect(versionsAfterDelete.versions).toHaveLength(1);
    expect(versionsAfterDelete.versions[0]?.id).toBe(published.version.id);
  });

  it('creates an input table through the custom processing strategy DSL', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n2,Bob\n', 'utf8');

    const result = await service.createRawTableWithProcessingStrategy({
      name: 'customers normalized',
      sourceKind: 'csv',
      filePath: csvPath,
      previewRows: 2,
      processingStrategy: {
        strategy: 'customize',
        rulePrompt: 'Normalize the customer Csv into a standard two-dimensional table.',
        primaryLanguage: 'node',
      },
    });

    expect(result.processingStrategy).toBe('customize');
    expect(result.normalizer?.publishedVersion.status).toBe('published');
    expect(result.rawTable.inputConfig.dataProcessing).toMatchObject({
      strategy: 'customize',
      artifactId: result.normalizer?.artifact.id,
      artifactVersionId: result.normalizer?.publishedVersion.id,
      artifactVersionStatus: 'published',
    });
    expect(result.preview?.columns).toEqual(['id', 'name']);
    expect(result.preview?.totalRows).toBe(2);
  });

  it('emits progress while generating a custom normalizer draft', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');
    const progressEvents: Array<{ phase: string; kind: string; text: string }> = [];

    await service.generateRawTableNormalizerDraft({
      name: 'customers normalizer',
      sourcePath: csvPath,
      sourceKind: 'csv',
      rulePrompt: 'Normalize the customer Csv into a standard table.',
      primaryLanguage: 'node',
      onProgress: (event) => progressEvents.push(event),
    });

    expect(progressEvents.map((event) => event.phase)).toEqual(
      expect.arrayContaining(['source_summary', 'code_generation', 'saving', 'complete'])
    );
    expect(progressEvents).toContainEqual({
      phase: 'code_generation',
      kind: 'delta',
      text: 'fake generated project delta',
    });
  });

  it('generates a custom normalizer that flattens irregular Excel tables and dedupes headers', async () => {
    const { service, tempRoot } = createService();
    const excelPath = path.join(tempRoot, 'irregular.xlsx');
    writeWorkbook(excelPath, {
      Sheet1: [
        ['不规则表处理'],
        ['生成时间', '2026-06-03'],
        ['姓名', '姓名', '金额'],
        ['Alice', 'A-001', 100],
        ['Bob', 'B-002', 200],
      ],
    });

    const draft = await service.generateRawTableNormalizerDraft({
      name: '不规则表处理 normalizer',
      sourcePath: excelPath,
      sourceKind: 'excel',
      config: {
        sourceKind: 'excel',
        sheetName: 'Sheet1',
        sheetNames: ['Sheet1'],
        headerMode: 'auto',
        headerRow: 1,
      },
      rulePrompt: '把表格变成标准的二维表，列重复的时候，把第二个名字加个序号',
      primaryLanguage: 'node',
    });

    const preview = await service.previewRawTableNormalizerVersion({
      versionId: draft.version.id,
      sourcePath: excelPath,
      sourceKind: 'excel',
      config: {
        sourceKind: 'excel',
        sheetName: 'Sheet1',
        sheetNames: ['Sheet1'],
        headerMode: 'auto',
        headerRow: 1,
      },
      prepareDependencies: false,
      limit: 10,
    });

    expect(preview.preview.columns).toEqual(['姓名', '姓名_2', '金额']);
    expect(preview.preview.totalRows).toBe(2);
    expect(preview.preview.rows[0]).toEqual({ 姓名: 'Alice', 姓名_2: 'A-001', 金额: '100' });
  });

  it('generates a custom normalizer that preserves Chinese two-level Excel headers', async () => {
    const { service, tempRoot } = createService();
    const excelPath = path.join(tempRoot, 'two-level-header.xlsx');
    writeWorkbookWithMerges(
      excelPath,
      {
        Sheet1: [
          [null, '9.35971E+11', null, null, null, null, null],
          ['时间\n顺着填', '整体数据', null, null, '手淘搜索', null, null],
          [null, '总访客', '总支付\n人数', '转化率', '访客数', '支付人数', '转化率'],
          ['5/1/26', '1,473', '223', '15.14%', '159', '38', '23.90%'],
          ['5/2/26', '1,280', '146', '11.41%', '246', '43', '17.48%'],
        ],
      },
      {
        Sheet1: ['A2:A3', 'B2:D2', 'E2:G2'],
      }
    );

    const config = {
      sourceKind: 'excel' as const,
      sheetName: 'Sheet1',
      sheetNames: ['Sheet1'],
      headerMode: 'auto' as const,
      headerRow: 1,
    };
    const draft = await service.generateRawTableNormalizerDraft({
      name: '两层表头 normalizer',
      sourcePath: excelPath,
      sourceKind: 'excel',
      config,
      rulePrompt:
        '把表格变成标准的二维表，列重复的时候，把第二个名字加个序号，保留中文的列名信息，有两层表头的情况，用第一层-第二次名字，这种形式表示表头',
      primaryLanguage: 'node',
    });

    const generatedTransform = draft.version.files.find(
      (file) => file.path === 'src/transform.js'
    )?.content;
    expect(generatedTransform).toContain('export async function transform');
    expect(generatedTransform).toContain('buildColumns');
    expect(generatedTransform).not.toContain('This project is a scaffold');

    const preview = await service.previewRawTableNormalizerVersion({
      versionId: draft.version.id,
      sourcePath: excelPath,
      sourceKind: 'excel',
      config,
      prepareDependencies: false,
      limit: 10,
    });

    expect(preview.preview.columns).toEqual([
      '时间 顺着填',
      '整体数据-总访客',
      '整体数据-总支付 人数',
      '整体数据-转化率',
      '手淘搜索-访客数',
      '手淘搜索-支付人数',
      '手淘搜索-转化率',
    ]);
    expect(preview.preview.totalRows).toBe(2);
    expect(preview.preview.rows[0]?.['时间 顺着填']).toBeTruthy();
    expect(preview.preview.rows[0]).toMatchObject({
      '整体数据-总访客': '1,473',
      '整体数据-总支付 人数': '223',
      '整体数据-转化率': '15.14%',
      '手淘搜索-访客数': '159',
      '手淘搜索-支付人数': '38',
      '手淘搜索-转化率': '23.90%',
    });
  });

  it('previews normalizer Csv output with quoted multiline headers', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'source.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');
    const draft = await service.generateRawTableNormalizerDraft({
      name: '多行表头输出 normalizer',
      sourcePath: csvPath,
      sourceKind: 'csv',
      rulePrompt: 'quoted multiline header output',
      primaryLanguage: 'node',
    });

    const preview = await service.previewRawTableNormalizerVersion({
      versionId: draft.version.id,
      sourcePath: csvPath,
      sourceKind: 'csv',
      prepareDependencies: false,
      limit: 5,
    });

    expect(preview.preview.totalRows).toBe(1);
    expect(preview.preview.columns).toEqual(['时间\n顺着填', '整体数据-总支付\n人数']);
    expect(preview.preview.rows[0]).toMatchObject({
      '时间\n顺着填': '5/1/26',
      '整体数据-总支付\n人数': '223',
    });
  });

  it('summarizes a multi-sheet Excel file with bounded header candidates', async () => {
    const { service, tempRoot } = createService();
    const excelPath = path.join(tempRoot, 'finance-report.xlsx');
    writeWorkbook(excelPath, {
      Summary: [
        ['Finance Report'],
        ['Generated by test'],
        ['Department', 'Month', 'Amount'],
        ['Sales', '2026-01', 100],
        ['Support', '2026-01', 50],
      ],
      Details: [
        ['Region', 'Employee', 'Month', 'Amount'],
        ['East', 'Alice', '2026-01', 10],
        ['West', 'Bob', '2026-01', 20],
      ],
    });

    const result = await service.summarizeRawTableSource({
      sourcePath: excelPath,
      sourceKind: 'excel',
      maxSheetsPerFile: 2,
      maxRowsPerSheet: 5,
      maxColumnsPerRow: 4,
    });

    expect(result.summary.sourceKind).toBe('excel');
    expect(result.summary.fileCount).toBe(1);
    expect(result.summary.files[0]?.sheets?.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'Details',
    ]);
    expect(result.summary.files[0]?.sheets?.[0]?.headerCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 3,
          values: ['Department', 'Month', 'Amount'],
        }),
      ])
    );
    expect(result.summary.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('summarizes a folder and generates a normalizer draft with the summary hash', async () => {
    const { service, tempRoot } = createService();
    const folderPath = path.join(tempRoot, 'monthly');
    fs.mkdirSync(folderPath);
    fs.writeFileSync(path.join(folderPath, 'jan.csv'), 'id,amount\n1,10\n', 'utf8');
    fs.writeFileSync(path.join(folderPath, 'feb.csv'), 'id,amount\n2,20\n', 'utf8');

    const summary = await service.summarizeRawTableSource({
      sourcePath: folderPath,
      sourceKind: 'folder',
      maxFiles: 1,
      maxRowsPerSheet: 2,
    });
    expect(summary.summary.sourceKind).toBe('folder');
    expect(summary.summary.fileCount).toBe(2);
    expect(summary.summary.sampledFileCount).toBe(1);
    expect(summary.summary.truncated).toBe(true);
    expect(summary.summary.files[0]?.sampleRows?.[0]).toEqual(['id', 'amount']);

    const draft = await service.generateRawTableNormalizerDraft({
      name: 'monthly normalizer',
      sourcePath: folderPath,
      sourceKind: 'folder',
      rulePrompt: 'Combine monthly Csv files into a standard table.',
      primaryLanguage: 'node',
    });
    expect(draft.summary.fileCount).toBe(2);
    expect(draft.version.sourceSummaryHash).toBe(draft.summary.hash);
    expect(draft.version.files.map((file) => file.path)).toContain('package-lock.json');
  });

  it('samples 20 source rows and Excel merge metadata before generating a normalizer draft', async () => {
    const { service, tempRoot } = createService();
    const excelPath = path.join(tempRoot, 'merged-report.xlsx');
    writeWorkbookWithMerges(
      excelPath,
      {
        Sheet1: [
          ['报表标题', null, null],
          ['分组', null, '金额'],
          ['姓名', '编号', '金额'],
          ...Array.from({ length: 24 }, (_, index) => [
            `客户${index + 1}`,
            `C-${String(index + 1).padStart(3, '0')}`,
            index + 1,
          ]),
        ],
      },
      {
        Sheet1: ['A1:C1', 'A2:B2'],
      }
    );

    const draft = await service.generateRawTableNormalizerDraft({
      name: '合并单元格 normalizer',
      sourcePath: excelPath,
      sourceKind: 'excel',
      rulePrompt: '分析合并单元格和前 20 行，再生成标准二维表处理代码',
      primaryLanguage: 'node',
    });

    const sheet = draft.summary.files[0]?.sheets?.[0];
    expect(sheet?.sampleRows).toHaveLength(20);
    expect(sheet?.sampleRows[0]).toEqual(['报表标题', '报表标题', '报表标题']);
    expect(sheet?.mergedCells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          range: 'A1:C1',
          startRow: 1,
          endRow: 1,
          startColumn: 1,
          endColumn: 3,
          value: '报表标题',
        }),
        expect.objectContaining({
          range: 'A2:B2',
          value: '分组',
        }),
      ])
    );
  });

  it('trims Chinese object suffixes when generating workflow DSL from a requirement', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain("where [Market] <> 'EU'");
    expect(generated.workflowDsl).not.toContain('EU的数据');
  });

  it('anchors generation at the selected node and merges into the existing workflow', async () => {
    const { service, store, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'anchored-market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'anchored market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const first = await service.generatePipelineFromRequirement({
      source: { location: 'local', tableId: input.rawTable.id },
      processRequirement: '过滤掉 Market 为 EU 的数据',
      output: { location: 'local', writeMode: 'create', tableName: 'anchored result' },
      runtimeConfig: testRuntimeConfig,
    });
    const saved = await store.getPipelineWorkflow(first.pipelineId);
    const filterNode = saved.nodes.find((node) => node.type === 'filter')!;
    const outputNode = saved.nodes.find((node) => node.type === 'output')!;

    // Second generation produces a two-step chain (aggregate → filter) — the
    // internal chain edge must survive the merge or the head operator dead-ends.
    queueModelReply({
      text: jflowReply('group [Market] (agg [总销售额] = sum([Sales]))', 'where [总销售额] > 100'),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });
    const second = await service.generatePipelineFromRequirement({
      source: { location: 'local', tableId: input.rawTable.id },
      processRequirement: '计算各 Market 总销售额并过滤大于 100 的',
      output: { location: 'local', writeMode: 'create', tableName: 'anchored second' },
      runtimeConfig: testRuntimeConfig,
      reusePipelineId: first.pipelineId,
      startFromNodeId: filterNode.id,
      workflow: {
        nodes: saved.nodes.map((node) => ({
          id: node.id,
          type: node.type,
          label: node.label,
          x: node.x,
          y: node.y,
          config: node.config,
        })),
        edges: saved.edges.map((edge) => ({
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        })),
      },
    });

    const merged = await store.getPipelineWorkflow(first.pipelineId);
    expect(second.pipelineId).toBe(first.pipelineId);
    // Existing nodes stay; the generated aggregate→filter chain splices in.
    expect(merged.nodes.map((node) => node.type)).toEqual([
      'input',
      'filter',
      'output',
      'aggregate',
      'filter',
    ]);
    const aggregateNode = merged.nodes.find((node) => node.type === 'aggregate')!;
    const newFilter = merged.nodes.find(
      (node) => node.type === 'filter' && node.id !== filterNode.id
    )!;
    const pairs = merged.edges.map((edge) => `${edge.sourceNodeId}->${edge.targetNodeId}`);
    expect(pairs).toContain(`${filterNode.id}->${aggregateNode.id}`);
    expect(pairs).toContain(`${aggregateNode.id}->${newFilter.id}`);
    expect(pairs).toContain(`${newFilter.id}->${outputNode.id}`);
    expect(pairs).not.toContain(`${filterNode.id}->${outputNode.id}`);
    // The merged tail feeds the existing output sink — no new output table.
    expect(second.resultTableId).toBe(first.resultTableId);
  });

  it('generates and validates a confirmed chain after a lone unsaved input node', async () => {
    const onActivity = vi.fn();
    const receipts = new RequirementAnalysisReceiptStore();
    const { service, store, tempRoot } = createService({ requirementAnalysisReceipts: receipts });
    const csvPath = path.join(tempRoot, 'open-tail.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'open tail input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const { pipeline } = await service.createPipeline({
      name: 'open tail pipeline',
      sourceRawTableId: input.rawTable.id,
    });
    const toolService = new DataToolService(service, receipts);
    const authoringRequest = {
      id: 'open-tail-request',
      source: { location: 'local' as const, tableId: input.rawTable.id },
      output: {
        location: 'local' as const,
        writeMode: 'create' as const,
        tableName: 'open tail result',
      },
      reusePipelineId: pipeline.id,
      startFromNodeId: 'input',
      workflow: {
        nodes: [
          {
            id: 'input',
            type: 'input' as const,
            label: 'Input',
            x: 0,
            y: 0,
            config: { source: 'rawTable', rawTableId: input.rawTable.id },
          },
        ],
        edges: [],
      },
    };
    queueModelReply({
      text: JSON.stringify({
        items: [
          {
            requirement: '过滤掉 Market 为 EU 的数据',
            status: 'supported',
            capabilities: ['filter.boolean_predicate'],
          },
        ],
      }),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });
    const analysis = await toolService.analyzePipelineRequirement(
      { rawTableId: input.rawTable.id, processRequirement: '过滤掉 Market 为 EU 的数据' },
      {
        sessionId: 'open-tail-chat',
        currentUserMessageId: 'request',
        authoringRequest,
        runtimeConfig: { ...testRuntimeConfig, enableThinking: true },
        onActivity,
      }
    );
    const result = await toolService.generatePipelineFromAnalysis(
      {
        analysisId: (analysis.details as { analysisId: string }).analysisId,
        confirmed: true,
        outputMode: 'create',
      },
      {
        sessionId: 'open-tail-chat',
        currentUserMessageId: 'confirmed',
        runtimeConfig: { ...testRuntimeConfig, enableThinking: true },
        onActivity,
      }
    );
    expect(result.details).toMatchObject({
      dataPipelineCompletion: {
        requestId: authoringRequest.id,
        result: { pipelineId: pipeline.id },
      },
      validation: { temporaryRun: 'passed' },
    });
    expect(vi.mocked(runPiAiOneShot).mock.calls.map((call) => call[3]?.onActivity)).toEqual([
      onActivity,
      onActivity,
    ]);
    expect(vi.mocked(runPiAiOneShot).mock.calls.map((call) => call[3]?.reasoning)).toEqual([
      'off',
      'low',
    ]);
    expect(vi.mocked(runPiAiOneShot).mock.calls[1][3]?.thinkingBudgets).toEqual({ low: 1024 });
    const saved = await store.getPipelineWorkflow(pipeline.id);
    expect(saved.nodes.map((node) => node.type)).toEqual(['input', 'filter', 'output']);
    expect(saved.edges).toHaveLength(2);
    const outputNode = saved.nodes.find((node) => node.type === 'output')!;
    expect(saved.edges.filter((edge) => edge.targetNodeId === outputNode.id)).toHaveLength(1);
  });

  it('rejects anchored generation when the start node is missing', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'anchor-missing.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\n', 'utf8');
    const input = await service.createRawTable({
      name: 'anchor missing input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const first = await service.generatePipelineFromRequirement({
      source: { location: 'local', tableId: input.rawTable.id },
      processRequirement: '过滤',
      output: { location: 'local', writeMode: 'create', tableName: 'anchor missing out' },
      runtimeConfig: testRuntimeConfig,
    });
    await expect(
      service.generatePipelineFromRequirement({
        source: { location: 'local', tableId: input.rawTable.id },
        processRequirement: '再过滤',
        output: { location: 'local', writeMode: 'create' },
        runtimeConfig: testRuntimeConfig,
        reusePipelineId: first.pipelineId,
        startFromNodeId: 'no_such_node',
      })
    ).rejects.toThrow(/Cannot find workflow node/);
  });

  it('derives required columns from generated DSL when the model omits them', async () => {
    queueModelReply({
      text: jflowReply("where [Market] <> 'EU'"),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.requiredColumns).toEqual([{ name: 'Market', type: 'text' }]);
  });

  it('allows sorting by aggregate metric aliases', async () => {
    queueModelReply({
      text: jflowReply(
        'group [Market], [Product Type] (agg [Sales 总和] = sum([Sales]), [Profit 总和] = sum([Profit]), [Marketing 总和] = sum([Marketing]), [记录数] = count(*))',
        'sort -[Sales 总和]'
      ),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'coffee.csv');
    fs.writeFileSync(
      csvPath,
      'Market,Product Type,Sales,Profit,Marketing\nCentral,Coffee,100,30,10\nEast,Tea,80,20,8\n',
      'utf8'
    );
    const input = await service.createRawTable({
      name: 'coffee input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement:
        '按 Market 和 Product Type 分组，统计 Sales 总和、Profit 总和、Marketing 总和、记录数，并按 Sales 总和降序排列。',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'coffee processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.requiredColumns).toEqual([
      { name: 'Market', type: 'text' },
      { name: 'Product Type', type: 'text' },
      { name: 'Sales', type: 'integer' },
      { name: 'Profit', type: 'integer' },
      { name: 'Marketing', type: 'integer' },
    ]);
  });

  it('preserves sort-then-drop ordering without expanding deletion into select', async () => {
    queueModelReply({
      text: jflowReply('sort [Sales]', 'drop [记录数]'),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'orders.csv');
    fs.writeFileSync(
      csvPath,
      [
        'City,Customer ID,Customer Name,Customer Segment,Order Date,Order ID,Order Priority,Postal Code,Product Category,Product Container,Product Name,Product Sub-Category,Region,Row ID,Ship Date,Ship Mode,State or Province,Discount,Product Base Margin,Profit,Quantity ordered new,Sales,Shipping Cost,Unit Price,记录数',
        'Shanghai,C-1,Alice,Consumer,2024-01-01,O-1,High,200000,Furniture,Box,Chair,Office,East,1,2024-01-02,Air,Shanghai,0.1,0.2,12,2,100,5,50,1',
      ].join('\n'),
      'utf8'
    );
    const input = await service.createRawTable({
      name: 'orders input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement: '按照sales升序排列\n删除记录数',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'orders processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.requiredColumns).toEqual([
      { name: 'Sales', type: 'integer' },
      { name: '记录数', type: 'integer' },
    ]);
  });

  it('allows generated chains to reference columns renamed by earlier operations', async () => {
    queueModelReply({
      text: jflowReply(
        'drop [记录数]',
        'rename [Adj Close] as [adj_close]',
        "derive replace [adj_close] = replace([adj_close], '$', '')",
        'cast [adj_close] as decimal(18,2) on_error: null'
      ),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'prices.csv');
    fs.writeFileSync(
      csvPath,
      [
        'Company Name,Date,Ticker,Adj Close,Close value in reference period,记录数',
        'Sourcefire,2012-12-31,FIRE,$8.34,NULL,1',
        'Symantec,2012-12-31,SYMC,$16.14,NULL,1',
      ].join('\n'),
      'utf8'
    );
    const input = await service.createRawTable({
      name: 'prices input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement:
        '把这张 Csv 清洗成标准价格明细表：删除“记录数”，统一字段名，Adj Close 去掉 $ 转数值，NULL 置空，Ticker 转大写，并从 Date 提取年份和月份。',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'prices processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.requiredColumns).toEqual([
      { name: 'Adj Close', type: 'text' },
      { name: '记录数', type: 'integer' },
    ]);
    expect(generated.expectedOutputSchema).toEqual([
      { name: 'Company Name', type: 'text' },
      { name: 'Date', type: 'date' },
      { name: 'Ticker', type: 'text' },
      // rename/cast keep the column in place
      { name: 'adj_close', type: 'decimal' },
      { name: 'Close value in reference period', type: 'text' },
    ]);
  });

  it('propagates converted column types through derived generated fields', async () => {
    queueModelReply({
      text: jflowReply(
        'rename [Adj Close] as [adj_close]',
        "derive replace [adj_close] = replace([adj_close], '$', '')",
        'cast [adj_close] as decimal(18,2) on_error: null',
        'derive [double_close] = [adj_close] * 2',
        'sort -[double_close]'
      ),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'prices.csv');
    fs.writeFileSync(csvPath, 'Adj Close\n$8.34\n$16.14\n', 'utf8');
    const input = await service.createRawTable({
      name: 'prices input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement: 'Adj Close 去掉美元符号转数值，新增 double_close 为两倍并降序排序',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'prices processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.requiredColumns).toEqual([{ name: 'Adj Close', type: 'text' }]);
    expect(generated.expectedOutputSchema).toEqual([
      { name: 'adj_close', type: 'decimal' },
      { name: 'double_close', type: 'decimal' },
    ]);
    expect(generated.lineage).toEqual([
      {
        name: 'adj_close',
        type: 'decimal',
        sourceColumns: [{ name: 'Adj Close', type: 'text' }],
        expression: "cast(replace([adj_close], '$', '') as decimal(18,2))",
      },
      {
        name: 'double_close',
        type: 'decimal',
        sourceColumns: [{ name: 'Adj Close', type: 'text' }],
        expression: '[adj_close] * 2',
      },
    ]);
  });

  it('infers integer output types for generated year and month fields', async () => {
    queueModelReply({
      text: jflowReply('derive [Year] = year([Date])', 'derive [Month] = month([Date])'),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'prices.csv');
    fs.writeFileSync(csvPath, 'Date\n2012-12-31\n2013-01-31\n', 'utf8');
    const input = await service.createRawTable({
      name: 'prices input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement: '从 Date 提取年份和月份',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'prices processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.expectedOutputSchema).toEqual([
      { name: 'Date', type: 'date' },
      { name: 'Year', type: 'integer' },
      { name: 'Month', type: 'integer' },
    ]);
    expect(runPiAiOneShot).toHaveBeenCalledTimes(1);
  });

  it('replaces existing columns when generated derive targets the same field name', async () => {
    queueModelReply({
      text: jflowReply('rename [Ticker] as [ticker]', 'derive replace [ticker] = upper([ticker])'),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'prices.csv');
    fs.writeFileSync(csvPath, 'Ticker\nfire\nsymc\n', 'utf8');
    const input = await service.createRawTable({
      name: 'prices input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement: '统一字段名，Ticker 转大写',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'prices processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.expectedOutputSchema).toEqual([{ name: 'ticker', type: 'text' }]);
  });

  it('fails data pipeline generation when the model call fails', async () => {
    vi.mocked(runPiAiOneShot).mockRejectedValueOnce(new Error('model unavailable'));
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    await expect(
      service.generatePipelineFromRequirement({
        source: {
          location: 'local',
          tableId: input.rawTable.id,
          tableName: input.rawTable.name,
        },
        processRequirement: '过滤掉Market为EU的数据',
        output: {
          location: 'local',
          writeMode: 'create',
          tableName: 'market processed',
        },
        runtimeConfig: testRuntimeConfig,
      })
    ).rejects.toMatchObject({ code: 'GENERATION_FAILED' });

    const pipelines = await service.listPipelines({ query: 'market input_自动处理' });
    const outputs = await service.listResultTables({ query: 'market processed' });
    expect(pipelines.pipelines).toHaveLength(0);
    expect(outputs.resultTables).toHaveLength(0);
  });

  it('does not delete a reused output table when generation fails', async () => {
    vi.mocked(runPiAiOneShot).mockRejectedValueOnce(new Error('model unavailable'));
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\n', 'utf8');
    const input = await service.createRawTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const existingOutput = await service.createResultTable({ name: 'market processed' });

    await expect(
      service.generatePipelineFromRequirement({
        source: { location: 'local', tableId: input.rawTable.id },
        processRequirement: '复制数据',
        output: {
          location: 'local',
          writeMode: 'create',
          tableName: existingOutput.resultTable.name,
          localResultTableId: existingOutput.resultTable.id,
        },
        runtimeConfig: testRuntimeConfig,
      })
    ).rejects.toMatchObject({ code: 'GENERATION_FAILED' });

    const outputs = await service.listResultTables({ query: 'market processed' });
    expect(outputs.resultTables.map((table) => table.id)).toContain(existingOutput.resultTable.id);
    expect(
      (await service.listPipelines({ query: 'market input_自动处理' })).pipelines
    ).toHaveLength(0);
  });

  it('reuses generated pipeline and output table when regenerating', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const first = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed',
      },
      runtimeConfig: testRuntimeConfig,
    });
    const second = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed',
        localResultTableId: first.resultTableId,
      },
      reusePipelineId: first.pipelineId,
      currentVersion: first.version,
      runtimeConfig: testRuntimeConfig,
    });
    const pipelines = await service.listPipelines({ query: 'market input_自动处理' });
    const outputs = await service.listResultTables({ query: 'market processed' });

    expect(second.pipelineId).toBe(first.pipelineId);
    expect(second.resultTableId).toBe(first.resultTableId);
    expect(second.version).toBe(2);
    expect(
      pipelines.pipelines.filter((pipeline) => pipeline.name.startsWith('market input_自动处理'))
    ).toHaveLength(1);
    expect(outputs.resultTables.filter((table) => table.name === 'market processed')).toHaveLength(
      1
    );
  });

  it('creates a new output table when a reused generated output table is missing', async () => {
    const { service, store, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const first = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed',
      },
      runtimeConfig: testRuntimeConfig,
    });
    await store.deleteRawTable(first.resultTableId);

    const regenerated = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed',
        localResultTableId: first.resultTableId,
      },
      reusePipelineId: first.pipelineId,
      currentVersion: first.version,
      runtimeConfig: testRuntimeConfig,
    });

    expect(regenerated.pipelineId).toBe(first.pipelineId);
    expect(regenerated.resultTableId).not.toBe(first.resultTableId);
    expect(regenerated.version).toBe(2);
  });

  it('creates a new output table when regenerating with a changed output name', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const first = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed 1',
      },
      runtimeConfig: testRuntimeConfig,
    });

    const regenerated = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed 2',
        localResultTableId: first.resultTableId,
      },
      reusePipelineId: first.pipelineId,
      currentVersion: first.version,
      runtimeConfig: testRuntimeConfig,
    });

    expect(regenerated.pipelineId).toBe(first.pipelineId);
    expect(regenerated.resultTableId).not.toBe(first.resultTableId);
    expect(regenerated.resultTableName).toBe('market processed 2');
    expect(regenerated.workflowDsl).toContain(
      `write @id('local:result/${regenerated.resultTableId}')`
    );
    expect(regenerated.version).toBe(2);
  });

  it('reuses an existing output table with the requested generated output name', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const existingOutput = await service.createResultTable({ name: 'market processed' });

    const generated = await service.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed',
      },
      runtimeConfig: testRuntimeConfig,
    });
    const outputs = await service.listResultTables({ query: 'market processed' });

    expect(generated.resultTableId).toBe(existingOutput.resultTable.id);
    expect(outputs.resultTables.filter((table) => table.name === 'market processed')).toHaveLength(
      1
    );
  });

  it('refreshes a stable local mirror for cloud generated pipelines', async () => {
    const { service } = createService({
      personalAnalysis: {
        apiOrigin: 'http://cloud.mock',
        apiKey: 'cloud-key',
        updatedAt: 1,
      },
    });
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/api/personal/api-keys/token')) {
        return jsonResponse({ success: true, data: { accessToken: 'cloud-token' } });
      }
      if (href.endsWith('/api/personal/analysis/v1/tables/tbl-12345678/exports')) {
        expect(init?.method).toBe('POST');
        return jsonResponse({ success: true, data: { pipelineId: 'export-1', status: 'RUNNING' } });
      }
      if (href.endsWith('/api/personal/analysis/v1/exports/export-1/download')) {
        return jsonResponse({
          success: true,
          data: { status: 'DONE', downloadUrl: 'http://download.mock/tbl-12345678.csv' },
        });
      }
      if (href === 'http://download.mock/tbl-12345678.csv') {
        return new Response('Market,Sales\nEU,10\nUS,20\n', {
          status: 200,
          headers: { 'Content-Type': 'text/csv' },
        });
      }
      throw new Error(`Unexpected request: ${href} ${init?.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const generated = await service.generatePipelineFromRequirement({
      source: {
        location: 'cloud',
        tableId: 'tbl-12345678',
        tableName: 'Cloud Orders',
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'cloud orders processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    await service.runGeneratedPipeline({
      pipelineId: generated.pipelineId,
      workflowDsl: generated.workflowDsl,
      source: {
        location: 'cloud',
        tableId: 'tbl-12345678',
        tableName: 'Cloud Orders',
      },
      output: {
        location: 'local',
        writeMode: 'create',
        localResultTableId: generated.resultTableId,
      },
      requiredColumns: generated.requiredColumns,
    });
    await service.runGeneratedPipeline({
      pipelineId: generated.pipelineId,
      workflowDsl: generated.workflowDsl,
      source: {
        location: 'cloud',
        tableId: 'tbl-12345678',
        tableName: 'Cloud Orders',
      },
      output: {
        location: 'local',
        writeMode: 'create',
        localResultTableId: generated.resultTableId,
      },
      requiredColumns: generated.requiredColumns,
    });
    const mirrors = await service.listRawTables({ query: 'Cloud Orders_自动化镜像' });

    expect(mirrors.rawTables).toHaveLength(1);
    expect(mirrors.rawTables[0]?.name).toBe('Cloud Orders_自动化镜像_tbl-1234');
  });

  it('reuses an existing cloud mirror when generating from the same cloud table again', async () => {
    const { service } = createService({
      personalAnalysis: {
        apiOrigin: 'http://cloud.mock',
        apiKey: 'cloud-key',
        updatedAt: 1,
      },
    });
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/api/personal/api-keys/token')) {
        return jsonResponse({ success: true, data: { accessToken: 'cloud-token' } });
      }
      if (href.endsWith('/api/personal/analysis/v1/tables/tbl-a0440000/exports')) {
        expect(init?.method).toBe('POST');
        return jsonResponse({ success: true, data: { pipelineId: 'export-1', status: 'RUNNING' } });
      }
      if (href.endsWith('/api/personal/analysis/v1/exports/export-1/download')) {
        return jsonResponse({
          success: true,
          data: { status: 'DONE', downloadUrl: 'http://download.mock/tbl-a0440000.csv' },
        });
      }
      if (href === 'http://download.mock/tbl-a0440000.csv') {
        return new Response('Market,Sales\nEU,10\nUS,20\n', {
          status: 200,
          headers: { 'Content-Type': 'text/csv' },
        });
      }
      throw new Error(`Unexpected request: ${href} ${init?.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await service.generatePipelineFromRequirement({
      source: {
        location: 'cloud',
        tableId: 'tbl-a0440000',
        tableName: '10题',
        updatedAt: '2026-07-16T10:00:00Z',
      },
      processRequirement: '过滤掉Market是EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'cloud orders processed',
      },
      runtimeConfig: testRuntimeConfig,
    });
    const second = await service.generatePipelineFromRequirement({
      source: {
        location: 'cloud',
        tableId: 'tbl-a0440000',
        tableName: '10题',
        updatedAt: '2026-07-16T10:00:00Z',
      },
      processRequirement: '过滤掉Market是EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'cloud orders processed',
        localResultTableId: first.resultTableId,
      },
      reusePipelineId: first.pipelineId,
      currentVersion: first.version,
      runtimeConfig: testRuntimeConfig,
    });
    const mirrors = await service.listRawTables({ query: '10题_自动化镜像_tbl-a044' });

    expect(second.version).toBe(2);
    expect(mirrors.rawTables).toHaveLength(1);
    expect(mirrors.rawTables[0]?.name).toBe('10题_自动化镜像_tbl-a044');
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/api/personal/analysis/v1/tables/tbl-a0440000/exports')
      )
    ).toHaveLength(1);
  });

  it('rejects generated DSL that references columns not in the source schema', async () => {
    const badResponse = {
      text: jflowReply('where [NotAColumn] = 1'),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    };
    defaultModelReply = badResponse;
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    await expect(
      service.generatePipelineFromRequirement({
        source: {
          location: 'local',
          tableId: input.rawTable.id,
          tableName: input.rawTable.name,
        },
        processRequirement: '复制数据',
        output: {
          location: 'local',
          writeMode: 'create',
          tableName: 'market processed',
        },
        runtimeConfig: testRuntimeConfig,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(runPiAiOneShot).toHaveBeenCalledTimes(1 + JFLOW_GENERATION_REPAIR_ATTEMPTS);
  });

  it('feeds compile diagnostics back to the model and runs the repaired jflow program', async () => {
    queueModelReply({
      text: jflowReply('where [NotAColumn] = 1'),
      hasThinking: false,
      durationMs: 1,
      ...ONE_SHOT_RESULT_DEFAULTS,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generatePipelineFromRequirement({
      source: { location: 'local', tableId: input.rawTable.id, tableName: input.rawTable.name },
      processRequirement: '过滤掉Market为EU的数据',
      output: { location: 'local', writeMode: 'create', tableName: 'market processed' },
      runtimeConfig: testRuntimeConfig,
    });

    expect(runPiAiOneShot).toHaveBeenCalledTimes(2);
    const repairPrompt = String(vi.mocked(runPiAiOneShot).mock.calls[1]?.[0]);
    expect(repairPrompt).toContain('Your previous program failed');
    expect(repairPrompt).toContain('NotAColumn');
    expect(generated.workflowDsl).toContain("where [Market] <> 'EU'");
    expect(generated.expectedOutputSchema.map((column) => column.name)).toEqual([
      'Market',
      'Sales',
    ]);
    const run = await service.runPipeline({ pipelineId: generated.pipelineId });
    expect(run.pipeline.status).toBe('completed');
    expect(run.preview?.totalRows).toBe(1);
  });

  it('stops generated pipeline runs when required columns drift', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Region,Sales\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'region input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const output = await service.createResultTable({ name: 'region output' });
    const pipeline = await service.createPipeline({
      name: 'region pipeline',
      sourceRawTableId: input.rawTable.id,
      resultTableId: output.resultTable.id,
    });

    await expect(
      service.runGeneratedPipeline({
        pipelineId: pipeline.pipeline.id,
        workflowDsl: `source src = @id('local:raw/${input.rawTable.id}')\nsrc\n  | write @id('local:result/${output.resultTable.id}') mode: replace`,
        source: {
          location: 'local',
          tableId: input.rawTable.id,
          tableName: input.rawTable.name,
        },
        output: {
          location: 'local',
          writeMode: 'replace',
          targetTableId: output.resultTable.id,
        },
        requiredColumns: [{ name: 'Market' }],
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('runs the latest saved pipeline workflow when an automation omits a workflow override', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'latest-workflow.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'latest workflow input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const output = await service.createResultTable({ name: 'latest workflow output' });
    const pipeline = await service.createPipeline({
      name: 'latest workflow pipeline',
      sourceRawTableId: input.rawTable.id,
      resultTableId: output.resultTable.id,
    });

    await service.applyWorkflowDsl({
      pipelineId: pipeline.pipeline.id,
      rawTableId: input.rawTable.id,
      resultTableId: output.resultTable.id,
      dsl: [
        `source src = @id('local:raw/${input.rawTable.id}')`,
        'src',
        '  | select [Market]',
        `  | write @id('local:result/${output.resultTable.id}') mode: replace`,
      ].join('\n'),
    });

    const result = await service.runGeneratedPipeline({
      pipelineId: pipeline.pipeline.id,
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      output: {
        location: 'local',
        writeMode: 'replace',
        targetTableId: output.resultTable.id,
      },
    });

    expect(result.preview?.columns).toEqual(['Market']);
    expect(result.preview?.rows).toEqual([{ Market: 'EU' }, { Market: 'US' }]);
  });

  it('stops generated pipeline runs when output schema drifts', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const output = await service.createResultTable({ name: 'market output' });
    const pipeline = await service.createPipeline({
      name: 'market schema pipeline',
      sourceRawTableId: input.rawTable.id,
      resultTableId: output.resultTable.id,
    });

    await service.runGeneratedPipeline({
      pipelineId: pipeline.pipeline.id,
      workflowDsl: `source src = @id('local:raw/${input.rawTable.id}')\nsrc\n  | write @id('local:result/${output.resultTable.id}') mode: replace`,
      source: { location: 'local', tableId: input.rawTable.id },
      output: {
        location: 'local',
        writeMode: 'replace',
        targetTableId: output.resultTable.id,
      },
      expectedOutputSchema: [
        { name: 'Market', type: 'text' },
        { name: 'Sales', type: 'integer' },
      ],
    });

    await expect(
      service.runGeneratedPipeline({
        pipelineId: pipeline.pipeline.id,
        workflowDsl: `source src = @id('local:raw/${input.rawTable.id}')\nsrc\n  | select [Market]\n  | write @id('local:result/${output.resultTable.id}') mode: replace`,
        source: {
          location: 'local',
          tableId: input.rawTable.id,
          tableName: input.rawTable.name,
        },
        output: {
          location: 'local',
          writeMode: 'replace',
          targetTableId: output.resultTable.id,
        },
        requiredColumns: [{ name: 'Market', type: 'text' }],
        expectedOutputSchema: [{ name: 'Region', type: 'text' }],
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('output column mismatch'),
    });

    const preview = await service.previewTable({
      tableKind: 'result',
      id: output.resultTable.id,
    });
    expect(preview.preview.columns).toEqual(['Market', 'Sales']);
    expect(preview.preview.totalRows).toBe(2);
  });

  it('validates generated output schema against runtime output instead of source table', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales,记录数\nEU,10,1\nUS,20,1\n', 'utf8');
    const input = await service.createRawTable({
      name: 'market source schema input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const output = await service.createResultTable({ name: 'market source schema output' });
    const pipeline = await service.createPipeline({
      name: 'market source schema pipeline',
      sourceRawTableId: input.rawTable.id,
      resultTableId: output.resultTable.id,
    });

    const result = await service.runGeneratedPipeline({
      pipelineId: pipeline.pipeline.id,
      workflowDsl: [
        `source src = @id('local:raw/${input.rawTable.id}')`,
        'src',
        '  | drop [记录数]',
        `  | write @id('local:result/${output.resultTable.id}') mode: replace`,
      ].join('\n'),
      source: {
        location: 'local',
        tableId: input.rawTable.id,
        tableName: input.rawTable.name,
      },
      output: {
        location: 'local',
        writeMode: 'replace',
        targetTableId: output.resultTable.id,
      },
      requiredColumns: [
        { name: 'Market', type: 'text' },
        { name: 'Sales', type: 'integer' },
        { name: '记录数', type: 'integer' },
      ],
      expectedOutputSchema: [
        { name: 'Market', type: 'text' },
        { name: 'Sales', type: 'integer' },
      ],
    });

    expect(result.preview?.columns).toEqual(['Market', 'Sales']);
    expect(result.workflowHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.stageDurationsMs).toEqual({
      prepare: expect.any(Number),
      compile: expect.any(Number),
      executeAndValidate: expect.any(Number),
      upload: 0,
      total: expect.any(Number),
    });
  });

  it('does not publish pipeline completion before cloud delivery succeeds', async () => {
    const onPipelineCompleted = vi.fn();
    const { service, tempRoot } = createService({ onPipelineCompleted });
    const csvPath = path.join(tempRoot, 'cloud-delivery.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createRawTable({
      name: 'cloud delivery input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const output = await service.createResultTable({ name: 'cloud delivery output' });
    const pipeline = await service.createPipeline({
      name: 'cloud delivery pipeline',
      sourceRawTableId: input.rawTable.id,
      resultTableId: output.resultTable.id,
    });
    await service.applyWorkflowDsl({
      pipelineId: pipeline.pipeline.id,
      rawTableId: input.rawTable.id,
      resultTableId: output.resultTable.id,
      dsl: [
        `source src = @id('local:raw/${input.rawTable.id}')`,
        'src',
        `  | write @id('local:result/${output.resultTable.id}') mode: replace`,
      ].join('\n'),
    });
    vi.spyOn(service, 'uploadDataTableToCloud').mockRejectedValue(
      new Error('simulated cloud delivery failure')
    );

    await expect(
      service.runGeneratedPipeline({
        pipelineId: pipeline.pipeline.id,
        source: { location: 'local', tableId: input.rawTable.id },
        output: {
          location: 'cloud',
          writeMode: 'create',
          tableName: 'cloud delivery result',
          folderId: 'folder-1',
          localResultTableId: output.resultTable.id,
        },
        mode: 'persisted',
      })
    ).rejects.toThrow('simulated cloud delivery failure');

    expect(onPipelineCompleted).not.toHaveBeenCalled();
  });
});

describe('constrained workflow plans and resource bindings', () => {
  async function seedTables(service: DataCommandService, tempRoot: string) {
    const ordersPath = path.join(tempRoot, 'orders.csv');
    fs.writeFileSync(ordersPath, 'id,amount,customer_id\n1,10,c1\n2,-5,c2\n', 'utf8');
    const orders = await service.createRawTable({
      name: 'orders',
      sourceKind: 'csv',
      filePath: ordersPath,
    });
    const customersPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(customersPath, 'customer_id,name\nc1,Ann\nc2,Bob\n', 'utf8');
    const customers = await service.createRawTable({
      name: 'customers',
      sourceKind: 'csv',
      filePath: customersPath,
    });
    const output = await service.createResultTable({ name: 'joined_output' });
    return {
      orders: orders.rawTable,
      customers: customers.rawTable,
      output: output.resultTable,
    };
  }

  it('applies a constrained plan with alias-bound input resources and exports canonical DSL', async () => {
    const { service, tempRoot } = createService();
    const { orders, customers, output } = await seedTables(service, tempRoot);
    const pipeline = await service.createPipeline({ name: 'plan pipeline' });

    const plan = {
      version: 'workflow-plan/v1',
      nodes: [
        { id: 'orders', type: 'input', config: { source: 'rawTable', alias: 'orders' } },
        {
          id: 'customers',
          type: 'input',
          config: { source: 'rawTable', alias: 'customers' },
        },
        {
          id: 'joined',
          type: 'join',
          config: {
            joinType: 'left',
            conditions: [
              {
                left: '[orders].[customer_id]',
                operator: '=',
                right: '[customers].[customer_id]',
              },
            ],
          },
        },
        { id: 'sink', type: 'output', config: { table: 'joined_output', mode: 'replace' } },
      ],
      edges: [
        { sourceNodeId: 'orders', targetNodeId: 'joined', targetHandle: 'left' },
        { sourceNodeId: 'customers', targetNodeId: 'joined', targetHandle: 'right' },
        { sourceNodeId: 'joined', targetNodeId: 'sink' },
      ],
    };
    const dry = await service.applyWorkflowPlan({
      pipelineId: pipeline.pipeline.id,
      plan,
      inputResources: { orders: orders.id, customers: customers.id },
      resultTableId: output.id,
      dryRun: true,
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.dsl).toContain(`source orders = @id('local:raw/${orders.id}'`);
    expect(dry.dsl).toContain(`source customers = @id('local:raw/${customers.id}'`);
    expect(dry.diagnostics?.filter((d) => d.severity === 'error')).toHaveLength(0);

    const saved = await service.applyWorkflowPlan({
      pipelineId: pipeline.pipeline.id,
      plan,
      inputResources: { orders: orders.id, customers: customers.id },
      resultTableId: output.id,
    });
    const inputNodes = saved.workflow.nodes.filter((node) => node.type === 'input');
    expect(inputNodes.map((node) => node.config.rawTableId).sort()).toEqual(
      [orders.id, customers.id].sort()
    );
    const run = await service.runPipeline({ pipelineId: pipeline.pipeline.id, mode: 'temporary' });
    expect(run.pipeline.status).toBe('completed');
  });

  it('removes incremental settings when binding an input table', async () => {
    const { service, tempRoot } = createService();
    const { orders, output } = await seedTables(service, tempRoot);
    const pipeline = await service.createPipeline({ name: 'Full input table' });
    const result = await service.applyWorkflowPlan({
      pipelineId: pipeline.pipeline.id,
      plan: {
        version: 'workflow-plan/v1',
        nodes: [
          {
            id: 'orders',
            type: 'input',
            config: { source: 'rawTable', alias: 'orders', incrementalBy: 'old_column' },
          },
          { id: 'sink', type: 'output', config: { mode: 'replace' } },
        ],
        edges: [{ sourceNodeId: 'orders', targetNodeId: 'sink' }],
      },
      inputResources: { orders: orders.id },
      resultTableId: output.id,
    });
    const inputNode = result.workflow.nodes.find((node) => node.type === 'input');
    expect(inputNode?.config).not.toHaveProperty('incrementalBy');
    expect(result.dsl).not.toContain('incremental by');
  });

  it('rejects plan version mismatch, unknown node types, and unbound rawTable sources', async () => {
    const { service, tempRoot } = createService();
    const { orders } = await seedTables(service, tempRoot);
    const pipeline = await service.createPipeline({ name: 'bad plan pipeline' });

    await expect(
      service.applyWorkflowPlan({
        pipelineId: pipeline.pipeline.id,
        plan: { version: 'workflow-plan/v0', nodes: [], edges: [] },
      })
    ).rejects.toThrow(/version/i);

    await expect(
      service.applyWorkflowPlan({
        pipelineId: pipeline.pipeline.id,
        plan: {
          version: 'workflow-plan/v1',
          nodes: [{ id: 'x', type: 'teleport', config: {} }],
          edges: [],
        },
      })
    ).rejects.toThrow(/unsupported/i);

    await expect(
      service.applyWorkflowPlan({
        pipelineId: pipeline.pipeline.id,
        plan: {
          version: 'workflow-plan/v1',
          nodes: [
            { id: 'orders', type: 'input', config: { source: 'rawTable', alias: 'orders' } },
            { id: 'sink', type: 'output', config: { table: 't' } },
          ],
          edges: [{ sourceNodeId: 'orders', targetNodeId: 'sink' }],
        },
      })
    ).rejects.toThrow(/bind|rawTable/i);
    void orders;
  });

  it('rejects input resource aliases that do not exist in the plan', async () => {
    const { service, tempRoot } = createService();
    const { orders } = await seedTables(service, tempRoot);
    const pipeline = await service.createPipeline({ name: 'alias pipeline' });
    await expect(
      service.applyWorkflowPlan({
        pipelineId: pipeline.pipeline.id,
        plan: {
          version: 'workflow-plan/v1',
          nodes: [
            { id: 'orders', type: 'input', config: { source: 'rawTable', alias: 'orders' } },
            { id: 'sink', type: 'output', config: { table: 't' } },
          ],
          edges: [{ sourceNodeId: 'orders', targetNodeId: 'sink' }],
        },
        inputResources: { orders: orders.id, ghost: orders.id },
      })
    ).rejects.toThrow(/ghost|alias/i);
  });

  it('reports planFieldNotFound for field references missing from bound schemas', async () => {
    const { service, tempRoot } = createService();
    const { orders } = await seedTables(service, tempRoot);
    const pipeline = await service.createPipeline({ name: 'schema pipeline' });
    const dry = await service.applyWorkflowPlan({
      pipelineId: pipeline.pipeline.id,
      plan: {
        version: 'workflow-plan/v1',
        nodes: [
          { id: 'orders', type: 'input', config: { source: 'rawTable', alias: 'orders' } },
          { id: 'f', type: 'filter', config: { condition: '[bogus_col] > 0' } },
          { id: 'sink', type: 'output', config: { table: 't' } },
        ],
        edges: [
          { sourceNodeId: 'orders', targetNodeId: 'f' },
          { sourceNodeId: 'f', targetNodeId: 'sink' },
        ],
      },
      inputResources: { orders: orders.id },
      dryRun: true,
    });
    expect(
      dry.diagnostics?.some((d) => d.severity === 'error' && d.code === 'planFieldNotFound')
    ).toBe(true);
  });

  it('binds multi-source DSL workflows via inputResources', async () => {
    const { service, tempRoot } = createService();
    const { orders, customers } = await seedTables(service, tempRoot);
    const pipeline = await service.createPipeline({ name: 'multi dsl pipeline' });
    const dsl = [
      `source orders = @id('local:raw/${orders.id}')`,
      `source customers = @id('local:raw/${customers.id}')`,
      '',
      'orders',
      '  | join left customers on [left].[customer_id] = [customers].[customer_id]',
      "  | write @new('joined') mode: replace",
    ].join('\n');
    const result = await service.applyWorkflowDsl({
      pipelineId: pipeline.pipeline.id,
      dsl,
      inputResources: { orders: orders.id, customers: customers.id },
    });
    const inputNodes = result.workflow.nodes.filter((node) => node.type === 'input');
    expect(inputNodes.map((node) => node.config.rawTableId).sort()).toEqual(
      [orders.id, customers.id].sort()
    );
  });

  it('returns a versioned capability manifest with operator schemas and table snapshots', async () => {
    const { service, tempRoot } = createService();
    const { orders, output } = await seedTables(service, tempRoot);
    const manifest = await service.getWorkflowCapabilityManifest({
      rawTableIds: [orders.id],
      resultTableIds: [output.id],
    });
    expect(manifest.manifestVersion).toBe('workflow-capability-manifest/v1');
    expect(manifest.planVersion).toBe('workflow-plan/v1');
    expect(manifest.plan.schema.properties.version.const).toBe('workflow-plan/v1');
    expect(manifest.plan.operatorConfigSchemas.expect).toBeTruthy();
    expect(manifest.plan.operatorConfigSchemas.join).toBeTruthy();
    const input = manifest.bindings?.inputs[0];
    expect(input?.id).toBe(orders.id);
    expect(input?.columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'amount', 'customer_id'])
    );
    expect(manifest.bindings?.outputs[0]?.id).toBe(output.id);
  });
});

function createService(
  options: {
    personalAnalysis?: {
      apiOrigin: string;
      apiKey: string;
      updatedAt?: number;
    };
    getPersonalAnalysisConfig?: () => {
      apiOrigin: string;
      apiKey: string;
      updatedAt: number;
    };
    getPersonalAnalysisConnection?: () => PersonalAnalysisConnectionInput | null;
    onPipelineCompleted?: (pipeline: DataPipeline) => void;
    requirementAnalysisReceipts?: RequirementAnalysisReceiptStore;
  } = {}
): { service: DataCommandService; store: DataPipelineStore; tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-data-command-'));
  tempRoots.push(tempRoot);
  const store = createDataPipelineStore(path.join(tempRoot, 'workspace.duckdb'), {
    now: () => 1_780_000_000_000,
  });
  stores.push(store);
  return {
    service: new DataCommandService(
      store,
      createFakeNormalizerGenerator(),
      options.getPersonalAnalysisConfig ||
        (() => ({
          ...(options.personalAnalysis || {
            apiOrigin: '',
            apiKey: '',
          }),
          updatedAt: options.personalAnalysis?.updatedAt ?? 0,
        })),
      {
        getPersonalAnalysisConnection: options.getPersonalAnalysisConnection,
        onPipelineCompleted: options.onPipelineCompleted,
        requirementAnalysisReceipts: options.requirementAnalysisReceipts,
      }
    ),
    store,
    tempRoot,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createFakeNormalizerGenerator(): RawTableNormalizerProjectGenerator {
  return {
    async generate(input) {
      const template = createRawTableNormalizerProjectTemplate(
        input.primaryLanguage,
        input.rulePrompt
      );
      input.onProgress?.({
        phase: 'code_generation',
        kind: 'delta',
        text: 'fake generated project delta',
      });
      return {
        ...template,
        files: template.files.map((file) =>
          file.path === 'src/transform.js'
            ? {
                ...file,
                content: input.rulePrompt.includes('quoted multiline header output')
                  ? GENERATED_NODE_MULTILINE_HEADER_OUTPUT_TRANSFORM
                  : GENERATED_NODE_NORMALIZER_TRANSFORM,
              }
            : file
        ),
      };
    },
  };
}

const GENERATED_NODE_NORMALIZER_TRANSFORM = String.raw`
import { readFile } from "node:fs/promises";

export async function transform(context, outputDir) {
  await outputDir.mkdir({ recursive: true });
  const outputPath = outputDir.join("normalized.csv");
  const rows = [];
  const columns = [];
  for (const source of collectSources(context)) {
    const sourceRows = parseCsv(await readFile(source.path, "utf8"));
    const headerIndex = chooseHeaderIndex(sourceRows, source);
    const sourceColumns = buildColumns(sourceRows, headerIndex);
    for (const column of sourceColumns) {
      if (!columns.includes(column)) columns.push(column);
    }
    for (const row of sourceRows.slice(headerIndex + 1)) {
      if (!row.some((cell) => String(cell ?? "").trim())) continue;
      const record = {};
      sourceColumns.forEach((column, index) => {
        record[column] = String(row[index] ?? "").trim();
      });
      rows.push(record);
    }
  }
  if (columns.length === 0) columns.push("empty");
  const csvRows = [
    columns,
    ...rows.map((row) => columns.map((column) => row[column] ?? "")),
  ];
  await outputPath.writeFile(csvRows.map((row) => row.map(escapeCsvCell).join(",")).join("\n") + "\n", "utf8");
  return {
    output: outputPath.toString(),
    format: "csv",
    rowCount: rows.length,
    columns: columns.map((name) => ({ name, type: "string" })),
    warnings: [],
  };
}

function collectSources(context) {
  if (Array.isArray(context.preparedSources?.files)) return context.preparedSources.files;
  return [{ path: context.sourcePath }];
}

function chooseHeaderIndex(rows, source) {
  const candidates = Array.isArray(source.headerCandidates) ? source.headerCandidates : [];
  const scoredCandidates = candidates
    .map((candidate) => {
      const rowNumber = Number(candidate.rowNumber || 1);
      const row = rows[rowNumber - 1] ?? [];
      return {
        rowNumber,
        score: Number(candidate.nonEmptyCellCount || 0) * 100 + labelCount(row) * 10,
      };
    })
    .sort((left, right) => right.score - left.score || right.rowNumber - left.rowNumber);
  if (scoredCandidates[0]) return scoredCandidates[0].rowNumber - 1;
  let bestIndex = 0;
  let bestScore = -1;
  rows.forEach((row, index) => {
    const nonEmpty = row.filter((cell) => String(cell ?? "").trim()).length;
    const score = nonEmpty * 100 + labelCount(row) * 10 - index;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function buildColumns(rows, headerIndex) {
  const leaf = rows[headerIndex] ?? [];
  const parent = rows[headerIndex - 1] ?? [];
  const useParent = shouldUseParent(parent, leaf);
  const rawColumns = Array.from({ length: Math.max(leaf.length, useParent ? parent.length : 0) }, (_, index) => {
    const parentName = useParent ? normalizeHeader(parent[index]) : "";
    const leafName = normalizeHeader(leaf[index]);
    if (parentName && leafName && parentName !== leafName) return parentName + "-" + leafName;
    return leafName || parentName || "column_" + (index + 1);
  });
  return dedupe(rawColumns);
}

function shouldUseParent(parent, leaf) {
  const parentValues = parent.map(normalizeHeader).filter(Boolean);
  const leafValues = leaf.map(normalizeHeader).filter(Boolean);
  if (parentValues.length < 2 || leafValues.length < 2) return false;
  const repeated = new Set(parentValues).size < parentValues.length;
  const coverage = parentValues.length >= Math.max(2, Math.ceil(leafValues.length * 0.75));
  return repeated || coverage;
}

function dedupe(names) {
  const used = new Map();
  return names.map((name, index) => {
    const base = normalizeHeader(name) || "column_" + (index + 1);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    if (count === 1) return base;
    return base + "_" + count;
  });
}

function labelCount(row) {
  return row.filter((cell) => {
    const text = normalizeHeader(cell);
    return text && !/^-?\d{1,3}(,\d{3})*(\.\d+)?%?$/.test(text) && !/^\d{1,4}[/-]\d{1,2}([/-]\d{1,4})?$/.test(text);
  }).length;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"") {
      if (quoted && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? "\"" + text.replace(/"/g, "\"\"") + "\"" : text;
}
`;

const GENERATED_NODE_MULTILINE_HEADER_OUTPUT_TRANSFORM = String.raw`
export async function transform(_context, outputDir) {
  await outputDir.mkdir({ recursive: true });
  const outputPath = outputDir.join("normalized.csv");
  await outputPath.writeFile('"时间\n顺着填","整体数据-总支付\n人数"\n5/1/26,223\n', "utf8");
  return {
    output: outputPath.toString(),
    format: "csv",
    rowCount: 1,
    columns: [
      { name: "时间\n顺着填", type: "string" },
      { name: "整体数据-总支付\n人数", type: "string" },
    ],
    warnings: [],
  };
}
`;

function writeWorkbook(filePath: string, sheets: Record<string, unknown[][]>): void {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  XLSX.writeFile(workbook, filePath);
}

function writeWorkbookWithMerges(
  filePath: string,
  sheets: Record<string, unknown[][]>,
  merges: Record<string, string[]>
): void {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!merges'] = (merges[name] ?? []).map((range) => XLSX.utils.decode_range(range));
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  }
  XLSX.writeFile(workbook, filePath);
}
