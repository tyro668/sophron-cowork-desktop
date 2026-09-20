import { CORE_MEMORY_UPDATE_SYSTEM_PROMPT } from './memory-prompts';
import type { MemoryLLMClientLike } from './memory-llm-client';
import type {
  CoreMemoryActionInput,
  MemoryExtractionOutcome,
  MemoryTranscriptTurn,
} from './memory-types';
import { normalizeConfidence, normalizeConfidenceSourceType } from './memory-confidence';
import { compactTranscript, extractJson } from './memory-utils';

export class CoreMemoryExtractor {
  constructor(
    private readonly llm: MemoryLLMClientLike,
    private readonly systemPrompt = CORE_MEMORY_UPDATE_SYSTEM_PROMPT
  ) {}

  async extract(params: {
    sessionId: string;
    sessionDate?: string;
    turns: MemoryTranscriptTurn[];
    existingCorePromptBlock: string;
    signal?: AbortSignal;
  }): Promise<MemoryExtractionOutcome<CoreMemoryActionInput[]>> {
    const conversationText = compactTranscript(params.turns);
    if (!conversationText.trim()) {
      return { kind: 'no_memory' };
    }

    const response = await this.llm.complete({
      systemPrompt: this.systemPrompt,
      userPrompt: [
        'Existing core memory:',
        params.existingCorePromptBlock,
        '',
        `Session ID: ${params.sessionId}`,
        params.sessionDate ? `Session Date: ${params.sessionDate}` : '',
        'Session transcript:',
        conversationText,
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

    const actions = (payload as { actions?: unknown }).actions;
    if (actions === undefined) {
      return { kind: 'failure', reason: 'memory.extraction.missingActions' };
    }
    if (!Array.isArray(actions)) {
      return { kind: 'failure', reason: 'memory.extraction.invalidActions' };
    }
    if (!actions.length) {
      return { kind: 'no_memory' };
    }

    const normalized = actions
      .map((action): CoreMemoryActionInput | null => {
        if (!action || typeof action !== 'object') {
          return null;
        }
        const input = action as {
          op?: unknown;
          category?: unknown;
          key?: unknown;
          value?: unknown;
          confidence?: unknown;
          sourceType?: unknown;
          source_type?: unknown;
          reason?: unknown;
          sourceTurns?: unknown;
          source_turns?: unknown;
        };
        const op = typeof input.op === 'string' ? input.op.toLowerCase().trim() : '';
        if (op !== 'add' && op !== 'update' && op !== 'upsert' && op !== 'delete') {
          return null;
        }
        const key = typeof input.key === 'string' ? input.key.trim() : '';
        if (!key) {
          return null;
        }
        const confidence = normalizeConfidence(input.confidence);
        const sourceType = normalizeConfidenceSourceType(input.sourceType ?? input.source_type);
        if (op !== 'delete' && (!sourceType || confidence === null)) {
          return null;
        }
        // Per-action evidence binding: 1-based indices into the provided
        // transcript. Out-of-range references are dropped — an action with no
        // verifiable support turns keeps working but can never supersede a
        // manual overlay (its support time is unknown).
        const rawTurns = input.sourceTurns ?? input.source_turns;
        const sourceTurns = Array.isArray(rawTurns)
          ? [
              ...new Set(
                rawTurns.filter(
                  (turn): turn is number =>
                    typeof turn === 'number' &&
                    Number.isInteger(turn) &&
                    turn >= 1 &&
                    turn <= params.turns.length
                )
              ),
            ]
          : undefined;
        return {
          op,
          category:
            typeof input.category === 'string'
              ? (input.category.trim() as CoreMemoryActionInput['category'])
              : undefined,
          key,
          value: typeof input.value === 'string' ? input.value.trim() : null,
          confidence: confidence ?? undefined,
          sourceType: sourceType ?? undefined,
          reason: typeof input.reason === 'string' ? input.reason.trim() : undefined,
          sourceTurns: sourceTurns?.length ? sourceTurns : undefined,
        } satisfies CoreMemoryActionInput;
      })
      .filter((item): item is CoreMemoryActionInput => Boolean(item));

    if (!normalized.length) {
      return { kind: 'failure', reason: 'memory.extraction.allActionsInvalid' };
    }
    return { kind: 'success', value: normalized };
  }
}
