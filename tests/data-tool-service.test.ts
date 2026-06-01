import { describe, expect, it, vi } from 'vitest';
import type { DataCommandService } from '../src/main/data/data-command-service';
import { DataToolService } from '../src/main/data/data-tool-service';
import type { DataCleaningTask, DataDataset, DataOutputTable } from '../src/renderer/types';

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
      '[customers](sophron://data/input-tables/dataset_1) (dataset_1)'
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
      '[customers output](sophron://data/output-tables/output_1) (output_1)'
    );
    expect(taskResult.content[0]?.text).toContain(
      '[customers cleanup](sophron://data/tasks/task_1) (task_1)'
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
