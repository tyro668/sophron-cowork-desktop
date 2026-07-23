import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { DataCommandService } from '../src/main/data/data-command-service';
import { createDataTaskStore, type DataTaskStore } from '../src/main/data/data-task-store';
import type { InputTableNormalizerProjectGenerator } from '../src/main/data/input-table-normalizer-generator';
import { createInputTableNormalizerProjectTemplate } from '../src/shared/input-table-normalizer/templates';
import { runPiAiOneShot } from '../src/main/claude/claude-sdk-one-shot';
import type { AgentRuntimeConfig } from '../src/renderer/types';
import type { PersonalAnalysisConnectionInput } from '../src/shared/personal-analysis-types';

function asFunctionWorkflow(chain: string): string {
  const calls = splitWorkflowChain(chain);
  const operations = calls.filter(
    (call) =>
      call.name !== 'workflow' && call.name !== 'inputDataset' && call.name !== 'outputTable'
  );
  const helpers = operations.map((call, index) => {
    const payload = legacyCallPayload(call.name, call.args);
    return `function step${index + 1}(input) {\n  return workflow.step(input, ${JSON.stringify(
      payload.type
    )}, ${payload.fields});\n}`;
  });
  const body = [
    'function main() {',
    '  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });',
    ...operations.map(
      (_call, index) =>
        `  const value${index + 1} = step${index + 1}(${index === 0 ? 'input' : `value${index}`});`
    ),
    `  return workflow.output(${operations.length ? `value${operations.length}` : 'input'}, OUTPUT_TABLE_NAME, { mode: "replace" });`,
    '}',
  ];
  return [...helpers, body.join('\n')].join('\n\n');
}

function splitWorkflowChain(source: string): Array<{ name: string; args: string[] }> {
  const calls: Array<{ name: string; args: string[] }> = [];
  const pattern = /(?:^|\.)\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const open = pattern.lastIndex - 1;
    let depth = 0;
    let quote: string | null = null;
    let end = open;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (quote) {
        if (char === '\\') end += 1;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '(') depth += 1;
      else if (char === ')' && --depth === 0) break;
    }
    calls.push({ name: match[1], args: splitTopLevelArguments(source.slice(open + 1, end)) });
    pattern.lastIndex = end + 1;
  }
  return calls;
}

function splitTopLevelArguments(source: string): string[] {
  if (!source.trim()) return [];
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === '`') quote = char;
    else if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth -= 1;
    else if (char === ',' && depth === 0) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(source.slice(start).trim());
  return args;
}

function legacyCallPayload(name: string, args: string[]): { type: string; fields: string } {
  switch (name) {
    case 'filter':
      return { type: 'filter', fields: `{ condition: ${args[0]} }` };
    case 'sort':
      return { type: 'sort', fields: `{ column: ${args[0]}, direction: ${args[1]} }` };
    case 'drop':
    case 'select':
      return {
        type: name,
        fields: `{ columns: ${args[0]?.trim().startsWith('[') ? args[0] : `[${args[0]}]`} }`,
      };
    case 'rename':
      return { type: 'rename', fields: `{ source: ${args[0]}, target: ${args[1]} }` };
    case 'derive':
      return { type: 'derive', fields: `{ column: ${args[0]}, expression: ${args[1]} }` };
    case 'cast':
      return {
        type: 'convert_type',
        fields: `{ column: ${args[0]}, targetType: ${args[1]}, options: ${args[2] ?? '{}'} }`,
      };
    case 'aggregate':
      return { type: 'aggregate', fields: args[0] };
    default:
      return { type: name, fields: args[0] ?? '{}' };
  }
}

vi.mock('../src/main/claude/claude-sdk-one-shot', () => ({
  runPiAiOneShot: vi.fn(async () => ({
    text: JSON.stringify({
      javascriptSource: asFunctionWorkflow(
        'workflow().inputDataset(INPUT_TABLE_ID, "src").filter(col("Market").neq(lit("EU"))).outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
      ),
      requiredColumns: [{ name: 'Market' }],
    }),
    hasThinking: false,
    durationMs: 1,
  })),
}));

const tempRoots: string[] = [];
const stores: DataTaskStore[] = [];
const testRuntimeConfig: AgentRuntimeConfig = {
  provider: 'openai',
  apiKey: 'test-key',
  model: 'test-model',
};

beforeEach(() => {
  vi.mocked(runPiAiOneShot).mockResolvedValue({
    text: JSON.stringify({
      javascriptSource: asFunctionWorkflow(
        'workflow().inputDataset(INPUT_TABLE_ID, "src").filter(col("Market").neq(lit("EU"))).outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
      ),
      requiredColumns: [{ name: 'Market' }],
    }),
    hasThinking: false,
    durationMs: 1,
  });
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

    const result = await service.listCloudSpaces({
      connectionMode: 'account',
      apiOrigin: 'http://account.mock',
    });

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
    const exportSpy = vi.spyOn(store, 'exportDatasetCsv');

    await expect(
      service.uploadDataTableToCloud({
        tableKind: 'input',
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
    const input = await service.createInputTable({
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
            uploadTaskId: 'upload-1',
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
          data: { taskId: 'import-1', tableId: 'table-1', status: 'PENDING' },
        });
      }
      throw new Error(`Unexpected request: ${href} ${init?.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.uploadDataTableToCloud({
      tableKind: 'input',
      id: input.inputTable.id,
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
    const input = await service.createInputTable({
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
        tableKind: 'input',
        id: input.inputTable.id,
        writeMode: 'CREATE',
      })
    ).rejects.toMatchObject({
      code: 'RUN_FAILED',
      message: expect.stringContaining('Pass datasourceId for this upload'),
    });
  });

  it('creates input/output/task resources, saves workflow DSL, and runs the task', async () => {
    const { service, store, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n2,Bob\n', 'utf8');

    const input = await service.createInputTable({
      name: 'customers',
      sourceKind: 'csv',
      filePath: csvPath,
      previewRows: 2,
    });
    expect(input.inputTable.name).toBe('customers');
    expect(input.preview?.totalRows).toBe(2);

    const output = await service.createOutputTable({
      name: 'customers output',
      sourceInputTableId: input.inputTable.id,
    });
    expect(output.outputTable.name).toBe('customers output');
    expect(output.outputTable.rowCount).toBe(2);

    const task = await service.createTask({
      name: 'Copy customers',
      sourceInputTableId: input.inputTable.id,
      outputTableId: output.outputTable.id,
    });
    expect(task.task.sourceDatasetId).toBe(input.inputTable.id);
    expect(task.task.outputTable).toBe(output.outputTable.tableName);

    const listedInputTablesBeforeRun = await service.listInputTables({});
    const listedOutputTablesBeforeRun = await service.listOutputTables({});
    expect(listedInputTablesBeforeRun.inputTables[0]?.relatedTaskNames).toContain('Copy customers');
    expect(listedOutputTablesBeforeRun.outputTables[0]?.relatedTaskNames).toContain(
      'Copy customers'
    );

    const dsl = `
      input source dataset "${input.inputTable.id}" as customers

      from customers
        | output table "customers_copy" mode replace
    `;
    const dryRun = await service.applyWorkflowDsl({
      taskId: task.task.id,
      dsl,
      outputTableId: output.outputTable.id,
      dryRun: true,
    });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.workflow.nodes.map((node) => node.type)).toEqual(['input_source', 'output']);
    expect(
      dryRun.workflow.nodes.find((node) => node.type === 'output')?.config.outputDatasetId
    ).toBe(output.outputTable.id);

    const saved = await service.applyWorkflowDsl({
      taskId: task.task.id,
      outputTableId: output.outputTable.id,
      dsl,
    });
    const outputNode = saved.workflow.nodes.find((node) => node.type === 'output');
    expect(outputNode?.config.outputDatasetId).toBe(output.outputTable.id);

    const onTaskCompleted = vi.fn();
    const notifyingService = new DataCommandService(
      store,
      createFakeNormalizerGenerator(),
      () => ({
        apiOrigin: '',
        apiKey: '',
        updatedAt: 0,
      }),
      { onTaskCompleted }
    );

    const temporaryRun = await notifyingService.runTask({
      taskId: task.task.id,
      mode: 'temporary',
      previewRows: 2,
    });
    expect(temporaryRun.task.status).toBe('completed');
    expect(temporaryRun.task.outputTable).toMatch(/^temp_task_/);
    expect(temporaryRun.preview?.totalRows).toBe(2);

    const persistedRun = await notifyingService.runTask({
      taskId: task.task.id,
      mode: 'persisted',
      previewRows: 2,
    });
    expect(persistedRun.task.status).toBe('completed');
    expect(persistedRun.task.sourceDatasetId).toBe(input.inputTable.id);
    expect(persistedRun.preview?.totalRows).toBe(2);
    expect(onTaskCompleted).toHaveBeenCalledTimes(1);
    expect(onTaskCompleted).toHaveBeenLastCalledWith(persistedRun.task);

    const exported = await service.exportWorkflowDsl({ taskId: task.task.id });
    expect(exported.text).toContain(`input source dataset "${input.inputTable.id}" as customers`);

    const outputPreview = await service.previewTable({
      tableKind: 'output',
      id: output.outputTable.id,
      limit: 2,
    });
    expect(outputPreview.preview.totalRows).toBe(2);
    expect(outputPreview.preview.columns).toEqual(['id', 'name']);
  });

  it('rejects JSON workflow payloads with a clear DSL format diagnostic', async () => {
    const { service } = createService();
    const task = await service.createTask({ name: 'Bad DSL task' });

    const result = await service.applyWorkflowDsl({
      taskId: task.task.id,
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
    const input = await service.createInputTable({
      name: 'candidate cache input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const task = await service.createTask({ name: 'candidate cache task' });
    const lookupSpy = vi.spyOn(store, 'getInputTableRecord');
    const dsl = `input source dataset "${input.inputTable.id}" as src\n  | output table "cache result" mode replace`;

    await service.applyWorkflowDsl({
      taskId: task.task.id,
      dsl,
      inputTableId: input.inputTable.id,
      dryRun: true,
    });
    await service.applyWorkflowDsl({
      taskId: task.task.id,
      dsl,
      inputTableId: input.inputTable.id,
      dryRun: true,
    });

    expect(lookupSpy).toHaveBeenCalledTimes(1);
  });

  it('saves a requested workflow only after task execution succeeds', async () => {
    const { service, store, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'save-after-run.csv');
    fs.writeFileSync(csvPath, 'id\n1\n', 'utf8');
    const input = await service.createInputTable({
      name: 'save after run input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const output = await service.createOutputTable({ name: 'save after run output' });
    const task = await service.createTask({
      name: 'save after run task',
      sourceInputTableId: input.inputTable.id,
      outputTableId: output.outputTable.id,
    });
    const runSpy = vi
      .spyOn(store, 'runTaskWithDiagnostics')
      .mockRejectedValueOnce(new Error('execution failed'));
    const saveSpy = vi.spyOn(store, 'saveTaskWorkflow');

    await expect(
      service.runTask({
        taskId: task.task.id,
        mode: 'persisted',
        workflowDsl: `input source dataset "${input.inputTable.id}" as src\n  | output table "${output.outputTable.name}" mode replace`,
        outputTableId: output.outputTable.id,
        saveWorkflow: true,
      })
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('serializes concurrent operations for the same task', async () => {
    const { service, store } = createService();
    const task = await service.createTask({ name: 'keyed lock task' });
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let callCount = 0;
    vi.spyOn(store, 'runTaskWithDiagnostics').mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) await firstBlocked;
      return { task: { ...task.task, status: 'completed' }, diagnostics: [] };
    });

    const first = service.runTask({ taskId: task.task.id, mode: 'persisted' });
    await vi.waitFor(() => expect(callCount).toBe(1));
    const second = service.runTask({ taskId: task.task.id, mode: 'persisted' });
    await Promise.resolve();
    expect(callCount).toBe(1);

    releaseFirst();
    await Promise.all([first, second]);
    expect(callCount).toBe(2);
  });

  it('cleans temporary task resources after returning the preview', async () => {
    const { service, store, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'temporary.csv');
    fs.writeFileSync(csvPath, 'id\n1\n', 'utf8');
    const input = await service.createInputTable({
      name: 'temporary input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const task = await service.createTask({
      name: 'temporary cleanup task',
      sourceInputTableId: input.inputTable.id,
    });
    const cleanupSpy = vi.spyOn(store, 'cleanupTemporaryTaskResources');

    const result = await service.runTask({
      taskId: task.task.id,
      mode: 'temporary',
      workflowDsl: `input source dataset "${input.inputTable.id}" as src\n  | output table "temporary result" mode replace`,
    });

    expect(result.preview?.totalRows).toBe(1);
    expect(cleanupSpy).toHaveBeenCalledWith(task.task.id);
  });

  it('reports duplicate names with stable command errors', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');
    await service.createInputTable({ name: 'customers', filePath: csvPath });

    await expect(
      service.createInputTable({ name: 'customers', filePath: csvPath })
    ).rejects.toThrow('[RESOURCE_ALREADY_EXISTS]');
  });

  it('generates, previews, publishes, and lists custom normalizer versions', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');

    const draft = await service.generateInputTableNormalizerDraft({
      name: 'customers normalizer',
      sourcePath: csvPath,
      sourceKind: 'csv',
      rulePrompt: 'Normalize the customer CSV into a standard table.',
      primaryLanguage: 'node',
    });

    expect(draft.version.status).toBe('draft');
    expect(draft.summary.fileCount).toBe(1);
    expect(draft.version.files.some((file) => file.path === 'src/cli.js')).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          tempRoot,
          'input-table-normalizers',
          'projects',
          draft.artifact.id,
          draft.version.id,
          'src',
          'cli.js'
        )
      )
    ).toBe(true);

    const preview = await service.previewInputTableNormalizerVersion({
      versionId: draft.version.id,
      sourcePath: csvPath,
      sourceKind: 'csv',
      prepareDependencies: false,
      limit: 5,
    });
    expect(preview.preview.totalRows).toBe(1);
    expect(preview.preview.columns).toEqual(['id', 'name']);
    expect(preview.preview.rows[0]).toEqual({ id: '1', name: 'Alice' });

    const published = await service.publishInputTableNormalizerVersion({
      versionId: draft.version.id,
    });
    expect(published.version.status).toBe('published');
    expect(published.artifact.activeVersionId).toBe(draft.version.id);

    const versions = await service.listInputTableNormalizerVersions({
      artifactId: draft.artifact.id,
    });
    expect(versions.versions).toHaveLength(1);
    expect(versions.versions[0]).toMatchObject({
      id: draft.version.id,
      status: 'published',
    });

    const secondDraft = await service.generateInputTableNormalizerDraft({
      artifactId: draft.artifact.id,
      name: 'customers normalizer',
      sourcePath: csvPath,
      sourceKind: 'csv',
      rulePrompt: 'Normalize the customer CSV into a standard table with a second draft.',
      primaryLanguage: 'node',
    });
    expect(secondDraft.version.status).toBe('draft');
    const secondDraftProjectDir = path.join(
      tempRoot,
      'input-table-normalizers',
      'projects',
      secondDraft.artifact.id,
      secondDraft.version.id
    );
    expect(fs.existsSync(secondDraftProjectDir)).toBe(true);

    await expect(
      service.deleteInputTableNormalizerVersion({
        versionId: published.version.id,
      })
    ).rejects.toThrow('Published normalizer versions cannot be deleted');

    await expect(
      service.deleteInputTableNormalizerVersion({
        versionId: secondDraft.version.id,
      })
    ).resolves.toEqual({ success: true });
    expect(fs.existsSync(secondDraftProjectDir)).toBe(false);

    const versionsAfterDelete = await service.listInputTableNormalizerVersions({
      artifactId: draft.artifact.id,
    });
    expect(versionsAfterDelete.versions).toHaveLength(1);
    expect(versionsAfterDelete.versions[0]?.id).toBe(published.version.id);
  });

  it('creates an input table through the custom processing strategy DSL', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n2,Bob\n', 'utf8');

    const result = await service.createInputTableWithProcessingStrategy({
      name: 'customers normalized',
      sourceKind: 'csv',
      filePath: csvPath,
      previewRows: 2,
      processingStrategy: {
        strategy: 'customize',
        rulePrompt: 'Normalize the customer CSV into a standard two-dimensional table.',
        primaryLanguage: 'node',
      },
    });

    expect(result.processingStrategy).toBe('customize');
    expect(result.normalizer?.publishedVersion.status).toBe('published');
    expect(result.inputTable.inputConfig.dataProcessing).toMatchObject({
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

    await service.generateInputTableNormalizerDraft({
      name: 'customers normalizer',
      sourcePath: csvPath,
      sourceKind: 'csv',
      rulePrompt: 'Normalize the customer CSV into a standard table.',
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

    const draft = await service.generateInputTableNormalizerDraft({
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

    const preview = await service.previewInputTableNormalizerVersion({
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
    const draft = await service.generateInputTableNormalizerDraft({
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

    const preview = await service.previewInputTableNormalizerVersion({
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

  it('previews normalizer CSV output with quoted multiline headers', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'source.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');
    const draft = await service.generateInputTableNormalizerDraft({
      name: '多行表头输出 normalizer',
      sourcePath: csvPath,
      sourceKind: 'csv',
      rulePrompt: 'quoted multiline header output',
      primaryLanguage: 'node',
    });

    const preview = await service.previewInputTableNormalizerVersion({
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

    const result = await service.summarizeInputTableSource({
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

    const summary = await service.summarizeInputTableSource({
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

    const draft = await service.generateInputTableNormalizerDraft({
      name: 'monthly normalizer',
      sourcePath: folderPath,
      sourceKind: 'folder',
      rulePrompt: 'Combine monthly CSV files into a standard table.',
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

    const draft = await service.generateInputTableNormalizerDraft({
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
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain("filter [Market] <> 'EU'");
    expect(generated.workflowDsl).not.toContain('EU的数据');
  });

  it('derives required columns from generated DSL when the model omits them', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          'workflow().inputDataset(INPUT_TABLE_ID, "src").filter(col("Market").neq(lit("EU"))).outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
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

  it('compiles restricted workflow JS API into DSL and lineage', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          [
            'workflow()',
            '.inputDataset(INPUT_TABLE_ID, "src")',
            '.filter(col("Market").neq(lit("EU")))',
            '.derive("Revenue", col("Sales").mul(col("Quantity")))',
            '.sort(col("Revenue"), "desc")',
            '.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })',
          ].join('')
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales,Quantity\nEU,10,2\nUS,20,3\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '过滤 Market 不是 EU，新增 Revenue = Sales * Quantity 并降序',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain("filter [Market] <> 'EU'");
    expect(generated.workflowDsl).toContain('derive [Revenue] = [Sales] * [Quantity]');
    expect(generated.workflowDsl).toContain('sort by [Revenue] desc');
    expect(generated.requiredColumns).toEqual([
      { name: 'Market', type: 'text' },
      { name: 'Sales', type: 'integer' },
      { name: 'Quantity', type: 'integer' },
    ]);
    expect(generated.expectedOutputSchema).toEqual([
      { name: 'Market', type: 'text' },
      { name: 'Sales', type: 'integer' },
      { name: 'Quantity', type: 'integer' },
      { name: 'Revenue', type: 'integer' },
    ]);
    expect(generated.lineage.find((column) => column.name === 'Revenue')).toEqual({
      name: 'Revenue',
      type: 'integer',
      sourceColumns: [
        { name: 'Sales', type: 'integer' },
        { name: 'Quantity', type: 'integer' },
      ],
      expression: '[Sales] * [Quantity]',
    });
  });

  it('compiles javascriptSource sort calls to Prep DSL instead of accepting SQL order by text', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          'workflow().inputDataset(INPUT_TABLE_ID, "src").sort(col("Unit Price"), "asc").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'items.csv');
    fs.writeFileSync(csvPath, 'Unit Price\n10\n5\n', 'utf8');
    const input = await service.createInputTable({
      name: 'items input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '按 Unit Price 升序排序',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'items processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain('sort by [`Unit Price`] asc');
    expect(generated.workflowDsl).not.toContain('order by');
    expect(generated.requiredColumns).toEqual([{ name: 'Unit Price', type: 'integer' }]);
  });

  it('normalizes bare backtick field refs in generated derive expressions', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          [
            'workflow()',
            '.inputDataset(INPUT_TABLE_ID, "src")',
            '.derive("Customer ID Number", fn.regexpExtract(col("Customer ID"), "[0-9]+"))',
            '.drop("记录数")',
            '.filter(col("Profit").gt(lit(0)))',
            '.sort(col("Profit"), "desc")',
            '.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })',
          ].join('')
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'orders.csv');
    fs.writeFileSync(csvPath, 'Customer ID,记录数,Profit\nCUS-001,1,10\nCUS-002,1,-5\n', 'utf8');
    const input = await service.createInputTable({
      name: 'orders input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '提取 Customer ID 中的数字，删除记录数，只保留 Profit 大于 0 并降序',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'orders processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain(
      "derive [`Customer ID Number`] = REGEXP_EXTRACT([`Customer ID`], '[0-9]+')"
    );
    expect(generated.workflowDsl).not.toContain('REGEXP_EXTRACT(`Customer ID`');
  });

  it('keeps valid DSL field refs in generated derive expressions unchanged', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          'workflow().inputDataset(INPUT_TABLE_ID, "src").derive("Customer ID Number", fn.regexpExtract(col("Customer ID"), "[0-9]+")).outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'orders.csv');
    fs.writeFileSync(csvPath, 'Customer ID\nCUS-001\n', 'utf8');
    const input = await service.createInputTable({
      name: 'orders input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '提取 Customer ID 中的数字',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'orders processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain(
      "derive [`Customer ID Number`] = REGEXP_EXTRACT([`Customer ID`], '[0-9]+')"
    );
    expect(generated.workflowDsl).not.toContain('[[`Customer ID`]]');
  });

  it('treats DSL field refs in generated filter values as field comparisons', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          'workflow().inputDataset(INPUT_TABLE_ID, "src").filter(col("Profit").lt(col("Target Profit"))).outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'profits.csv');
    fs.writeFileSync(csvPath, 'Profit,Target Profit\n100,150\n200,180\n', 'utf8');
    const input = await service.createInputTable({
      name: 'profits input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '只保留 Profit 小于 Target Profit 的记录',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'profits processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain('filter [Profit] < [`Target Profit`]');
    expect(generated.workflowDsl).not.toContain("'[Target Profit]'");
    expect(generated.requiredColumns).toEqual([
      { name: 'Profit', type: 'integer' },
      { name: 'Target Profit', type: 'integer' },
    ]);
  });

  it('normalizes bracket field refs with spaces in generated derive expressions', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          [
            'workflow()',
            '.inputDataset(INPUT_TABLE_ID, "src")',
            '.filter(col("Profit").lt(col("Target Profit")))',
            '.derive("Profit Shortfall", col("Target Profit").sub(col("Profit")))',
            '.sort(col("Profit Shortfall"), "desc")',
            '.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })',
          ].join('')
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'profits.csv');
    fs.writeFileSync(csvPath, 'Profit,Target Profit\n100,150\n200,180\n', 'utf8');
    const input = await service.createInputTable({
      name: 'profits input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement:
        '只保留 Profit 小于 Target Profit 的记录，新增 Profit Shortfall = Target Profit - Profit，并按 Profit Shortfall 降序排序',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'profits processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain('filter [Profit] < [`Target Profit`]');
    expect(generated.workflowDsl).toContain(
      'derive [`Profit Shortfall`] = [`Target Profit`] - [Profit]'
    );
    expect(generated.workflowDsl).not.toContain('[Target Profit] - [Profit]');
  });

  it('allows sorting by aggregate metric aliases', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          [
            'workflow()',
            '.inputDataset(INPUT_TABLE_ID, "src")',
            '.aggregate({ groupBy: [col("Market"), col("Product Type")], metrics: [metric.sum(col("Sales")).as("Sales 总和"), metric.sum(col("Profit")).as("Profit 总和"), metric.sum(col("Marketing")).as("Marketing 总和"), metric.count().as("记录数")] })',
            '.sort(col("Sales 总和"), "desc")',
            '.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })',
          ].join('')
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'coffee.csv');
    fs.writeFileSync(
      csvPath,
      'Market,Product Type,Sales,Profit,Marketing\nCentral,Coffee,100,30,10\nEast,Tea,80,20,8\n',
      'utf8'
    );
    const input = await service.createInputTable({
      name: 'coffee input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
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

    expect(generated.workflowDsl).toContain(
      'aggregate by [Market], [`Product Type`] metrics sum([Sales]) as [`Sales 总和`]'
    );
    expect(generated.workflowDsl).toContain('sort by [`Sales 总和`] desc');
    expect(generated.requiredColumns).toEqual([
      { name: 'Market', type: 'text' },
      { name: 'Product Type', type: 'text' },
      { name: 'Sales', type: 'integer' },
      { name: 'Profit', type: 'integer' },
      { name: 'Marketing', type: 'integer' },
    ]);
  });

  it('accepts single-column javascriptSource drop calls before sorting', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          'workflow().inputDataset(INPUT_TABLE_ID, "src").drop("记录数").sort(col("Unit Price"), "asc").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'items.csv');
    fs.writeFileSync(csvPath, 'Unit Price,记录数\n10,1\n5,1\n', 'utf8');
    const input = await service.createInputTable({
      name: 'items input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '删除记录数，按照Unit Price升序排列',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'items processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain('drop [记录数]');
    expect(generated.workflowDsl).toContain('sort by [`Unit Price`] asc');
    expect(generated.requiredColumns).toEqual([
      { name: '记录数', type: 'integer' },
      { name: 'Unit Price', type: 'integer' },
    ]);
  });

  it('compiles javascriptSource drop and sort chains before generating DSL', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          'workflow().inputDataset(INPUT_TABLE_ID, "src").drop(["记录数"]).sort(col("Unit Price"), "asc").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'items.csv');
    fs.writeFileSync(csvPath, 'Unit Price,记录数\n10,1\n5,1\n', 'utf8');
    const input = await service.createInputTable({
      name: 'items input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '删除记录数，按照Unit Price升序排列',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'items processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain('drop [记录数]');
    expect(generated.workflowDsl).toContain('sort by [`Unit Price`] asc');
    expect(generated.requiredColumns).toEqual([
      { name: '记录数', type: 'integer' },
      { name: 'Unit Price', type: 'integer' },
    ]);
  });

  it('canonicalizes select-all-except generated for column deletion into drop', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          'workflow().inputDataset(INPUT_TABLE_ID, "src").sort(col("Sales"), "asc").drop("记录数").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
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
    const input = await service.createInputTable({
      name: 'orders input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '按照sales升序排列\n删除记录数',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'orders processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain('sort by [Sales] asc');
    expect(generated.workflowDsl).toContain('drop [记录数]');
    expect(generated.workflowDsl).not.toContain('select [City]');
    expect(generated.requiredColumns).toEqual([
      { name: 'Sales', type: 'integer' },
      { name: '记录数', type: 'integer' },
    ]);
  });

  it('allows javascriptSource chains to reference columns renamed by earlier operations', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          'workflow().inputDataset(INPUT_TABLE_ID, "src").drop("记录数").rename("Adj Close", "adj_close").cast("adj_close", "decimal", { removePrefix: "$", scale: 2 }).outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
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
    const input = await service.createInputTable({
      name: 'prices input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement:
        '把这张 CSV 清洗成标准价格明细表：删除“记录数”，统一字段名，Adj Close 去掉 $ 转数值，NULL 置空，Ticker 转大写，并从 Date 提取年份和月份。',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'prices processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain('drop [记录数]');
    expect(generated.workflowDsl).toContain('map [`Adj Close`] to [adj_close]');
    expect(generated.workflowDsl).toContain('derive [__sophron_cast_adj_close] = TRY_CAST');
    expect(generated.workflowDsl).toContain("REPLACE(CAST([adj_close] AS VARCHAR), '$', '')");
    expect(generated.workflowDsl).toContain('drop [adj_close]');
    expect(generated.workflowDsl).toContain('map [__sophron_cast_adj_close] to [adj_close]');
    expect(generated.requiredColumns).toEqual([
      { name: '记录数', type: 'integer' },
      { name: 'Adj Close', type: 'text' },
    ]);
    expect(generated.expectedOutputSchema).toEqual([
      { name: 'Company Name', type: 'text' },
      { name: 'Date', type: 'date' },
      { name: 'Ticker', type: 'text' },
      { name: 'Close value in reference period', type: 'text' },
      { name: 'adj_close', type: 'decimal' },
    ]);
  });

  it('propagates converted column types through derived generated fields', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          'workflow().inputDataset(INPUT_TABLE_ID, "src").rename("Adj Close", "adj_close").cast("adj_close", "decimal", { removePrefix: "$", scale: 2 }).derive("double_close", col("adj_close").mul(lit(2))).sort(col("double_close"), "desc").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'prices.csv');
    fs.writeFileSync(csvPath, 'Adj Close\n$8.34\n$16.14\n', 'utf8');
    const input = await service.createInputTable({
      name: 'prices input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: 'Adj Close 去掉美元符号转数值，新增 double_close 为两倍并降序排序',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'prices processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain('map [__sophron_cast_adj_close] to [adj_close]');
    expect(generated.workflowDsl).toContain('derive [double_close] = [adj_close] * 2');
    expect(generated.workflowDsl).toContain('sort by [double_close] desc');
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
        expression: "TRY_CAST(REPLACE(CAST([adj_close] AS VARCHAR), '$', '') AS DECIMAL(18,2))",
      },
      {
        name: 'double_close',
        type: 'decimal',
        sourceColumns: [{ name: 'Adj Close', type: 'text' }],
        expression: '[adj_close] * 2',
      },
    ]);
  });

  it('infers dollar-prefix removal when generated JS casts currency text to decimal', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          [
            'workflow()',
            '.inputDataset(INPUT_TABLE_ID, "src")',
            '.cast("Adj Close", "decimal", { scale: 2 })',
            '.drop("记录数")',
            '.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })',
          ].join('')
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'prices.csv');
    fs.writeFileSync(csvPath, 'Adj Close,记录数\n$8.34,1\n$16.14,1\n', 'utf8');
    const input = await service.createInputTable({
      name: 'prices input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '将Adj Close转换成数值，去除开头的$符号，删除记录数这一列',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'prices processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain("REPLACE(CAST([`Adj Close`] AS VARCHAR), '$', '')");
    expect(generated.workflowDsl).toContain('drop [记录数]');
    expect(generated.expectedOutputSchema).toEqual([{ name: 'Adj Close', type: 'decimal' }]);
  });

  it('infers integer output types for generated year and month fields', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: `function extractYear(input) {
  return workflow.step(input, "derive", { column: "Year", expression: fn.year(col("Date")) });
}

function extractMonth(input) {
  return workflow.step(input, "derive", { column: "Month", expression: fn.month(col("Date")) });
}

function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  const withYear = extractYear(input);
  const withMonth = extractMonth(withYear);
  return workflow.output(withMonth, OUTPUT_TABLE_NAME, { mode: "replace" });
}`,
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'prices.csv');
    fs.writeFileSync(csvPath, 'Date\n2012-12-31\n2013-01-31\n', 'utf8');
    const input = await service.createInputTable({
      name: 'prices input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
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

  it('retries an Acorn-scoped function repair when the first patch is still non-atomic', async () => {
    const nonAtomicSource = `function extractYearMonth(input) {
  const withYear = workflow.step(input, "derive", { column: "Year", expression: fn.year(col("Date")) });
  return workflow.step(withYear, "derive", { column: "Month", expression: fn.month(col("Date")) });
}

function main() {
  const input = workflow.input(INPUT_TABLE_ID, { alias: "src" });
  const extracted = extractYearMonth(input);
  return workflow.output(extracted, OUTPUT_TABLE_NAME, { mode: "replace" });
}`;
    vi.mocked(runPiAiOneShot)
      .mockResolvedValueOnce({
        text: JSON.stringify({ javascriptSource: nonAtomicSource }),
        hasThinking: false,
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          javascriptPatch: {
            functionName: 'extractYearMonth',
            replacementSource: `function extractYearMonth(input) {
  const withYear = workflow.step(input, "derive", { column: "Year", expression: fn.year(col("Date")) });
  return workflow.step(withYear, "derive", { column: "Month", expression: fn.month(col("Date")) });
}`,
          },
        }),
        hasThinking: false,
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          javascriptPatch: {
            functionName: 'extractYearMonth',
            replacementSource: `function extractYear(input) {
  return workflow.step(input, "derive", { column: "Year", expression: fn.year(col("Date")) });
}

function extractMonth(input) {
  return workflow.step(input, "derive", { column: "Month", expression: fn.month(col("Date")) });
}

function extractYearMonth(input) {
  const withYear = extractYear(input);
  return extractMonth(withYear);
}`,
          },
        }),
        hasThinking: false,
        durationMs: 1,
      });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'repair-dates.csv');
    fs.writeFileSync(csvPath, 'Date\n2012-12-31\n2013-01-31\n', 'utf8');
    const input = await service.createInputTable({
      name: 'repair dates input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '从 Date 提取年份和月份',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'repair dates processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(runPiAiOneShot).toHaveBeenCalledTimes(3);
    expect(generated.expectedOutputSchema).toEqual([
      { name: 'Date', type: 'date' },
      { name: 'Year', type: 'integer' },
      { name: 'Month', type: 'integer' },
    ]);
  });

  it('casts date fields to text before generated regexp extraction', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          [
            'workflow()',
            '.inputDataset(INPUT_TABLE_ID, "src")',
            '.derive("year", fn.regexpExtract(col("Date"), "^[0-9]{4}"))',
            '.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })',
          ].join('')
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'prices.csv');
    fs.writeFileSync(csvPath, 'Date\n2012-12-31\n2013-01-31\n', 'utf8');
    const input = await service.createInputTable({
      name: 'prices input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '从 Date 提取年份',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'prices processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain("REGEXP_EXTRACT(CAST([Date] AS VARCHAR), '^[0-9]{4}')");
    expect(generated.expectedOutputSchema).toEqual([
      { name: 'Date', type: 'date' },
      { name: 'year', type: 'text' },
    ]);
  });

  it('extracts regexp capture groups instead of full matches for generated month fields', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          [
            'workflow()',
            '.inputDataset(INPUT_TABLE_ID, "src")',
            '.derive("month", fn.regexpExtract(col("Date"), "^[0-9]{4}-([0-9]{2})"))',
            '.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })',
          ].join('')
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'prices.csv');
    fs.writeFileSync(csvPath, 'Date\n2012-12-31\n2013-01-31\n', 'utf8');
    const input = await service.createInputTable({
      name: 'prices input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '从 Date 提取月份',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'prices processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain(
      "REGEXP_EXTRACT(CAST([Date] AS VARCHAR), '^[0-9]{4}-([0-9]{2})', 1)"
    );
  });

  it('replaces existing columns when generated derive targets the same field name', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          [
            'workflow()',
            '.inputDataset(INPUT_TABLE_ID, "src")',
            '.rename("Ticker", "ticker")',
            '.derive("ticker", fn.upper(col("ticker")))',
            '.outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })',
          ].join('')
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'prices.csv');
    fs.writeFileSync(csvPath, 'Ticker\nfire\nsymc\n', 'utf8');
    const input = await service.createInputTable({
      name: 'prices input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '统一字段名，Ticker 转大写',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'prices processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain('derive [__sophron_cast_ticker] = UPPER([ticker])');
    expect(generated.workflowDsl).toContain('drop [ticker]');
    expect(generated.workflowDsl).toContain('map [__sophron_cast_ticker] to [ticker]');
    expect(generated.expectedOutputSchema).toEqual([{ name: 'ticker', type: 'text' }]);
  });

  it('rejects generated JavaScript with incompatible filter comparison types', async () => {
    const badResponse = {
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          'workflow().inputDataset(INPUT_TABLE_ID, "src").filter(col("Market").gt(lit(100))).outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    };
    vi.mocked(runPiAiOneShot)
      .mockResolvedValueOnce(badResponse)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          javascriptPatch: {
            functionName: 'step1',
            replacementSource:
              'function step1(input) { return workflow.step(input, "filter", { condition: col("Market").gt(lit(100)) }); }',
          },
        }),
        hasThinking: false,
        durationMs: 1,
      });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    await expect(
      service.generateTaskFromRequirement({
        source: {
          location: 'local',
          tableId: input.inputTable.id,
          tableName: input.inputTable.name,
        },
        processRequirement: '过滤 Market 大于 100 的数据',
        output: {
          location: 'local',
          writeMode: 'create',
          tableName: 'market processed',
        },
        runtimeConfig: testRuntimeConfig,
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('incompatible types'),
    });
  });

  it('rejects a repaired workflowDsl response when a function patch is required', async () => {
    vi.mocked(runPiAiOneShot)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          javascriptSource: asFunctionWorkflow(
            'workflow().inputDataset(INPUT_TABLE_ID, "src").filter(col("Market").gt(lit(100))).outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
          ),
          requiredColumns: [],
        }),
        hasThinking: false,
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          workflowDsl: [
            'input source dataset "ignored" as src',
            "  | filter [Market] <> 'EU'",
            '  | output table "market processed" mode replace',
          ].join('\n'),
        }),
        hasThinking: false,
        durationMs: 1,
      });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    await expect(
      service.generateTaskFromRequirement({
        source: {
          location: 'local',
          tableId: input.inputTable.id,
          tableName: input.inputTable.name,
        },
        processRequirement: '过滤掉Market为EU的数据',
        output: {
          location: 'local',
          writeMode: 'create',
          tableName: 'market processed',
        },
        runtimeConfig: testRuntimeConfig,
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('javascriptPatch'),
    });
  });

  it('reports repair response format errors as validation failures', async () => {
    vi.mocked(runPiAiOneShot)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          javascriptSource: asFunctionWorkflow(
            'workflow().inputDataset(INPUT_TABLE_ID, "src").filter(col("Market").gt(lit(100))).outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
          ),
          requiredColumns: [],
        }),
        hasThinking: false,
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ steps: ['filter Market'] }),
        hasThinking: false,
        durationMs: 1,
      });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    await expect(
      service.generateTaskFromRequirement({
        source: {
          location: 'local',
          tableId: input.inputTable.id,
          tableName: input.inputTable.name,
        },
        processRequirement: '过滤掉Market为EU的数据',
        output: {
          location: 'local',
          writeMode: 'create',
          tableName: 'market processed',
        },
        runtimeConfig: testRuntimeConfig,
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('javascriptPatch'),
    });
  });

  it('rejects DSL responses because repairs must remain on the JavaScript pipeline', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    vi.mocked(runPiAiOneShot)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          javascriptSource: asFunctionWorkflow(
            'workflow().inputDataset(INPUT_TABLE_ID, "src").customDsl("filter EU market rows").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
          ),
          requiredColumns: [{ name: 'Market' }],
        }),
        hasThinking: false,
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          workflowDsl: [
            `input source dataset "${input.inputTable.id}" as src`,
            "  | filter [Market] <> 'EU'",
            '  | output table "market processed" mode replace',
          ].join('\n'),
          requiredColumns: [{ name: 'Market' }],
        }),
        hasThinking: false,
        durationMs: 1,
      });

    await expect(
      service.generateTaskFromRequirement({
        source: {
          location: 'local',
          tableId: input.inputTable.id,
          tableName: input.inputTable.name,
        },
        processRequirement: '用高级逻辑过滤掉Market为EU的数据',
        output: {
          location: 'local',
          writeMode: 'create',
          tableName: 'market processed',
        },
        runtimeConfig: testRuntimeConfig,
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('javascriptPatch'),
    });
    expect(runPiAiOneShot).toHaveBeenCalledTimes(2);
  });

  it('compiles a javascriptSource sort column when it matches the schema', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          'workflow().inputDataset(INPUT_TABLE_ID, "src").sort(col("Unit Price"), "asc").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'items.csv');
    fs.writeFileSync(csvPath, 'Unit Price,记录数\n10,1\n5,1\n', 'utf8');
    const input = await service.createInputTable({
      name: 'items input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '按照Unit Price升序排列',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'items processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain('sort by [`Unit Price`] asc');
    expect(generated.requiredColumns).toEqual([{ name: 'Unit Price', type: 'integer' }]);
  });

  it('rejects javascriptSource that references a missing longer ASCII sort column', async () => {
    vi.mocked(runPiAiOneShot)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          javascriptSource: asFunctionWorkflow(
            'workflow().inputDataset(INPUT_TABLE_ID, "src").sort(col("Market Value"), "asc").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
          ),
          requiredColumns: [],
        }),
        hasThinking: false,
        durationMs: 1,
      })
      .mockResolvedValue({
        text: JSON.stringify({
          javascriptPatch: {
            functionName: 'step1',
            replacementSource:
              'function step1(input) { return workflow.step(input, "sort", { column: col("Market Value"), direction: "asc" }); }',
          },
        }),
        hasThinking: false,
        durationMs: 1,
      });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'items.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nUS,20\nEU,10\n', 'utf8');
    const input = await service.createInputTable({
      name: 'items input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    await expect(
      service.generateTaskFromRequirement({
        source: {
          location: 'local',
          tableId: input.inputTable.id,
          tableName: input.inputTable.name,
        },
        processRequirement: '按照Market Value升序排列',
        output: {
          location: 'local',
          writeMode: 'create',
          tableName: 'items processed',
        },
        runtimeConfig: testRuntimeConfig,
      })
    ).rejects.toThrow(/unknown input column/);
  });

  it('accepts a complete longer ASCII sort column from javascriptSource', async () => {
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce({
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          'workflow().inputDataset(INPUT_TABLE_ID, "src").sort(col("Market Value"), "asc").outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    });
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'items.csv');
    fs.writeFileSync(csvPath, 'Market Value,Sales\n20,2\n10,1\n', 'utf8');
    const input = await service.createInputTable({
      name: 'items input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '按照Market Value升序排列',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'items processed',
      },
      runtimeConfig: testRuntimeConfig,
    });

    expect(generated.workflowDsl).toContain('sort by [`Market Value`] asc');
    expect(generated.requiredColumns).toEqual([{ name: 'Market Value', type: 'integer' }]);
  });

  it('fails data task generation when the model call fails', async () => {
    vi.mocked(runPiAiOneShot).mockRejectedValueOnce(new Error('model unavailable'));
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    await expect(
      service.generateTaskFromRequirement({
        source: {
          location: 'local',
          tableId: input.inputTable.id,
          tableName: input.inputTable.name,
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

    const tasks = await service.listTasks({ query: 'market input_自动处理' });
    const outputs = await service.listOutputTables({ query: 'market processed' });
    expect(tasks.tasks).toHaveLength(0);
    expect(outputs.outputTables).toHaveLength(0);
  });

  it('does not delete a reused output table when generation fails', async () => {
    vi.mocked(runPiAiOneShot).mockRejectedValueOnce(new Error('model unavailable'));
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const existingOutput = await service.createOutputTable({ name: 'market processed' });

    await expect(
      service.generateTaskFromRequirement({
        source: { location: 'local', tableId: input.inputTable.id },
        processRequirement: '复制数据',
        output: {
          location: 'local',
          writeMode: 'create',
          tableName: existingOutput.outputTable.name,
          localOutputTableId: existingOutput.outputTable.id,
        },
        runtimeConfig: testRuntimeConfig,
      })
    ).rejects.toMatchObject({ code: 'GENERATION_FAILED' });

    const outputs = await service.listOutputTables({ query: 'market processed' });
    expect(outputs.outputTables.map((table) => table.id)).toContain(existingOutput.outputTable.id);
    expect((await service.listTasks({ query: 'market input_自动处理' })).tasks).toHaveLength(0);
  });

  it('reuses generated task and output table when regenerating', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    const first = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed',
      },
      runtimeConfig: testRuntimeConfig,
    });
    const second = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed',
        localOutputTableId: first.outputTableId,
      },
      reuseTaskId: first.taskId,
      currentVersion: first.version,
      runtimeConfig: testRuntimeConfig,
    });
    const tasks = await service.listTasks({ query: 'market input_自动处理' });
    const outputs = await service.listOutputTables({ query: 'market processed' });

    expect(second.taskId).toBe(first.taskId);
    expect(second.outputTableId).toBe(first.outputTableId);
    expect(second.version).toBe(2);
    expect(
      tasks.tasks.filter((task) => task.name.startsWith('market input_自动处理'))
    ).toHaveLength(1);
    expect(outputs.outputTables.filter((table) => table.name === 'market processed')).toHaveLength(
      1
    );
  });

  it('creates a new output table when a reused generated output table is missing', async () => {
    const { service, store, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const first = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed',
      },
      runtimeConfig: testRuntimeConfig,
    });
    await store.deleteDataset(first.outputTableId);

    const regenerated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed',
        localOutputTableId: first.outputTableId,
      },
      reuseTaskId: first.taskId,
      currentVersion: first.version,
      runtimeConfig: testRuntimeConfig,
    });

    expect(regenerated.taskId).toBe(first.taskId);
    expect(regenerated.outputTableId).not.toBe(first.outputTableId);
    expect(regenerated.version).toBe(2);
  });

  it('creates a new output table when regenerating with a changed output name', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const first = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed 1',
      },
      runtimeConfig: testRuntimeConfig,
    });

    const regenerated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed 2',
        localOutputTableId: first.outputTableId,
      },
      reuseTaskId: first.taskId,
      currentVersion: first.version,
      runtimeConfig: testRuntimeConfig,
    });

    expect(regenerated.taskId).toBe(first.taskId);
    expect(regenerated.outputTableId).not.toBe(first.outputTableId);
    expect(regenerated.outputTableName).toBe('market processed 2');
    expect(regenerated.workflowDsl).toContain('output table "market processed 2" mode replace');
    expect(regenerated.workflowDsl).not.toContain('output table "market processed 1"');
    expect(regenerated.version).toBe(2);
  });

  it('reuses an existing output table with the requested generated output name', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const existingOutput = await service.createOutputTable({ name: 'market processed' });

    const generated = await service.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      processRequirement: '过滤掉Market为EU的数据',
      output: {
        location: 'local',
        writeMode: 'create',
        tableName: 'market processed',
      },
      runtimeConfig: testRuntimeConfig,
    });
    const outputs = await service.listOutputTables({ query: 'market processed' });

    expect(generated.outputTableId).toBe(existingOutput.outputTable.id);
    expect(outputs.outputTables.filter((table) => table.name === 'market processed')).toHaveLength(
      1
    );
  });

  it('refreshes a stable local mirror for cloud generated tasks', async () => {
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
        return jsonResponse({ success: true, data: { taskId: 'export-1', status: 'RUNNING' } });
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

    const generated = await service.generateTaskFromRequirement({
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

    await service.runGeneratedTask({
      taskId: generated.taskId,
      workflowDsl: generated.workflowDsl,
      source: {
        location: 'cloud',
        tableId: 'tbl-12345678',
        tableName: 'Cloud Orders',
      },
      output: {
        location: 'local',
        writeMode: 'create',
        localOutputTableId: generated.outputTableId,
      },
      requiredColumns: generated.requiredColumns,
    });
    await service.runGeneratedTask({
      taskId: generated.taskId,
      workflowDsl: generated.workflowDsl,
      source: {
        location: 'cloud',
        tableId: 'tbl-12345678',
        tableName: 'Cloud Orders',
      },
      output: {
        location: 'local',
        writeMode: 'create',
        localOutputTableId: generated.outputTableId,
      },
      requiredColumns: generated.requiredColumns,
    });
    const mirrors = await service.listInputTables({ query: 'Cloud Orders_自动化镜像' });

    expect(mirrors.inputTables).toHaveLength(1);
    expect(mirrors.inputTables[0]?.name).toBe('Cloud Orders_自动化镜像_tbl-1234');
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
        return jsonResponse({ success: true, data: { taskId: 'export-1', status: 'RUNNING' } });
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

    const first = await service.generateTaskFromRequirement({
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
    const second = await service.generateTaskFromRequirement({
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
        localOutputTableId: first.outputTableId,
      },
      reuseTaskId: first.taskId,
      currentVersion: first.version,
      runtimeConfig: testRuntimeConfig,
    });
    const mirrors = await service.listInputTables({ query: '10题_自动化镜像_tbl-a044' });

    expect(second.version).toBe(2);
    expect(mirrors.inputTables).toHaveLength(1);
    expect(mirrors.inputTables[0]?.name).toBe('10题_自动化镜像_tbl-a044');
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/api/personal/analysis/v1/tables/tbl-a0440000/exports')
      )
    ).toHaveLength(1);
  });

  it('rejects generated DSL that references columns not in the source schema', async () => {
    const badResponse = {
      text: JSON.stringify({
        javascriptSource: asFunctionWorkflow(
          'workflow().inputDataset(INPUT_TABLE_ID, "src").filter(col("NotAColumn").eq(lit(1))).outputTable(OUTPUT_TABLE_NAME, { mode: "replace" })'
        ),
        requiredColumns: [],
      }),
      hasThinking: false,
      durationMs: 1,
    };
    vi.mocked(runPiAiOneShot).mockResolvedValueOnce(badResponse).mockResolvedValueOnce(badResponse);
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });

    await expect(
      service.generateTaskFromRequirement({
        source: {
          location: 'local',
          tableId: input.inputTable.id,
          tableName: input.inputTable.name,
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
  });

  it('stops generated task runs when required columns drift', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Region,Sales\nUS,20\n', 'utf8');
    const input = await service.createInputTable({
      name: 'region input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const output = await service.createOutputTable({ name: 'region output' });
    const task = await service.createTask({
      name: 'region task',
      sourceInputTableId: input.inputTable.id,
      outputTableId: output.outputTable.id,
    });

    await expect(
      service.runGeneratedTask({
        taskId: task.task.id,
        workflowDsl: `input source dataset "${input.inputTable.id}" as src\n  | output table "${output.outputTable.name}" mode replace`,
        source: {
          location: 'local',
          tableId: input.inputTable.id,
          tableName: input.inputTable.name,
        },
        output: {
          location: 'local',
          writeMode: 'replace',
          targetTableId: output.outputTable.id,
        },
        requiredColumns: [{ name: 'Market' }],
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('stops generated task runs when output schema drifts', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales\nEU,10\nUS,20\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const output = await service.createOutputTable({ name: 'market output' });
    const task = await service.createTask({
      name: 'market schema task',
      sourceInputTableId: input.inputTable.id,
      outputTableId: output.outputTable.id,
    });

    await service.runGeneratedTask({
      taskId: task.task.id,
      workflowDsl: `input source dataset "${input.inputTable.id}" as src\n  | output table "${output.outputTable.name}" mode replace`,
      source: { location: 'local', tableId: input.inputTable.id },
      output: {
        location: 'local',
        writeMode: 'replace',
        targetTableId: output.outputTable.id,
      },
      expectedOutputSchema: [
        { name: 'Market', type: 'text' },
        { name: 'Sales', type: 'integer' },
      ],
    });

    await expect(
      service.runGeneratedTask({
        taskId: task.task.id,
        workflowDsl: `input source dataset "${input.inputTable.id}" as src\n  | select [Market]\n  | output table "${output.outputTable.name}" mode replace`,
        source: {
          location: 'local',
          tableId: input.inputTable.id,
          tableName: input.inputTable.name,
        },
        output: {
          location: 'local',
          writeMode: 'replace',
          targetTableId: output.outputTable.id,
        },
        requiredColumns: [{ name: 'Market', type: 'text' }],
        expectedOutputSchema: [{ name: 'Region', type: 'text' }],
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('output column mismatch'),
    });

    const preview = await service.previewTable({
      tableKind: 'output',
      id: output.outputTable.id,
    });
    expect(preview.preview.columns).toEqual(['Market', 'Sales']);
    expect(preview.preview.totalRows).toBe(2);
  });

  it('validates generated output schema against runtime output instead of source table', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'market.csv');
    fs.writeFileSync(csvPath, 'Market,Sales,记录数\nEU,10,1\nUS,20,1\n', 'utf8');
    const input = await service.createInputTable({
      name: 'market source schema input',
      sourceKind: 'csv',
      filePath: csvPath,
    });
    const output = await service.createOutputTable({ name: 'market source schema output' });
    const task = await service.createTask({
      name: 'market source schema task',
      sourceInputTableId: input.inputTable.id,
      outputTableId: output.outputTable.id,
    });

    const result = await service.runGeneratedTask({
      taskId: task.task.id,
      workflowDsl: [
        `input source dataset "${input.inputTable.id}" as src`,
        '  | drop [记录数]',
        `  | output table "${output.outputTable.name}" mode replace`,
      ].join('\n'),
      source: {
        location: 'local',
        tableId: input.inputTable.id,
        tableName: input.inputTable.name,
      },
      output: {
        location: 'local',
        writeMode: 'replace',
        targetTableId: output.outputTable.id,
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
  } = {}
): { service: DataCommandService; store: DataTaskStore; tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-data-command-'));
  tempRoots.push(tempRoot);
  const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
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

function createFakeNormalizerGenerator(): InputTableNormalizerProjectGenerator {
  return {
    async generate(input) {
      const template = createInputTableNormalizerProjectTemplate(
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
