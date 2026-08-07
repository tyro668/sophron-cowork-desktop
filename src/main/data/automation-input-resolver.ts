import type { DataDataset } from '../../renderer/types';
import type {
  CreateInputTableCommand,
  GenerateTaskFromRequirementCommand,
  InputTableResult,
  UpdateInputTableCommand,
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

export interface PreparedGeneratedTaskInput {
  inputTable: DataDataset;
  columnsSnapshot: Array<{ name: string; type?: string }>;
}

interface AutomationInputTableCommands {
  createInputTable: (input: CreateInputTableCommand) => Promise<InputTableResult>;
  updateInputTable: (input: UpdateInputTableCommand) => Promise<InputTableResult>;
}

export class AutomationInputResolver {
  constructor(
    private readonly resources: DataCommandResources,
    private readonly locks: DataCommandLockCoordinator,
    private readonly preview: WorkflowPreviewService,
    private readonly inputTables: AutomationInputTableCommands,
    private readonly cloudAnalysis: CloudAnalysisCommandService
  ) {}

  async prepareGeneratedTaskInput(
    input: Pick<GenerateTaskFromRequirementCommand, 'source'>
  ): Promise<PreparedGeneratedTaskInput> {
    if (input.source.location === 'cloud') {
      const imported = await this.refreshAutomationCloudMirrorInputTable(input.source);
      return {
        inputTable: imported.inputTable,
        columnsSnapshot: normalizeColumnSnapshot(
          imported.preview?.columnTypes,
          input.source.columnsSnapshot
        ),
      };
    }
    const inputTable = await this.resources.requireInputTable(
      normalizeRequiredName(input.source.tableId, 'Input table id is required')
    );
    let columnsSnapshot = normalizeColumnSnapshot(undefined, input.source.columnsSnapshot);
    if (columnsSnapshot.length === 0) {
      try {
        const tablePreview = await this.preview.previewDataset(inputTable.id, 20);
        columnsSnapshot = normalizeColumnSnapshot(tablePreview.columnTypes);
      } catch (error) {
        logDataCommandFallback('Failed to infer generated-task columns from local preview', error, {
          inputTableId: inputTable.id,
        });
        columnsSnapshot = [];
      }
    }
    return { inputTable, columnsSnapshot };
  }

  private async refreshAutomationCloudMirrorInputTable(
    source: GenerateTaskFromRequirementCommand['source']
  ): Promise<InputTableResult> {
    const tableId = normalizeRequiredName(source.tableId, 'Cloud table id is required');
    const mirrorName = buildAutomationCloudMirrorInputName(source.tableName, tableId);
    return this.locks.withKeyedLock(`cloud-mirror:${mirrorName}`, async () => {
      const mirrorStartedAt = Date.now();
      const existing = await this.resources.findInputTableByExactName(mirrorName);
      const sourceVersion = normalizeOptionalName(source.updatedAt);
      const existingMirror =
        existing?.inputConfig.sourceKind === 'csv' ? existing.inputConfig.cloudMirror : undefined;
      if (
        existing &&
        sourceVersion &&
        existingMirror?.tableId === tableId &&
        existingMirror.sourceVersion === sourceVersion
      ) {
        const result = await this.reuseAutomationCloudMirrorInputTable(existing);
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
        const result = await this.reuseAutomationCloudMirrorInputTable(existing);
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
        sourceKind: 'csv' as const,
        header: 'auto' as const,
        dataRegion: 'auto' as const,
        encoding: 'auto' as const,
        delimiter: 'auto' as const,
        cloudMirror: { tableId, sourceVersion, contentHash },
      };
      if (existing) {
        const result = await this.updateAutomationCloudMirrorInputTable(
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
        const result = await this.inputTables.createInputTable({
          name: mirrorName,
          sourceKind: 'csv',
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
          const conflict = await this.resources.findInputTableByExactName(mirrorName);
          if (conflict) {
            return this.updateAutomationCloudMirrorInputTable(
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

  private async updateAutomationCloudMirrorInputTable(
    id: string,
    name: string,
    filePath: string,
    config: Extract<DataDataset['inputConfig'], { sourceKind: 'csv' }>
  ): Promise<InputTableResult> {
    return this.inputTables.updateInputTable({
      id,
      name,
      sourceKind: 'csv',
      filePath,
      config,
      previewRows: 50,
    });
  }

  private async reuseAutomationCloudMirrorInputTable(
    inputTable: DataDataset
  ): Promise<InputTableResult> {
    return { inputTable, preview: await this.preview.previewDataset(inputTable.id, 50) };
  }
}
