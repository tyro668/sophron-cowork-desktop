import type { DataPipelineStore } from './data-pipeline-store';
import {
  DataCommandError,
  type CreateResultTableCommand,
  type ListRawTablesInput,
  type ListResultTablesResult,
  type ResultTableResult,
  type UpdateResultTableCommand,
} from './data-command-types';
import type { DataRawTablePreview } from '../../shared/contracts';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 100;

export class ResultTablesCommandService {
  constructor(private readonly store: DataPipelineStore) {}

  async listResultTables(input: ListRawTablesInput = {}): Promise<ListResultTablesResult> {
    const window = listWindow(input.limit, input.offset);
    const dashboard = await this.store.getDashboard({
      query: input.query,
      includeSummary: false,
      includePipelines: false,
      includeRawTables: false,
      includeResultTables: true,
      outputLimit: window.limit,
      outputOffset: window.offset,
    });
    return {
      resultTables: dashboard.resultTables,
      total: dashboard.totalResultTables,
      ...window,
    };
  }

  async createResultTable(input: CreateResultTableCommand = {}): Promise<ResultTableResult> {
    const name = normalizeOptionalName(input.name);
    if (name) {
      await this.ensureUniqueResultTableName(name);
    }
    if (input.sourceRawTableId) {
      await this.requireRawTable(input.sourceRawTableId);
    }

    const created = await this.store.createResultTable({ name });
    const resultTable = input.sourceRawTableId
      ? await this.store.updateResultTable({
          id: created.id,
          sourceRawTableId: input.sourceRawTableId,
        })
      : created;
    const preview =
      resultTable.rowCount > 0 ? await this.previewRawTable(resultTable.id) : undefined;
    return { resultTable, preview };
  }

  async updateResultTable(input: UpdateResultTableCommand): Promise<ResultTableResult> {
    const existing = await this.store.getResultTableRecord(input.id);
    if (!existing) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Output table not found: ${input.id}`);
    }
    const name = normalizeOptionalName(input.name);
    if (name) {
      await this.ensureUniqueResultTableName(name, input.id);
    }
    if (input.sourceRawTableId) {
      await this.requireRawTable(input.sourceRawTableId);
    }
    const resultTable = await this.store.updateResultTable({
      id: input.id,
      name,
      sourceRawTableId: input.sourceRawTableId,
    });
    const preview =
      resultTable.rowCount > 0 ? await this.previewRawTable(resultTable.id) : undefined;
    return { resultTable, preview };
  }

  private async requireRawTable(id: string) {
    const rawTable = await this.store.getRawTableRecord(id);
    if (!rawTable) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Input table not found: ${id}`);
    }
    return rawTable;
  }

  private async ensureUniqueResultTableName(name: string, excludeId?: string): Promise<void> {
    const result = await this.listResultTables({ query: name, limit: MAX_LIST_LIMIT });
    const existing = result.resultTables.find(
      (item) => item.id !== excludeId && item.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      throw new DataCommandError(
        'RESOURCE_ALREADY_EXISTS',
        `Output table already exists: ${name}`,
        {
          id: existing.id,
          name: existing.name,
        }
      );
    }
  }

  private async previewRawTable(
    id: string,
    limit?: number,
    offset?: number
  ): Promise<DataRawTablePreview> {
    return this.store.previewRawTable({
      id,
      limit: previewLimit(limit),
      offset: previewOffset(offset),
    });
  }
}

function listWindow(
  limit: number | undefined,
  offset: number | undefined
): { limit: number; offset: number } {
  return {
    limit: clampInteger(limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT),
    offset: Math.max(0, Math.floor(Number(offset) || 0)),
  };
}

function previewLimit(limit: number | undefined): number {
  return clampInteger(limit, DEFAULT_PREVIEW_LIMIT, 1, MAX_PREVIEW_LIMIT);
}

function previewOffset(offset: number | undefined): number {
  return Math.max(0, Math.floor(Number(offset) || 0));
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(Number(value))));
}

function normalizeOptionalName(name: string | undefined): string | undefined {
  const normalized = name?.trim();
  return normalized || undefined;
}
