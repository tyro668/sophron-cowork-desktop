/**
 * Cross-process memory contracts. Shared by main, preload, and renderer.
 * Must not import from main/, renderer/, or preload/.
 */

// Memory types
export interface MemoryEntry {
  id: string;
  sessionId: string;
  content: string;
  metadata: MemoryMetadata;
  createdAt: number;
}

export interface MemoryMetadata {
  source: string;
  timestamp: number;
  tags: string[];
}

export type MemorySearchScope = 'workspace' | 'global' | 'all';

export type MemorySearchKind =
  | 'core'
  | 'project'
  | 'experience_session'
  | 'experience_chunk'
  | 'raw_session';

export type MemoryItemStatus = 'active' | 'pending' | 'rejected' | 'archived';

export type MemoryConfidenceSourceType =
  | 'explicit_user_statement'
  | 'conversation_summary'
  | 'llm_inference'
  | 'manual_edit';

export interface MemoryTranscriptTurn {
  role: string;
  content: string;
  messageId?: string;
  timestamp?: number;
}

export interface MemoryEvidenceRef {
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceSessionTitle?: string;
  sourceTurns?: number[];
  excerpt?: string;
  createdAt?: string;
}

export interface MemoryConfidenceSignals {
  sourceType: MemoryConfidenceSourceType;
  extractionConfidence: number;
  evidenceCount: number;
  corroborationCount: number;
  contradictionCount: number;
  userVerified: boolean;
  lastVerifiedAt?: string;
  calculationVersion: number;
  reason?: string;
}

export interface CoreMemoryEntry {
  combinedKey: string;
  category?: 'identity' | 'preferences' | 'skills' | 'interests';
  key: string;
  value: string;
  confidence: number;
  confidenceSignals: MemoryConfidenceSignals;
  status: MemoryItemStatus;
  evidence: MemoryEvidenceRef[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemoryEntry {
  id: string;
  workspaceKey: string;
  workspaceLabel?: string;
  key: string;
  value: string;
  confidence: number;
  confidenceSignals: MemoryConfidenceSignals;
  status: MemoryItemStatus;
  evidence: MemoryEvidenceRef[];
  createdAt: string;
  updatedAt: string;
}

export interface ChunkMemoryItem {
  id: string;
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceWorkspaceLabel?: string;
  sourceSessionId: string;
  sourceSessionTitle?: string;
  sourceSessionDate?: string;
  summary: string;
  details: string;
  keywords: string[];
  sourceTurns: number[];
  rawText: string;
  sessionDate: string;
  createdAt: string;
  ingestedAt: string;
  embedding: number[];
  confidence: number;
  confidenceSignals: MemoryConfidenceSignals;
  status: MemoryItemStatus;
  supersededBy?: string;
}

export interface SessionMemoryItem {
  id: string;
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceWorkspaceLabel?: string;
  sourceSessionId: string;
  sourceSessionTitle?: string;
  sourceSessionDate?: string;
  summary: string;
  keywords: string[];
  chunkIds: string[];
  rawSession: MemoryTranscriptTurn[];
  sessionDate: string;
  createdAt: string;
  ingestedAt: string;
  embedding: number[];
  confidence: number;
  confidenceSignals: MemoryConfidenceSignals;
  status: MemoryItemStatus;
  supersededBy?: string;
}

export interface MemoryDebugFileInfo {
  kind: 'core' | 'project' | 'experience' | 'state' | 'artifacts';
  label: string;
  filePath: string;
  exists: boolean;
  sizeBytes: number;
  updatedAt: number | null;
  sessionCount?: number;
  chunkCount?: number;
}

export interface MemoryDebugFileContent {
  kind: MemoryDebugFileInfo['kind'];
  filePath: string;
  text: string;
  parsed: unknown | null;
  sizeBytes: number;
  updatedAt: number | null;
}

export interface MemoryInspectSessionResult {
  sourceWorkspace?: string | null;
  filePath: string;
  session: SessionMemoryItem;
  chunks: ChunkMemoryItem[];
}

export interface MemoryOverview {
  enabled: boolean;
  storageRoot: string;
  coreFilePath: string;
  projectFilePath: string;
  experienceFilePath: string;
  stateFilePath: string;
  coreCount: number;
  projectCount: number;
  experienceSessionCount: number;
  experienceChunkCount: number;
  sourceWorkspaceCount: number;
  failedSessionCount: number;
  latestIngestionAt: number | null;
  latestError: string | null;
  currentWorkspace?: {
    workspaceKey: string;
    projectCount: number;
    experienceSessionCount: number;
    experienceChunkCount: number;
  };
  topSourceWorkspaces: Array<{
    workspaceKey: string;
    sessionCount: number;
    chunkCount: number;
  }>;
}

export interface MemorySearchResult {
  id: string;
  recordId: string;
  kind: MemorySearchKind;
  title: string;
  summary: string;
  contentPreview: string;
  workspaceKey?: string;
  sourceWorkspace?: string | null;
  sourceWorkspaceLabel?: string;
  sourceSessionId?: string;
  sourceSessionTitle?: string;
  sessionId?: string;
  sessionTitle?: string;
  category?: 'identity' | 'preferences' | 'skills' | 'interests';
  confidence?: number;
  status?: MemoryItemStatus;
  score: number;
  createdAt: number;
  updatedAt?: number;
  keywords?: string[];
  sourceFile?: string;
}

export interface MemoryReadResult extends MemorySearchResult {
  rawText?: string;
  details?: string;
  rawSession?: MemoryTranscriptTurn[];
  sourceTurns?: number[];
  chunkIds?: string[];
  sourceExcerpt?: string;
}
