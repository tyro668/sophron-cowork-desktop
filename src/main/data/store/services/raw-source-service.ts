/**
 * Raw-table sources (1:N): a file or folder produces one or more raw tables according to its
 * build mode. Scans a source for the wizard, creates / refreshes / rebuilds its tables, and
 * reports which pipelines a rebuild would break. Each member table stays an ordinary raw table.
 */
import * as fs from 'fs';
import { basename, join, relative } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  DataCreateRawSourceInput,
  DataRawSource,
  DataRawSourceBuildMode,
  DataRawSourceConfig,
  DataRawSourceCreateResult,
  DataRawSourceFileScan,
  DataRawSourceKind,
  DataRawSourceRebuildImpact,
  DataRawSourceRefreshResult,
  DataRawSourceScan,
  DataRawSourceSheetScan,
  DataRawTable,
  DataRawTableConfig,
  DataRebuildRawSourceInput,
  DataScanRawSourceInput,
} from '../../../../shared/contracts';
import { DataStoreContext } from '../data-store-context';
import { tableNameFromId } from '../data-store-records';
import {
  defaultExcelConfig,
  defaultFolderConfig,
  getWorkbookSheetNames,
  isExcelFile,
  isFolderRangeFile,
  normalizeImportSourcePath,
  normalizeSheetSelector,
  parseWorkbookRows,
  rawTableNameFromPath,
  resolveSheetBySelector,
} from '../input-source';
import { RawSourceRepository } from '../repositories/raw-source-repository';
import { RawTableRepository } from '../repositories/raw-table-repository';
import {
  RawTableService,
  SOURCE_FILE_SYSTEM_COLUMN,
  findFilledColumns,
  findTypeConflicts,
} from './raw-table-service';

const MULTI_TABLE_MODES: ReadonlySet<DataRawSourceBuildMode> = new Set([
  'excel_per_sheet',
  'folder_per_file',
]);

function stem(path: string): string {
  return rawTableNameFromPath(path);
}

export class RawSourceService {
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly sources: RawSourceRepository,
    private readonly rawTableRepo: RawTableRepository,
    private readonly rawTables: RawTableService
  ) {}

  async listSources(): Promise<DataRawSource[]> {
    await this.ctx.ensureMetadataReady();
    return this.sources.listSources();
  }

  async getSource(id: string): Promise<DataRawSource | null> {
    await this.ctx.ensureMetadataReady();
    return this.sources.getSource(id);
  }

  // ---- scan ---------------------------------------------------------------------------------

  async scanSource(input: DataScanRawSourceInput): Promise<DataRawSourceScan> {
    await this.ctx.ensureReady();
    const sourcePath = normalizeImportSourcePath(input.sourcePath);
    const stat = fs.statSync(sourcePath);
    if (stat.isFile()) {
      const excel = isExcelFile(sourcePath);
      return {
        sourcePath,
        kind: excel ? 'excel' : 'csv',
        name: basename(sourcePath),
        sizeBytes: stat.size,
        sheets: excel ? scanWorkbookSheets(sourcePath) : [],
        files: [],
        merge: null,
      };
    }
    const files = await this.ctx.runExclusive(
      () => this.scanFolderFiles(sourcePath, input),
      `scanRawSource:${sourcePath}`
    );
    const ready = files.filter((file) => file.status === 'ready');
    return {
      sourcePath,
      kind: 'folder',
      name: basename(sourcePath),
      sizeBytes: 0,
      sheets: [],
      files,
      merge: {
        fileCount: ready.length,
        rowCount: ready.reduce((sum, file) => sum + file.rowCount, 0),
        filledColumns: findFilledColumns(
          ready.map((file) => ({ file: file.relativePath, columns: file.columns }))
        ),
      },
    };
  }

  private async scanFolderFiles(
    folderPath: string,
    input: DataScanRawSourceInput
  ): Promise<DataRawSourceFileScan[]> {
    const selector = normalizeSheetSelector(input.sheetSelector);
    const overrides = input.fileSheetOverrides ?? {};
    const out: DataRawSourceFileScan[] = [];
    const typed: Array<{ file: string; types: Array<{ name: string; type: string }> }> = [];
    for (const filePath of listFolderEntries(folderPath, input.fileRange ?? 'excel_csv')) {
      const relativePath = relative(folderPath, filePath);
      const name = basename(filePath);
      const kind = isExcelFile(filePath) ? 'excel' : 'csv';
      const base: DataRawSourceFileScan = {
        path: filePath,
        relativePath,
        kind,
        status: 'ready',
        sheetNames: [],
        usedSheet: null,
        rowCount: 0,
        columns: [],
      };
      if (name.startsWith('~$') || name.startsWith('.')) {
        out.push({ ...base, status: 'skipped', reason: 'temp_file' });
        continue;
      }
      let config: DataRawTableConfig = {
        sourceKind: 'csv',
        header: 'auto',
        dataRegion: 'auto',
        encoding: 'auto',
        delimiter: 'auto',
      };
      if (kind === 'excel') {
        try {
          base.sheetNames = getWorkbookSheetNames(filePath);
        } catch (error) {
          out.push({ ...base, status: 'unreadable', reason: errorText(error) });
          continue;
        }
        const override = overrides[relativePath];
        base.usedSheet =
          override && base.sheetNames.includes(override)
            ? override
            : resolveSheetBySelector(selector, base.sheetNames);
        if (!base.usedSheet) {
          out.push({ ...base, status: 'missing_sheet' });
          continue;
        }
        config = { ...defaultExcelConfig(filePath), sheetName: base.usedSheet };
      }
      const tempTable = tableNameFromId('rawSource_scan', uuidv4());
      try {
        await this.rawTables.createImportTempTable(tempTable, filePath, 0, true, config);
        const types = await this.ctx.inferTableColumnTypes(tempTable);
        base.rowCount = await this.ctx.countRows(tempTable);
        base.columns = types.map((column) => column.name);
        typed.push({ file: relativePath, types });
        out.push(base);
      } catch (error) {
        out.push({ ...base, status: 'unreadable', reason: errorText(error) });
      } finally {
        await this.ctx.dropTableIfExists(tempTable).catch(() => undefined);
      }
    }
    const conflicts = findTypeConflicts(typed);
    for (const file of out) {
      const columns = conflicts.get(file.relativePath);
      if (file.status === 'ready' && columns) {
        file.status = 'type_conflict';
        file.conflictColumns = columns;
      }
    }
    return out;
  }

  // ---- create -------------------------------------------------------------------------------

  async createSource(
    input: DataCreateRawSourceInput,
    existingSourceId?: string
  ): Promise<DataRawSourceCreateResult> {
    await this.ctx.ensureReady();
    const sourcePath = normalizeImportSourcePath(input.sourcePath);
    const isFolder = fs.statSync(sourcePath).isDirectory();
    const sourceKind: DataRawSourceKind = isFolder
      ? 'folder'
      : isExcelFile(sourcePath)
        ? 'excel'
        : 'csv';
    const buildMode = validateBuildMode(input.buildMode, sourceKind);
    const sheetSelector = normalizeSheetSelector(input.sheetSelector);
    const config: DataRawSourceConfig = {
      autoInclude: input.autoInclude !== false && MULTI_TABLE_MODES.has(buildMode),
      ...(sheetSelector ? { sheetSelector } : {}),
      ...(input.fileSheetOverrides ? { fileSheetOverrides: input.fileSheetOverrides } : {}),
      ...(input.excludedFiles?.length ? { excludedFiles: input.excludedFiles } : {}),
      ...(input.fileRange ? { fileRange: input.fileRange } : {}),
      lastScannedAt: this.ctx.now(),
    };
    const sourceId = existingSourceId ?? uuidv4();
    const sourceName = input.name?.trim() || basename(sourcePath);
    const at = this.ctx.now();
    if (existingSourceId && (await this.sources.getSource(existingSourceId))) {
      await this.sources.updateSource({
        id: sourceId,
        name: sourceName,
        sourcePath,
        sourceKind,
        buildMode,
        config,
        at,
      });
    } else {
      await this.sources.insertSource({
        id: sourceId,
        name: sourceName,
        sourcePath,
        sourceKind,
        buildMode,
        config,
        at,
      });
    }
    const tables: DataRawTable[] = [];
    const skipped: DataRawSourceCreateResult['skipped'] = [];
    try {
      const plans = await this.planMembers(sourcePath, sourceKind, buildMode, input, skipped);
      for (const plan of plans) {
        try {
          tables.push(
            await this.rawTables.importRawTable({
              filePath: plan.filePath,
              name: plan.name,
              sourceKind: plan.sourceKind,
              config: plan.config,
              sourceId,
              memberKey: plan.memberKey,
            })
          );
        } catch (error) {
          if (plans.length === 1) throw error;
          skipped.push({ key: plan.memberKey ?? plan.name, reason: errorText(error) });
        }
      }
      if (tables.length === 0) {
        throw new Error(
          `No table could be created from ${sourceName}${
            skipped.length ? `: ${skipped.map((s) => `${s.key} (${s.reason})`).join('; ')}` : ''
          }`
        );
      }
    } catch (error) {
      for (const table of tables) await this.rawTables.deleteRawTable(table.id).catch(() => false);
      await this.sources.deleteSourceRow(sourceId).catch(() => undefined);
      throw error;
    }
    const known = await this.currentMemberKeys(sourcePath, sourceKind, buildMode, config);
    await this.sources.updateSource({
      id: sourceId,
      config: { ...config, ...(input.sheets ? { sheets: input.sheets } : {}), knownMembers: known },
      at: this.ctx.now(),
    });
    return { source: await this.sources.requireSource(sourceId), tables, skipped };
  }

  private async planMembers(
    sourcePath: string,
    _sourceKind: DataRawSourceKind,
    buildMode: DataRawSourceBuildMode,
    input: DataCreateRawSourceInput,
    skipped: DataRawSourceCreateResult['skipped']
  ): Promise<
    Array<{
      filePath: string;
      name: string;
      sourceKind: 'excel' | 'csv' | 'folder';
      config?: DataRawTableConfig;
      memberKey: string | null;
    }>
  > {
    const fileStem = stem(sourcePath);
    if (buildMode === 'single') {
      return [
        {
          filePath: sourcePath,
          name: input.tableName?.trim() || input.members?.[0]?.name?.trim() || fileStem,
          sourceKind: 'csv',
          memberKey: null,
        },
      ];
    }
    if (buildMode === 'excel_single' || buildMode === 'excel_per_sheet') {
      const sheetNames = getWorkbookSheetNames(sourcePath);
      const members = input.members?.length
        ? input.members
        : buildMode === 'excel_single'
          ? [{ key: sheetNames[0] }]
          : sheetNames.map((key) => ({ key }));
      if (buildMode === 'excel_single' && members.length !== 1) {
        throw new Error('excel_single builds exactly one table; pick one sheet');
      }
      return members.map((member) => {
        if (!sheetNames.includes(member.key)) {
          throw new Error(
            `Sheet "${member.key}" not found in ${basename(sourcePath)}. Available sheets: ${sheetNames.join(', ')}`
          );
        }
        return {
          filePath: sourcePath,
          name:
            member.name?.trim() ||
            (buildMode === 'excel_single' ? fileStem : `${fileStem} / ${member.key}`),
          sourceKind: 'excel' as const,
          config: {
            ...defaultExcelConfig(sourcePath),
            sheetName: member.key,
            ...(member.headerRow
              ? { headerMode: 'manual' as const, headerRow: member.headerRow }
              : {}),
          },
          memberKey: member.key,
        };
      });
    }
    if (buildMode === 'excel_merge_sheets') {
      const sheetNames = getWorkbookSheetNames(sourcePath);
      const sheets = (input.sheets ?? []).filter((sheet) => sheetNames.includes(sheet));
      if (sheets.length < 2) throw new Error('Pick at least two sheets to merge into one table');
      return [
        {
          filePath: sourcePath,
          name: input.tableName?.trim() || `${fileStem}（合并）`,
          sourceKind: 'excel',
          config: { ...defaultExcelConfig(sourcePath), sheetName: sheets[0], mergeSheets: sheets },
          memberKey: null,
        },
      ];
    }
    if (buildMode === 'folder_merge') {
      return [
        {
          filePath: sourcePath,
          name: input.tableName?.trim() || `${fileStem}（合并）`,
          sourceKind: 'folder',
          config: {
            ...defaultFolderConfig(),
            ...(input.fileRange ? { fileRange: input.fileRange } : {}),
            ...(normalizeSheetSelector(input.sheetSelector)
              ? { sheetSelector: normalizeSheetSelector(input.sheetSelector) }
              : {}),
            ...(input.excludedFiles?.length ? { excludedFiles: input.excludedFiles } : {}),
          },
          memberKey: null,
        },
      ];
    }
    // folder_per_file
    const scan = await this.ctx.runExclusive(
      () =>
        this.scanFolderFiles(sourcePath, {
          sourcePath,
          sheetSelector: input.sheetSelector,
          fileSheetOverrides: input.fileSheetOverrides,
          fileRange: input.fileRange,
        }),
      `planRawSource:${sourcePath}`
    );
    const wanted = input.members?.length ? new Map(input.members.map((m) => [m.key, m])) : null;
    const excluded = new Set(input.excludedFiles ?? []);
    const plans = [];
    for (const file of scan) {
      if (excluded.has(file.relativePath)) continue;
      if (wanted && !wanted.has(file.relativePath)) continue;
      const member = wanted?.get(file.relativePath);
      const sheet = member?.sheetName ?? file.usedSheet;
      // In per-file mode a type conflict between files does not matter.
      if (file.status !== 'ready' && file.status !== 'type_conflict' && !member?.sheetName) {
        skipped.push({ key: file.relativePath, reason: file.reason ?? file.status });
        continue;
      }
      if (file.kind === 'excel' && sheet && !file.sheetNames.includes(sheet)) {
        skipped.push({ key: file.relativePath, reason: 'missing_sheet' });
        continue;
      }
      plans.push({
        filePath: file.path,
        name: member?.name?.trim() || `${fileStem} / ${stem(file.relativePath)}`,
        sourceKind: file.kind,
        config:
          file.kind === 'excel'
            ? ({
                ...defaultExcelConfig(file.path),
                sheetName: sheet ?? file.sheetNames[0],
              } as DataRawTableConfig)
            : undefined,
        memberKey: file.relativePath,
      });
    }
    return plans;
  }

  /** Sheets (per-sheet) or files (per-file) currently present in the source. */
  private async currentMemberKeys(
    sourcePath: string,
    sourceKind: DataRawSourceKind,
    buildMode: DataRawSourceBuildMode,
    config: DataRawSourceConfig
  ): Promise<string[]> {
    try {
      if (buildMode === 'excel_per_sheet') return getWorkbookSheetNames(sourcePath);
      if (buildMode === 'folder_per_file' && sourceKind === 'folder') {
        return listFolderEntries(sourcePath, config.fileRange ?? 'excel_csv')
          .map((file) => relative(sourcePath, file))
          .filter((file) => !basename(file).startsWith('~$'));
      }
    } catch {
      return [];
    }
    return [];
  }

  // ---- refresh ------------------------------------------------------------------------------

  /** Re-imports every table of the source; per-sheet / per-file sources also pick up new
   *  sheets / files (when auto-include is on) and flag members that disappeared. */
  async refreshSource(id: string): Promise<DataRawSourceRefreshResult> {
    await this.ctx.ensureReady();
    const source = await this.sources.requireSource(id);
    const result: DataRawSourceRefreshResult = {
      source,
      refreshed: [],
      added: [],
      missing: [],
      failed: [],
    };
    const members = await Promise.all(
      source.memberIds.map((m) => this.rawTableRepo.requireRawTable(m))
    );
    const present = new Set(
      await this.currentMemberKeys(
        source.sourcePath,
        source.sourceKind,
        source.buildMode,
        source.config
      )
    );
    const tracksMembers =
      source.buildMode === 'excel_per_sheet' ||
      source.buildMode === 'folder_per_file' ||
      source.buildMode === 'excel_single';
    if (source.buildMode === 'excel_single') {
      try {
        for (const sheet of getWorkbookSheetNames(source.sourcePath)) present.add(sheet);
      } catch {
        // file gone: every member is missing
      }
    }
    for (const member of members) {
      if (tracksMembers && member.memberKey && !present.has(member.memberKey)) {
        await this.sources.setMemberStatus(member.id, 'missing');
        result.missing.push(member.id);
        continue;
      }
      try {
        await this.rawTables.updateRawTable({ id: member.id, config: member.inputConfig });
        await this.sources.setMemberStatus(member.id, 'ok');
        result.refreshed.push(member.id);
      } catch (error) {
        result.failed.push({ id: member.id, error: errorText(error) });
      }
    }
    if (MULTI_TABLE_MODES.has(source.buildMode) && source.config.autoInclude) {
      const known = new Set([
        ...(source.config.knownMembers ?? []),
        ...members.map((m) => m.memberKey).filter((k): k is string => Boolean(k)),
      ]);
      const fresh = [...present].filter((key) => !known.has(key));
      if (fresh.length > 0) {
        const skipped: DataRawSourceCreateResult['skipped'] = [];
        const plans = await this.planMembers(
          source.sourcePath,
          source.sourceKind,
          source.buildMode,
          {
            sourcePath: source.sourcePath,
            buildMode: source.buildMode,
            members: fresh.map((key) => ({ key })),
            sheetSelector: source.config.sheetSelector,
            fileSheetOverrides: source.config.fileSheetOverrides,
            fileRange: source.config.fileRange,
          },
          skipped
        ).catch(() => []);
        for (const plan of plans) {
          try {
            const table = await this.rawTables.importRawTable({
              filePath: plan.filePath,
              name: plan.name,
              sourceKind: plan.sourceKind,
              config: plan.config,
              sourceId: source.id,
              memberKey: plan.memberKey,
            });
            result.added.push(table.id);
          } catch (error) {
            result.failed.push({ id: plan.memberKey ?? plan.name, error: errorText(error) });
          }
        }
      }
    }
    await this.sources.updateSource({
      id: source.id,
      config: { ...source.config, knownMembers: [...present], lastScannedAt: this.ctx.now() },
      at: this.ctx.now(),
    });
    result.source = await this.sources.requireSource(source.id);
    return result;
  }

  // ---- rebuild / delete ---------------------------------------------------------------------

  async getRebuildImpact(id: string): Promise<DataRawSourceRebuildImpact> {
    await this.ctx.ensureMetadataReady();
    const source = await this.sources.requireSource(id);
    const tables = [];
    for (const memberId of source.memberIds) {
      const table = await this.rawTableRepo.requireRawTable(memberId);
      tables.push({
        id: table.id,
        name: table.name,
        rowCount: table.rowCount,
        pipelineNames: await this.pipelinesReferencing(table.id),
      });
    }
    return { sourceId: id, tables };
  }

  /** Changing the build mode deletes the source's tables and creates them again. */
  async rebuildSource(input: DataRebuildRawSourceInput): Promise<DataRawSourceCreateResult> {
    if (input.confirmDeleteExistingTables !== true) {
      throw new Error(
        'E_REBUILD_NOT_CONFIRMED: changing the build mode deletes the existing tables; confirm first'
      );
    }
    const source = await this.sources.requireSource(input.sourceId);
    for (const memberId of source.memberIds) {
      await this.rawTables.deleteRawTable(memberId);
    }
    return this.createSource(
      {
        ...input,
        sourcePath: input.sourcePath || source.sourcePath,
        name: input.name ?? source.name,
      },
      source.id
    );
  }

  async deleteSource(id: string): Promise<boolean> {
    const source = await this.sources.getSource(id);
    if (!source) return false;
    for (const memberId of source.memberIds) await this.rawTables.deleteRawTable(memberId);
    await this.sources.deleteSourceRow(id);
    return true;
  }

  private async pipelinesReferencing(rawTableId: string): Promise<string[]> {
    const rows = await this.ctx.metaQueryRows<{ name: string }>(
      `SELECT DISTINCT p.name AS name
         FROM data_workflow_nodes n JOIN data_pipelines p ON p.id = n.pipeline_id
        WHERE n.config_json LIKE $pattern
        ORDER BY p.name`,
      { pattern: `%${rawTableId}%` }
    );
    return rows.map((row) => String(row.name));
  }
}

function validateBuildMode(
  mode: DataRawSourceBuildMode,
  kind: DataRawSourceKind
): DataRawSourceBuildMode {
  const allowed: Record<DataRawSourceKind, DataRawSourceBuildMode[]> = {
    excel: ['excel_single', 'excel_per_sheet', 'excel_merge_sheets'],
    folder: ['folder_merge', 'folder_per_file'],
    csv: ['single'],
    cloud: ['single'],
  };
  if (!allowed[kind].includes(mode)) {
    throw new Error(
      `Build mode ${mode} does not apply to a ${kind} source; use one of: ${allowed[kind].join(', ')}`
    );
  }
  return mode;
}

function scanWorkbookSheets(filePath: string): DataRawSourceSheetScan[] {
  const base = defaultExcelConfig(filePath);
  return base.sheetNames.map((name) => {
    try {
      const parsed = parseWorkbookRows(filePath, { ...base, sheetName: name });
      const columns = parsed.columns;
      return {
        name,
        rowCount: parsed.rows.length,
        columnCount: columns.length,
        columns,
        empty: columns.length === 0 || parsed.rows.length === 0,
      };
    } catch {
      return { name, rowCount: 0, columnCount: 0, columns: [], empty: true };
    }
  });
}

/** Every file of the folder (recursive), including temp files so the scan can list them. */
function listFolderEntries(
  folderPath: string,
  fileRange: NonNullable<DataRawSourceConfig['fileRange']>
): string[] {
  const out: string[] = [];
  const visit = (directory: string) => {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && isFolderRangeFile(entryPath, fileRange)) out.push(entryPath);
    }
  };
  visit(folderPath);
  return out;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { SOURCE_FILE_SYSTEM_COLUMN };
