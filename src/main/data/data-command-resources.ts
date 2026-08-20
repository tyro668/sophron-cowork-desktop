import type { DataTaskStore } from './data-task-store';
import type { DataCleaningTask, DataDataset, DataOutputTable } from '../../renderer/types';
import { DataCommandError } from './data-command-types';
import { MAX_LIST_LIMIT, normalizeRequiredName } from './data-command-utils';

export class DataCommandResources {
  constructor(private readonly store: DataTaskStore) {}

  async requireTask(id: string): Promise<DataCleaningTask> {
    const task = await this.store.getTaskRecord(id);
    if (!task) throw new DataCommandError('RESOURCE_NOT_FOUND', `Data task not found: ${id}`);
    return task;
  }

  async requireInputTable(id: string): Promise<DataDataset> {
    const inputTable = await this.store.getInputTableRecord(id);
    if (!inputTable) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Input table not found: ${id}`);
    }
    return inputTable;
  }

  async requireOutputTable(id: string): Promise<DataOutputTable> {
    const outputTable = await this.store.getOutputTableRecord(id);
    if (!outputTable) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Output table not found: ${id}`);
    }
    return outputTable;
  }

  async findInputTableByExactName(name: string): Promise<DataDataset | null> {
    return this.store.findInputTableRecordByName(name);
  }

  async findOutputTableByExactName(name: string): Promise<DataOutputTable | null> {
    const dashboard = await this.store.getDashboard({
      query: name,
      includeSummary: false,
      includeTasks: false,
      includeDatasets: false,
      includeOutputTables: true,
      outputLimit: MAX_LIST_LIMIT,
    });
    return (
      dashboard.outputTables.find((item) => item.name.toLowerCase() === name.toLowerCase()) ?? null
    );
  }

  async createUniqueTaskName(baseName: string): Promise<string> {
    const base = normalizeRequiredName(baseName, 'Task name is required');
    for (let index = 0; index < 100; index += 1) {
      const candidate = index === 0 ? base : `${base}_${index + 1}`;
      if (!(await this.findTaskByExactName(candidate))) return candidate;
    }
    return `${base}_${Date.now()}`;
  }

  async ensureUniqueTaskName(name: string, excludeId?: string): Promise<void> {
    const existing = await this.findTaskByExactName(name, excludeId);
    if (existing) {
      throw new DataCommandError('RESOURCE_ALREADY_EXISTS', `Data task already exists: ${name}`, {
        id: existing.id,
        name: existing.name,
      });
    }
  }

  private async findTaskByExactName(
    name: string,
    excludeId?: string
  ): Promise<DataCleaningTask | null> {
    const dashboard = await this.store.getDashboard({
      query: name,
      includeSummary: false,
      includeTasks: true,
      includeDatasets: false,
      includeOutputTables: false,
      taskLimit: MAX_LIST_LIMIT,
    });
    return (
      dashboard.tasks.find(
        (item) => item.id !== excludeId && item.name.toLowerCase() === name.toLowerCase()
      ) ?? null
    );
  }
}
