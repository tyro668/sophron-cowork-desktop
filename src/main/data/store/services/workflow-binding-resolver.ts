/** Binds workflow source/output configs to rawTable + table records. */
import type { DataWorkflowNode, DataWorkflowNodeInput } from '../../../../shared/contracts';
import { RawTableRepository } from '../repositories/raw-table-repository';
import { stringConfigValue, getResultTableName } from '../workflow-model';

export class WorkflowBindingResolver {
  constructor(private readonly rawTables: RawTableRepository) {}
  async prepareWorkflowOutputNodesForSave(
    nodes: DataWorkflowNodeInput[],
    updatedAt: number
  ): Promise<DataWorkflowNodeInput[]> {
    const preparedNodes: DataWorkflowNodeInput[] = [];
    for (const node of nodes) {
      if (node.type !== 'output') {
        preparedNodes.push(node);
        continue;
      }

      const config = { ...(node.config ?? {}) };
      const selectedOutputRawTableId =
        stringConfigValue(config.outputResultTableId) || stringConfigValue(config.resultTableId);
      const configuredStrategy = stringConfigValue(config.outputStrategy);
      const outputStrategy =
        configuredStrategy === 'auto' || configuredStrategy === 'existing'
          ? configuredStrategy
          : selectedOutputRawTableId
            ? 'existing'
            : // Unsaved strategy: the editor shows 「自动」, so treat it as auto here too.
              // Legacy nodes that only carry a physical `table` keep their old behaviour.
              stringConfigValue(config.table)
              ? ''
              : 'auto';

      if (outputStrategy === 'auto') {
        const outputName =
          stringConfigValue(config.resultTableName) || stringConfigValue(config.table);
        if (!outputName) {
          preparedNodes.push({
            ...node,
            config: {
              ...config,
              outputStrategy: 'auto',
              destination: 'duckdb_table',
              mode: stringConfigValue(config.mode) || 'replace',
            },
          });
          continue;
        }

        const resultTable = selectedOutputRawTableId
          ? await this.rawTables.updateAutoResultTableMetadata(
              selectedOutputRawTableId,
              outputName,
              updatedAt
            )
          : await this.rawTables.createResultTableMetadata(outputName, updatedAt);
        preparedNodes.push({
          ...node,
          config: {
            ...config,
            outputStrategy: 'auto',
            resultTableName: resultTable.name,
            outputResultTableId: resultTable.id,
            table: resultTable.tableName,
            destination: 'duckdb_table',
            mode: stringConfigValue(config.mode) || 'replace',
          },
        });
        continue;
      }

      if (selectedOutputRawTableId) {
        const resultTable = await this.rawTables.requireResultTable(selectedOutputRawTableId);
        preparedNodes.push({
          ...node,
          config: {
            ...config,
            outputStrategy: 'existing',
            resultTableName: resultTable.name,
            outputResultTableId: resultTable.id,
            table: resultTable.tableName,
            destination: 'duckdb_table',
            mode: stringConfigValue(config.mode) || 'replace',
          },
        });
        continue;
      }

      preparedNodes.push(node);
    }
    return preparedNodes;
  }
  async findWorkflowSourceRawTableId(nodes: DataWorkflowNode[]): Promise<string | null> {
    for (const node of nodes) {
      if (node.type !== 'input_source' || node.config.disabled === true) {
        continue;
      }
      const source =
        typeof node.config.source === 'string'
          ? node.config.source
          : stringConfigValue(node.config.rawTableId) ||
              stringConfigValue(node.config.rawTableId) ||
              stringConfigValue(node.config.sourceRawTableId)
            ? 'rawTable'
            : 'pipeline';
      if (source !== 'rawTable') {
        continue;
      }

      const rawTableRef =
        stringConfigValue(node.config.rawTableId) ||
        stringConfigValue(node.config.rawTableId) ||
        stringConfigValue(node.config.sourceRawTableId);
      if (!rawTableRef) {
        continue;
      }
      const rawTable = await this.rawTables.findRawTableByReference(rawTableRef);
      if (rawTable) {
        return rawTable.id;
      }
    }
    return null;
  }
  async resolveWorkflowOutputTarget(
    node: { config?: Record<string, unknown> } | undefined,
    fallback: string
  ): Promise<{
    tableName: string;
    outputResultTableId?: string;
    mode: 'replace' | 'append' | 'error_if_exists' | 'merge';
    mergeKeys: string[];
    schemaPolicy: 'extend' | 'strict' | 'ignore';
  }> {
    const destination = stringConfigValue(node?.config?.destination);
    if (destination === 'rawTable' || destination === 'file') {
      throw new Error(
        `Output destination "${destination}" is not supported in pipeline workflows; use "output table" instead`
      );
    }
    const rawMode = stringConfigValue(node?.config?.mode) || 'replace';
    if (
      rawMode !== 'replace' &&
      rawMode !== 'append' &&
      rawMode !== 'error_if_exists' &&
      rawMode !== 'merge'
    ) {
      throw new Error(
        `Unsupported output mode "${rawMode}"; expected replace, append, error_if_exists, or merge`
      );
    }
    const mergeKeys = Array.isArray(node?.config?.mergeKeys)
      ? node!
          .config!.mergeKeys.map((key) => String(key ?? '').trim())
          .filter((key) => key.length > 0)
      : [];
    if (rawMode === 'merge' && mergeKeys.length === 0) {
      throw new Error('Output mode "merge" requires `by` business key columns');
    }
    if (rawMode !== 'merge' && mergeKeys.length > 0) {
      throw new Error('Output `by` keys are only valid with mode merge');
    }
    const rawSchema = stringConfigValue(node?.config?.schemaPolicy) || 'extend';
    if (rawSchema !== 'extend' && rawSchema !== 'strict' && rawSchema !== 'ignore') {
      throw new Error(
        `Unsupported output schema policy "${rawSchema}"; expected extend, strict, or ignore`
      );
    }
    const mode = rawMode;
    const outputResultTableId =
      stringConfigValue(node?.config?.outputResultTableId) ||
      stringConfigValue(node?.config?.resultTableId);
    if (outputResultTableId) {
      const resultTable = await this.rawTables.requireResultTable(outputResultTableId);
      return {
        tableName: resultTable.tableName,
        outputResultTableId: resultTable.id,
        mode,
        mergeKeys,
        schemaPolicy: rawSchema,
      };
    }
    return {
      tableName: getResultTableName(node, fallback),
      mode,
      mergeKeys,
      schemaPolicy: rawSchema,
    };
  }
}
