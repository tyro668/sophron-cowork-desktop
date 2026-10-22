/** Commits validated staging outputs with journaled rollback + recovery. */
import type { WatermarkUpdate } from '../repositories/watermark-repository';
import type { DataPipeline, DataWorkflowSaveInput } from '../../../../shared/contracts';
import { getWorkflowUpstreamSignature } from '../../../../shared/workflow-plan';
import type { WorkflowNodeRunStat } from '../../data-command-types';
import { quoteIdentifier, toNumber } from '../../operators';
import { DataStoreContext } from '../data-store-context';
import { tableNameFromId } from '../data-store-records';
import { RawTableRepository } from '../repositories/raw-table-repository';
import { OutputCommitJournal } from '../repositories/output-commit-journal';
import { RunStatsRepository } from '../repositories/run-stats-repository';
import { PipelineRepository } from '../repositories/pipeline-repository';
import { WatermarkRepository } from '../repositories/watermark-repository';
import { normalizeRuntimeWorkflowInput } from '../workflow-model';
import { WorkflowBindingResolver } from './workflow-binding-resolver';
import { v4 as uuidv4 } from 'uuid';

export class OutputCommitCoordinator {
  /** Called after a commit with the rawTable ids of every committed output table. */
  onOutputsCommitted?: (outputResultTableIds: string[]) => void;

  constructor(
    private readonly ctx: DataStoreContext,
    private readonly pipelines: PipelineRepository,
    private readonly rawTables: RawTableRepository,
    private readonly runStats: RunStatsRepository,
    private readonly watermarks: WatermarkRepository,
    private readonly journal: OutputCommitJournal,
    private readonly binding: WorkflowBindingResolver
  ) {}

  async commitValidatedPipelineOutput(
    id: string,
    temporaryPipeline: DataPipeline,
    workflow: DataWorkflowSaveInput,
    watermarkUpdates?: WatermarkUpdate[],
    nodeStats?: WorkflowNodeRunStat[],
    stagedSinks?: Array<{ nodeId: string; stagingTable: string }>,
    runId?: string
  ): Promise<DataPipeline> {
    return this.ctx.runExclusive(async () => {
      await this.ctx.ensureReady();
      const pipeline = await this.pipelines.requirePipeline(id);
      const temporaryTable = temporaryPipeline.resultTable;
      if (!temporaryTable || !(await this.ctx.physicalTableExists(temporaryTable))) {
        throw new Error('Validated temporary pipeline output is no longer available');
      }
      const runtimeWorkflow = normalizeRuntimeWorkflowInput(id, workflow, this.ctx.now());
      const nodeById = new Map(runtimeWorkflow.nodes.map((node) => [node.id, node]));
      const outputNodes = runtimeWorkflow.nodes.filter(
        (node) => node.type === 'output' && node.config.disabled !== true
      );
      // Every staged sink gets its own resolved target; the first sink keeps
      // the pipeline's primary output table for compatibility.
      const sinkInputs =
        stagedSinks && stagedSinks.length > 0
          ? stagedSinks
          : [{ nodeId: outputNodes[0]?.id ?? '', stagingTable: temporaryTable }];

      interface ResolvedTarget {
        tableName: string;
        outputResultTableId?: string;
        mode: 'replace' | 'append' | 'error_if_exists' | 'merge';
        mergeKeys: string[];
        schemaPolicy: 'extend' | 'strict' | 'ignore';
      }
      interface SinkPlan {
        journalId: string;
        nodeId: string;
        stagingTable: string;
        target: ResolvedTarget;
        backupTable: string;
        targetExisted: boolean;
        appendToExisting: boolean;
        tempReadSql: string;
        mergeKeyPredicate: string;
        finalRowCount: number;
      }

      const completedAt = this.ctx.now();
      const commitId = uuidv4();
      const sourceRawTableId =
        (await this.binding.findWorkflowSourceRawTableId(runtimeWorkflow.nodes)) ??
        pipeline.sourceRawTableId;
      const sinks: SinkPlan[] = [];
      const claimedTargets = new Set<string>();
      for (const [index, sink] of sinkInputs.entries()) {
        const outputNode = sink.nodeId ? nodeById.get(sink.nodeId) : undefined;
        const fallback =
          index === 0
            ? pipeline.resultTable || tableNameFromId('clean_pipeline', pipeline.id)
            : tableNameFromId('pipeline_sink', `${pipeline.id}_${sink.nodeId || index}`);
        const target = await this.binding.resolveWorkflowOutputTarget(outputNode, fallback);
        const targetKey = target.tableName.toLowerCase();
        if (claimedTargets.has(targetKey)) {
          throw new Error(
            `Output target "${target.tableName}" is claimed by more than one output sink`
          );
        }
        claimedTargets.add(targetKey);
        if (!(await this.ctx.physicalTableExists(sink.stagingTable))) {
          throw new Error(`Validated staging output ${sink.stagingTable} is no longer available`);
        }
        const rowCount = await this.ctx.countRows(sink.stagingTable);
        const targetExisted = await this.ctx.physicalTableExists(target.tableName);
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
          const existingColumns = await this.ctx.getTableColumns(target.tableName);
          const tempColumns = await this.ctx.getTableColumns(sink.stagingTable);
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
                  await this.ctx.queryRows<{ count: number | string }>(
                    `SELECT count(*) AS count FROM (${tempReadSql}) _dedup`
                  )
                )[0]?.count
              )
            : rowCount;
        const finalRowCount = !appendToExisting
          ? incomingCount
          : target.mode === 'append'
            ? rowCount + (await this.ctx.countRows(target.tableName))
            : (await this.countMergeSurvivors(target.tableName, tempReadSql, mergeKeyPredicate)) +
              incomingCount;
        sinks.push({
          journalId: index === 0 ? commitId : `${commitId}__${index}`,
          nodeId: sink.nodeId,
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
        await this.journal.insertPreparedCommit({
          id: sink.journalId,
          pipelineId: id,
          temporaryTable: sink.stagingTable,
          targetTable: sink.target.tableName,
          backupTable: sink.backupTable,
          targetExisted: sink.targetExisted,
          intendedMetadataJson: JSON.stringify({
            pipelineName: pipeline.name,
            sourcePath: temporaryPipeline.sourcePath,
            sourceRawTableId,
            outputResultTableId: sink.target.outputResultTableId ?? null,
            rowCount: sink.finalRowCount,
            nodeCount: runtimeWorkflow.nodes.length,
            // Persisted provenance: the committed output stays attributable to
            // the upstream config that generated it (preview staleness).
            workflowSignature: sink.nodeId
              ? getWorkflowUpstreamSignature(workflow, sink.nodeId)
              : null,
            completedAt,
          }),
          at: completedAt,
        });
      }

      let physicalCommitted = false;
      let metadataTransactionStarted = false;
      try {
        // One physical transaction covers every sink so partial writes roll back.
        await this.ctx.runSql('BEGIN TRANSACTION');
        for (const sink of sinks) {
          if (sink.targetExisted) {
            await this.ctx.dropTableIfExists(sink.backupTable);
            await this.ctx.runSql(
              `ALTER TABLE ${quoteIdentifier(sink.target.tableName)} RENAME TO ${quoteIdentifier(sink.backupTable)}`
            );
          }
          const survivingSql =
            sink.target.mode === 'merge'
              ? `SELECT * FROM ${quoteIdentifier(sink.backupTable)} b
                 WHERE NOT EXISTS (SELECT 1 FROM (${sink.tempReadSql}) t
                   WHERE ${sink.mergeKeyPredicate})`
              : `SELECT * FROM ${quoteIdentifier(sink.backupTable)}`;
          await this.ctx.runSql(
            sink.appendToExisting
              ? `CREATE TABLE ${quoteIdentifier(sink.target.tableName)} AS ${survivingSql} UNION ALL BY NAME ${sink.tempReadSql}`
              : `CREATE TABLE ${quoteIdentifier(sink.target.tableName)} AS ${sink.tempReadSql}`
          );
        }
        await this.ctx.runSql('COMMIT');
        physicalCommitted = true;
        for (const sink of sinks) {
          await this.journal.updateOutputCommitState(sink.journalId, 'data_committed');
        }

        await this.ctx.metaRunSql('BEGIN TRANSACTION');
        metadataTransactionStarted = true;
        for (const [index, sink] of sinks.entries()) {
          const finalColumnCount = sink.appendToExisting
            ? (await this.ctx.getTableColumns(sink.target.tableName)).length
            : (await this.ctx.getTableColumns(sink.stagingTable)).length;
          await this.rawTables.upsertRawTableForPipelineOutput(
            pipeline.name,
            temporaryPipeline.sourcePath,
            sink.target.tableName,
            sink.finalRowCount,
            finalColumnCount,
            sink.target.outputResultTableId
          );
          if (index === 0) {
            await this.pipelines.markPipelineCompleted(id, {
              nodeCount: runtimeWorkflow.nodes.length,
              sourcePath: temporaryPipeline.sourcePath,
              sourceRawTableId,
              resultTable: sink.target.tableName,
              rowCount: sink.finalRowCount,
              columnCount: finalColumnCount,
              at: completedAt,
            });
          }
        }
        if (watermarkUpdates && watermarkUpdates.length > 0) {
          await this.watermarks.upsertPipelineWatermark(id, watermarkUpdates);
        }
        if (nodeStats && nodeStats.length > 0) {
          await this.runStats.persistPipelineNodeStats(id, runId ?? commitId, nodeStats);
        }
        for (const sink of sinks) {
          await this.journal.updateOutputCommitState(sink.journalId, 'metadata_committed');
        }
        await this.ctx.metaRunSql('COMMIT');
        metadataTransactionStarted = false;
      } catch (error) {
        if (metadataTransactionStarted) {
          await this.ctx.metaRunSql('ROLLBACK').catch(() => undefined);
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
            await this.ctx.runSql('ROLLBACK');
          } catch {
            for (const sink of sinks) unrestoredSinks.add(sink.journalId);
          }
        }
        for (const sink of sinks) {
          if (unrestoredSinks.has(sink.journalId)) {
            // Keep the journal recoverable: startup recovery retries the
            // restore instead of trusting a 'failed' tombstone while the
            // physical state is unknown.
            await this.journal
              .updateOutputCommitState(
                sink.journalId,
                physicalCommitted ? 'data_committed' : 'prepared',
                `commit failed and restore also failed; pending recovery: ${message}`
              )
              .catch(() => undefined);
          } else {
            await this.journal
              .updateOutputCommitState(sink.journalId, 'failed', message)
              .catch(() => undefined);
          }
        }
        throw error;
      }

      for (const sink of sinks) {
        await this.ctx.dropTableIfExists(sink.backupTable).catch(() => undefined);
        await this.ctx.dropTableIfExists(sink.stagingTable).catch(() => undefined);
        await this.journal
          .updateOutputCommitState(sink.journalId, 'completed')
          .catch(() => undefined);
      }
      const committedRawTableIds = sinks
        .map((sink) => sink.target.outputResultTableId)
        .filter((rawTableId): rawTableId is string => Boolean(rawTableId));
      if (committedRawTableIds.length > 0) {
        try {
          this.onOutputsCommitted?.(committedRawTableIds);
        } catch {
          // Listener errors must never fail the commit.
        }
      }
      return this.pipelines.requirePipeline(id);
    }, `commitValidatedPipelineOutput:${id}`);
  }
  private async countMergeSurvivors(
    targetTable: string,
    temporaryTable: string,
    mergeKeyPredicate: string
  ): Promise<number> {
    const rows = await this.ctx.queryRows<{ count: number | string }>(
      `SELECT count(*) AS count FROM ${quoteIdentifier(targetTable)} b
       WHERE NOT EXISTS (SELECT 1 FROM (${temporaryTable}) t
         WHERE ${mergeKeyPredicate})`
    );
    return toNumber(rows[0]?.count);
  }
  private async restoreOutputCommit(input: {
    targetTable: string;
    backupTable: string;
    targetExisted: boolean;
  }): Promise<void> {
    await this.ctx.runSql('BEGIN TRANSACTION');
    try {
      if (input.targetExisted) {
        if (await this.ctx.physicalTableExists(input.backupTable)) {
          await this.ctx.dropTableIfExists(input.targetTable);
          await this.ctx.runSql(
            `ALTER TABLE ${quoteIdentifier(input.backupTable)} RENAME TO ${quoteIdentifier(input.targetTable)}`
          );
        }
      } else {
        await this.ctx.dropTableIfExists(input.targetTable);
      }
      await this.ctx.runSql('COMMIT');
    } catch (error) {
      await this.ctx.runSql('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }
  async recoverPendingOutputCommits(): Promise<void> {
    const rows = await this.journal.listPendingCommits();
    for (const row of rows) {
      const targetTable = String(row.target_table);
      const backupTable = String(row.backup_table);
      const targetExisted = toNumber(row.target_existed) === 1;
      if (row.state === 'metadata_committed') {
        await this.ctx.dropTableIfExists(backupTable).catch(() => undefined);
        await this.ctx.dropTableIfExists(String(row.temporary_table)).catch(() => undefined);
        await this.journal.updateOutputCommitState(String(row.id), 'completed');
        continue;
      }
      await this.restoreOutputCommit({ targetTable, backupTable, targetExisted });
      await this.journal.updateOutputCommitState(
        String(row.id),
        'failed',
        'Recovered an interrupted output commit by restoring the previous output table'
      );
    }
  }
}
