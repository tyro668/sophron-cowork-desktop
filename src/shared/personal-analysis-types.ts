import type { ScheduleConfig } from './contracts/schedule';

export interface PersonalAnalysisConfig {
  apiOrigin: string;
  apiKey: string;
  updatedAt?: number;
  /** A rejected API key is retained for editing, but no longer used automatically. */
  connectionStatus?: 'disconnected';
}

export interface StoredPersonalAnalysisConfig extends PersonalAnalysisConfig {
  updatedAt: number;
}

export interface PersonalAnalysisConnectionInput {
  apiOrigin?: string;
  apiKey?: string;
  accessToken?: string;
  connectionMode?: 'account' | 'apiKey';
}

export interface PersonalAnalysisSpace {
  spaceId: string;
  spaceName: string;
  description?: string;
  projectCount?: number;
}

export interface PersonalAnalysisProject {
  projectId: string;
  folderId: string;
  spaceId: string;
  projectName: string;
  tableCount?: number;
}

export interface PersonalAnalysisDatasource {
  datasourceId: string;
  datasourceName?: string;
  description?: string;
}

export interface PersonalAnalysisTable {
  tableId: string;
  sheetId?: string;
  kind?: 'base' | 'analysis';
  tableName: string;
  spaceId?: string;
  projectId: string;
  datasourceId?: string;
  folderId?: string;
  sourceType?: string;
  source?: string;
  sourceObjectKey?: string;
  columns?: string[];
  rowCount?: number;
  columnCount?: number;
  updatedAt?: string;
}

export interface PersonalAnalysisTableSearchParams {
  keyword?: string;
  spaceId?: string;
  projectId?: string;
  matchField?: 'table' | 'field' | 'all';
  page?: number;
  pageSize?: number;
  sortBy?: 'tableName' | 'updatedAt' | 'rowCount';
  sortOrder?: 'asc' | 'desc';
}

export interface PersonalAnalysisTableListResult {
  tables: PersonalAnalysisTable[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface PersonalAnalysisUploadInput extends PersonalAnalysisConnectionInput {
  writeMode: 'CREATE' | 'REPLACE';
  datasourceId?: string;
  folderId?: string;
  projectId?: string;
  spaceId?: string;
  tableId?: string;
  fileName: string;
  tableName: string;
  csv: string;
  waitForDone?: boolean;
}

export interface PersonalAnalysisUploadResult {
  uploadPipelineId: string;
  importPipelineId: string;
  tableId: string;
  sheetId?: string;
  status: string;
  table?: PersonalAnalysisTable;
}

export interface PersonalAnalysisDriveFileSheet {
  name: string;
  rowCount: number;
  columnCount: number;
}

export interface PersonalAnalysisDriveFile {
  fileId: string;
  projectId: string;
  spaceId?: string;
  fileName: string;
  fileType: 'csv' | 'excel';
  extension: 'csv' | 'xlsx';
  mimeType?: string;
  writable?: boolean;
  size?: number;
  sheets?: PersonalAnalysisDriveFileSheet[];
  version?: number;
  updatedAt?: string;
}

export interface PersonalAnalysisDriveFileSearchParams {
  keyword?: string;
  fileType?: 'csv' | 'excel';
  page?: number;
  pageSize?: number;
}

export interface PersonalAnalysisDriveFileListResult {
  files: PersonalAnalysisDriveFile[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface PersonalAnalysisDriveFilePreview {
  file: PersonalAnalysisDriveFile;
  sheetName: string;
  rows: unknown[][];
}

export interface PersonalAnalysisDriveSyncInput extends PersonalAnalysisConnectionInput {
  spaceId: string;
  projectId: string;
  fileId?: string;
  outputId?: string;
  fileName?: string;
  expectedVersion?: number;
  csvContent: string;
}

export interface PersonalAnalysisDriveSyncResult {
  file: PersonalAnalysisDriveFile;
  created: boolean;
}

export type CloudOutputActionType = 'cloud_table' | 'drive_file';

export type CloudOutputActionTrigger = 'on_change' | 'schedule';

export interface CloudOutputAction {
  type: CloudOutputActionType;
  trigger: CloudOutputActionTrigger;
  schedule?: ScheduleConfig;
  spaceId: string;
  projectId: string;
  fileId?: string;
  fileName?: string;
  version?: number;
  tableId?: string;
  tableName?: string;
  writeMode?: 'CREATE' | 'REPLACE';
  lastRunAt?: number;
  lastError?: string;
}

export type CloudOutputActionSpec = Omit<CloudOutputAction, 'version' | 'lastRunAt' | 'lastError'>;
