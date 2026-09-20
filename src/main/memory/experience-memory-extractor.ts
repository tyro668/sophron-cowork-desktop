import { SESSION_CHUNK_EXTRACTION_PROMPT } from './memory-prompts';
import type { MemoryLLMClientLike } from './memory-llm-client';
import type {
  ExperienceSessionExtract,
  MemoryExtractionOutcome,
  MemoryTranscriptTurn,
} from './memory-types';
import { compactTranscript, extractJson } from './memory-utils';

export class ExperienceMemoryExtractor {
  constructor(
    private readonly llm: MemoryLLMClientLike,
    private readonly systemPrompt = SESSION_CHUNK_EXTRACTION_PROMPT
  ) {}

  async extractSession(params: {
    sessionId: string;
    sessionDate?: string;
    turns: MemoryTranscriptTurn[];
    signal?: AbortSignal;
  }): Promise<MemoryExtractionOutcome<ExperienceSessionExtract>> {
    const transcript = compactTranscript(params.turns);
    if (!transcript.trim()) {
      return { kind: 'no_memory' };
    }

    const response = await this.llm.complete({
      systemPrompt: this.systemPrompt,
      userPrompt: [
        `Session ID: ${params.sessionId}`,
        params.sessionDate ? `Session Date: ${params.sessionDate}` : '',
        'Session transcript:',
        transcript,
      ]
        .filter(Boolean)
        .join('\n'),
      temperature: 0,
      maxTokens: 16_000,
      signal: params.signal,
    });

    const payload = extractJson(response.text);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { kind: 'failure', reason: 'memory.extraction.malformedResponse' };
    }

    const record = payload as {
      session_summary?: unknown;
      sessionSummary?: unknown;
      session_keywords?: unknown;
      sessionKeywords?: unknown;
      session_confidence?: unknown;
      sessionConfidence?: unknown;
      chunks?: unknown;
      no_memory?: unknown;
      noMemory?: unknown;
    };
    // Explicit no-memory protocol: the extractor must assert emptiness rather
    // than emit a shapeless object — a bare {} is a malformed response, not a
    // legitimate "nothing to store" signal.
    if (record.no_memory === true || record.noMemory === true) {
      return { kind: 'no_memory' };
    }
    const summaryField = record.session_summary ?? record.sessionSummary;
    const confidenceField = record.session_confidence ?? record.sessionConfidence;
    const hasSessionFields = summaryField !== undefined || record.chunks !== undefined;
    if (!hasSessionFields) {
      return { kind: 'failure', reason: 'memory.extraction.missingSessionFields' };
    }
    if (
      (summaryField !== undefined && typeof summaryField !== 'string') ||
      (confidenceField !== undefined &&
        (typeof confidenceField !== 'number' || !Number.isFinite(confidenceField))) ||
      (record.chunks !== undefined && !Array.isArray(record.chunks))
    ) {
      return { kind: 'failure', reason: 'memory.extraction.invalidFieldTypes' };
    }

    const rawChunks = Array.isArray(record.chunks) ? record.chunks : [];
    const sessionSummary = typeof summaryField === 'string' ? summaryField.trim() : '';
    const sessionConfidence = normalizeConfidence(confidenceField);
    if (!sessionSummary && !rawChunks.length) {
      // Recognized fields were present but explicitly empty — a well-formed
      // "nothing worth storing" answer.
      return { kind: 'no_memory' };
    }
    if (!sessionSummary || sessionConfidence === null) {
      return { kind: 'failure', reason: 'memory.extraction.missingSessionFields' };
    }

    const chunks: ExperienceSessionExtract['chunks'] = [];
    for (const item of rawChunks) {
      // Strict schema: a malformed chunk fails the whole response instead of
      // being silently dropped — a failed extraction keeps the stored session
      // record and the previous cursor, never commits a partial result.
      if (!item || typeof item !== 'object') {
        return { kind: 'failure', reason: 'memory.extraction.invalidChunk' };
      }
      const chunk = item as {
        summary?: unknown;
        details?: unknown;
        keywords?: unknown;
        source_turns?: unknown;
        sourceTurns?: unknown;
        confidence?: unknown;
      };
      const rawSourceTurns = chunk.source_turns ?? chunk.sourceTurns;
      if (!Array.isArray(rawSourceTurns) || !rawSourceTurns.length) {
        return { kind: 'failure', reason: 'memory.extraction.missingChunkTurns' };
      }
      const sourceTurns = rawSourceTurns.filter(
        (value): value is number =>
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= 1 &&
          value <= params.turns.length
      );
      // Every declared source turn must resolve — an out-of-range reference
      // means the model indexed a different transcript than it was given.
      if (sourceTurns.length !== rawSourceTurns.length) {
        return { kind: 'failure', reason: 'memory.extraction.invalidChunkTurns' };
      }
      const summary = typeof chunk.summary === 'string' ? chunk.summary.trim() : '';
      const confidence = normalizeConfidence(chunk.confidence);
      if (!summary || confidence === null) {
        return { kind: 'failure', reason: 'memory.extraction.invalidChunkFields' };
      }
      chunks.push({
        summary,
        details:
          typeof chunk.details === 'string' && chunk.details.trim()
            ? chunk.details.trim()
            : summary,
        keywords: Array.isArray(chunk.keywords)
          ? chunk.keywords.filter((value): value is string => typeof value === 'string')
          : [],
        sourceTurns,
        confidence,
      });
    }

    return {
      kind: 'success',
      value: {
        sessionSummary,
        sessionKeywords: Array.isArray(record.session_keywords)
          ? record.session_keywords.filter((item): item is string => typeof item === 'string')
          : Array.isArray(record.sessionKeywords)
            ? record.sessionKeywords.filter((item): item is string => typeof item === 'string')
            : [],
        sessionConfidence,
        chunks,
      },
    };
  }
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(1, value));
}
