import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExperienceMemoryStore } from '../../main/memory/experience-memory-store';

type SessionInput = Parameters<ExperienceMemoryStore['replaceSession']>[1];
type ChunkInput = Parameters<ExperienceMemoryStore['replaceSession']>[2][number];

describe('ExperienceMemoryStore', () => {
  let tempRoot: string;
  let filePath: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-experience-memory-'));
    filePath = path.join(tempRoot, 'experience_memory.json');
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function createSessionInput(sessionId: string, summary: string): SessionInput {
    return {
      sessionId,
      sourceWorkspace: '/repo/a',
      sourceWorkspaceLabel: 'a',
      sourceSessionId: sessionId,
      sourceSessionTitle: 'Gateway fixes',
      sourceSessionDate: '2026-06-17',
      summary,
      keywords: ['gateway', 'token', 'rotation'],
      chunkIds: [],
      rawSession: [{ role: 'user', content: summary }],
      sessionDate: '2026-06-17',
      createdAt: '2026-06-17T00:00:00',
      ingestedAt: '2026-06-17T00:00:00',
      embedding: [],
      confidence: 0.82,
    };
  }

  function createChunkInput(sessionId: string, summary: string): ChunkInput {
    return {
      sessionId,
      sourceWorkspace: '/repo/a',
      sourceWorkspaceLabel: 'a',
      sourceSessionId: sessionId,
      sourceSessionTitle: 'Gateway fixes',
      sourceSessionDate: '2026-06-17',
      summary,
      details: `${summary}，并同步 remote gateway 行为。`,
      keywords: ['gateway', 'rotation', 'remote'],
      sourceTurns: [1, 2],
      rawText: `user: ${summary}`,
      sessionDate: '2026-06-17',
      createdAt: '2026-06-17T00:00:00',
      ingestedAt: '2026-06-17T00:00:00',
      embedding: [],
      confidence: 0.78,
    };
  }

  it('flags older highly similar chunks as duplicate candidates without archiving them', () => {
    const store = new ExperienceMemoryStore(filePath);

    store.replaceSession(
      'old-session',
      createSessionInput('old-session', '实现 gateway token rotation'),
      [createChunkInput('old-session', '实现 gateway token rotation')]
    );
    store.replaceSession(
      'new-session',
      createSessionInput('new-session', '实现 gateway token rotation'),
      [createChunkInput('new-session', '实现 gateway token rotation')]
    );

    const oldChunk = store.chunks.find((item) => item.sessionId === 'old-session');
    const newChunk = store.chunks.find((item) => item.sessionId === 'new-session');
    // Similarity alone never retires a record — it stays active but is marked
    // as a duplicate candidate so retrieval can deprioritize it.
    expect(oldChunk?.status).toBe('active');
    expect(oldChunk?.duplicateCandidateOf).toBe(newChunk?.id);
    expect(oldChunk?.supersededBy).toBeUndefined();

    const retrieval = store.retrieveProgressive('gateway token rotation', {
      chunkTopK: 10,
      sessionTopK: 10,
      currentWorkspace: '/repo/a',
    });
    // Both remain retrievable; the duplicate candidate ranks below its
    // canonical record.
    const rankedIds = retrieval.rankedChunks.map((item) => item.sessionId);
    expect(rankedIds).toContain('new-session');
    expect(rankedIds.indexOf('new-session')).toBeLessThan(rankedIds.indexOf('old-session'));
  });
});
