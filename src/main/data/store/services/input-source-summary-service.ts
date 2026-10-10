/** Summarizes importable input files (no database access). */
import type {
  DataRawTableSourceSummary,
  DataSummarizeRawTableSourceInput,
} from '../../../../shared/contracts';
import { DataStoreContext } from '../data-store-context';
import {
  normalizeImportSourcePath,
  normalizeRawTableConfig,
  normalizeRawTableSourceKind,
  clampSummaryLimit,
  createStableJsonHash,
  getImportSourceFiles,
  summarizeRawTableFile,
} from '../input-source';

export class InputSourceSummaryService {
  constructor(private readonly ctx: DataStoreContext) {}
  async summarizeRawTableSource(
    input: DataSummarizeRawTableSourceInput
  ): Promise<DataRawTableSourceSummary> {
    const sourcePath = normalizeImportSourcePath(input.sourcePath);
    const sourceKind = normalizeRawTableSourceKind(input.sourceKind, sourcePath);
    const config = normalizeRawTableConfig(input.config, sourceKind, sourcePath);
    const maxFiles = clampSummaryLimit(input.maxFiles, 1, 20, 8);
    const maxSheetsPerFile = clampSummaryLimit(input.maxSheetsPerFile, 1, 12, 6);
    const maxRowsPerSheet = clampSummaryLimit(input.maxRowsPerSheet, 1, 20, 8);
    const maxColumnsPerRow = clampSummaryLimit(input.maxColumnsPerRow, 1, 80, 16);
    const allFiles = getImportSourceFiles(sourcePath, sourceKind, config);
    const sampledFiles = allFiles.slice(0, maxFiles);
    const files = sampledFiles.map((filePath) =>
      summarizeRawTableFile(filePath, sourcePath, {
        maxSheetsPerFile,
        maxRowsPerSheet,
        maxColumnsPerRow,
      })
    );
    const notes: string[] = [];
    if (allFiles.length > sampledFiles.length) {
      notes.push(`Sampled ${sampledFiles.length} of ${allFiles.length} files.`);
    }
    for (const file of files) {
      if (file.warning) {
        notes.push(`${file.relativePath}: ${file.warning}`);
      }
    }
    const hashPayload = {
      sourcePath,
      sourceKind,
      fileCount: allFiles.length,
      files,
    };
    return {
      sourcePath,
      sourceKind,
      generatedAt: this.ctx.now(),
      hash: createStableJsonHash(hashPayload),
      fileCount: allFiles.length,
      sampledFileCount: files.length,
      truncated: allFiles.length > sampledFiles.length,
      notes,
      files,
    };
  }
}
