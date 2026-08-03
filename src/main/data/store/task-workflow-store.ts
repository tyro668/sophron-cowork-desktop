import { v4 as uuidv4 } from 'uuid';
import type {
  DataCleaningTask,
  DataColumnTypeInfo,
  DataCreateTaskInput,
  DataInputTablePreview,
  DataPreviewWorkflowNodeInput,
  DataRunTaskInput,
  DataTaskStatus,
  DataTaskWorkflow,
  DataUpdateTaskInput,
  DataWorkflowEdge,
  DataWorkflowNode,
  DataWorkflowNodeInput,
  DataWorkflowSaveInput,
} from '../../../renderer/types';
import type { PrepDiagnostic } from '../../../shared/prep-dsl/ast';
import { isRecord, quoteIdentifier, toNumber } from '../operators';
import {
  DataOutputCommitRow,
  DataTaskRow,
  isDuckDbTransactionStateError,
  mapTaskRow,
  tableNameFromId,
} from './data-store-records';
import {
  normalizePreviewLimit,
  normalizePreviewOffset,
  normalizePreviewRow,
  normalizeSourcePath,
  readRelationForPath,
} from './input-source';
import { WorkflowCompiler } from './workflow-compiler';
import {
  DataWorkflowEdgeRow,
  DataWorkflowNodeCacheRow,
  DataWorkflowNodeRow,
  RuntimeWorkflow,
  WORKFLOW_TEMP_CACHE_TTL_MS,
  WorkflowCacheScope,
  WorkflowOutputMode,
  findWorkflowTerminalNodeId,
  getOutputTableName,
  mapWorkflowEdgeRow,
  mapWorkflowNodeRow,
  normalizeRuntimeWorkflowInput,
  normalizeScopedWorkflowInputs,
  stringConfigValue,
  toPersistentCreateTableSql,
  workflowRequiresTaskSource,
} from './workflow-model';

export class TaskWorkflowStore extends WorkflowCompiler {
  private outputCommitRecoveryPromise: Promise<void> | null = null;

  protected override async ensureReady(): Promise<void> {
    await super.ensureReady();
    if (!this.outputCommitRecoveryPromise) {
      this.outputCommitRecoveryPromise = this.recoverPendingOutputCommits();
    }
    await this.outputCommitRecoveryPromise;
  }

  async createTask(input: DataCreateTaskInput): Promise<DataCleaningTask> {
    await this.ensureMetadataReady();
    const name = input.name.trim();
    if (!name) {
      throw new Error('Task name is required');
    }
    const sourcePath = input.sourcePath ? normalizeSourcePath(input.sourcePath) : null;
    const sourceDatasetId = input.sourceDatasetId
      ? (await this.requireInputDataset(input.sourceDatasetId)).id
      : null;
    const outputTable = input.outputTableId
      ? (await this.requireOutputTable(input.outputTableId)).tableName
      : null;
    const now = this.now();
    const id = uuidv4();
    const status: DataTaskStatus = sourcePath || sourceDatasetId ? 'pending' : 'draft';
    await this.metaRunSql(
      `
          INSERT INTO data_cleaning_tasks (
            id, name, status, node_count, source_path, source_dataset_id, output_table,
            row_count, column_count, error, scheduled_for, created_at, updated_at, last_run_at
          )
          VALUES (
            $id, $name, $status, $nodeCount, $sourcePath, $sourceDatasetId, $outputTable,
            NULL, NULL, NULL, NULL, $createdAt, $updatedAt, NULL
          )
        `,
      {
        id,
        name,
        status,
        nodeCount: 0,
        sourcePath,
        sourceDatasetId,
        outputTable,
        createdAt: now,
        updatedAt: now,
      }
    );
    return this.requireTask(id);
  }

  async updateTask(input: DataUpdateTaskInput): Promise<DataCleaningTask> {
    await this.ensureMetadataReady();
    const task = await this.requireTask(input.id);
    const name = input.name?.trim();
    if (name !== undefined && !name) {
      throw new Error('Task name is required');
    }
    const updatedAt = this.now();
    await this.metaRunSql(
      `
          UPDATE data_cleaning_tasks
          SET name = $name,
              updated_at = $updatedAt
          WHERE id = $id
        `,
      {
        id: task.id,
        name: name ?? task.name,
        updatedAt,
      }
    );
    return this.requireTask(task.id);
  }

  async runTask(id: string, input: DataRunTaskInput = {}): Promise<DataCleaningTask> {
    return (await this.runTaskWithDiagnostics(id, input)).task;
  }

  async runTaskWithDiagnostics(
    id: string,
    input: DataRunTaskInput = {}
  ): Promise<{ task: DataCleaningTask; diagnostics: PrepDiagnostic[] }> {
    const recordTaskState = input.outputMode !== 'temporary';
    return this.runExclusive(() => this.runTaskUnsafe(id, input, recordTaskState), `runTask:${id}`);
  }

  async validateTaskWorkflow(
    id: string,
    input: DataRunTaskInput
  ): Promise<{ task: DataCleaningTask; diagnostics: PrepDiagnostic[] }> {
    return this.runExclusive(
      () => this.runTaskUnsafe(id, { ...input, outputMode: 'temporary' }, false),
      `validateTaskWorkflow:${id}`
    );
  }

  async commitValidatedTaskOutput(
    id: string,
    temporaryTask: DataCleaningTask,
    workflow: DataWorkflowSaveInput
  ): Promise<DataCleaningTask> {
    return this.runExclusive(async () => {
      await this.ensureReady();
      const task = await this.requireTask(id);
      const temporaryTable = temporaryTask.outputTable;
      if (!temporaryTable || !(await this.physicalTableExists(temporaryTable))) {
        throw new Error('Validated temporary task output is no longer available');
      }
      const runtimeWorkflow = normalizeRuntimeWorkflowInput(id, workflow, this.now());
      const outputNode = runtimeWorkflow.nodes.find((node) => node.type === 'output');
      const target = await this.resolveWorkflowOutputTarget(
        outputNode,
        task.outputTable || tableNameFromId('clean_task', task.id)
      );
      const rowCount = await this.countRows(temporaryTable);
      const columnCount = (await this.getTableColumns(temporaryTable)).length;
      const sourceDatasetId =
        (await this.findWorkflowSourceDatasetId(runtimeWorkflow.nodes)) ?? task.sourceDatasetId;
      const completedAt = this.now();
      const commitId = uuidv4();
      const backupTable = tableNameFromId('output_backup', commitId);
      const targetExisted = await this.physicalTableExists(target.tableName);
      await this.metaRunSql(
        `INSERT INTO data_output_commits (
           id, task_id, temporary_table, target_table, backup_table, target_existed,
           state, intended_metadata_json, error, created_at, updated_at
         ) VALUES (
           $id, $taskId, $temporaryTable, $targetTable, $backupTable, $targetExisted,
           'prepared', $intendedMetadataJson, NULL, $createdAt, $updatedAt
         )`,
        {
          id: commitId,
          taskId: id,
          temporaryTable,
          targetTable: target.tableName,
          backupTable,
          targetExisted: targetExisted ? 1 : 0,
          intendedMetadataJson: JSON.stringify({
            taskName: task.name,
            sourcePath: temporaryTask.sourcePath,
            sourceDatasetId,
            outputDatasetId: target.outputDatasetId ?? null,
            rowCount,
            columnCount,
            nodeCount: runtimeWorkflow.nodes.length,
            completedAt,
          }),
          createdAt: completedAt,
          updatedAt: completedAt,
        }
      );

      let physicalCommitted = false;
      let metadataTransactionStarted = false;
      try {
        await this.runSql('BEGIN TRANSACTION');
        if (targetExisted) {
          await this.dropTableIfExists(backupTable);
          await this.runSql(
            `ALTER TABLE ${quoteIdentifier(target.tableName)} RENAME TO ${quoteIdentifier(backupTable)}`
          );
        }
        await this.runSql(
          `CREATE TABLE ${quoteIdentifier(target.tableName)} AS SELECT * FROM ${quoteIdentifier(temporaryTable)}`
        );
        await this.runSql('COMMIT');
        physicalCommitted = true;
        await this.updateOutputCommitState(commitId, 'data_committed');

        await this.metaRunSql('BEGIN TRANSACTION');
        metadataTransactionStarted = true;
        await this.upsertDatasetForTaskOutput(
          task.name,
          temporaryTask.sourcePath,
          target.tableName,
          rowCount,
          columnCount,
          target.outputDatasetId
        );
        await this.metaRunSql(
          `
            UPDATE data_cleaning_tasks
            SET status = 'completed',
                node_count = $nodeCount,
                source_path = $sourcePath,
                source_dataset_id = $sourceDatasetId,
                output_table = $outputTable,
                row_count = $rowCount,
                column_count = $columnCount,
                last_run_at = $lastRunAt,
                updated_at = $updatedAt,
                error = NULL
            WHERE id = $id
          `,
          {
            id,
            nodeCount: runtimeWorkflow.nodes.length,
            sourcePath: temporaryTask.sourcePath,
            sourceDatasetId,
            outputTable: target.tableName,
            rowCount,
            columnCount,
            lastRunAt: completedAt,
            updatedAt: completedAt,
          }
        );
        await this.updateOutputCommitState(commitId, 'metadata_committed');
        await this.metaRunSql('COMMIT');
        metadataTransactionStarted = false;
      } catch (error) {
        if (metadataTransactionStarted) {
          await this.metaRunSql('ROLLBACK').catch(() => undefined);
        }
        if (physicalCommitted) {
          await this.restoreOutputCommit({
            targetTable: target.tableName,
            backupTable,
            targetExisted,
          }).catch(() => undefined);
        } else {
          await this.runSql('ROLLBACK').catch(() => undefined);
        }
        await this.updateOutputCommitState(
          commitId,
          'failed',
          error instanceof Error ? error.message : String(error)
        ).catch(() => undefined);
        throw error;
      }

      await this.dropTableIfExists(backupTable).catch(() => undefined);
      await this.dropTableIfExists(temporaryTable).catch(() => undefined);
      await this.updateOutputCommitState(commitId, 'completed').catch(() => undefined);
      return this.requireTask(id);
    }, `commitValidatedTaskOutput:${id}`);
  }

  private async updateOutputCommitState(id: string, state: string, error: string | null = null) {
    await this.metaRunSql(
      `UPDATE data_output_commits
       SET state = $state, error = $error, updated_at = $updatedAt
       WHERE id = $id`,
      { id, state, error, updatedAt: this.now() }
    );
  }

  private async restoreOutputCommit(input: {
    targetTable: string;
    backupTable: string;
    targetExisted: boolean;
  }): Promise<void> {
    await this.runSql('BEGIN TRANSACTION');
    try {
      if (input.targetExisted) {
        if (await this.physicalTableExists(input.backupTable)) {
          await this.dropTableIfExists(input.targetTable);
          await this.runSql(
            `ALTER TABLE ${quoteIdentifier(input.backupTable)} RENAME TO ${quoteIdentifier(input.targetTable)}`
          );
        }
      } else {
        await this.dropTableIfExists(input.targetTable);
      }
      await this.runSql('COMMIT');
    } catch (error) {
      await this.runSql('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  private async recoverPendingOutputCommits(): Promise<void> {
    const rows = await this.metaQueryRows<DataOutputCommitRow>(
      `SELECT * FROM data_output_commits WHERE state NOT IN ('completed', 'failed')`
    );
    for (const row of rows) {
      const targetTable = String(row.target_table);
      const backupTable = String(row.backup_table);
      const targetExisted = toNumber(row.target_existed) === 1;
      if (row.state === 'metadata_committed') {
        await this.dropTableIfExists(backupTable).catch(() => undefined);
        await this.dropTableIfExists(String(row.temporary_table)).catch(() => undefined);
        await this.updateOutputCommitState(String(row.id), 'completed');
        continue;
      }
      await this.restoreOutputCommit({ targetTable, backupTable, targetExisted });
      await this.updateOutputCommitState(
        String(row.id),
        'failed',
        'Recovered an interrupted output commit by restoring the previous output table'
      );
    }
  }

  async discardTemporaryTaskOutput(task: DataCleaningTask): Promise<void> {
    const tableName = task.outputTable;
    if (!tableName || !tableName.startsWith('temp_task_')) return;
    await this.runExclusive(() => this.dropTableIfExists(tableName), `discardTemporary:${task.id}`);
  }

  async cleanupTemporaryTaskResources(taskId: string): Promise<void> {
    await this.runExclusive(async () => {
      await this.ensureReady();
      const rows = await this.metaQueryRows<DataWorkflowNodeCacheRow>(
        `
            SELECT *
            FROM data_workflow_node_caches
            WHERE task_id = $taskId
              AND cache_scope = 'temporary'
          `,
        { taskId }
      );
      for (const tableName of new Set(rows.map((row) => String(row.table_name)))) {
        await this.dropTableIfExists(tableName).catch(() => undefined);
      }
      await this.metaRunSql(
        `
            DELETE FROM data_workflow_node_caches
            WHERE task_id = $taskId
              AND cache_scope = 'temporary'
          `,
        { taskId }
      );
    }, `cleanupTemporaryTaskResources:${taskId}`);
  }

  protected async runTaskUnsafe(
    id: string,
    input: DataRunTaskInput,
    recordTaskState: boolean
  ): Promise<{ task: DataCleaningTask; diagnostics: PrepDiagnostic[] }> {
    const diagnostics: PrepDiagnostic[] = [];
    await this.ensureReady();
    await this.cleanupExpiredWorkflowNodeCaches();
    const task = await this.requireTask(id);
    const sourcePath = input.sourcePath ? normalizeSourcePath(input.sourcePath) : task.sourcePath;
    const startedAt = this.now();
    const runtimeWorkflow = input.workflow
      ? normalizeRuntimeWorkflowInput(task.id, input.workflow, startedAt)
      : await this.getRuntimeWorkflow(task.id);
    const outputMode: WorkflowOutputMode =
      input.outputMode === 'temporary' ? 'temporary' : 'persisted';
    if (!sourcePath && workflowRequiresTaskSource(runtimeWorkflow.nodes)) {
      const message = 'Data source file is required before running a cleaning task';
      if (recordTaskState) {
        await this.metaRunSql(
          `
            UPDATE data_cleaning_tasks
            SET status = 'failed',
                error = $error,
                updated_at = $updatedAt,
                last_run_at = $lastRunAt
            WHERE id = $id
          `,
          { id, error: message, updatedAt: startedAt, lastRunAt: startedAt }
        );
      }
      throw new Error(message);
    }
    if (recordTaskState) {
      await this.metaRunSql(
        `
          UPDATE data_cleaning_tasks
          SET status = 'running',
              source_path = $sourcePath,
              error = NULL,
              updated_at = $updatedAt
          WHERE id = $id
        `,
        { id, sourcePath, updatedAt: startedAt }
      );
    }

    try {
      const result = await this.cleanSourceIntoTaskOutput(
        task,
        sourcePath,
        runtimeWorkflow,
        outputMode,
        diagnostics
      );
      if (!recordTaskState) {
        return {
          task: {
            ...task,
            status: 'completed',
            sourcePath,
            sourceDatasetId: result.sourceDatasetId,
            outputTable: result.outputTable,
            rowCount: result.rowCount,
            columnCount: result.columnCount,
            error: null,
          },
          diagnostics,
        };
      }
      const completedAt = this.now();
      const nodeCount = await this.countWorkflowNodes(id);
      await this.metaRunSql(
        `
            UPDATE data_cleaning_tasks
            SET status = 'completed',
                node_count = $nodeCount,
                source_path = $sourcePath,
                source_dataset_id = $sourceDatasetId,
                output_table = $outputTable,
                row_count = $rowCount,
                column_count = $columnCount,
                last_run_at = $lastRunAt,
                updated_at = $updatedAt,
                error = NULL
            WHERE id = $id
          `,
        {
          id,
          nodeCount,
          sourcePath,
          sourceDatasetId: result.sourceDatasetId,
          outputTable: result.outputTable,
          rowCount: result.rowCount,
          columnCount: result.columnCount,
          lastRunAt: completedAt,
          updatedAt: completedAt,
        }
      );
      return { task: await this.requireTask(id), diagnostics };
    } catch (error) {
      const failedAt = this.now();
      const message = error instanceof Error ? error.message : String(error);
      if (isDuckDbTransactionStateError(message)) {
        await this.recoverDuckDbTransactionState();
      }
      if (recordTaskState) {
        await this.metaRunSql(
          `
            UPDATE data_cleaning_tasks
            SET status = 'failed',
                error = $error,
                updated_at = $updatedAt,
                last_run_at = $lastRunAt
            WHERE id = $id
          `,
          { id, error: message, updatedAt: failedAt, lastRunAt: failedAt }
        );
      }
      throw error;
    }
  }

  async previewWorkflowNode(input: DataPreviewWorkflowNodeInput): Promise<DataInputTablePreview> {
    await this.ensureMetadataReady();
    const task = await this.requireTask(input.taskId);
    await this.ensureReady();
    await this.cleanupExpiredWorkflowNodeCaches();
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    const nodeConfig = input.nodeConfig ?? {};
    const tableName = await this.resolveWorkflowNodePreviewTable(task, {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    });

    if (!tableName || !(await this.physicalTableExists(tableName))) {
      return {
        columns: [],
        columnTypes: [],
        rows: [],
        fileCount: 0,
        limit,
        offset,
        totalRows: 0,
      };
    }

    const quotedTableName = quoteIdentifier(tableName);
    const countRows = await this.queryRows<{ count: number | string }>(
      `SELECT count(*) AS count FROM ${quotedTableName}`
    );
    const rows = await this.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${quotedTableName} LIMIT ${limit} OFFSET ${offset}`
    );
    return {
      columns: await this.getTableColumns(tableName),
      columnTypes: await this.getTableColumnTypes(tableName),
      rows: rows.map(normalizePreviewRow),
      fileCount: 1,
      limit,
      offset,
      totalRows: toNumber(countRows[0]?.count),
    };
  }

  async getWorkflowNodeColumns(input: DataPreviewWorkflowNodeInput): Promise<string[]> {
    await this.ensureMetadataReady();
    const task = await this.requireTask(input.taskId);
    await this.ensureReady();
    await this.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };

    const inputSourceColumns = await this.resolveInputSourceColumns(node, task.sourcePath);
    if (inputSourceColumns) {
      return inputSourceColumns;
    }

    const tableName = await this.resolveWorkflowNodePreviewTable(task, node);

    if (!tableName || !(await this.physicalTableExists(tableName))) {
      return [];
    }

    return this.getTableColumns(tableName);
  }

  async getWorkflowNodeColumnTypes(
    input: DataPreviewWorkflowNodeInput
  ): Promise<DataColumnTypeInfo[]> {
    await this.ensureMetadataReady();
    const task = await this.requireTask(input.taskId);
    await this.ensureReady();
    await this.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };

    const tableName = await this.resolveWorkflowNodePreviewTable(task, node);
    if (!tableName || !(await this.physicalTableExists(tableName))) {
      return [];
    }

    return this.getTableColumnTypes(tableName);
  }

  async getWorkflowNodeColumnValues(
    input: DataPreviewWorkflowNodeInput & { column: string }
  ): Promise<string[]> {
    await this.ensureMetadataReady();
    const task = await this.requireTask(input.taskId);
    await this.ensureReady();
    await this.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };

    let tableName = await this.resolveWorkflowNodePreviewTable(task, node);
    if (!tableName || !(await this.physicalTableExists(tableName))) {
      // 缓存表不存在，尝试从源文件加载数据创建临时表
      if (node.type !== 'input_source' || node.config.disabled === true) {
        return [];
      }
      const source =
        typeof node.config.source === 'string'
          ? node.config.source
          : stringConfigValue(node.config.datasetId)
            ? 'dataset'
            : 'task';
      if (source === 'dataset') {
        return [];
      }
      const filePath =
        source === 'file' && typeof node.config.filePath === 'string'
          ? normalizeSourcePath(node.config.filePath)
          : task.sourcePath;
      if (!filePath) {
        return [];
      }
      tableName = tableNameFromId('workflow_preview_values', node.id);
      await this.dropTableIfExists(tableName);
      const relation = readRelationForPath(filePath, 'sourcePath');
      await this.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${relation}`,
        { sourcePath: filePath }
      );
    }

    const colName = input.column.replace(/^\[|\]$/g, '');
    if (tableName && !(await this.physicalTableExists(tableName))) {
      return [];
    }
    const quotedCol = quoteIdentifier(colName);
    const quotedTable = quoteIdentifier(tableName);
    const rows = await this.queryRows<{ val: string }>(
      `SELECT DISTINCT ${quotedCol} AS val FROM ${quotedTable} WHERE ${quotedCol} IS NOT NULL ORDER BY ${quotedCol} LIMIT 100`,
      {}
    );
    return rows.map((row) => (row.val === null ? '' : String(row.val))).filter((v) => v !== '');
  }

  async getWorkflowNodeRowCount(input: DataPreviewWorkflowNodeInput): Promise<number> {
    await this.ensureMetadataReady();
    const task = await this.requireTask(input.taskId);
    await this.ensureReady();
    await this.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };
    const tableName = await this.resolveWorkflowNodePreviewTable(task, node);
    if (!tableName || !(await this.physicalTableExists(tableName))) {
      return 0;
    }
    const quotedTable = quoteIdentifier(tableName);
    const rows = await this.queryRows<{ cnt: number }>(
      `SELECT count(*) AS cnt FROM ${quotedTable}`,
      {}
    );
    return rows[0]?.cnt ?? 0;
  }

  async deleteTask(id: string): Promise<boolean> {
    await this.ensureMetadataReady();
    const task = await this.getTask(id);
    if (!task) {
      return false;
    }
    if (task.outputTable) {
      await this.ensureReady();
      await this.dropTableIfExists(task.outputTable);
      await this.metaRunSql('DELETE FROM data_datasets WHERE table_name = $tableName', {
        tableName: task.outputTable,
      });
    }
    await this.deleteWorkflowNodeCachesForTask(id);
    await this.metaRunSql('DELETE FROM data_workflow_edges WHERE task_id = $id', { id });
    await this.metaRunSql('DELETE FROM data_workflow_nodes WHERE task_id = $id', { id });
    await this.metaRunSql('DELETE FROM data_cleaning_tasks WHERE id = $id', { id });
    return true;
  }

  async deleteTaskMetadataOnly(id: string): Promise<boolean> {
    await this.ensureMetadataReady();
    const task = await this.getTask(id);
    if (!task) return false;
    await this.deleteWorkflowNodeCachesForTask(id);
    await this.metaRunSql('DELETE FROM data_workflow_edges WHERE task_id = $id', { id });
    await this.metaRunSql('DELETE FROM data_workflow_nodes WHERE task_id = $id', { id });
    await this.metaRunSql('DELETE FROM data_cleaning_tasks WHERE id = $id', { id });
    return true;
  }

  async getTaskWorkflow(id: string): Promise<DataTaskWorkflow> {
    await this.ensureMetadataReady();
    await this.requireTask(id);
    const nodes = await this.getWorkflowNodes(id);
    const edges = await this.getWorkflowEdges(id);
    return { task: await this.requireTask(id), nodes, edges };
  }

  async saveTaskWorkflow(id: string, input: DataWorkflowSaveInput): Promise<DataTaskWorkflow> {
    await this.ensureMetadataReady();
    await this.requireTask(id);
    const updatedAt = this.now();
    const scopedWorkflow = normalizeScopedWorkflowInputs(id, input);
    let nodes = scopedWorkflow.nodes;
    const edges = scopedWorkflow.edges;

    await this.metaRunSql('BEGIN TRANSACTION');
    try {
      nodes = await this.prepareWorkflowOutputNodesForSave(nodes, updatedAt);
      await this.metaRunSql('DELETE FROM data_workflow_edges WHERE task_id = $taskId', {
        taskId: id,
      });
      await this.metaRunSql('DELETE FROM data_workflow_nodes WHERE task_id = $taskId', {
        taskId: id,
      });
      for (const [index, node] of nodes.entries()) {
        await this.metaRunSql(
          `
              INSERT INTO data_workflow_nodes (
                id, task_id, node_key, label, ordinal, operator_type, x, y,
                config_json, created_at, updated_at
              )
              VALUES (
                $id, $taskId, $nodeKey, $label, $ordinal, $operatorType, $x, $y,
                $configJson, $createdAt, $updatedAt
              )
            `,
          {
            id: node.id,
            taskId: id,
            nodeKey: node.id,
            label: node.label,
            ordinal: index + 1,
            operatorType: node.type,
            x: node.x,
            y: node.y,
            configJson: JSON.stringify(node.config ?? {}),
            createdAt: updatedAt,
            updatedAt,
          }
        );
      }
      for (const edge of edges) {
        await this.metaRunSql(
          `
              INSERT INTO data_workflow_edges (
                id, task_id, source_node_id, target_node_id, source_handle, target_handle, created_at
              )
              VALUES (
                $id, $taskId, $sourceNodeId, $targetNodeId, $sourceHandle, $targetHandle, $createdAt
              )
            `,
          {
            id: edge.id,
            taskId: id,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
            sourceHandle: edge.sourceHandle ?? null,
            targetHandle: edge.targetHandle ?? null,
            createdAt: updatedAt,
          }
        );
      }
      await this.metaRunSql(
        `
            UPDATE data_cleaning_tasks
            SET node_count = $nodeCount,
                updated_at = $updatedAt
            WHERE id = $taskId
          `,
        { taskId: id, nodeCount: nodes.length, updatedAt }
      );
      await this.metaRunSql('COMMIT');
    } catch (error) {
      await this.metaRunSql('ROLLBACK').catch(() => undefined);
      throw error;
    }

    return this.getTaskWorkflow(id);
  }

  async getTaskRecord(id: string): Promise<DataCleaningTask | null> {
    await this.ensureMetadataReady();
    return this.getTask(id);
  }

  protected async prepareWorkflowOutputNodesForSave(
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
          ? await this.updateAutoOutputTableMetadata(selectedOutputDatasetId, outputName, updatedAt)
          : await this.createOutputTableMetadata(outputName, updatedAt);
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

      if (selectedOutputDatasetId) {
        const outputTable = await this.requireOutputTable(selectedOutputDatasetId);
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

  protected async cleanSourceIntoTaskOutput(
    task: DataCleaningTask,
    sourcePath: string | null,
    workflow: RuntimeWorkflow,
    outputMode: WorkflowOutputMode,
    diagnostics: PrepDiagnostic[]
  ): Promise<{
    outputTable: string;
    rowCount: number;
    columnCount: number;
    sourceDatasetId: string | null;
  }> {
    if (workflow.nodes.length > 0) {
      return this.runWorkflowIntoTaskOutput(
        task,
        sourcePath,
        workflow.nodes,
        workflow.edges,
        outputMode,
        diagnostics
      );
    }

    if (!sourcePath) {
      throw new Error('Data source file is required before running a cleaning task');
    }

    const outputTable = task.outputTable || tableNameFromId('clean_task', task.id);
    const rawTable = tableNameFromId('raw_task', uuidv4());
    const relation = readRelationForPath(sourcePath, 'sourcePath');
    await this.dropTableIfExists(rawTable);
    await this.dropTableIfExists(outputTable);
    try {
      await this.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(rawTable)} AS SELECT * FROM ${relation}`,
        { sourcePath }
      );
      const columns = await this.getTableColumns(rawTable);
      const nonEmptyFilter =
        columns.length > 0
          ? columns.map((column) => `${quoteIdentifier(column)} IS NOT NULL`).join(' OR ')
          : 'true';
      await this.runSql(
        `
            CREATE TABLE ${quoteIdentifier(outputTable)} AS
            SELECT DISTINCT *
            FROM ${quoteIdentifier(rawTable)}
            WHERE ${nonEmptyFilter}
          `
      );
      const rowCount = await this.countRows(outputTable);
      const columnCount = (await this.getTableColumns(outputTable)).length;
      const dataset = await this.upsertDatasetForTaskOutput(
        task.name,
        sourcePath,
        outputTable,
        rowCount,
        columnCount
      );
      return {
        outputTable,
        rowCount,
        columnCount,
        sourceDatasetId: dataset?.id ?? task.sourceDatasetId,
      };
    } finally {
      await this.dropTableIfExists(rawTable);
    }
  }

  protected async runWorkflowIntoTaskOutput(
    task: DataCleaningTask,
    sourcePath: string | null,
    nodes: DataWorkflowNode[],
    edges: DataWorkflowEdge[],
    outputMode: WorkflowOutputMode,
    diagnostics: PrepDiagnostic[]
  ): Promise<{
    outputTable: string;
    rowCount: number;
    columnCount: number;
    sourceDatasetId: string | null;
  }> {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const outputNode = nodes.find((node) => node.type === 'output');
    const outputTarget: { tableName: string; outputDatasetId?: string } =
      outputMode === 'temporary'
        ? { tableName: tableNameFromId('temp_task', `${task.id}_${uuidv4()}`) }
        : await this.resolveWorkflowOutputTarget(
            outputNode,
            task.outputTable || tableNameFromId('clean_task', task.id)
          );
    const outputTable = outputTarget.tableName;
    const relationByNode = new Map<string, string>();
    const visitingNodeIds = new Set<string>();
    const cacheScope: WorkflowCacheScope = outputMode === 'temporary' ? 'temporary' : 'permanent';
    const cacheRunId = uuidv4();
    const cacheExpiresAt =
      cacheScope === 'temporary' ? this.now() + WORKFLOW_TEMP_CACHE_TTL_MS : null;
    await this.dropTableIfExists(outputTable);

    const materializeNode = async (nodeId: string): Promise<string> => {
      const existingRelation = relationByNode.get(nodeId);
      if (existingRelation) return existingRelation;
      if (visitingNodeIds.has(nodeId)) {
        throw new Error(`Workflow contains a cycle at node: ${nodeId}`);
      }
      const node = nodeById.get(nodeId);
      if (!node) {
        throw new Error(`Workflow node not found: ${nodeId}`);
      }
      if (node.type === 'output') {
        const outputInputId = this.findIncomingNodeId(node.id, edges, 'input');
        if (!outputInputId) {
          throw new Error(`Output node has no input: ${node.id}`);
        }
        return materializeNode(outputInputId);
      }
      visitingNodeIds.add(nodeId);
      try {
        const outputRelation = this.getWorkflowNodeCacheTableName(
          task.id,
          node,
          cacheScope,
          cacheRunId
        );
        if (node.type === 'input_source') {
          const relation = await this.materializeInputSource(node, sourcePath, outputRelation);
          relationByNode.set(node.id, relation);
          await this.registerWorkflowNodeCache(node, relation, cacheScope, cacheExpiresAt);
          return relation;
        }

        if (node.config.disabled === true) {
          const passthroughNodeId =
            node.type === 'join' || node.type === 'set_op'
              ? (this.findIncomingNodeId(node.id, edges, 'left') ??
                this.findIncomingNodeId(node.id, edges, 'input') ??
                this.findIncomingNodeId(node.id, edges, 'right'))
              : this.findIncomingNodeId(node.id, edges, 'input');
          if (!passthroughNodeId) {
            throw new Error(`Disabled workflow node has no passthrough input: ${node.id}`);
          }
          const relation = await materializeNode(passthroughNodeId);
          relationByNode.set(node.id, relation);
          return relation;
        }

        if (node.type === 'join' || node.type === 'set_op') {
          const leftNodeId = this.findIncomingNodeId(node.id, edges, 'left');
          const rightNodeId = this.findIncomingNodeId(node.id, edges, 'right');
          if (!leftNodeId || !rightNodeId) {
            throw new Error(
              `${node.type === 'join' ? 'Join' : 'Set operation'} node requires left and right inputs: ${node.id}`
            );
          }
          await materializeNode(leftNodeId);
          await materializeNode(rightNodeId);
        } else {
          const inputNodeId = this.findIncomingNodeId(node.id, edges, 'input');
          if (!inputNodeId) {
            throw new Error(`Workflow node has no input: ${node.id}`);
          }
          await materializeNode(inputNodeId);
        }

        await this.dropTableIfExists(outputRelation);
        const sql = await this.compileWorkflowNodeSql(
          node,
          outputRelation,
          relationByNode,
          edges,
          diagnostics
        );
        try {
          await this.runSql(toPersistentCreateTableSql(sql));
        } catch (error) {
          const origin = isRecord(node.config.generatedOrigin)
            ? node.config.generatedOrigin
            : undefined;
          const cause = error instanceof Error ? error.message : String(error);
          const functionLabel =
            origin && typeof origin.functionName === 'string'
              ? ` in generated helper ${origin.functionName}`
              : '';
          const wrapped = new Error(
            `Workflow node ${node.id} (${node.type})${functionLabel} failed: ${cause}`
          ) as Error & { workflowOrigin?: Record<string, unknown> };
          wrapped.workflowOrigin = {
            ...(origin ?? {}),
            nodeId: node.id,
            nodeType: node.type,
          };
          throw wrapped;
        }
        relationByNode.set(node.id, outputRelation);
        await this.registerWorkflowNodeCache(node, outputRelation, cacheScope, cacheExpiresAt);
        return outputRelation;
      } finally {
        visitingNodeIds.delete(nodeId);
      }
    };

    const finalInputId = outputNode
      ? this.findIncomingNodeId(outputNode.id, edges, 'input')
      : findWorkflowTerminalNodeId(nodes, edges);
    if (!finalInputId) {
      throw new Error('Workflow has no materialized output relation');
    }
    const finalRelation = await materializeNode(finalInputId);
    await this.runSql(
      `CREATE TABLE ${quoteIdentifier(outputTable)} AS SELECT * FROM ${quoteIdentifier(finalRelation)}`
    );
    const rowCount = await this.countRows(outputTable);
    const columnCount = (await this.getTableColumns(outputTable)).length;
    if (outputNode) {
      await this.registerWorkflowNodeCache(outputNode, outputTable, cacheScope, cacheExpiresAt);
    }
    if (outputMode === 'temporary') {
      return { outputTable, rowCount, columnCount, sourceDatasetId: null };
    }
    const sourceDatasetId = (await this.findWorkflowSourceDatasetId(nodes)) ?? task.sourceDatasetId;
    const dataset = await this.upsertDatasetForTaskOutput(
      task.name,
      sourcePath,
      outputTable,
      rowCount,
      columnCount,
      outputTarget.outputDatasetId
    );
    void dataset;
    return { outputTable, rowCount, columnCount, sourceDatasetId };
  }

  protected async findWorkflowSourceDatasetId(nodes: DataWorkflowNode[]): Promise<string | null> {
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
      const dataset = await this.findDatasetByReference(datasetRef);
      if (dataset) {
        return dataset.id;
      }
    }
    return null;
  }

  protected async resolveWorkflowOutputTarget(
    node: DataWorkflowNode | undefined,
    fallback: string
  ): Promise<{ tableName: string; outputDatasetId?: string }> {
    const outputDatasetId =
      stringConfigValue(node?.config.outputDatasetId) ||
      stringConfigValue(node?.config.outputTableId);
    if (outputDatasetId) {
      const outputTable = await this.requireOutputTable(outputDatasetId);
      return { tableName: outputTable.tableName, outputDatasetId: outputTable.id };
    }
    return { tableName: getOutputTableName(node, fallback) };
  }

  protected async resolveWorkflowNodePreviewTable(
    task: DataCleaningTask,
    node: DataWorkflowNode
  ): Promise<string | null> {
    if (node.config.disabled === true) {
      return null;
    }
    const cachedTableName = await this.findWorkflowNodeCacheTable(task.id, node.id);
    if (cachedTableName) {
      return cachedTableName;
    }
    if (node.type === 'input_source') {
      return tableNameFromId('workflow_source', node.id);
    }
    if (node.type === 'output') {
      const outputDatasetId =
        stringConfigValue(node.config.outputDatasetId) ||
        stringConfigValue(node.config.outputTableId);
      if (outputDatasetId) {
        const outputTable = await this.getOutputTable(outputDatasetId);
        return outputTable?.tableName ?? null;
      }
      return (
        stringConfigValue(node.config.table) ||
        task.outputTable ||
        tableNameFromId('clean_task', task.id)
      );
    }
    return tableNameFromId(`workflow_${node.type}`, node.id);
  }

  protected getWorkflowNodeCacheTableName(
    taskId: string,
    node: DataWorkflowNode,
    cacheScope: WorkflowCacheScope,
    cacheRunId: string
  ): string {
    const baseId =
      cacheScope === 'permanent' ? `${taskId}_${node.id}` : `${taskId}_${node.id}_${cacheRunId}`;
    return tableNameFromId(`workflow_cache_${cacheScope}_${node.type}`, baseId);
  }

  protected async registerWorkflowNodeCache(
    node: DataWorkflowNode,
    tableName: string,
    cacheScope: WorkflowCacheScope,
    expiresAt: number | null
  ): Promise<void> {
    const timestamp = this.now();
    const id = tableNameFromId('cache', `${node.taskId}_${node.id}_${tableName}`);
    await this.metaRunSql(
      `
          DELETE FROM data_workflow_node_caches
          WHERE task_id = $taskId
            AND node_id = $nodeId
            AND table_name = $tableName
        `,
      { taskId: node.taskId, nodeId: node.id, tableName }
    );
    await this.metaRunSql(
      `
          INSERT INTO data_workflow_node_caches (
            id, task_id, node_id, node_type, table_name, cache_scope,
            expires_at, created_at, updated_at
          )
          VALUES (
            $id, $taskId, $nodeId, $nodeType, $tableName, $cacheScope,
            $expiresAt, $createdAt, $updatedAt
          )
        `,
      {
        id,
        taskId: node.taskId,
        nodeId: node.id,
        nodeType: node.type,
        tableName,
        cacheScope,
        expiresAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    );
  }

  protected async findWorkflowNodeCacheTable(
    taskId: string,
    nodeId: string
  ): Promise<string | null> {
    const rows = await this.metaQueryRows<DataWorkflowNodeCacheRow>(
      `
          SELECT *
          FROM data_workflow_node_caches
          WHERE task_id = $taskId
            AND node_id = $nodeId
            AND (expires_at IS NULL OR expires_at > $now)
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 8
        `,
      { taskId, nodeId, now: this.now() }
    );
    for (const row of rows) {
      const tableName = String(row.table_name);
      if (await this.physicalTableExists(tableName)) {
        return tableName;
      }
      await this.metaRunSql('DELETE FROM data_workflow_node_caches WHERE id = $id', {
        id: String(row.id),
      });
    }
    return null;
  }

  protected async cleanupExpiredWorkflowNodeCaches(): Promise<void> {
    const rows = await this.metaQueryRows<DataWorkflowNodeCacheRow>(
      `
          SELECT *
          FROM data_workflow_node_caches
          WHERE expires_at IS NOT NULL
            AND expires_at <= $now
        `,
      { now: this.now() }
    );
    for (const row of rows) {
      await this.dropTableIfExists(String(row.table_name)).catch(() => undefined);
      await this.metaRunSql('DELETE FROM data_workflow_node_caches WHERE id = $id', {
        id: String(row.id),
      });
    }
  }

  protected async deleteWorkflowNodeCachesForTask(taskId: string): Promise<void> {
    const rows = await this.metaQueryRows<DataWorkflowNodeCacheRow>(
      'SELECT * FROM data_workflow_node_caches WHERE task_id = $taskId',
      { taskId }
    );
    for (const row of rows) {
      await this.dropTableIfExists(String(row.table_name)).catch(() => undefined);
    }
    await this.metaRunSql('DELETE FROM data_workflow_node_caches WHERE task_id = $taskId', {
      taskId,
    });
  }

  protected async getWorkflowNodes(taskId: string): Promise<DataWorkflowNode[]> {
    const rows = await this.metaQueryRows<DataWorkflowNodeRow>(
      `
          SELECT *
          FROM data_workflow_nodes
          WHERE task_id = $taskId
          ORDER BY ordinal ASC, created_at ASC
        `,
      { taskId }
    );
    return rows.map(mapWorkflowNodeRow);
  }

  protected async getWorkflowEdges(taskId: string): Promise<DataWorkflowEdge[]> {
    const rows = await this.metaQueryRows<DataWorkflowEdgeRow>(
      `
          SELECT *
          FROM data_workflow_edges
          WHERE task_id = $taskId
          ORDER BY created_at ASC
        `,
      { taskId }
    );
    return rows.map(mapWorkflowEdgeRow);
  }

  protected async getRuntimeWorkflow(taskId: string): Promise<RuntimeWorkflow> {
    const nodes = await this.getWorkflowNodes(taskId);
    const edges = nodes.length > 0 ? await this.getWorkflowEdges(taskId) : [];
    return { nodes, edges };
  }

  protected async countWorkflowNodes(taskId: string): Promise<number> {
    const rows = await this.metaQueryRows<{ count: number | string }>(
      'SELECT count(*) AS count FROM data_workflow_nodes WHERE task_id = $taskId',
      { taskId }
    );
    return toNumber(rows[0]?.count);
  }

  protected async getTask(id: string): Promise<DataCleaningTask | null> {
    const rows = await this.metaQueryRows<DataTaskRow>(
      'SELECT * FROM data_cleaning_tasks WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapTaskRow(rows[0]) : null;
  }

  protected async requireTask(id: string): Promise<DataCleaningTask> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error(`Data cleaning task not found: ${id}`);
    }
    return task;
  }
}
