export interface PersonalAnalysisConfig {
  apiOrigin: string;
  apiKey: string;
  updatedAt?: number;
}

export interface StoredPersonalAnalysisConfig extends PersonalAnalysisConfig {
  updatedAt: number;
}

export interface PersonalAnalysisConnectionInput {
  apiOrigin?: string;
  apiKey?: string;
  accessToken?: string;
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
  uploadTaskId: string;
  importTaskId: string;
  tableId: string;
  sheetId?: string;
  status: string;
  table?: PersonalAnalysisTable;
}
