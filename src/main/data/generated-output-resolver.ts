import type { DataOutputTable } from '../../renderer/types';
import type {
  CreateOutputTableCommand,
  GenerateTaskFromRequirementCommand,
  OutputTableResult,
} from './data-command-types';
import type { DataTaskStore } from './data-task-store';
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
    inputTableName: string
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
    if (existingOutputTable) return { outputTable: existingOutputTable, created: false };
    return {
      outputTable: (await this.outputTables.createOutputTable({ name: outputTableName }))
        .outputTable,
      created: true,
    };
  }
}
