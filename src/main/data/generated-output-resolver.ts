import type { DataOutputTable } from '../../renderer/types';
import type {
  CreateOutputTableCommand,
  GenerateTaskFromRequirementCommand,
  OutputTableResult,
} from './data-command-types';
import type { DataTaskStore } from './data-task-store';
import { DataCommandError } from './data-command-types';
import { DataCommandResources } from './data-command-resources';
import { normalizeOptionalName, normalizeRequiredName } from './data-command-utils';

export interface ResolvedGeneratedOutputTable {
  outputTable: DataOutputTable;
  created: boolean;
}

interface GeneratedOutputCommands {
  createOutputTable: (input: CreateOutputTableCommand) => Promise<OutputTableResult>;
}

export class GeneratedOutputResolver {
  constructor(
    private readonly store: DataTaskStore,
    private readonly resources: DataCommandResources,
    private readonly outputTables: GeneratedOutputCommands
  ) {}

  async resolveGeneratedOutputTable(
    output: GenerateTaskFromRequirementCommand['output'],
    inputTableName: string,
    conflictPolicy: GenerateTaskFromRequirementCommand['outputConflictPolicy'] = 'reuse'
  ): Promise<ResolvedGeneratedOutputTable> {
    if (output.location === 'local' && output.writeMode === 'replace') {
      return {
        outputTable: await this.resources.requireOutputTable(
          normalizeRequiredName(output.targetTableId ?? '', 'Output table id is required')
        ),
        created: false,
      };
    }
    const outputTableName =
      normalizeOptionalName(output.tableName) || `${inputTableName || 'processed_table'}_processed`;
    if (output.localOutputTableId) {
      const existingOutputTable = await this.store.getOutputTableRecord(output.localOutputTableId);
      if (existingOutputTable && existingOutputTable.name === outputTableName) {
        return { outputTable: existingOutputTable, created: false };
      }
    }
    const existingOutputTable = await this.resources.findOutputTableByExactName(outputTableName);
    if (existingOutputTable) {
      if (conflictPolicy === 'reuse') {
        return { outputTable: existingOutputTable, created: false };
      }
      if (conflictPolicy === 'error') {
        throw new DataCommandError(
          'RESOURCE_ALREADY_EXISTS',
          `Output table already exists: ${outputTableName}`,
          { id: existingOutputTable.id, name: existingOutputTable.name }
        );
      }
    }
    const resolvedName =
      existingOutputTable && conflictPolicy === 'unique'
        ? await this.createUniqueOutputTableName(outputTableName)
        : outputTableName;
    return {
      outputTable: (await this.outputTables.createOutputTable({ name: resolvedName })).outputTable,
      created: true,
    };
  }

  private async createUniqueOutputTableName(baseName: string): Promise<string> {
    for (let index = 2; index <= 100; index += 1) {
      const candidate = `${baseName}_${index}`;
      if (!(await this.resources.findOutputTableByExactName(candidate))) return candidate;
    }
    return `${baseName}_${Date.now()}`;
  }
}
