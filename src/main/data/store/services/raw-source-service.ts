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
  DataRawSourceChangeItem,
  DataRawSourceRenameCandidate,
  DataResolveRawSourceRenamesInput,
  DataResolveRawSourceRenamesResult,
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
   *  sheets / files (when auto-include is on) and flag members that disappeared. A missing
   *  member whose fingerprint matches a new sheet / file is reported as a suspected rename and
   *  left untouched until the user resolves it (resolveRenames). */
  async refreshSource(id: string): Promise<DataRawSourceRefreshResult> {
    await this.ctx.ensureReady();
    const source = await this.sources.requireSource(id);
    const result: DataRawSourceRefreshResult = {
      source,
      refreshed: [],
      added: [],
      missing: [],
      failed: [],
      renames: [],
      addedItems: [],
      missingItems: [],
      unchangedNames: [],
    };
    if (source.sourceKind === 'cloud') {
      throw new Error(
        'E_CLOUD_SOURCE_REFRESH: cloud tables are refreshed by cloud sync, not from a local path'
      );
    }
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
    const memberKeys = new Set(
      members.map((m) => m.memberKey).filter((k): k is string => Boolean(k))
    );
    const known = new Set([...(source.config.knownMembers ?? []), ...memberKeys]);
    const fresh = [...present].filter((key) => !known.has(key) && !memberKeys.has(key));
    const gone = tracksMembers
      ? members.filter((m) => m.memberKey && !present.has(m.memberKey))
      : [];
    result.renames = await this.detectRenames(source, gone, fresh);
    const renamedIds = new Set(result.renames.map((r) => r.tableId));
    const renameTargets = new Set(result.renames.map((r) => r.newKey));

    for (const member of members) {
      if (renamedIds.has(member.id)) continue;
      if (tracksMembers && member.memberKey && !present.has(member.memberKey)) {
        await this.sources.setMemberStatus(member.id, 'missing');
        result.missing.push(member.id);
        result.missingItems.push(await this.changeItem(member));
        continue;
      }
      try {
        await this.rawTables.updateRawTable({ id: member.id, config: member.inputConfig });
        await this.sources.setMemberStatus(member.id, 'ok');
        result.refreshed.push(member.id);
        result.unchangedNames.push(member.name);
      } catch (error) {
        result.failed.push({ id: member.id, error: errorText(error) });
      }
    }
    if (MULTI_TABLE_MODES.has(source.buildMode) && source.config.autoInclude) {
      const toAdd = fresh.filter((key) => !renameTargets.has(key));
      await this.importNewMembers(source, toAdd, result.added, result.failed);
      for (const tableId of result.added) {
        result.addedItems.push(
          await this.changeItem(await this.rawTableRepo.requireRawTable(tableId))
        );
      }
    }
    await this.sources.updateSource({
      id: source.id,
      config: {
        ...source.config,
        // Rename targets stay "unknown" so an unresolved rename is detected again next time.
        knownMembers: [...present].filter((key) => !renameTargets.has(key)),
        lastScannedAt: this.ctx.now(),
      },
      at: this.ctx.now(),
    });
    result.source = await this.sources.requireSource(source.id);
    return result;
  }

  /** Applies the user's rename decisions from the refresh dialog. */
  async resolveRenames(
    input: DataResolveRawSourceRenamesInput
  ): Promise<DataResolveRawSourceRenamesResult> {
    await this.ctx.ensureReady();
    const source = await this.sources.requireSource(input.sourceId);
    const out: DataResolveRawSourceRenamesResult = {
      source,
      renamed: [],
      added: [],
      missing: [],
      failed: [],
    };
    const asNew: string[] = [];
    for (const decision of input.decisions) {
      if (!source.memberIds.includes(decision.tableId)) {
        out.failed.push({ id: decision.tableId, error: 'Table is not a member of this source' });
        continue;
      }
      const table = await this.rawTableRepo.requireRawTable(decision.tableId);
      if (decision.action === 'new') {
        await this.sources.setMemberStatus(table.id, 'missing');
        out.missing.push(table.id);
        asNew.push(decision.newKey);
        continue;
      }
      try {
        const rebound = this.reboundMember(source, table, decision.newKey);
        await this.rawTables.updateRawTable({
          id: table.id,
          filePath: rebound.filePath,
          config: rebound.config,
        });
        await this.sources.setMemberKey(table.id, decision.newKey);
        await this.sources.setMemberStatus(table.id, 'ok');
        out.renamed.push(table.id);
      } catch (error) {
        out.failed.push({ id: table.id, error: errorText(error) });
      }
    }
    await this.importNewMembers(source, asNew, out.added, out.failed);
    const decided = new Set(input.decisions.map((d) => d.newKey));
    await this.sources.updateSource({
      id: source.id,
      config: {
        ...source.config,
        knownMembers: [...new Set([...(source.config.knownMembers ?? []), ...decided])],
      },
      at: this.ctx.now(),
    });
    out.source = await this.sources.requireSource(source.id);
    return out;
  }

  private reboundMember(
    source: DataRawSource,
    table: DataRawTable,
    newKey: string
  ): { filePath?: string; config: DataRawTableConfig } {
    if (source.buildMode === 'folder_per_file') {
      const filePath = join(source.sourcePath, newKey);
      if (table.inputConfig.sourceKind === 'excel' && isExcelFile(filePath)) {
        const sheets = getWorkbookSheetNames(filePath);
        const sheet =
          source.config.fileSheetOverrides?.[newKey] ??
          resolveSheetBySelector(normalizeSheetSelector(source.config.sheetSelector), sheets) ??
          sheets[0];
        return { filePath, config: { ...defaultExcelConfig(filePath), sheetName: sheet } };
      }
      return { filePath, config: table.inputConfig };
    }
    if (table.inputConfig.sourceKind !== 'excel') {
      throw new Error('Only Excel sheets and folder files can be re-bound');
    }
    return { config: { ...table.inputConfig, sheetName: newKey } };
  }

  private async importNewMembers(
    source: DataRawSource,
    keys: string[],
    added: string[],
    failed: Array<{ id: string; error: string }>
  ): Promise<void> {
    if (keys.length === 0) return;
    const mode = source.buildMode === 'excel_single' ? 'excel_per_sheet' : source.buildMode;
    const skipped: DataRawSourceCreateResult['skipped'] = [];
    const plans = await this.planMembers(
      source.sourcePath,
      source.sourceKind,
      mode,
      {
        sourcePath: source.sourcePath,
        buildMode: mode,
        members: keys.map((key) => ({ key })),
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
        added.push(table.id);
      } catch (error) {
        failed.push({ id: plan.memberKey ?? plan.name, error: errorText(error) });
      }
    }
  }

  private async changeItem(table: DataRawTable): Promise<DataRawSourceChangeItem> {
    return {
      id: table.id,
      name: table.name,
      key: table.memberKey ?? null,
      pipelineNames: await this.pipelinesReferencing(table.id),
    };
  }

  /** Pairs each vanished member with the most similar new sheet / file (>= threshold). */
  private async detectRenames(
    source: DataRawSource,
    gone: DataRawTable[],
    fresh: string[]
  ): Promise<DataRawSourceRenameCandidate[]> {
    if (gone.length === 0 || fresh.length === 0) return [];
    const candidates = new Map<string, Fingerprint | null>();
    for (const key of fresh) {
      candidates.set(key, await this.candidateFingerprint(source, key).catch(() => null));
    }
    const out: DataRawSourceRenameCandidate[] = [];
    const taken = new Set<string>();
    for (const table of gone) {
      const old = await this.storedFingerprint(table).catch(() => null);
      if (!old) continue;
      let best: { key: string; score: number } | null = null;
      for (const [key, fp] of candidates) {
        if (!fp || taken.has(key)) continue;
        const score = fingerprintSimilarity(old, fp);
        if (!best || score > best.score) best = { key, score };
      }
      if (best && best.score >= RENAME_SIMILARITY_THRESHOLD) {
        taken.add(best.key);
        out.push({
          tableId: table.id,
          tableName: table.name,
          oldKey: table.memberKey ?? '',
          newKey: best.key,
          similarity: Math.round(best.score * 100) / 100,
        });
      }
    }
    return out;
  }

  private async storedFingerprint(table: DataRawTable): Promise<Fingerprint> {
    return this.ctx.runExclusive(async () => {
      const types = await this.ctx.getTableColumnTypes(table.tableName);
      const rows = await this.ctx.queryRows<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdent(table.tableName)} LIMIT ${FINGERPRINT_ROWS}`
      );
      return makeFingerprint(types, rows);
    }, `renameFingerprint:${table.id}`);
  }

  private async candidateFingerprint(source: DataRawSource, key: string): Promise<Fingerprint> {
    let filePath = source.sourcePath;
    let config: DataRawTableConfig;
    if (source.sourceKind === 'folder') {
      filePath = join(source.sourcePath, key);
      if (isExcelFile(filePath)) {
        const sheets = getWorkbookSheetNames(filePath);
        const sheet =
          resolveSheetBySelector(normalizeSheetSelector(source.config.sheetSelector), sheets) ??
          sheets[0];
        config = { ...defaultExcelConfig(filePath), sheetName: sheet };
      } else {
        config = {
          sourceKind: 'csv',
          header: 'auto',
          dataRegion: 'auto',
          encoding: 'auto',
          delimiter: 'auto',
        };
      }
    } else {
      config = { ...defaultExcelConfig(filePath), sheetName: key };
    }
    const tempTable = tableNameFromId('rawSource_fp', uuidv4());
    return this.ctx.runExclusive(async () => {
      try {
        await this.rawTables.createImportTempTable(tempTable, filePath, 0, true, config);
        const types = await this.ctx.inferTableColumnTypes(tempTable);
        const rows = await this.ctx.queryRows<Record<string, unknown>>(
          `SELECT * FROM ${quoteIdent(tempTable)} LIMIT ${FINGERPRINT_ROWS}`
        );
        return makeFingerprint(types, rows);
      } finally {
        await this.ctx.dropTableIfExists(tempTable).catch(() => undefined);
      }
    }, `renameFingerprint:${key}`);
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
    cloud: ['cloud_table'],
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

const RENAME_SIMILARITY_THRESHOLD = 0.8;
const FINGERPRINT_ROWS = 50;

/** Fingerprint = column names + type families + first 50 rows (normalized text). */
export interface Fingerprint {
  columns: string[];
  families: Record<string, string>;
  rows: string[];
}

function typeFamily(type: string): string {
  const t = type.toUpperCase();
  if (/INT|DOUBLE|DECIMAL|FLOAT|REAL|NUMERIC|HUGEINT/.test(t)) return 'number';
  if (/DATE|TIME/.test(t)) return 'date';
  if (/BOOL/.test(t)) return 'boolean';
  return 'text';
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return /^-?\d+\.0+$/.test(text) ? text.replace(/\.0+$/, '') : text;
}

export function makeFingerprint(
  types: Array<{ name: string; type: string }>,
  rows: Array<Record<string, unknown>>
): Fingerprint {
  const columns = types.map((column) => column.name).filter((name) => !name.startsWith('_'));
  return {
    columns,
    families: Object.fromEntries(types.map((column) => [column.name, typeFamily(column.type)])),
    rows: rows.map((row) => columns.map((column) => normalizeCell(row[column])).join('\u0001')),
  };
}

/** 0.5 × column-name Jaccard + 0.2 × type agreement + 0.3 × first-rows overlap. */
export function fingerprintSimilarity(a: Fingerprint, b: Fingerprint): number {
  const ca = new Set(a.columns);
  const cb = new Set(b.columns);
  const shared = [...ca].filter((column) => cb.has(column));
  const union = new Set([...ca, ...cb]).size || 1;
  const nameScore = shared.length / union;
  const typeScore = shared.length
    ? shared.filter((column) => a.families[column] === b.families[column]).length / shared.length
    : 0;
  const rb = new Set(b.rows);
  const rowBase = Math.max(a.rows.length, b.rows.length);
  const rowScore = rowBase ? a.rows.filter((row) => rb.has(row)).length / rowBase : 1;
  return 0.5 * nameScore + 0.2 * typeScore + 0.3 * rowScore;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { SOURCE_FILE_SYSTEM_COLUMN };
