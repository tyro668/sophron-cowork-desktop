import type { DataResultTable } from '../../shared/contracts';
import type {
  CreateResultTableCommand,
  GeneratePipelineFromRequirementCommand,
  ResultTableResult,
} from './data-command-types';
import type { DataPipelineStore } from './data-pipeline-store';
import { DataCommandError } from './data-command-types';
import { DataCommandResources } from './data-command-resources';
import { normalizeOptionalName, normalizeRequiredName } from './data-command-utils';

export interface ResolvedGeneratedResultTable {
  resultTable: DataResultTable;
  created: boolean;
}

interface GeneratedOutputCommands {
  createResultTable: (input: CreateResultTableCommand) => Promise<ResultTableResult>;
}

export class GeneratedOutputResolver {
  constructor(
    private readonly store: DataPipelineStore,
    private readonly resources: DataCommandResources,
    private readonly resultTables: GeneratedOutputCommands
  ) {}

  async resolveGeneratedResultTable(
    output: GeneratePipelineFromRequirementCommand['output'],
    rawTableName: string,
    conflictPolicy: GeneratePipelineFromRequirementCommand['outputConflictPolicy'] = 'reuse'
  ): Promise<ResolvedGeneratedResultTable> {
    if (output.location === 'local' && output.writeMode === 'replace') {
      return {
        resultTable: await this.resources.requireResultTable(
          normalizeRequiredName(output.targetTableId ?? '', 'Output table id is required')
        ),
        created: false,
      };
    }
    const resultTableName =
      normalizeOptionalName(output.tableName) || `${rawTableName || 'processed_table'}_processed`;
    if (output.localResultTableId) {
      const existingResultTable = await this.store.getResultTableRecord(output.localResultTableId);
      if (existingResultTable && existingResultTable.name === resultTableName) {
        return { resultTable: existingResultTable, created: false };
      }
    }
    const existingResultTable = await this.resources.findResultTableByExactName(resultTableName);
    if (existingResultTable) {
      if (conflictPolicy === 'reuse') {
        return { resultTable: existingResultTable, created: false };
      }
      if (conflictPolicy === 'error') {
        throw new DataCommandError(
          'RESOURCE_ALREADY_EXISTS',
          `Output table already exists: ${resultTableName}`,
          { id: existingResultTable.id, name: existingResultTable.name }
        );
      }
    }
    const resolvedName =
      existingResultTable && conflictPolicy === 'unique'
        ? await this.createUniqueResultTableName(resultTableName)
        : resultTableName;
    return {
      resultTable: (await this.resultTables.createResultTable({ name: resolvedName })).resultTable,
      created: true,
    };
  }

  private async createUniqueResultTableName(baseName: string): Promise<string> {
    for (let index = 2; index <= 100; index += 1) {
      const candidate = `${baseName}_${index}`;
      if (!(await this.resources.findResultTableByExactName(candidate))) return candidate;
    }
    return `${baseName}_${Date.now()}`;
  }
}
