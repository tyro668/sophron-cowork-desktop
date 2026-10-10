import type { DataPipelineStore } from './data-pipeline-store';
import type { DataPipeline, DataRawTable, DataResultTable } from '../../shared/contracts';
import { DataCommandError } from './data-command-types';
import { MAX_LIST_LIMIT, normalizeRequiredName } from './data-command-utils';

export class DataCommandResources {
  constructor(private readonly store: DataPipelineStore) {}

  async requirePipeline(id: string): Promise<DataPipeline> {
    const pipeline = await this.store.getPipelineRecord(id);
    if (!pipeline)
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Data pipeline not found: ${id}`);
    return pipeline;
  }

  async requireRawTable(id: string): Promise<DataRawTable> {
    const rawTable = await this.store.getRawTableRecord(id);
    if (!rawTable) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Input table not found: ${id}`);
    }
    return rawTable;
  }

  async requireResultTable(id: string): Promise<DataResultTable> {
    const resultTable = await this.store.getResultTableRecord(id);
    if (!resultTable) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Output table not found: ${id}`);
    }
    return resultTable;
  }

  async findRawTableByExactName(name: string): Promise<DataRawTable | null> {
    return this.store.findRawTableRecordByName(name);
  }

  async findResultTableByExactName(name: string): Promise<DataResultTable | null> {
    const dashboard = await this.store.getDashboard({
      query: name,
      includeSummary: false,
      includePipelines: false,
      includeRawTables: false,
      includeResultTables: true,
      outputLimit: MAX_LIST_LIMIT,
    });
    return (
      dashboard.resultTables.find((item) => item.name.toLowerCase() === name.toLowerCase()) ?? null
    );
  }

  async createUniquePipelineName(baseName: string): Promise<string> {
    const base = normalizeRequiredName(baseName, 'Pipeline name is required');
    for (let index = 0; index < 100; index += 1) {
      const candidate = index === 0 ? base : `${base}_${index + 1}`;
      if (!(await this.findPipelineByExactName(candidate))) return candidate;
    }
    return `${base}_${Date.now()}`;
  }

  async ensureUniquePipelineName(name: string, excludeId?: string): Promise<void> {
    const existing = await this.findPipelineByExactName(name, excludeId);
    if (existing) {
      throw new DataCommandError(
        'RESOURCE_ALREADY_EXISTS',
        `Data pipeline already exists: ${name}`,
        {
          id: existing.id,
          name: existing.name,
        }
      );
    }
  }

  private async findPipelineByExactName(
    name: string,
    excludeId?: string
  ): Promise<DataPipeline | null> {
    const dashboard = await this.store.getDashboard({
      query: name,
      includeSummary: false,
      includePipelines: true,
      includeRawTables: false,
      includeResultTables: false,
      pipelineLimit: MAX_LIST_LIMIT,
    });
    return (
      dashboard.pipelines.find(
        (item) => item.id !== excludeId && item.name.toLowerCase() === name.toLowerCase()
      ) ?? null
    );
  }
}
