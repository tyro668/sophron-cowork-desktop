import { BrowserWindow, ipcMain } from 'electron';
import type { DataWorkflowEdge, DataWorkflowNode } from '../../../renderer/types';
import type { PrepDiagnostic } from '../../../shared/prep-dsl/ast';
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
      return this.getTableColumns(cachedTable);
    }

    if (source === 'dataset') {
      const datasetRef = String(
        node.config.datasetId ?? node.config.name ?? node.config.alias ?? ''
      );
      const dataset = await this.findDatasetByReference(datasetRef);
      if (!dataset || !(await this.physicalTableExists(dataset.tableName))) {
        return [];
      }
      return this.getTableColumns(dataset.tableName);
    }

    const cachedTableName = tableNameFromId('workflow_source', node.id);
    if (await this.physicalTableExists(cachedTableName)) {
      return this.getTableColumns(cachedTableName);
    }

    const filePath =
      source === 'file' && typeof node.config.filePath === 'string'
        ? normalizeSourcePath(node.config.filePath)
        : taskSourcePath;
    if (!filePath) {
      return [];
    }

    const schemaTableName = tableNameFromId('workflow_schema', node.id);
    await this.dropTableIfExists(schemaTableName);
    try {
      const relation = readRelationForPath(filePath, 'sourcePath');
      await this.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(schemaTableName)} AS SELECT * FROM ${relation} LIMIT 0`,
        { sourcePath: filePath }
      );
      return this.getTableColumns(schemaTableName);
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
    diagnostics: PrepDiagnostic[]
  ): Promise<string> {
    if (node.type === 'join') {
      return this.compileJoinSql(node, outputRelation, relationByNode, edges);
    }
    if (node.type === 'set_op') {
      return this.compileSetOpSql(node, outputRelation, relationByNode, edges, diagnostics);
    }
    const inputId = this.findIncomingNodeId(node.id, edges, 'input');
    const inputRelation = inputId ? relationByNode.get(inputId) : null;
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
      return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input}`;
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
    edges: DataWorkflowEdge[],
    diagnostics: PrepDiagnostic[]
  ): Promise<string> {
    const leftNodeId = this.findIncomingNodeId(node.id, edges, 'left');
    const rightNodeId = this.findIncomingNodeId(node.id, edges, 'right');
    const leftRelation = leftNodeId ? relationByNode.get(leftNodeId) : null;
    const rightRelation = rightNodeId ? relationByNode.get(rightNodeId) : null;
    if (!leftRelation || !rightRelation) {
      throw new Error(`Set operation node requires left and right inputs: ${node.id}`);
    }
    const leftColumns = await this.getTableColumns(leftRelation);
    const rightColumns = await this.getTableColumns(rightRelation);
    const config = node.config;

    // 前置检查：列数不一致（仅对非 UNION BY NAME 场景）
    const isUnionByName =
      String(config.operation ?? 'union') === 'union' && config.match === 'by_name';
    if (!isUnionByName && leftColumns.length !== rightColumns.length) {
      diagnostics.push({
        severity: 'warning',
        message: `左右两表列数不一致（左表 ${leftColumns.length} 列，右表 ${rightColumns.length} 列），缺失列已自动填充 NULL`,
      });
    }

    // 前置检查：按位置匹配时列名不同
    if (config.match !== 'by_name') {
      const minLen = Math.min(leftColumns.length, rightColumns.length);
      const mismatches: string[] = [];
      for (let i = 0; i < minLen; i++) {
        if (leftColumns[i] !== rightColumns[i]) {
          mismatches.push(`第 ${i + 1} 列：左表「${leftColumns[i]}」≠ 右表「${rightColumns[i]}」`);
        }
      }
      if (mismatches.length > 0) {
        diagnostics.push({
          severity: 'warning',
          message: `左右两表按位置匹配，但列名不同：${mismatches.join('；')}`,
        });
      }
    }

    // 前置检查：类型兼容性
    const NUMERIC_TYPES = ['integer', 'float', 'decimal'];
    const TEMPORAL_TYPES = ['date', 'datetime'];
    const leftTypes = await this.getTableColumnTypes(leftRelation);
    const rightTypes = await this.getTableColumnTypes(rightRelation);
    const minTypeLen = Math.min(leftTypes.length, rightTypes.length);
    for (let i = 0; i < minTypeLen; i++) {
      const lt = leftTypes[i].type;
      const rt = rightTypes[i].type;
      if (lt === rt) continue;
      const bothNumeric = NUMERIC_TYPES.includes(lt) && NUMERIC_TYPES.includes(rt);
      const bothTemporal = TEMPORAL_TYPES.includes(lt) && TEMPORAL_TYPES.includes(rt);
      if (bothNumeric || bothTemporal) continue;
      if (lt === 'text' || rt === 'text') {
        diagnostics.push({
          severity: 'warning',
          message: `第 ${i + 1} 列类型不一致（左表「${leftColumns[i]}」: ${lt}，右表「${rightColumns[i]}」: ${rt}），可能导致数据转换异常`,
        });
      } else {
        diagnostics.push({
          severity: 'warning',
          message: `第 ${i + 1} 列类型不兼容（左表「${leftColumns[i]}」: ${lt}，右表「${rightColumns[i]}」: ${rt}），可能导致执行错误`,
        });
      }
    }

    const typeWarnings = diagnostics.filter(
      (d) => d.severity === 'warning' && d.message.includes('类型')
    );
    if (typeWarnings.length > 0) {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      if (!win) throw new Error('无法找到窗口来显示确认对话框');
      const channel = `operator-confirm:${Date.now()}`;
      win.webContents.send('data.operatorConfirm', {
        channel,
        title: '列类型不匹配',
        message: '左右两表的列类型不完全匹配，执行时可能出现数据转换异常或精度丢失。',
        detail: typeWarnings.map((d) => d.message).join('\n'),
        confirmLabel: '忽略警告，继续执行',
        cancelLabel: '取消执行',
      });
      const confirmed = await new Promise<boolean>((resolve) => {
        ipcMain.handleOnce(channel, (_event, result: boolean) => resolve(result));
      });
      if (!confirmed) {
        throw new Error('用户取消了集合操作执行：列类型不匹配');
      }
    }

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
    edges: DataWorkflowEdge[]
  ): Promise<string> {
    const leftNodeId = this.findIncomingNodeId(node.id, edges, 'left');
    const rightNodeId = this.findIncomingNodeId(node.id, edges, 'right');
    const leftRelation = leftNodeId ? relationByNode.get(leftNodeId) : null;
    const rightRelation = rightNodeId ? relationByNode.get(rightNodeId) : null;
    if (!leftRelation || !rightRelation) {
      throw new Error(`Join node requires left and right inputs: ${node.id}`);
    }
    const leftColumns = await this.getTableColumns(leftRelation);
    const rightColumns = await this.getTableColumns(rightRelation);
    const output = quoteIdentifier(outputRelation);
    const left = quoteIdentifier(leftRelation);
    const right = quoteIdentifier(rightRelation);
    const config = parseOperatorConfig(JoinConfigSchema, node.config);
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
}
