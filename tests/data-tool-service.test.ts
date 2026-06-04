import { describe, expect, it, vi } from 'vitest';
import type { DataCommandService } from '../src/main/data/data-command-service';
import { createDataCustomTools } from '../src/main/data/data-tool-definitions';
import { DataToolService } from '../src/main/data/data-tool-service';
import type {
  DataCleaningTask,
  DataDataset,
  DataInputTablePreview,
  DataOutputTable,
} from '../src/renderer/types';

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
    const service = new DataToolService(commandService);

    const result = await service.listInputTables({});

    expect(result.content[0]?.text).toContain('Found 1 of 1 input table');
    expect(result.content[0]?.text).toContain(
      '[customers](#/data/input-tables/dataset_1) (dataset_1)'
    );
    expect(result.details).toMatchObject({ total: 1, inputTables: [{ id: 'dataset_1' }] });
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
    const service = new DataToolService(commandService);

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
    const service = new DataToolService(commandService);

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
    const service = new DataToolService(commandService);
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

    const result = await tool?.execute('call_1', {
      name: 'normalized excel',
      sourceKind: 'excel',
      filePath: '.tmp/source.xlsx',
      processingStrategy: '{"strategy":"customize","rulePrompt":"normalize"}',
    });

    expect(result?.content[0]?.text).toContain('Created input table with customize processing');
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

  it('returns embedded workflow DSL reference without relying on source docs', async () => {
    const commandService = {} as DataCommandService;
    const service = new DataToolService(commandService);

    const result = await service.getWorkflowDslReference({ topic: 'examples' });

    expect(result.content[0]?.text).toContain('input source dataset "<inputTableId>" as src');
    expect(result.content[0]?.text).toContain('data_apply_workflow_dsl');
    expect(result.content[0]?.text).not.toContain('design/prep');
  });
});
