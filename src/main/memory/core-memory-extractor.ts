import { CORE_MEMORY_UPDATE_SYSTEM_PROMPT } from './memory-prompts';
import type { MemoryLLMClientLike } from './memory-llm-client';
import type { CoreMemoryActionInput, MemoryTranscriptTurn } from './memory-types';
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
  }): Promise<CoreMemoryActionInput[]> {
    const conversationText = compactTranscript(params.turns);
    if (!conversationText.trim()) {
      return [];
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
    });

    const payload = extractJson(response.text);
    if (!payload || typeof payload !== 'object') {
      return [];
    }

    const actions = (payload as { actions?: unknown }).actions;
    if (!Array.isArray(actions)) {
      return [];
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
        } satisfies CoreMemoryActionInput;
      })
      .filter((item): item is CoreMemoryActionInput => Boolean(item));

    return normalized;
  }
}
