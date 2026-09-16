import type { DataWorkflowEdge, DataWorkflowNode } from '../../../renderer/types';
import type { PrepDiagnostic } from '../../../shared/prep-dsl/ast';
import { parseFieldRefExact } from '../../../shared/prep-dsl';
import {
  JoinConfigSchema,
  MAX_PIVOT_VALUES_PER_FIELD,
  PivotConfigSchema,
  parseOperatorConfig,
} from '../../../shared/operator-schemas';
import {
  compileAsofJoinSql,
  compileJoinConditionList,
  compileJoinProjection,
  compileSetOpSql,
  literalToSql,
  quoteIdentifier,
  RESOLVED_DYNAMIC_PIVOT_VALUES,
} from '../operators';
import { COMPILE_STRATEGIES } from '../operators/strategy';
import { tableNameFromId } from './data-store-records';
import { DatasetStore } from './dataset-store';
import { normalizeSourcePath, readRelationForPath } from './input-source';
import { stringConfigValue } from './workflow-model';

export abstract class WorkflowCompiler extends DatasetStore {
  protected async resolveInputSourceColumns(
    node: DataWorkflowNode,
    taskSourcePath: string | null
  ): Promise<string[] | null> {
    const columns = await this.resolveInputSourceColumnTypes(node, taskSourcePath);
    return columns ? columns.map((column) => column.name) : null;
  }

  /**
   * Input columns with normalized types for plan-level schema validation.
   * Returns null when the node is not an enabled input_source.
   */
  protected async resolveInputSourceColumnTypes(
    node: DataWorkflowNode,
    taskSourcePath: string | null
  ): Promise<{ name: string; type?: string }[] | null> {
    if (node.type !== 'input_source' || node.config.disabled === true) {
      return null;
    }

    const source =
      typeof node.config.source === 'string'
        ? node.config.source
        : stringConfigValue(node.config.datasetId)
          ? 'dataset'
          : 'task';
    const cachedTable = await this.findWorkflowNodeCacheTable(node.taskId, node.id);
    if (cachedTable) {
      return this.getTableColumnTypes(cachedTable);
    }

    if (source === 'dataset') {
      const datasetRef = String(
        node.config.datasetId ?? node.config.name ?? node.config.alias ?? ''
      );
      const dataset = await this.findDatasetByReference(datasetRef);
      if (!dataset || !(await this.physicalTableExists(dataset.tableName))) {
        return null;
      }
      return this.getTableColumnTypes(dataset.tableName);
    }

    const cachedTableName = tableNameFromId('workflow_source', node.id);
    if (await this.physicalTableExists(cachedTableName)) {
      return this.getTableColumnTypes(cachedTableName);
    }

    const filePath =
      source === 'file' && typeof node.config.filePath === 'string'
        ? normalizeSourcePath(node.config.filePath)
        : taskSourcePath;
    if (!filePath) {
      return null;
    }

    const schemaTableName = tableNameFromId('workflow_schema', node.id);
    await this.dropTableIfExists(schemaTableName);
    try {
      const relation = readRelationForPath(filePath, 'sourcePath');
      await this.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(schemaTableName)} AS SELECT * FROM ${relation} LIMIT 0`,
        { sourcePath: filePath }
      );
      return await this.getTableColumnTypes(schemaTableName);
    } finally {
      await this.dropTableIfExists(schemaTableName).catch(() => undefined);
    }
  }

  protected async materializeInputSource(
    node: DataWorkflowNode,
    taskSourcePath: string | null,
    tableName: string
  ): Promise<string> {
    const source =
      typeof node.config.source === 'string'
        ? node.config.source
        : stringConfigValue(node.config.datasetId)
          ? 'dataset'
          : 'task';
    await this.dropTableIfExists(tableName);
    if (source === 'dataset') {
      const datasetRef = String(
        node.config.datasetId ?? node.config.name ?? node.config.alias ?? ''
      );
      const dataset = await this.findDatasetByReference(datasetRef);
      if (!dataset) {
        throw new Error(`Dataset source not found: ${datasetRef}`);
      }
      await this.runSql(
        `CREATE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${quoteIdentifier(
          dataset.tableName
        )}`
      );
      return tableName;
    }

    const filePath =
      source === 'file' && typeof node.config.filePath === 'string'
        ? normalizeSourcePath(node.config.filePath)
        : taskSourcePath;
    if (!filePath) {
      throw new Error('Data source file is required before running a cleaning task');
    }
    const relation = readRelationForPath(filePath, 'sourcePath');
    await this.runSql(`CREATE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${relation}`, {
      sourcePath: filePath,
    });
    return tableName;
  }

  protected async compileWorkflowNodeSql(
    node: DataWorkflowNode,
    outputRelation: string,
    relationByNode: Map<string, string>,
    edges: DataWorkflowEdge[],
    diagnostics: PrepDiagnostic[] = []
  ): Promise<string> {
    if (node.type === 'join') {
      return this.compileJoinSql(node, outputRelation, relationByNode, edges, diagnostics);
    }
    if (node.type === 'set_op') {
      return this.compileSetOpSql(node, outputRelation, relationByNode, edges);
    }
    const inputEdge = this.findIncomingEdge(node.id, edges, 'input');
    const inputRelation = inputEdge ? relationByNode.get(relationKeyForEdge(inputEdge)) : null;
    if (!inputRelation) {
      throw new Error(`Workflow node has no input: ${node.id}`);
    }
    const strategy = COMPILE_STRATEGIES[node.type as string];
    const input = quoteIdentifier(inputRelation);
    const output = quoteIdentifier(outputRelation);
    const columns = strategy?.needsColumns ? await this.getTableColumns(inputRelation) : [];
    const columnTypes = strategy?.needsColumns ? await this.getTableColumnTypes(inputRelation) : [];
    const columnTypeMap = Object.fromEntries(
      columnTypes.map((column) => [column.name, column.type])
    );
    if (!strategy) {
      throw new Error(`Unsupported workflow operator type: ${node.type}`);
    }
    let compileConfig = node.config;
    if (node.type === 'pivot') {
      const pivotConfig = parseOperatorConfig(PivotConfigSchema, node.config);
      const on: typeof pivotConfig.on = [];
      for (const axis of pivotConfig.on) {
        if (axis.values.length > 0) {
          on.push(axis);
          continue;
        }
        const field = quoteIdentifier(axis.field);
        const rows = await this.queryRows<{ value: string | null }>(
          `SELECT DISTINCT CAST(${field} AS VARCHAR) AS value FROM ${input} ORDER BY value LIMIT ${MAX_PIVOT_VALUES_PER_FIELD + 1}`
        );
        if (rows.length > MAX_PIVOT_VALUES_PER_FIELD) {
          throw new Error(
            `Pivot field "${axis.field}" has more than ${MAX_PIVOT_VALUES_PER_FIELD} distinct values`
          );
        }
        on.push({ ...axis, values: rows.map((row) => row.value) });
      }
      compileConfig = { ...pivotConfig, on, [RESOLVED_DYNAMIC_PIVOT_VALUES]: true };
    }
    if (node.type === 'unnest' && node.config.sourceKind === 'json') {
      const columnName = String(node.config.column ?? '');
      const jsonPath = String(node.config.path ?? '$');
      if (columnName) {
        const columnExpression =
          jsonPath === '$'
            ? quoteIdentifier(columnName)
            : `json_extract(${quoteIdentifier(columnName)}, ${literalToSql(jsonPath)})`;
        const invalidRows = await this.queryRows<{ bad: boolean }>(
          `SELECT ${columnExpression} IS NOT NULL AND TRY_CAST(${columnExpression} AS JSON) IS NULL AS bad FROM ${input} WHERE ${columnExpression} IS NOT NULL LIMIT 1`
        );
        if (invalidRows[0]?.bad) {
          throw new Error(
            `"${columnName}" is not valid JSON. Use standard JSON format: {"Key":"Value"} or {"Key":1}`
          );
        }
        const typeRows = await this.queryRows<{ t: string }>(
          `SELECT json_type(${columnExpression}) AS t FROM ${input} WHERE ${columnExpression} IS NOT NULL AND TRY_CAST(${columnExpression} AS JSON) IS NOT NULL LIMIT 1`
        );
        const jsonType = typeRows[0]?.t ?? '';
        const jsonKeys =
          jsonType === 'OBJECT'
            ? ((
                await this.queryRows<{ keys: string[] }>(
                  `SELECT json_keys(${columnExpression}) AS keys FROM ${input} WHERE ${columnExpression} IS NOT NULL AND TRY_CAST(${columnExpression} AS JSON) IS NOT NULL LIMIT 1`
                )
              )[0]?.keys ?? [])
            : [];
        compileConfig = { ...node.config, _jsonType: jsonType, _jsonKeys: jsonKeys };
      }
    }
    return strategy.compile(output, input, columns, compileConfig, columnTypeMap);
  }

  protected async compileSetOpSql(
    node: DataWorkflowNode,
    outputRelation: string,
    relationByNode: Map<string, string>,
    edges: DataWorkflowEdge[]
  ): Promise<string> {
    const leftRelation = relationByNode.get(
      relationKeyForEdge(this.findIncomingEdge(node.id, edges, 'left'))
    );
    const rightRelation = relationByNode.get(
      relationKeyForEdge(this.findIncomingEdge(node.id, edges, 'right'))
    );
    if (!leftRelation || !rightRelation) {
      throw new Error(`Set operation node requires left and right inputs: ${node.id}`);
    }
    const leftColumns = await this.getTableColumns(leftRelation);
    const rightColumns = await this.getTableColumns(rightRelation);
    const config = node.config;

    return compileSetOpSql(
      quoteIdentifier(outputRelation),
      quoteIdentifier(leftRelation),
      quoteIdentifier(rightRelation),
      config,
      leftColumns,
      rightColumns
    );
  }

  protected async compileJoinSql(
    node: DataWorkflowNode,
    outputRelation: string,
    relationByNode: Map<string, string>,
    edges: DataWorkflowEdge[],
    diagnostics: PrepDiagnostic[] = []
  ): Promise<string> {
    const leftRelation = relationByNode.get(
      relationKeyForEdge(this.findIncomingEdge(node.id, edges, 'left'))
    );
    const rightRelation = relationByNode.get(
      relationKeyForEdge(this.findIncomingEdge(node.id, edges, 'right'))
    );
    if (!leftRelation || !rightRelation) {
      throw new Error(`Join node requires left and right inputs: ${node.id}`);
    }
    const leftColumns = await this.getTableColumns(leftRelation);
    const rightColumns = await this.getTableColumns(rightRelation);
    const output = quoteIdentifier(outputRelation);
    const left = quoteIdentifier(leftRelation);
    const right = quoteIdentifier(rightRelation);
    const config = parseOperatorConfig(JoinConfigSchema, node.config);
    await this.collectJoinCardinalityDiagnostics(
      node,
      config,
      leftRelation,
      rightRelation,
      diagnostics
    );
    const joinType = config.joinType;
    if (joinType === 'semi' || joinType === 'anti') {
      const existsOperator = joinType === 'semi' ? 'EXISTS' : 'NOT EXISTS';
      const condition = compileJoinConditionList(config.conditions);
      return `
          CREATE TEMP TABLE ${output} AS
          SELECT l.*
          FROM ${left} l
          WHERE ${existsOperator} (
            SELECT 1 FROM ${right} r WHERE ${condition}
          )
        `;
    }
    if (joinType === 'asof') {
      return compileAsofJoinSql(output, left, right, leftColumns, rightColumns, config);
    }
    const condition =
      joinType === 'cross' ? '' : ` ON ${compileJoinConditionList(config.conditions)}`;
    const sqlJoinType = joinType === 'full' ? 'FULL OUTER' : joinType.toUpperCase();
    const projection = compileJoinProjection(
      config.keep,
      leftColumns,
      rightColumns,
      config.conflict,
      config.rightAlias
    );
    return `
        CREATE TEMP TABLE ${output} AS
        SELECT ${projection}
        FROM ${left} l
        ${sqlJoinType} JOIN ${right} r${condition}
      `;
  }

  private async collectJoinCardinalityDiagnostics(
    node: DataWorkflowNode,
    config: ReturnType<typeof JoinConfigSchema.parse>,
    leftRelation: string,
    rightRelation: string,
    diagnostics: PrepDiagnostic[]
  ): Promise<void> {
    const expectation = config.expect;
    if (!expectation || expectation === 'many_to_many') return;

    const leftKeys: string[] = [];
    const rightKeys: string[] = [];
    if (config.joinType === 'asof') {
      const asof = config.asof;
      if (asof?.leftTime) leftKeys.push(fieldNameOf(asof.leftTime));
      if (asof?.rightTime) rightKeys.push(fieldNameOf(asof.rightTime));
      for (const condition of asof?.by ?? []) {
        leftKeys.push(fieldNameOf(condition.left));
        rightKeys.push(fieldNameOf(condition.right));
      }
    } else {
      for (const condition of config.conditions ?? []) {
        leftKeys.push(fieldNameOf(condition.left));
        rightKeys.push(fieldNameOf(condition.right));
      }
    }

    const checks: Array<{ side: 'left' | 'right'; relation: string; keys: string[] }> = [];
    if (expectation === 'one_to_one' || expectation === 'one_to_many') {
      checks.push({ side: 'left', relation: leftRelation, keys: leftKeys });
    }
    if (expectation === 'one_to_one' || expectation === 'many_to_one') {
      checks.push({ side: 'right', relation: rightRelation, keys: rightKeys });
    }

    for (const check of checks) {
      if (!(await this.relationHasDuplicateJoinKeys(check.relation, check.keys))) continue;
      diagnostics.push({
        severity: 'warning',
        code: 'joinCardinalityMismatch',
        message: `Join expected ${expectation}, but the ${check.side} input has duplicate join keys`,
        line: 0,
        column: 0,
        params: {
          nodeId: node.id,
          expectation,
          side: check.side,
          keys: check.keys.join(', '),
        },
      });
    }
  }

  private async relationHasDuplicateJoinKeys(relation: string, keys: string[]): Promise<boolean> {
    const normalizedKeys = [...new Set(keys.filter(Boolean))];
    if (normalizedKeys.length === 0) {
      const rows = await this.queryRows<{ hasDuplicates: boolean }>(
        `SELECT COUNT(*) > 1 AS "hasDuplicates" FROM ${quoteIdentifier(relation)}`
      );
      return Boolean(rows[0]?.hasDuplicates);
    }
    const fields = normalizedKeys.map(quoteIdentifier);
    const rows = await this.queryRows<{ hasDuplicates: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM ${quoteIdentifier(relation)}
        WHERE ${fields.map((field) => `${field} IS NOT NULL`).join(' AND ')}
        GROUP BY ${fields.join(', ')}
        HAVING COUNT(*) > 1
        LIMIT 1
      ) AS "hasDuplicates"
    `);
    return Boolean(rows[0]?.hasDuplicates);
  }

  protected findIncomingNodeId(
    nodeId: string,
    edges: DataWorkflowEdge[],
    targetHandle: string
  ): string | null {
    return (
      edges.find(
        (edge) => edge.targetNodeId === nodeId && (edge.targetHandle ?? 'input') === targetHandle
      )?.sourceNodeId ?? null
    );
  }

  protected findIncomingEdge(
    nodeId: string,
    edges: DataWorkflowEdge[],
    targetHandle: string
  ): DataWorkflowEdge | undefined {
    return edges.find(
      (edge) => edge.targetNodeId === nodeId && (edge.targetHandle ?? 'input') === targetHandle
    );
  }
}

function relationKeyForEdge(edge: DataWorkflowEdge | undefined | null): string {
  return edge?.sourceHandle === 'reject'
    ? `${edge.sourceNodeId}#reject`
    : (edge?.sourceNodeId ?? '');
}

function fieldNameOf(value: string): string {
  return parseFieldRefExact(value)?.name ?? value.trim();
}
