import type { DataRawTable } from '../../shared/contracts';
import type {
  CreateRawTableCommand,
  GeneratePipelineFromRequirementCommand,
  RawTableResult,
  UpdateRawTableCommand,
} from './data-command-types';
import { CloudAnalysisCommandService } from './cloud-analysis-command-service';
import { DataCommandLockCoordinator } from './data-command-lock-coordinator';
import { DataCommandResources } from './data-command-resources';
import { WorkflowPreviewService } from './workflow-preview-service';
import {
  buildAutomationCloudMirrorInputName,
  hashFile,
  isDataCommandErrorCode,
  logDataCommandFallback,
  normalizeOptionalName,
  normalizeRequiredName,
} from './data-command-utils';
import { log } from '../utils/logger';
import { normalizeColumnSnapshot } from './workflow';

export interface PreparedGeneratedPipelineInput {
  rawTable: DataRawTable;
  columnsSnapshot: Array<{ name: string; type?: string }>;
}

interface AutomationRawTableCommands {
  createRawTable: (input: CreateRawTableCommand) => Promise<RawTableResult>;
  updateRawTable: (input: UpdateRawTableCommand) => Promise<RawTableResult>;
}

export class AutomationInputResolver {
  constructor(
    private readonly resources: DataCommandResources,
    private readonly locks: DataCommandLockCoordinator,
    private readonly preview: WorkflowPreviewService,
    private readonly rawTables: AutomationRawTableCommands,
    private readonly cloudAnalysis: CloudAnalysisCommandService
  ) {}

  async prepareGeneratedPipelineInput(
    input: Pick<GeneratePipelineFromRequirementCommand, 'source'>
  ): Promise<PreparedGeneratedPipelineInput> {
    if (input.source.location === 'cloud') {
      const imported = await this.refreshAutomationCloudMirrorRawTable(input.source);
      return {
        rawTable: imported.rawTable,
        columnsSnapshot: normalizeColumnSnapshot(
          imported.preview?.columnTypes,
          input.source.columnsSnapshot
        ),
      };
    }
    const rawTable = await this.resources.requireRawTable(
      normalizeRequiredName(input.source.tableId, 'Input table id is required')
    );
    let columnsSnapshot = normalizeColumnSnapshot(undefined, input.source.columnsSnapshot);
    if (columnsSnapshot.length === 0) {
      try {
        const tablePreview = await this.preview.previewRawTable(rawTable.id, 20);
        columnsSnapshot = normalizeColumnSnapshot(tablePreview.columnTypes);
      } catch (error) {
        logDataCommandFallback(
          'Failed to infer generated-pipeline columns from local preview',
          error,
          {
            rawTableId: rawTable.id,
          }
        );
        columnsSnapshot = [];
      }
    }
    return { rawTable, columnsSnapshot };
  }

  private async refreshAutomationCloudMirrorRawTable(
    source: GeneratePipelineFromRequirementCommand['source']
  ): Promise<RawTableResult> {
    const tableId = normalizeRequiredName(source.tableId, 'Cloud table id is required');
    const mirrorName = buildAutomationCloudMirrorInputName(source.tableName, tableId);
    return this.locks.withKeyedLock(`cloud-mirror:${mirrorName}`, async () => {
      const mirrorStartedAt = Date.now();
      const existing = await this.resources.findRawTableByExactName(mirrorName);
      const sourceVersion = normalizeOptionalName(source.updatedAt);
      const existingMirror =
        existing?.inputConfig.sourceKind === 'cloud' || existing?.inputConfig.sourceKind === 'csv'
          ? existing.inputConfig.cloudMirror
          : undefined;
      if (
        existing &&
        sourceVersion &&
        existingMirror?.tableId === tableId &&
        existingMirror.sourceVersion === sourceVersion
      ) {
        const result = await this.reuseAutomationCloudMirrorRawTable(existing);
        log('[DataCommandService] Reused unchanged cloud mirror input table', {
          tableId,
          mirrorName,
          mode: 'version_hit',
          sourceVersion,
          mirrorDurationMs: Date.now() - mirrorStartedAt,
        });
        return result;
      }
      const downloadStartedAt = Date.now();
      const downloaded = await this.cloudAnalysis.previewCloudTable({ tableId, limit: 50 });
      const downloadDurationMs = Date.now() - downloadStartedAt;
      const contentHash = source.contentHash || (await hashFile(downloaded.downloadedFilePath));
      if (
        existing &&
        existingMirror?.tableId === tableId &&
        existingMirror.contentHash === contentHash
      ) {
        const result = await this.reuseAutomationCloudMirrorRawTable(existing);
        log('[DataCommandService] Reused unchanged cloud mirror input table', {
          tableId,
          mirrorName,
          mode: 'hash_hit',
          contentHash,
          downloadDurationMs,
          mirrorDurationMs: Date.now() - mirrorStartedAt,
        });
        return result;
      }
      const mirrorConfig = {
        sourceKind: 'cloud' as const,
        cloudMirror: {
          tableId,
          sourceVersion,
          contentHash,
          syncedAt: Date.now(),
          spaceId: normalizeOptionalName(source.spaceId),
          projectId: normalizeOptionalName(source.projectId),
          spaceName: normalizeOptionalName(source.spaceName),
          projectName: normalizeOptionalName(source.projectName),
          tableName: normalizeOptionalName(source.tableName),
        },
      };
      if (existing) {
        const result = await this.updateAutomationCloudMirrorRawTable(
          existing.id,
          mirrorName,
          downloaded.downloadedFilePath,
          mirrorConfig
        );
        log('[DataCommandService] Refreshed cloud mirror input table', {
          tableId,
          mirrorName,
          mode: 'update',
          downloadDurationMs,
          mirrorDurationMs: Date.now() - mirrorStartedAt,
        });
        return result;
      }
      try {
        const result = await this.rawTables.createRawTable({
          name: mirrorName,
          sourceKind: 'cloud',
          filePath: downloaded.downloadedFilePath,
          config: mirrorConfig,
          previewRows: 50,
        });
        log('[DataCommandService] Refreshed cloud mirror input table', {
          tableId,
          mirrorName,
          mode: 'create',
          downloadDurationMs,
          mirrorDurationMs: Date.now() - mirrorStartedAt,
        });
        return result;
      } catch (error) {
        if (isDataCommandErrorCode(error, 'RESOURCE_ALREADY_EXISTS')) {
          const conflict = await this.resources.findRawTableByExactName(mirrorName);
          if (conflict) {
            return this.updateAutomationCloudMirrorRawTable(
              conflict.id,
              mirrorName,
              downloaded.downloadedFilePath,
              mirrorConfig
            );
          }
        }
        throw error;
      }
    });
  }

  private async updateAutomationCloudMirrorRawTable(
    id: string,
    name: string,
    filePath: string,
    config: Extract<DataRawTable['inputConfig'], { sourceKind: 'cloud' }>
  ): Promise<RawTableResult> {
    return this.rawTables.updateRawTable({
      id,
      name,
      sourceKind: 'cloud',
      filePath,
      config,
      previewRows: 50,
    });
  }

  private async reuseAutomationCloudMirrorRawTable(
    rawTable: DataRawTable
  ): Promise<RawTableResult> {
    return { rawTable, preview: await this.preview.previewRawTable(rawTable.id, 50) };
  }
}
