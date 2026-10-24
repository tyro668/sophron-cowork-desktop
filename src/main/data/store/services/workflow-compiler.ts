/** Compiles workflow nodes to SQL and resolves input-source schemas. */
import { withCsvReadPath } from '../csv-encoding';
import { buildSqlQuery, describeSqlQuery } from '../../operators/sql-query';
import { SqlQueryConfigSchema } from '../../../../shared/operator-schemas/sql-query';
import type {
  DataRawTable,
  DataWorkflowEdge,
  DataWorkflowNode,
} from '../../../../shared/contracts';
import {
  JoinConfigSchema,
  MAX_PIVOT_VALUES_PER_FIELD,
  PivotConfigSchema,
  parseOperatorConfig,
} from '../../../../shared/operator-schemas';
import type { WorkflowDiagnostic } from '../../../../shared/workflow-diagnostics';
import {
  quoteIdentifier,
  compileAsofJoinSql,
  compileJoinPredicate,
  compileJoinProjection,
  compileSetOpSql,
  literalToSql,
  RESOLVED_DYNAMIC_PIVOT_VALUES,
} from '../../operators';
import { parseFieldRefExact } from '../../../../shared/expression-syntax/fields';
import { getOperatorDefinition } from '../../../../shared/operators';
import { COMPILE_STRATEGIES } from '../../operators/strategy';
import { DataStoreContext } from '../data-store-context';
import { tableNameFromId } from '../data-store-records';
import { normalizeSourcePath, readRelationForPath } from '../input-source';
import { CacheRepository } from '../repositories/cache-repository';
import { RawTableRepository } from '../repositories/raw-table-repository';
import { stringConfigValue } from '../workflow-model';

export class WorkflowCompiler {
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly rawTables: RawTableRepository,
    private readonly caches: CacheRepository
  ) {}
  async resolveInputSourceColumns(
    node: DataWorkflowNode,
    pipelineSourcePath: string | null
  ): Promise<string[] | null> {
    const columns = await this.resolveInputSourceColumnTypes(node, pipelineSourcePath);
    return columns ? columns.map((column) => column.name) : null;
  }
  /**
   * Input columns with normalized types for plan-level schema validation.
   * Returns null when the node is not an enabled input.
   */
  async resolveInputSourceColumnTypes(
    node: DataWorkflowNode,
    pipelineSourcePath: string | null
  ): Promise<{ name: string; type?: string }[] | null> {
    if (node.type !== 'input' || node.config.disabled === true) {
      return null;
    }

    const source =
      typeof node.config.source === 'string'
        ? node.config.source
        : stringConfigValue(node.config.rawTableId)
          ? 'rawTable'
          : 'pipeline';
    const cachedTable = await this.caches.findWorkflowNodeCacheTable(node.pipelineId, node.id);
    if (cachedTable) {
      return this.ctx.getTableColumnTypes(cachedTable);
    }

    if (source === 'rawTable') {
      const rawTableRef = String(
        node.config.rawTableId ?? node.config.name ?? node.config.alias ?? ''
      );
      const rawTable = await this.rawTables.findRawTableByReference(rawTableRef);
      if (!rawTable || !(await this.ctx.physicalTableExists(rawTable.tableName))) {
        return null;
      }
      return this.ctx.getTableColumnTypes(rawTable.tableName);
    }

    const cachedTableName = tableNameFromId('workflow_source', node.id);
    if (await this.ctx.physicalTableExists(cachedTableName)) {
      return this.ctx.getTableColumnTypes(cachedTableName);
    }

    const filePath =
      source === 'file' && typeof node.config.filePath === 'string'
        ? normalizeSourcePath(node.config.filePath)
        : pipelineSourcePath;
    if (!filePath) {
      return null;
    }

    const schemaTableName = tableNameFromId('workflow_schema', node.id);
    await this.ctx.dropTableIfExists(schemaTableName);
    try {
      const relation = readRelationForPath(filePath, 'sourcePath');
      await withCsvReadPath(filePath, 'auto', (readPath) =>
        this.ctx.runSql(
          `CREATE TEMP TABLE ${quoteIdentifier(schemaTableName)} AS SELECT * FROM ${relation} LIMIT 0`,
          { sourcePath: readPath }
        )
      );
      return await this.ctx.getTableColumnTypes(schemaTableName);
    } finally {
      await this.ctx.dropTableIfExists(schemaTableName).catch(() => undefined);
    }
  }
  /** E_SOURCE_MEMBER_MISSING (raw 1:N design 4.5): fail instead of silently using stale data. */
  private async sourceMemberMissingMessage(rawTable: DataRawTable): Promise<string> {
    let sourceName = '';
    if (rawTable.sourceId) {
      const rows = await this.ctx.metaQueryRows<{ name: string }>(
        'SELECT name FROM data_raw_sources WHERE id = $id',
        { id: rawTable.sourceId }
      );
      sourceName = rows[0]?.name ? String(rows[0].name) : '';
    }
    const where = [sourceName, rawTable.memberKey].filter(Boolean).join(' / ');
    return (
      `E_SOURCE_MEMBER_MISSING: 原始表“${rawTable.name}”${where ? `（${where}）` : ''}在来源中已不存在。` +
      '原始表保留着上次导入的数据；请重新指定 Sheet / 文件、换成其他原始表，' +
      '或在输入节点开启“用上次数据继续”。'
    );
  }
  async materializeInputSource(
    node: DataWorkflowNode,
    pipelineSourcePath: string | null,
    tableName: string
  ): Promise<string> {
    const source =
      typeof node.config.source === 'string'
        ? node.config.source
        : stringConfigValue(node.config.rawTableId)
          ? 'rawTable'
          : 'pipeline';
    await this.ctx.dropTableIfExists(tableName);
    if (source === 'rawTable') {
      const rawTableRef = String(
        node.config.rawTableId ?? node.config.name ?? node.config.alias ?? ''
      );
      const rawTable = await this.rawTables.findRawTableByReference(rawTableRef);
      if (!rawTable) {
        throw new Error(
          `E_INPUT_TABLE_DELETED: 输入节点“${node.label || node.id}”引用的原始表已删除，请重新选择。`
        );
      }
      if (rawTable.memberStatus === 'missing' && node.config.allowMissingSourceMember !== true) {
        throw new Error(await this.sourceMemberMissingMessage(rawTable));
      }
      await this.ctx.runSql(
        `CREATE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${quoteIdentifier(
          rawTable.tableName
        )}`
      );
      return tableName;
    }

    const filePath =
      source === 'file' && typeof node.config.filePath === 'string'
        ? normalizeSourcePath(node.config.filePath)
        : pipelineSourcePath;
    if (!filePath) {
      throw new Error('Data source file is required before running a cleaning pipeline');
    }
    const relation = readRelationForPath(filePath, 'sourcePath');
    await withCsvReadPath(filePath, 'auto', (readPath) =>
      this.ctx.runSql(`CREATE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${relation}`, {
        sourcePath: readPath,
      })
    );
    return tableName;
  }
  async compileWorkflowNodeSql(
    node: DataWorkflowNode,
    outputRelation: string,
    relationByNode: Map<string, string>,
    edges: DataWorkflowEdge[],
    diagnostics: WorkflowDiagnostic[] = [],
    namedRelations: ReadonlyArray<{ alias: string; relation: string }> = []
  ): Promise<string> {
    const compileKind = getOperatorDefinition(node.type)?.compileKind;
    if (compileKind === 'join') {
      return this.compileJoinSql(node, outputRelation, relationByNode, edges, diagnostics);
    }
    if (compileKind === 'set_op') {
      return this.compileSetOpSql(node, outputRelation, relationByNode, edges);
    }
    const inputEdge = this.findIncomingEdge(node.id, edges, 'input');
    const inputRelation = inputEdge ? relationByNode.get(relationKeyForEdge(inputEdge)) : null;
    if (!inputRelation) {
      throw new Error(`Workflow node has no input: ${node.id}`);
    }
    if (compileKind === 'sql') {
      const { sql } = parseOperatorConfig(SqlQueryConfigSchema, node.config);
      const query = buildSqlQuery(
        sql,
        `SELECT * FROM ${quoteIdentifier(inputRelation)}`,
        namedRelations.map(({ alias, relation }) => ({
          alias,
          query: `SELECT * FROM ${quoteIdentifier(relation)}`,
        }))
      );
      await describeSqlQuery(this.ctx.connection!, query);
      return `CREATE TEMP TABLE ${quoteIdentifier(outputRelation)} AS ${query}`;
    }
    const strategy = compileKind === 'strategy' ? COMPILE_STRATEGIES[node.type] : undefined;
    if (!strategy) {
      throw new Error(`Unsupported workflow operator type: ${node.type}`);
    }
    const input = quoteIdentifier(inputRelation);
    const output = quoteIdentifier(outputRelation);
    const columns = strategy.needsColumns ? await this.ctx.getTableColumns(inputRelation) : [];
    const columnTypes = strategy.needsColumns
      ? await this.ctx.getTableColumnTypes(inputRelation)
      : [];
    const columnTypeMap = Object.fromEntries(
      columnTypes.map((column) => [column.name, column.type])
    );
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
        const rows = await this.ctx.queryRows<{ value: string | null }>(
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
      const columnName = String(node.config.field ?? '');
      const jsonPath = String(node.config.path ?? '$');
      if (columnName) {
        const columnExpression =
          jsonPath === '$'
            ? quoteIdentifier(columnName)
            : `json_extract(${quoteIdentifier(columnName)}, ${literalToSql(jsonPath)})`;
        const invalidRows = await this.ctx.queryRows<{ bad: boolean }>(
          `SELECT ${columnExpression} IS NOT NULL AND TRY_CAST(${columnExpression} AS JSON) IS NULL AS bad FROM ${input} WHERE ${columnExpression} IS NOT NULL LIMIT 1`
        );
        if (invalidRows[0]?.bad) {
          throw new Error(
            `"${columnName}" is not valid JSON. Use standard JSON format: {"Key":"Value"} or {"Key":1}`
          );
        }
        const typeRows = await this.ctx.queryRows<{ t: string }>(
          `SELECT json_type(${columnExpression}) AS t FROM ${input} WHERE ${columnExpression} IS NOT NULL AND TRY_CAST(${columnExpression} AS JSON) IS NOT NULL LIMIT 1`
        );
        const jsonType = typeRows[0]?.t ?? '';
        const jsonKeys =
          jsonType === 'OBJECT'
            ? ((
                await this.ctx.queryRows<{ keys: string[] }>(
                  `SELECT json_keys(${columnExpression}) AS keys FROM ${input} WHERE ${columnExpression} IS NOT NULL AND TRY_CAST(${columnExpression} AS JSON) IS NOT NULL LIMIT 1`
                )
              )[0]?.keys ?? [])
            : [];
        compileConfig = { ...node.config, _jsonType: jsonType, _jsonKeys: jsonKeys };
      }
    }
    return strategy.compile(output, input, columns, compileConfig, columnTypeMap);
  }
  private async compileSetOpSql(
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
    const leftColumns = await this.ctx.getTableColumns(leftRelation);
    const rightColumns = await this.ctx.getTableColumns(rightRelation);
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
  private async compileJoinSql(
    node: DataWorkflowNode,
    outputRelation: string,
    relationByNode: Map<string, string>,
    edges: DataWorkflowEdge[],
    diagnostics: WorkflowDiagnostic[] = []
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
    const leftColumns = await this.ctx.getTableColumns(leftRelation);
    const rightColumns = await this.ctx.getTableColumns(rightRelation);
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
      const condition = compileJoinPredicate(
        { ...config, rightInput: String(node.config.rightInput ?? '') },
        leftColumns,
        rightColumns
      );
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
      joinType === 'cross'
        ? ''
        : ` ON ${compileJoinPredicate({ ...config, rightInput: String(node.config.rightInput ?? '') }, leftColumns, rightColumns)}`;
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
    diagnostics: WorkflowDiagnostic[]
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
      const rows = await this.ctx.queryRows<{ hasDuplicates: boolean }>(
        `SELECT COUNT(*) > 1 AS "hasDuplicates" FROM ${quoteIdentifier(relation)}`
      );
      return Boolean(rows[0]?.hasDuplicates);
    }
    const fields = normalizedKeys.map(quoteIdentifier);
    const rows = await this.ctx.queryRows<{ hasDuplicates: boolean }>(`
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
  findIncomingNodeId(
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
  findIncomingEdge(
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
