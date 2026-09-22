import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';
import type { Message, Session } from '../../shared/contracts';
import type * as SharedMemory from '../../shared/contracts/memory';

// Cross-process DTOs have a single canonical definition in
// src/shared/contracts/memory — these aliases keep main-internal imports
// working while making divergence a compile error instead of silent drift.
export type MemorySearchScope = SharedMemory.MemorySearchScope;
export type MemorySearchKind = SharedMemory.MemorySearchKind;
export type MemoryItemStatus = SharedMemory.MemoryItemStatus;
export type MemoryConfidenceSourceType = SharedMemory.MemoryConfidenceSourceType;
export type MemoryTranscriptTurn = SharedMemory.MemoryTranscriptTurn;
export type MemoryEvidenceRef = SharedMemory.MemoryEvidenceRef;
export type MemoryConfidenceSignals = SharedMemory.MemoryConfidenceSignals;
export type CoreMemoryEntry = SharedMemory.CoreMemoryEntry;
export type ProjectMemoryEntry = SharedMemory.ProjectMemoryEntry;
export type ChunkMemoryItem = SharedMemory.ChunkMemoryItem;
export type SessionMemoryItem = SharedMemory.SessionMemoryItem;
export type MemorySearchResult = SharedMemory.MemorySearchResult;
export type MemoryReadResult = SharedMemory.MemoryReadResult;
export type MemoryDebugFileInfo = SharedMemory.MemoryDebugFileInfo;
export type MemoryDebugFileContent = SharedMemory.MemoryDebugFileContent;
export type MemoryInspectSessionResult = SharedMemory.MemoryInspectSessionResult;
export type MemoryOverview = SharedMemory.MemoryOverview;
export type MemoryInjectionRecord = SharedMemory.MemoryInjectionRecord;

// ---------------------------------------------------------------------------
// Main-process internals below — never cross the IPC boundary.

export type CoreMemoryCategory = 'identity' | 'preferences' | 'skills' | 'interests';
export type MemoryNavigationActionType = 'expand_chunk' | 'expand_session' | 'get_raw_session';

export interface CoreMemoryActionInput {
  op: 'add' | 'update' | 'upsert' | 'delete';
  category?: CoreMemoryCategory;
  key: string;
  value?: string | null;
  reason?: string;
  confidence?: number;
  sourceType?: MemoryConfidenceSourceType;
  /**
   * 1-based transcript turns that support THIS action — the evidence binding
   * that decides whether an explicit statement may supersede a manual
   * overlay. Without it an action has no verifiable support time and must
   * never outrank human-authored state.
   */
  sourceTurns?: number[];
}

export interface AppliedCoreMemoryAction {
  op: 'add' | 'update' | 'upsert' | 'delete';
  category?: CoreMemoryCategory;
  key: string;
  value?: string | null;
  combinedKey: string;
}

export interface ProgressiveSummaryItem {
  type: 'chunk' | 'session';
  id: string;
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceSessionTitle?: string;
  summary: string;
}

export interface FocusedChunkItem {
  chunkId: string;
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceSessionTitle?: string;
  details: string;
  summary: string;
  keywords: string[];
  sourceTurns: number[];
}

export interface SessionContextItem {
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceSessionTitle?: string;
  sessionSummary: string;
  sessionDate: string;
  chunkIds: string[];
}

export interface RawSessionCandidateItem {
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceSessionTitle?: string;
  sessionDate: string;
  rawSession: MemoryTranscriptTurn[];
}

export interface ProgressiveRetrievalResult {
  broadSummaries: ProgressiveSummaryItem[];
  focusedChunks: FocusedChunkItem[];
  sessionContexts: SessionContextItem[];
  rawSessionCandidates: RawSessionCandidateItem[];
  finalContext: string;
  rankedChunks: ChunkMemoryItem[];
  rankedSessions: SessionMemoryItem[];
}

export interface NavigationAction {
  type: MemoryNavigationActionType;
  chunkId?: string;
  sessionId?: string;
}

export interface NavigationDecision {
  sufficient: boolean;
  reason: string;
  actions: NavigationAction[];
}

export interface MemorySearchParams {
  query: string;
  cwd?: string;
  workspaceKey?: string | null;
  sourceWorkspace?: string | null;
  scope?: MemorySearchScope;
  limit?: number;
}

export interface MemoryIngestionInput {
  session: Session;
  prompt: string;
  messages: Message[];
}

export interface MemorySessionStateRecord {
  sessionId: string;
  sourceWorkspace?: string | null;
  lastProcessedMessageCount: number;
  lastMessageIds?: string[];
  /**
   * Per-message (id, content-hash) cursor for the trailing window — detects
   * in-place content edits that an id-only prefix comparison misses.
   */
  lastMessageFingerprints?: Array<{ id: string; hash: string }>;
  /** Hash of all fingerprints preceding the trailing window — guards edits before it. */
  lastMessagePrefixHash?: string;
  lastTranscriptHash?: string;
  lastIngestedAt?: number | null;
  lastError?: string | null;
  createdAt: number;
  updatedAt: number;
}

export type MemoryExtractionOutcome<T> =
  | { kind: 'success'; value: T }
  | { kind: 'no_memory' }
  | { kind: 'failure'; reason: string };

export interface MemoryTombstone {
  kind: 'core' | 'project';
  identity: string;
  valueHash: string;
  sourceSessionIds: string[];
  createdAt: string;
}

export interface ExperienceSessionExtract {
  sessionSummary: string;
  sessionKeywords: string[];
  sessionConfidence?: number;
  chunks: Array<{
    summary: string;
    details: string;
    keywords: string[];
    sourceTurns: number[];
    confidence?: number;
  }>;
}

export interface MemoryToolDefinition extends ToolDefinition<TSchema, unknown> {}
