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
import type { WorkflowNodeRunStat } from '../data-command-types';
import { parseFieldRefExact } from '../../../shared/prep-dsl';
import {
  buildWorkflowPlan,
  validateWorkflowPlanGraph,
  validateWorkflowPlanSchemas,
  type PlanColumn,
  type WorkflowPlanDiagnostic,
} from '../../../shared/workflow-plan';
import {
  compileFilterConditionExpression,
  isRecord,
  literalToSql,
  quoteIdentifier,
  toNumber,
} from '../operators';
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
  runtimeWorkflowToSaveInput,
  stringConfigValue,
  toPersistentCreateTableSql,
  workflowExecutionSignature,
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
  ): Promise<{
    task: DataCleaningTask;
    diagnostics: PrepDiagnostic[];
    nodeStats?: WorkflowNodeRunStat[];
  }> {
    return this.runExclusive(async () => {
      if (input.outputMode === 'temporary') {
        return this.runTaskToTemporaryOutputUnsafe(id, input);
      }

      await this.ensureReady();
      const task = await this.requireTask(id);
      const sourcePath = input.sourcePath ? normalizeSourcePath(input.sourcePath) : task.sourcePath;
      const runtimeWorkflow = input.workflow
        ? normalizeRuntimeWorkflowInput(id, input.workflow, this.now())
        : await this.getRuntimeWorkflow(id);
      const workflow = input.workflow ?? runtimeWorkflowToSaveInput(runtimeWorkflow);
      const startedAt = this.now();
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

      try {
        const validated = await this.runTaskToTemporaryOutputUnsafe(id, {
          ...input,
          workflow,
          outputMode: 'temporary',
        });
        const committedTask = await this.commitValidatedTaskOutput(
          id,
          validated.task,
          workflow,
          validated.watermarkUpdates,
          validated.nodeStats,
          validated.stagedSinks
        );
        return {
          task: committedTask,
          diagnostics: validated.diagnostics,
          nodeStats: validated.nodeStats,
        };
      } catch (error) {
        const failedAt = this.now();
        const message = error instanceof Error ? error.message : String(error);
        // Per-node stats collected before the failure are persisted under a
        // failed-run id so exception samples stay inspectable.
        const failedStats = (error as { nodeStats?: WorkflowNodeRunStat[] }).nodeStats;
        if (failedStats && failedStats.length > 0) {
          await this.persistTaskNodeStats(id, `failed_${failedAt}`, failedStats).catch(
            () => undefined
          );
        }
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
        await this.cleanupTemporaryTaskResources(id).catch(() => undefined);
        throw error;
      }
    }, `runTask:${id}`);
  }

  /**
   * Staged plan validation shared by save, trial-run and DSL apply: builds the
   * typed workflow plan, runs the shared graph rules, resolves each input
   * source's columns, then propagates schemas to check field existence, type
   * compatibility, set-op alignment, pivot outputs and deterministic ordering.
   */
  async validateWorkflowPlanForTask(
    id: string,
    input: DataWorkflowSaveInput
  ): Promise<WorkflowPlanDiagnostic[]> {
    return this.runExclusive(async () => {
      await this.ensureReady();
      const task = await this.requireTask(id);
      const { plan, diagnostics } = buildWorkflowPlan(
        { nodes: input.nodes, edges: input.edges },
        { includeConfigDiagnostics: true }
      );
      diagnostics.push(...validateWorkflowPlanGraph(plan, { profile: 'task' }));

      // Multiple sinks may not resolve to the same physical target table —
      // the second write would silently overwrite the first. Resolve via the
      // same path the commit uses so outputDatasetId and table-name configs
      // compare on equal terms; nodes whose config already failed validation
      // (e.g. bad mode) are skipped to avoid duplicate noise.
      const claimedOutputTargets = new Map<string, string>();
      const erroredNodeIds = new Set(
        diagnostics
          .filter((item) => item.severity === 'error' && item.nodeId)
          .map((item) => item.nodeId as string)
      );
      const outputNodes = plan.nodes.filter(
        (node) => node.type === 'output' && node.config?.disabled !== true
      );
      for (const [index, planNode] of outputNodes.entries()) {
        if (erroredNodeIds.has(planNode.id)) continue;
        const taskNode = input.nodes.find((node) => node.id === planNode.id);
        if (!taskNode) continue;
        try {
          const target = await this.resolveWorkflowOutputTarget(
            taskNode,
            index === 0
              ? task.outputTable || tableNameFromId('clean_task', task.id)
              : tableNameFromId('task_sink', `${task.id}_${planNode.id}`)
          );
          const targetKey = target.tableName.toLowerCase();
          const claimant = claimedOutputTargets.get(targetKey);
          if (claimant) {
            diagnostics.push({
              severity: 'error',
              code: 'outputTargetDuplicate',
              message: `Output sinks ${claimant} and ${planNode.id} resolve to the same target table "${target.tableName}"`,
              nodeId: planNode.id,
              nodeType: planNode.type,
            });
          } else {
            claimedOutputTargets.set(targetKey, planNode.id);
          }
        } catch {
          // Resolution failures are already reported as config diagnostics.
        }
      }

      const inputSchemas = new Map<string, PlanColumn[]>();
      for (const node of plan.nodes) {
        if (node.type !== 'input_source') continue;
        const columns = await this.resolveInputSourceColumnTypes(
          {
            id: node.id,
            taskId: task.id,
            type: 'input_source',
            label: node.label ?? '',
            x: node.x ?? 0,
            y: node.y ?? 0,
            config: node.config,
            createdAt: 0,
            updatedAt: 0,
          },
          task.sourcePath
        );
        if (columns) inputSchemas.set(node.id, columns);
      }
      diagnostics.push(
        ...validateWorkflowPlanSchemas(plan, (node) => inputSchemas.get(node.id) ?? null)
      );
      return diagnostics;
    }, `validateWorkflowPlan:${id}`);
  }

  async validateTaskWorkflow(
    id: string,
    input: DataRunTaskInput
  ): Promise<{
    task: DataCleaningTask;
    diagnostics: PrepDiagnostic[];
    nodeStats?: WorkflowNodeRunStat[];
    watermarkUpdates?: Array<{ nodeId: string; column: string; value: string }>;
    stagedSinks?: Array<{ nodeId: string; stagingTable: string }>;
  }> {
    return this.runExclusive(
      () => this.runTaskToTemporaryOutputUnsafe(id, input),
      `validateTaskWorkflow:${id}`
    );
  }

  async commitValidatedTaskOutput(
    id: string,
    temporaryTask: DataCleaningTask,
    workflow: DataWorkflowSaveInput,
    watermarkUpdates?: Array<{ nodeId: string; column: string; value: string }>,
    nodeStats?: WorkflowNodeRunStat[],
    stagedSinks?: Array<{ nodeId: string; stagingTable: string }>
  ): Promise<DataCleaningTask> {
    return this.runExclusive(async () => {
      await this.ensureReady();
      const task = await this.requireTask(id);
      const temporaryTable = temporaryTask.outputTable;
      if (!temporaryTable || !(await this.physicalTableExists(temporaryTable))) {
        throw new Error('Validated temporary task output is no longer available');
      }
      const runtimeWorkflow = normalizeRuntimeWorkflowInput(id, workflow, this.now());
      const nodeById = new Map(runtimeWorkflow.nodes.map((node) => [node.id, node]));
      const outputNodes = runtimeWorkflow.nodes.filter(
        (node) => node.type === 'output' && node.config.disabled !== true
      );
      // Every staged sink gets its own resolved target; the first sink keeps
      // the task's primary output table for compatibility.
      const sinkInputs =
        stagedSinks && stagedSinks.length > 0
          ? stagedSinks
          : [{ nodeId: outputNodes[0]?.id ?? '', stagingTable: temporaryTable }];

      interface ResolvedTarget {
        tableName: string;
        outputDatasetId?: string;
        mode: 'replace' | 'append' | 'error_if_exists' | 'merge';
        mergeKeys: string[];
        schemaPolicy: 'extend' | 'strict' | 'ignore';
      }
      interface SinkPlan {
        journalId: string;
        stagingTable: string;
        target: ResolvedTarget;
        backupTable: string;
        targetExisted: boolean;
        appendToExisting: boolean;
        tempReadSql: string;
        mergeKeyPredicate: string;
        finalRowCount: number;
      }

      const completedAt = this.now();
      const commitId = uuidv4();
      const sourceDatasetId =
        (await this.findWorkflowSourceDatasetId(runtimeWorkflow.nodes)) ?? task.sourceDatasetId;
      const sinks: SinkPlan[] = [];
      const claimedTargets = new Set<string>();
      for (const [index, sink] of sinkInputs.entries()) {
        const outputNode = sink.nodeId ? nodeById.get(sink.nodeId) : undefined;
        const fallback =
          index === 0
            ? task.outputTable || tableNameFromId('clean_task', task.id)
            : tableNameFromId('task_sink', `${task.id}_${sink.nodeId || index}`);
        const target = await this.resolveWorkflowOutputTarget(outputNode, fallback);
        const targetKey = target.tableName.toLowerCase();
        if (claimedTargets.has(targetKey)) {
          throw new Error(
            `Output target "${target.tableName}" is claimed by more than one output sink`
          );
        }
        claimedTargets.add(targetKey);
        if (!(await this.physicalTableExists(sink.stagingTable))) {
          throw new Error(`Validated staging output ${sink.stagingTable} is no longer available`);
        }
        const rowCount = await this.countRows(sink.stagingTable);
        const targetExisted = await this.physicalTableExists(target.tableName);
        if (target.mode === 'error_if_exists' && targetExisted) {
          throw new Error(
            `Output table "${target.tableName}" already exists (mode error_if_exists)`
          );
        }
        const appendToExisting =
          (target.mode === 'append' || target.mode === 'merge') && targetExisted;

        // A merge batch with duplicate business keys applies the last row per
        // key (physical order via rowid) so rerunning a batch stays idempotent.
        const incomingSource =
          target.mode === 'merge' && target.mergeKeys.length > 0
            ? `(
                 SELECT * EXCLUDE (__merge_rank) FROM (
                   SELECT *,
                     row_number() OVER (
                       PARTITION BY ${target.mergeKeys
                         .map((key) => quoteIdentifier(key))
                         .join(', ')}
                       ORDER BY rowid DESC
                     ) AS __merge_rank
                   FROM ${quoteIdentifier(sink.stagingTable)}
                 ) WHERE __merge_rank = 1
               )`
            : quoteIdentifier(sink.stagingTable);

        // Schema drift policy only applies when writing into an existing table.
        let tempReadSql = `SELECT * FROM ${incomingSource}`;
        if (appendToExisting && target.schemaPolicy !== 'extend') {
          const existingColumns = await this.getTableColumns(target.tableName);
          const tempColumns = await this.getTableColumns(sink.stagingTable);
          const existingNames = new Set(existingColumns);
          const tempNames = new Set(tempColumns);
          if (target.schemaPolicy === 'strict') {
            const added = tempColumns.filter((column) => !existingNames.has(column));
            const missing = existingColumns.filter((column) => !tempNames.has(column));
            if (added.length > 0 || missing.length > 0) {
              throw new Error(
                `Output schema drift (strict): ${[
                  added.length ? `new columns [${added.join(', ')}]` : '',
                  missing.length ? `missing columns [${missing.join(', ')}]` : '',
                ]
                  .filter(Boolean)
                  .join('; ')}`
              );
            }
          } else {
            // ignore: project the incoming rows onto the existing table's columns.
            const projection = existingColumns
              .map((column) =>
                tempNames.has(column)
                  ? quoteIdentifier(column)
                  : `NULL AS ${quoteIdentifier(column)}`
              )
              .join(', ');
            tempReadSql = `SELECT ${projection} FROM ${incomingSource}`;
          }
        }

        const mergeKeyPredicate = target.mergeKeys
          .map((key) => `b.${quoteIdentifier(key)} IS NOT DISTINCT FROM t.${quoteIdentifier(key)}`)
          .join(' AND ');
        const incomingCount =
          target.mode === 'merge' && target.mergeKeys.length > 0
            ? toNumber(
                (
                  await this.queryRows<{ count: number | string }>(
                    `SELECT count(*) AS count FROM (${tempReadSql}) _dedup`
                  )
                )[0]?.count
              )
            : rowCount;
        const finalRowCount = !appendToExisting
          ? incomingCount
          : target.mode === 'append'
            ? rowCount + (await this.countRows(target.tableName))
            : (await this.countMergeSurvivors(target.tableName, tempReadSql, mergeKeyPredicate)) +
              incomingCount;
        sinks.push({
          journalId: index === 0 ? commitId : `${commitId}__${index}`,
          stagingTable: sink.stagingTable,
          target,
          backupTable: tableNameFromId(
            'output_backup',
            index === 0 ? commitId : `${commitId}_${index}`
          ),
          targetExisted,
          appendToExisting,
          tempReadSql,
          mergeKeyPredicate,
          finalRowCount,
        });
      }

      for (const sink of sinks) {
        await this.metaRunSql(
          `INSERT INTO data_output_commits (
             id, task_id, temporary_table, target_table, backup_table, target_existed,
             state, intended_metadata_json, error, created_at, updated_at
           ) VALUES (
             $id, $taskId, $temporaryTable, $targetTable, $backupTable, $targetExisted,
             'prepared', $intendedMetadataJson, NULL, $createdAt, $updatedAt
           )`,
          {
            id: sink.journalId,
            taskId: id,
            temporaryTable: sink.stagingTable,
            targetTable: sink.target.tableName,
            backupTable: sink.backupTable,
            targetExisted: sink.targetExisted ? 1 : 0,
            intendedMetadataJson: JSON.stringify({
              taskName: task.name,
              sourcePath: temporaryTask.sourcePath,
              sourceDatasetId,
              outputDatasetId: sink.target.outputDatasetId ?? null,
              rowCount: sink.finalRowCount,
              nodeCount: runtimeWorkflow.nodes.length,
              completedAt,
            }),
            createdAt: completedAt,
            updatedAt: completedAt,
          }
        );
      }

      let physicalCommitted = false;
      let metadataTransactionStarted = false;
      try {
        // One physical transaction covers every sink so partial writes roll back.
        await this.runSql('BEGIN TRANSACTION');
        for (const sink of sinks) {
          if (sink.targetExisted) {
            await this.dropTableIfExists(sink.backupTable);
            await this.runSql(
              `ALTER TABLE ${quoteIdentifier(sink.target.tableName)} RENAME TO ${quoteIdentifier(sink.backupTable)}`
            );
          }
          const survivingSql =
            sink.target.mode === 'merge'
              ? `SELECT * FROM ${quoteIdentifier(sink.backupTable)} b
                 WHERE NOT EXISTS (SELECT 1 FROM (${sink.tempReadSql}) t
                   WHERE ${sink.mergeKeyPredicate})`
              : `SELECT * FROM ${quoteIdentifier(sink.backupTable)}`;
          await this.runSql(
            sink.appendToExisting
              ? `CREATE TABLE ${quoteIdentifier(sink.target.tableName)} AS ${survivingSql} UNION ALL BY NAME ${sink.tempReadSql}`
              : `CREATE TABLE ${quoteIdentifier(sink.target.tableName)} AS ${sink.tempReadSql}`
          );
        }
        await this.runSql('COMMIT');
        physicalCommitted = true;
        for (const sink of sinks) {
          await this.updateOutputCommitState(sink.journalId, 'data_committed');
        }

        await this.metaRunSql('BEGIN TRANSACTION');
        metadataTransactionStarted = true;
        for (const [index, sink] of sinks.entries()) {
          const finalColumnCount = sink.appendToExisting
            ? (await this.getTableColumns(sink.target.tableName)).length
            : (await this.getTableColumns(sink.stagingTable)).length;
          await this.upsertDatasetForTaskOutput(
            task.name,
            temporaryTask.sourcePath,
            sink.target.tableName,
            sink.finalRowCount,
            finalColumnCount,
            sink.target.outputDatasetId
          );
          if (index === 0) {
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
                outputTable: sink.target.tableName,
                rowCount: sink.finalRowCount,
                columnCount: finalColumnCount,
                lastRunAt: completedAt,
                updatedAt: completedAt,
              }
            );
          }
        }
        if (watermarkUpdates && watermarkUpdates.length > 0) {
          await this.upsertTaskWatermark(id, watermarkUpdates);
        }
        if (nodeStats && nodeStats.length > 0) {
          await this.persistTaskNodeStats(id, commitId, nodeStats);
        }
        for (const sink of sinks) {
          await this.updateOutputCommitState(sink.journalId, 'metadata_committed');
        }
        await this.metaRunSql('COMMIT');
        metadataTransactionStarted = false;
      } catch (error) {
        if (metadataTransactionStarted) {
          await this.metaRunSql('ROLLBACK').catch(() => undefined);
        }
        const message = error instanceof Error ? error.message : String(error);
        const unrestoredSinks = new Set<string>();
        if (physicalCommitted) {
          for (const sink of sinks) {
            try {
              await this.restoreOutputCommit({
                targetTable: sink.target.tableName,
                backupTable: sink.backupTable,
                targetExisted: sink.targetExisted,
              });
            } catch {
              unrestoredSinks.add(sink.journalId);
            }
          }
        } else {
          // A failed rollback leaves physical state unknown — keep journals
          // recoverable ('prepared') so startup recovery can sort it out.
          try {
            await this.runSql('ROLLBACK');
          } catch {
            for (const sink of sinks) unrestoredSinks.add(sink.journalId);
          }
        }
        for (const sink of sinks) {
          if (unrestoredSinks.has(sink.journalId)) {
            // Keep the journal recoverable: startup recovery retries the
            // restore instead of trusting a 'failed' tombstone while the
            // physical state is unknown.
            await this.updateOutputCommitState(
              sink.journalId,
              physicalCommitted ? 'data_committed' : 'prepared',
              `commit failed and restore also failed; pending recovery: ${message}`
            ).catch(() => undefined);
          } else {
            await this.updateOutputCommitState(sink.journalId, 'failed', message).catch(
              () => undefined
            );
          }
        }
        throw error;
      }

      for (const sink of sinks) {
        await this.dropTableIfExists(sink.backupTable).catch(() => undefined);
        await this.dropTableIfExists(sink.stagingTable).catch(() => undefined);
        await this.updateOutputCommitState(sink.journalId, 'completed').catch(() => undefined);
      }
      return this.requireTask(id);
    }, `commitValidatedTaskOutput:${id}`);
  }

  /**
   * `expect` node: materializes the conforming main stream and the reject
   * stream of violating rows. Without `rejectStream` any violation fails the
   * run and reports sample rows.
   */
  private async materializeExpectNode(
    node: DataWorkflowNode,
    inputRelation: string,
    outputRelation: string,
    rejectRelation: string
  ): Promise<{
    rejectedRows: number;
    sample: Record<string, unknown>[];
    /** Set when the assertion fails the run — callers must record stats, then throw it. */
    failure?: string;
  }> {
    const config = node.config;
    const kind = typeof config.kind === 'string' ? config.kind : 'expression';
    const input = quoteIdentifier(inputRelation);
    await this.dropTableIfExists(outputRelation);
    await this.dropTableIfExists(rejectRelation);

    if (kind === 'row_count') {
      const operator = typeof config.operator === 'string' ? config.operator : '>=';
      const value = Number(config.value ?? 0);
      const count = await this.countRows(inputRelation);
      const ok =
        operator === '>'
          ? count > value
          : operator === '>='
            ? count >= value
            : operator === '<'
              ? count < value
              : operator === '<='
                ? count <= value
                : operator === '!='
                  ? count !== value
                  : count === value;
      if (!ok) {
        return {
          rejectedRows: 0,
          sample: [],
          failure: `Expect failed at node ${node.id}: row count ${count} does not satisfy rows ${operator} ${value}`,
        };
      }
      await this.runSql(
        `CREATE TABLE ${quoteIdentifier(outputRelation)} AS SELECT * FROM ${input}`
      );
      await this.runSql(
        `CREATE TABLE ${quoteIdentifier(rejectRelation)} AS SELECT * FROM ${input} WHERE false`
      );
      return { rejectedRows: 0, sample: [] };
    }

    let violation: string;
    if (kind === 'unique') {
      const columns = (Array.isArray(config.columns) ? config.columns : []).map((column) =>
        quoteIdentifier(String(column))
      );
      if (columns.length === 0) {
        throw new Error(`Expect unique at node ${node.id} requires at least one field`);
      }
      const match = columns
        .map((column) => `_d.${column} IS NOT DISTINCT FROM t.${column}`)
        .join(' AND ');
      violation = `EXISTS (
        SELECT 1 FROM (
          SELECT ${columns.join(', ')}, COUNT(*) AS _n
          FROM ${input} GROUP BY ${columns.join(', ')} HAVING _n > 1
        ) _d WHERE ${match}
      )`;
    } else {
      const expression =
        typeof config.expression === 'string' && config.expression.trim()
          ? config.expression
          : 'true';
      // `IS NOT TRUE` treats NULL (unknown) results as violations so rejected
      // rows never silently vanish from both streams.
      violation = `(${compileFilterConditionExpression(expression)}) IS NOT TRUE`;
    }

    const sample = await this.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${input} t WHERE ${violation} LIMIT 5`
    );
    const rejectedRows = await this.countRejectRows(input, violation);
    const rejectStream = typeof config.rejectStream === 'string' ? config.rejectStream.trim() : '';
    if (rejectedRows > 0 && !rejectStream) {
      return {
        rejectedRows,
        sample,
        failure: `Expect failed at node ${node.id}: ${rejectedRows} row(s) violate the assertion; sample: ${JSON.stringify(sample)}`,
      };
    }
    await this.runSql(
      `CREATE TABLE ${quoteIdentifier(outputRelation)} AS SELECT * FROM ${input} t WHERE NOT (${violation})`
    );
    await this.runSql(
      `CREATE TABLE ${quoteIdentifier(rejectRelation)} AS SELECT * FROM ${input} t WHERE ${violation}`
    );
    return { rejectedRows, sample };
  }

  private async countRejectRows(input: string, violation: string): Promise<number> {
    const rows = await this.queryRows<{ count: number | string }>(
      `SELECT count(*) AS count FROM ${input} t WHERE ${violation}`
    );
    return toNumber(rows[0]?.count);
  }

  /**
   * `incremental by [col]` on an input source reads only rows newer than the
   * stored watermark and records the new high-water mark for the next run.
   */
  private async materializeInputSourceWithContract(
    task: DataCleaningTask,
    node: DataWorkflowNode,
    sourcePath: string | null,
    outputRelation: string,
    watermarkUpdates: Array<{ nodeId: string; column: string; value: string }>
  ): Promise<string> {
    const incrementalBy =
      typeof node.config.incrementalBy === 'string' ? node.config.incrementalBy.trim() : '';
    const relation = await this.materializeInputSource(node, sourcePath, outputRelation);
    if (!incrementalBy) return relation;

    const column = quoteIdentifier(incrementalBy);
    const table = quoteIdentifier(relation);
    const previous = await this.getTaskWatermark(task.id, node.id, incrementalBy);
    if (previous !== null) {
      const filtered = `${relation}_incr`;
      await this.dropTableIfExists(filtered);
      await this.runSql(
        `CREATE TABLE ${quoteIdentifier(filtered)} AS SELECT * FROM ${table}
         WHERE ${column} > ${literalToSql(previous)}`
      );
      await this.dropTableIfExists(relation);
      const maxRow = await this.queryRows<{ value: unknown }>(
        `SELECT CAST(MAX(${column}) AS VARCHAR) AS value FROM ${quoteIdentifier(filtered)}`
      );
      const value = maxRow[0]?.value;
      if (value !== null && value !== undefined) {
        watermarkUpdates.push({ nodeId: node.id, column: incrementalBy, value: String(value) });
      }
      return filtered;
    }
    const maxRow = await this.queryRows<{ value: unknown }>(
      `SELECT CAST(MAX(${column}) AS VARCHAR) AS value FROM ${table}`
    );
    const value = maxRow[0]?.value;
    if (value !== null && value !== undefined) {
      watermarkUpdates.push({ nodeId: node.id, column: incrementalBy, value: String(value) });
    }
    return relation;
  }

  private async getTaskWatermark(
    taskId: string,
    nodeId: string,
    column: string
  ): Promise<string | null> {
    const rows = await this.metaQueryRows<{ watermark_value: string | null }>(
      `SELECT watermark_value FROM data_task_watermarks
       WHERE task_id = $taskId AND node_id = $nodeId AND column_name = $column`,
      { taskId, nodeId, column }
    );
    const value = rows[0]?.watermark_value;
    return value === null || value === undefined ? null : String(value);
  }

  /** Keeps only the newest run's per-node stats per task; prior runs are pruned. */
  private async persistTaskNodeStats(
    taskId: string,
    runId: string,
    stats: WorkflowNodeRunStat[]
  ): Promise<void> {
    await this.metaRunSql(`DELETE FROM data_task_node_run_stats WHERE task_id = $taskId`, {
      taskId,
    });
    for (const stat of stats) {
      await this.metaRunSql(
        `INSERT INTO data_task_node_run_stats
           (task_id, run_id, node_id, node_type, input_rows, output_rows, dropped_rows, rejected_rows, sample_json, created_at)
         VALUES ($taskId, $runId, $nodeId, $nodeType, $inputRows, $outputRows, $droppedRows, $rejectedRows, $sampleJson, $createdAt)`,
        {
          taskId,
          runId,
          nodeId: stat.nodeId,
          nodeType: stat.nodeType,
          inputRows: stat.inputRows,
          outputRows: stat.outputRows,
          droppedRows: stat.droppedRows ?? 0,
          rejectedRows: stat.rejectedRows ?? 0,
          sampleJson: stat.sample && stat.sample.length > 0 ? JSON.stringify(stat.sample) : null,
          createdAt: this.now(),
        }
      );
    }
  }

  /** Latest persisted run's per-node stats for a task (newest run only). */
  async getTaskNodeStats(taskId: string): Promise<WorkflowNodeRunStat[]> {
    await this.ensureMetadataReady();
    const rows = await this.metaQueryRows<{
      node_id: string;
      node_type: string;
      input_rows: number | null;
      output_rows: number;
      dropped_rows: number;
      rejected_rows: number;
      sample_json: string | null;
    }>(
      `SELECT node_id, node_type, input_rows, output_rows, dropped_rows, rejected_rows, sample_json
       FROM data_task_node_run_stats WHERE task_id = $taskId ORDER BY node_id`,
      { taskId }
    );
    return rows.map((row) => ({
      nodeId: row.node_id,
      nodeType: row.node_type,
      inputRows: row.input_rows === null ? null : Number(row.input_rows),
      outputRows: Number(row.output_rows),
      droppedRows: Number(row.dropped_rows) || undefined,
      rejectedRows: Number(row.rejected_rows) || undefined,
      sample: row.sample_json
        ? (JSON.parse(row.sample_json) as Record<string, unknown>[])
        : undefined,
    }));
  }

  private async upsertTaskWatermark(
    taskId: string,
    updates: Array<{ nodeId: string; column: string; value: string }>
  ): Promise<void> {
    for (const update of updates) {
      await this.metaRunSql(
        `DELETE FROM data_task_watermarks WHERE task_id = $taskId AND node_id = $nodeId`,
        { taskId, nodeId: update.nodeId }
      );
      await this.metaRunSql(
        `INSERT INTO data_task_watermarks (task_id, node_id, column_name, watermark_value, updated_at)
         VALUES ($taskId, $nodeId, $column, $value, $updatedAt)`,
        {
          taskId,
          nodeId: update.nodeId,
          column: update.column,
          value: update.value,
          updatedAt: this.now(),
        }
      );
    }
  }

  private async countMergeSurvivors(
    targetTable: string,
    temporaryTable: string,
    mergeKeyPredicate: string
  ): Promise<number> {
    const rows = await this.queryRows<{ count: number | string }>(
      `SELECT count(*) AS count FROM ${quoteIdentifier(targetTable)} b
       WHERE NOT EXISTS (SELECT 1 FROM (${temporaryTable}) t
         WHERE ${mergeKeyPredicate})`
    );
    return toNumber(rows[0]?.count);
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

  protected async runTaskToTemporaryOutputUnsafe(
    id: string,
    input: DataRunTaskInput
  ): Promise<{
    task: DataCleaningTask;
    diagnostics: PrepDiagnostic[];
    nodeStats?: WorkflowNodeRunStat[];
    watermarkUpdates?: Array<{ nodeId: string; column: string; value: string }>;
    stagedSinks?: Array<{ nodeId: string; stagingTable: string }>;
  }> {
    const diagnostics: PrepDiagnostic[] = [];
    await this.ensureReady();
    await this.cleanupExpiredWorkflowNodeCaches();
    const task = await this.requireTask(id);
    const sourcePath = input.sourcePath ? normalizeSourcePath(input.sourcePath) : task.sourcePath;
    const startedAt = this.now();
    const runtimeWorkflow = input.workflow
      ? normalizeRuntimeWorkflowInput(task.id, input.workflow, startedAt)
      : await this.getRuntimeWorkflow(task.id);
    if (!sourcePath && workflowRequiresTaskSource(runtimeWorkflow.nodes)) {
      throw new Error('Data source file is required before running a cleaning task');
    }

    const planDiagnostics =
      runtimeWorkflow.nodes.length > 0
        ? await this.validateWorkflowPlanForTask(
            task.id,
            runtimeWorkflowToSaveInput(runtimeWorkflow)
          )
        : [];
    const planErrors = planDiagnostics.filter((item) => item.severity === 'error');
    if (planErrors.length > 0) {
      throw new Error(
        `Workflow plan validation failed: ${planErrors.map((item) => item.message).join('; ')}`
      );
    }
    diagnostics.push(...planDiagnostics);

    try {
      const result = await this.cleanSourceIntoTaskOutput(
        task,
        sourcePath,
        runtimeWorkflow,
        'temporary',
        diagnostics
      );
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
        nodeStats: result.nodeStats,
        watermarkUpdates: result.watermarkUpdates,
        stagedSinks: result.stagedSinks,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isDuckDbTransactionStateError(message)) {
        await this.recoverDuckDbTransactionState();
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

    const colName = parseFieldRefExact(input.column)?.name ?? input.column.trim();
    if (tableName && !(await this.physicalTableExists(tableName))) {
      return [];
    }
    const quotedCol = quoteIdentifier(colName);
    const quotedTable = quoteIdentifier(tableName);
    const rows = await this.queryRows<{ val: string }>(
      `SELECT DISTINCT ${quotedCol} AS val FROM ${quotedTable} WHERE ${quotedCol} IS NOT NULL ORDER BY ${quotedCol} LIMIT 100`,
      {}
    );
    return rows.map((row) => (row.val === null ? '' : String(row.val)));
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
    await this.deleteWorkflowNodeCachesForTask(
      id,
      task.outputTable ? new Set([task.outputTable]) : undefined
    );
    await this.metaRunSql('DELETE FROM data_workflow_edges WHERE task_id = $id', { id });
    await this.metaRunSql('DELETE FROM data_workflow_nodes WHERE task_id = $id', { id });
    await this.metaRunSql('DELETE FROM data_cleaning_tasks WHERE id = $id', { id });
    return true;
  }

  async getTaskWorkflow(id: string): Promise<DataTaskWorkflow> {
    await this.ensureMetadataReady();
    const task = await this.requireTask(id);
    const nodes = await this.getWorkflowNodes(id);
    const edges = await this.getWorkflowEdges(id);
    return { task, nodes, edges };
  }

  async saveTaskWorkflow(id: string, input: DataWorkflowSaveInput): Promise<DataTaskWorkflow> {
    return this.runExclusive(
      () => this.saveTaskWorkflowUnsafe(id, input),
      `saveTaskWorkflow:${id}`
    );
  }

  private async saveTaskWorkflowUnsafe(
    id: string,
    input: DataWorkflowSaveInput
  ): Promise<DataTaskWorkflow> {
    await this.ensureReady();
    const task = await this.requireTask(id);
    const previousWorkflow = await this.getRuntimeWorkflow(id);
    const updatedAt = this.now();
    const scopedWorkflow = normalizeScopedWorkflowInputs(id, input);
    let nodes = scopedWorkflow.nodes;
    const edges = scopedWorkflow.edges;

    const planDiagnostics =
      nodes.length > 0 ? await this.validateWorkflowPlanForTask(id, { nodes, edges }) : [];
    const planErrors = planDiagnostics.filter((item) => item.severity === 'error');
    if (planErrors.length > 0) {
      throw new Error(
        `Workflow plan validation failed: ${planErrors.map((item) => item.message).join('; ')}`
      );
    }

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

    const executionChanged =
      workflowExecutionSignature(runtimeWorkflowToSaveInput(previousWorkflow)) !==
      workflowExecutionSignature({ nodes, edges });
    if (executionChanged) {
      await this.deleteWorkflowNodeCachesForTask(
        id,
        task.outputTable ? new Set([task.outputTable]) : undefined
      );
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
    diagnostics: PrepDiagnostic[] = []
  ): Promise<{
    outputTable: string;
    rowCount: number;
    columnCount: number;
    sourceDatasetId: string | null;
    nodeStats?: WorkflowNodeRunStat[];
    watermarkUpdates?: Array<{ nodeId: string; column: string; value: string }>;
    stagedSinks?: Array<{ nodeId: string; stagingTable: string }>;
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

    const outputTable =
      outputMode === 'temporary'
        ? tableNameFromId('temp_task', `${task.id}_${uuidv4()}`)
        : task.outputTable || tableNameFromId('clean_task', task.id);
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
      if (outputMode === 'temporary') {
        return { outputTable, rowCount, columnCount, sourceDatasetId: null };
      }
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
    diagnostics: PrepDiagnostic[] = []
  ): Promise<{
    outputTable: string;
    rowCount: number;
    columnCount: number;
    sourceDatasetId: string | null;
    nodeStats: WorkflowNodeRunStat[];
    watermarkUpdates: Array<{ nodeId: string; column: string; value: string }>;
    stagedSinks: Array<{ nodeId: string; stagingTable: string }>;
  }> {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const outputNode = nodes.find((node) => node.type === 'output');
    const nodeStats: WorkflowNodeRunStat[] = [];
    try {
      return await this.runWorkflowIntoTaskOutputInner(
        task,
        sourcePath,
        nodes,
        edges,
        outputMode,
        diagnostics,
        nodeById,
        outputNode ?? null,
        nodeStats
      );
    } catch (error) {
      // Preserve partially collected stats so failed runs stay inspectable.
      const holder = error as { nodeStats?: WorkflowNodeRunStat[] };
      if (!holder.nodeStats) holder.nodeStats = nodeStats;
      throw error;
    }
  }

  private async runWorkflowIntoTaskOutputInner(
    task: DataCleaningTask,
    sourcePath: string | null,
    nodes: DataWorkflowNode[],
    edges: DataWorkflowEdge[],
    outputMode: WorkflowOutputMode,
    diagnostics: PrepDiagnostic[],
    nodeById: Map<string, DataWorkflowNode>,
    outputNode: DataWorkflowNode | null,
    nodeStats: WorkflowNodeRunStat[]
  ): Promise<{
    outputTable: string;
    rowCount: number;
    columnCount: number;
    sourceDatasetId: string | null;
    nodeStats: WorkflowNodeRunStat[];
    watermarkUpdates: Array<{ nodeId: string; column: string; value: string }>;
    stagedSinks: Array<{ nodeId: string; stagingTable: string }>;
  }> {
    const outputTarget: { tableName: string; outputDatasetId?: string } =
      outputMode === 'temporary'
        ? { tableName: tableNameFromId('temp_task', `${task.id}_${uuidv4()}`) }
        : await this.resolveWorkflowOutputTarget(
            outputNode ?? undefined,
            task.outputTable || tableNameFromId('clean_task', task.id)
          );
    const outputTable = outputTarget.tableName;
    const relationByNode = new Map<string, string>();
    const visitingNodeIds = new Set<string>();
    const watermarkUpdates: Array<{ nodeId: string; column: string; value: string }> = [];
    const cacheScope: WorkflowCacheScope = outputMode === 'temporary' ? 'temporary' : 'permanent';
    const cacheRunId = uuidv4();
    const cacheExpiresAt =
      cacheScope === 'temporary' ? this.now() + WORKFLOW_TEMP_CACHE_TTL_MS : null;
    await this.dropTableIfExists(outputTable);

    const relationKeyOf = (nodeId: string, sourceHandle?: string | null) =>
      sourceHandle === 'reject' ? `${nodeId}#reject` : nodeId;

    const findIncomingEdge = (nodeId: string, targetHandle: string) =>
      edges.find(
        (edge) => edge.targetNodeId === nodeId && (edge.targetHandle ?? 'input') === targetHandle
      );

    const materializeEdgeSource = async (edge: DataWorkflowEdge): Promise<string> => {
      const relation = await materializeNode(edge.sourceNodeId);
      const keyed = relationByNode.get(relationKeyOf(edge.sourceNodeId, edge.sourceHandle));
      return keyed ?? relation;
    };

    const collectNodeStat = async (
      node: DataWorkflowNode,
      outputRelation: string,
      inputRelations: string[]
    ) => {
      const outputRows = await this.countRows(outputRelation);
      const inputRows =
        inputRelations.length > 0
          ? (await Promise.all(inputRelations.map((relation) => this.countRows(relation)))).reduce(
              (total, count) => total + count,
              0
            )
          : null;
      const stat: WorkflowNodeRunStat = {
        nodeId: node.id,
        nodeType: node.type,
        inputRows,
        outputRows,
      };
      if (
        inputRows !== null &&
        ['filter', 'deduplicate', 'limit', 'expect'].includes(node.type) &&
        outputRows < inputRows
      ) {
        stat.droppedRows = inputRows - outputRows;
      }
      nodeStats.push(stat);
    };

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
        const outputEdge = findIncomingEdge(node.id, 'input');
        if (!outputEdge) {
          throw new Error(`Output node has no input: ${node.id}`);
        }
        return materializeEdgeSource(outputEdge);
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
          const relation = await this.materializeInputSourceWithContract(
            task,
            node,
            sourcePath,
            outputRelation,
            watermarkUpdates
          );
          relationByNode.set(node.id, relation);
          await this.registerWorkflowNodeCache(node, relation, cacheScope, cacheExpiresAt);
          await collectNodeStat(node, relation, []);
          return relation;
        }

        if (node.config.disabled === true) {
          const passthroughEdge =
            node.type === 'join' || node.type === 'set_op'
              ? (findIncomingEdge(node.id, 'left') ??
                findIncomingEdge(node.id, 'input') ??
                findIncomingEdge(node.id, 'right'))
              : findIncomingEdge(node.id, 'input');
          if (!passthroughEdge) {
            throw new Error(`Disabled workflow node has no passthrough input: ${node.id}`);
          }
          const relation = await materializeEdgeSource(passthroughEdge);
          relationByNode.set(node.id, relation);
          return relation;
        }

        if (node.type === 'join' || node.type === 'set_op') {
          const leftEdge = findIncomingEdge(node.id, 'left');
          const rightEdge = findIncomingEdge(node.id, 'right');
          if (!leftEdge || !rightEdge) {
            throw new Error(
              `${node.type === 'join' ? 'Join' : 'Set operation'} node requires left and right inputs: ${node.id}`
            );
          }
          await materializeEdgeSource(leftEdge);
          await materializeEdgeSource(rightEdge);
        } else {
          const inputEdge = findIncomingEdge(node.id, 'input');
          if (!inputEdge) {
            throw new Error(`Workflow node has no input: ${node.id}`);
          }
          await materializeEdgeSource(inputEdge);
        }

        if (node.type === 'expect') {
          const inputEdge = findIncomingEdge(node.id, 'input')!;
          const inputRelation = relationByNode.get(
            relationKeyOf(inputEdge.sourceNodeId, inputEdge.sourceHandle)
          )!;
          const rejectRelation = `${outputRelation}_reject`;
          const { rejectedRows, sample, failure } = await this.materializeExpectNode(
            node,
            inputRelation,
            outputRelation,
            rejectRelation
          );
          // Record the assertion's stats before failing the run so failed-run
          // stats still carry rejectedRows and the violating sample.
          const expectInputRows = await this.countRows(inputRelation);
          const expectOutputRows = failure ? 0 : await this.countRows(outputRelation);
          const expectStat: WorkflowNodeRunStat = {
            nodeId: node.id,
            nodeType: 'expect',
            inputRows: expectInputRows,
            outputRows: expectOutputRows,
            droppedRows: Math.max(0, expectInputRows - expectOutputRows),
            rejectedRows,
            ...(sample.length > 0 ? { sample } : {}),
          };
          nodeStats.push(expectStat);
          if (failure) throw new Error(failure);
          relationByNode.set(node.id, outputRelation);
          relationByNode.set(`${node.id}#reject`, rejectRelation);
          await this.registerWorkflowNodeCache(node, outputRelation, cacheScope, cacheExpiresAt);
          return outputRelation;
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
        const inputRelations = edges
          .filter((edge) => edge.targetNodeId === node.id)
          .map((edge) => relationByNode.get(relationKeyOf(edge.sourceNodeId, edge.sourceHandle)))
          .filter((relation): relation is string => Boolean(relation));
        await collectNodeStat(node, outputRelation, inputRelations);
        return outputRelation;
      } finally {
        visitingNodeIds.delete(nodeId);
      }
    };

    // Materialize every output sink into its own staging table; the first
    // sink uses `outputTable` so task metadata/preview stay compatible.
    const outputNodes = nodes.filter(
      (node) => node.type === 'output' && node.config.disabled !== true
    );
    const stagedSinks: Array<{ nodeId: string; stagingTable: string }> = [];
    let rowCount = 0;
    let columnCount = 0;
    if (outputNodes.length > 0) {
      for (const [index, sinkNode] of outputNodes.entries()) {
        const sinkEdge =
          findIncomingEdge(sinkNode.id, 'input') ??
          edges.find((edge) => edge.targetNodeId === sinkNode.id);
        if (!sinkEdge) {
          throw new Error(`Output node ${sinkNode.id} has no incoming edge`);
        }
        const sinkRelation = await materializeEdgeSource(sinkEdge);
        const stagingTable = index === 0 ? outputTable : `${outputTable}__sink${index}`;
        await this.dropTableIfExists(stagingTable);
        await this.runSql(
          `CREATE TABLE ${quoteIdentifier(stagingTable)} AS SELECT * FROM ${quoteIdentifier(sinkRelation)}`
        );
        await this.registerWorkflowNodeCache(sinkNode, stagingTable, cacheScope, cacheExpiresAt);
        nodeStats.push({
          nodeId: sinkNode.id,
          nodeType: 'output',
          inputRows: await this.countRows(sinkRelation),
          outputRows: await this.countRows(stagingTable),
        });
        stagedSinks.push({ nodeId: sinkNode.id, stagingTable });
      }
      rowCount = await this.countRows(outputTable);
      columnCount = (await this.getTableColumns(outputTable)).length;
    } else {
      const finalInputId = findWorkflowTerminalNodeId(nodes, edges);
      if (!finalInputId) {
        throw new Error('Workflow has no materialized output relation');
      }
      const finalRelation = await materializeNode(finalInputId);
      await this.runSql(
        `CREATE TABLE ${quoteIdentifier(outputTable)} AS SELECT * FROM ${quoteIdentifier(finalRelation)}`
      );
      rowCount = await this.countRows(outputTable);
      columnCount = (await this.getTableColumns(outputTable)).length;
    }
    if (outputMode === 'temporary') {
      return {
        outputTable,
        rowCount,
        columnCount,
        sourceDatasetId: null,
        nodeStats,
        watermarkUpdates,
        stagedSinks,
      };
    }
    if (stagedSinks.length > 1) {
      throw new Error(
        'Direct persisted writes support a single output sink; run temporary + commit instead'
      );
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
    return {
      outputTable,
      rowCount,
      columnCount,
      sourceDatasetId,
      nodeStats,
      watermarkUpdates,
      stagedSinks,
    };
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
      const outputTable = await this.requireOutputTable(outputDatasetId);
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

  protected async resolveWorkflowNodePreviewTable(
    task: DataCleaningTask,
    node: DataWorkflowNode
  ): Promise<string | null> {
    if (node.config.disabled === true) {
      return null;
    }
    if (node.type === 'input_source') {
      const source =
        typeof node.config.source === 'string'
          ? node.config.source
          : stringConfigValue(node.config.datasetId)
            ? 'dataset'
            : 'task';
      if (source === 'dataset') {
        const datasetRef =
          stringConfigValue(node.config.datasetId) ||
          stringConfigValue(node.config.inputTableId) ||
          stringConfigValue(node.config.sourceDatasetId) ||
          stringConfigValue(node.config.name) ||
          stringConfigValue(node.config.alias);
        if (!datasetRef) {
          return null;
        }
        const dataset = await this.findDatasetByReference(datasetRef);
        return dataset?.tableName ?? null;
      }
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

  protected async deleteWorkflowNodeCachesForTask(
    taskId: string,
    preservedTables: ReadonlySet<string> = new Set()
  ): Promise<void> {
    const rows = await this.metaQueryRows<DataWorkflowNodeCacheRow>(
      'SELECT * FROM data_workflow_node_caches WHERE task_id = $taskId',
      { taskId }
    );
    for (const row of rows) {
      const tableName = String(row.table_name);
      if (!preservedTables.has(tableName)) {
        await this.dropTableIfExists(tableName).catch(() => undefined);
      }
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
