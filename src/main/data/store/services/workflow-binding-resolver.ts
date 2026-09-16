/** Binds workflow source/output configs to dataset + table records. */
import type { DataWorkflowNode, DataWorkflowNodeInput } from '../../../../shared/contracts';
import { DatasetRepository } from '../repositories/dataset-repository';
import { stringConfigValue, getOutputTableName } from '../workflow-model';

export class WorkflowBindingResolver {
  constructor(private readonly datasets: DatasetRepository) {}
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
      const selectedOutputDatasetId =
        stringConfigValue(config.outputDatasetId) || stringConfigValue(config.outputTableId);
      const configuredStrategy = stringConfigValue(config.outputStrategy);
      const outputStrategy =
        configuredStrategy === 'auto' || configuredStrategy === 'existing'
          ? configuredStrategy
          : selectedOutputDatasetId
            ? 'existing'
            : '';

      if (outputStrategy === 'auto') {
        const outputName =
          stringConfigValue(config.outputTableName) || stringConfigValue(config.table);
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

        const outputTable = selectedOutputDatasetId
          ? await this.datasets.updateAutoOutputTableMetadata(
              selectedOutputDatasetId,
              outputName,
              updatedAt
            )
          : await this.datasets.createOutputTableMetadata(outputName, updatedAt);
        preparedNodes.push({
          ...node,
          config: {
            ...config,
            outputStrategy: 'auto',
            outputTableName: outputTable.name,
            outputDatasetId: outputTable.id,
            table: outputTable.tableName,
            destination: 'duckdb_table',
            mode: stringConfigValue(config.mode) || 'replace',
          },
        });
        continue;
      }

      if (selectedOutputDatasetId) {
        const outputTable = await this.datasets.requireOutputTable(selectedOutputDatasetId);
        preparedNodes.push({
          ...node,
          config: {
            ...config,
            outputStrategy: 'existing',
            outputTableName: outputTable.name,
            outputDatasetId: outputTable.id,
            table: outputTable.tableName,
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
  async findWorkflowSourceDatasetId(nodes: DataWorkflowNode[]): Promise<string | null> {
    for (const node of nodes) {
      if (node.type !== 'input_source' || node.config.disabled === true) {
        continue;
      }
      const source =
        typeof node.config.source === 'string'
          ? node.config.source
          : stringConfigValue(node.config.datasetId) ||
              stringConfigValue(node.config.inputTableId) ||
              stringConfigValue(node.config.sourceDatasetId)
            ? 'dataset'
            : 'task';
      if (source !== 'dataset') {
        continue;
      }

      const datasetRef =
        stringConfigValue(node.config.datasetId) ||
        stringConfigValue(node.config.inputTableId) ||
        stringConfigValue(node.config.sourceDatasetId);
      if (!datasetRef) {
        continue;
      }
      const dataset = await this.datasets.findDatasetByReference(datasetRef);
      if (dataset) {
        return dataset.id;
      }
    }
    return null;
  }
  async resolveWorkflowOutputTarget(
    node: { config?: Record<string, unknown> } | undefined,
    fallback: string
  ): Promise<{
    tableName: string;
    outputDatasetId?: string;
    mode: 'replace' | 'append' | 'error_if_exists' | 'merge';
    mergeKeys: string[];
    schemaPolicy: 'extend' | 'strict' | 'ignore';
  }> {
    const destination = stringConfigValue(node?.config?.destination);
    if (destination === 'dataset' || destination === 'file') {
      throw new Error(
        `Output destination "${destination}" is not supported in task workflows; use "output table" instead`
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
    const outputDatasetId =
      stringConfigValue(node?.config?.outputDatasetId) ||
      stringConfigValue(node?.config?.outputTableId);
    if (outputDatasetId) {
      const outputTable = await this.datasets.requireOutputTable(outputDatasetId);
      return {
        tableName: outputTable.tableName,
        outputDatasetId: outputTable.id,
        mode,
        mergeKeys,
        schemaPolicy: rawSchema,
      };
    }
    return {
      tableName: getOutputTableName(node, fallback),
      mode,
      mergeKeys,
      schemaPolicy: rawSchema,
    };
  }
}
