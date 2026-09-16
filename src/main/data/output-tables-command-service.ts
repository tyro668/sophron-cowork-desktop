import type { DataTaskStore } from './data-task-store';
import {
  DataCommandError,
  type CreateOutputTableCommand,
  type ListInputTablesInput,
  type ListOutputTablesResult,
  type OutputTableResult,
  type UpdateOutputTableCommand,
} from './data-command-types';
import type { DataInputTablePreview } from '../../shared/contracts';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 100;

export class OutputTablesCommandService {
  constructor(private readonly store: DataTaskStore) {}

  async listOutputTables(input: ListInputTablesInput = {}): Promise<ListOutputTablesResult> {
    const window = listWindow(input.limit, input.offset);
    const dashboard = await this.store.getDashboard({
      query: input.query,
      includeSummary: false,
      includeTasks: false,
      includeDatasets: false,
      includeOutputTables: true,
      outputLimit: window.limit,
      outputOffset: window.offset,
    });
    return {
      outputTables: dashboard.outputTables,
      total: dashboard.totalOutputTables,
      ...window,
    };
  }

  async createOutputTable(input: CreateOutputTableCommand = {}): Promise<OutputTableResult> {
    const name = normalizeOptionalName(input.name);
    if (name) {
      await this.ensureUniqueOutputTableName(name);
    }
    if (input.sourceInputTableId) {
      await this.requireInputTable(input.sourceInputTableId);
    }

    const created = await this.store.createOutputTable({ name });
    const outputTable = input.sourceInputTableId
      ? await this.store.updateOutputTable({
          id: created.id,
          sourceDatasetId: input.sourceInputTableId,
        })
      : created;
    const preview =
      outputTable.rowCount > 0 ? await this.previewDataset(outputTable.id) : undefined;
    return { outputTable, preview };
  }

  async updateOutputTable(input: UpdateOutputTableCommand): Promise<OutputTableResult> {
    const existing = await this.store.getOutputTableRecord(input.id);
    if (!existing) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Output table not found: ${input.id}`);
    }
    const name = normalizeOptionalName(input.name);
    if (name) {
      await this.ensureUniqueOutputTableName(name, input.id);
    }
    if (input.sourceInputTableId) {
      await this.requireInputTable(input.sourceInputTableId);
    }
    const outputTable = await this.store.updateOutputTable({
      id: input.id,
      name,
      sourceDatasetId: input.sourceInputTableId,
    });
    const preview =
      outputTable.rowCount > 0 ? await this.previewDataset(outputTable.id) : undefined;
    return { outputTable, preview };
  }

  private async requireInputTable(id: string) {
    const inputTable = await this.store.getInputTableRecord(id);
    if (!inputTable) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Input table not found: ${id}`);
    }
    return inputTable;
  }

  private async ensureUniqueOutputTableName(name: string, excludeId?: string): Promise<void> {
    const result = await this.listOutputTables({ query: name, limit: MAX_LIST_LIMIT });
    const existing = result.outputTables.find(
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

  private async previewDataset(
    id: string,
    limit?: number,
    offset?: number
  ): Promise<DataInputTablePreview> {
    return this.store.previewDataset({
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
