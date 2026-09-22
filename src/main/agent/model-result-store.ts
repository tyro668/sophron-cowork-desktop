import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

export const MODEL_RESULT_MAX_CHARS = 6000;
export const RESULT_READ_TOOL = 'tool_result_read';
type ToolResult = Awaited<ReturnType<ToolDefinition['execute']>>;

const EVIDENCE_KEYS = new Set([
  'id',
  'code',
  'status',
  'taskId',
  'inputTableId',
  'outputTableId',
  'analysisId',
  'draftId',
  'runId',
  'mode',
  'outputMode',
  'committed',
  'confirmed',
  'confirmationRequired',
  'expiresAt',
]);

/** Keep business identifiers and outcomes outside the optional text excerpt. */
function evidenceOf(value: unknown, depth = 0): Record<string, unknown> {
  if (!value || typeof value !== 'object' || depth > 2) return {};
  const evidence: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      EVIDENCE_KEYS.has(key) &&
      (typeof entry === 'boolean' ||
        typeof entry === 'number' ||
        (typeof entry === 'string' && entry.length <= 200))
    ) {
      evidence[key] = entry;
    } else if (['task', 'inputTable', 'outputTable', 'error'].includes(key)) {
      const nested = evidenceOf(entry, depth + 1);
      if (Object.keys(nested).length) evidence[key] = nested;
    } else if (key === 'diagnostics' && Array.isArray(entry)) {
      evidence[key] = entry.slice(0, 8).map((item) => evidenceOf(item, depth + 1));
    }
  }
  return evidence;
}

function compactEvidence(evidence: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = { additionalEvidenceInResult: true };
  // Prioritize outcomes so an already committed mutation is never reported as
  // a formatting failure simply because its identifiers/diagnostics are large.
  for (const key of new Set([
    'committed',
    'mode',
    'outputMode',
    'status',
    ...Object.keys(evidence),
  ])) {
    if (!(key in evidence)) continue;
    if (JSON.stringify({ ...compact, [key]: evidence[key] }).length <= 1800)
      compact[key] = evidence[key];
  }
  return compact;
}

/** Session-owned, bounded cache. References never cross conversation boundaries. */
export class ModelResultStore {
  private readonly results = new Map<string, { text: string; evidence: Record<string, unknown> }>();
  private size = 0;

  bound(result: ToolResult, onTruncated?: () => void): ToolResult {
    let text = result.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    if (text.length <= MODEL_RESULT_MAX_CHARS) return result;
    let evidence = evidenceOf(result.details);
    if (JSON.stringify(evidence).length > 1800) {
      text += `\nAdditional execution evidence:\n${JSON.stringify(evidence)}`;
      evidence = compactEvidence(evidence);
    }
    const resultRef = `result_${randomUUID()}`;
    this.results.set(resultRef, { text, evidence });
    this.size += text.length;
    // Retain at least the latest result, even if that one result exceeds the
    // cache target. Never silently discard part of a stored result.
    while (this.results.size > 1 && (this.results.size > 32 || this.size > 8_000_000)) {
      const first = this.results.keys().next().value!;
      this.size -= this.results.get(first)!.text.length;
      this.results.delete(first);
    }
    onTruncated?.();
    return {
      ...result,
      content: [
        { type: 'text', text: this.page(resultRef, 0, 3500) },
        ...result.content.filter((block) => block.type !== 'text'),
      ],
    };
  }

  private page(resultRef: string, offset: number, limit: number, contains?: string): string {
    const result = this.results.get(resultRef);
    if (!result)
      throw new Error('RESULT_REF_EXPIRED: Result reference is unavailable in this conversation.');
    if (contains) {
      const match = result.text.indexOf(contains, offset);
      if (match < 0)
        return JSON.stringify({ resultRef, found: false, totalChars: result.text.length });
      offset = match;
    }
    let length = Math.min(limit, Math.max(0, result.text.length - offset));
    for (;;) {
      const end = offset + length;
      const page = JSON.stringify({
        resultRef,
        truncated: offset > 0 || end < result.text.length,
        totalChars: result.text.length,
        offset,
        nextOffset: end < result.text.length ? end : null,
        evidence: result.evidence,
        // This is explicitly a TEXT FRAGMENT, never presented as complete JSON.
        textFragment: result.text.slice(offset, end),
        readMore: `Use ${RESULT_READ_TOOL} with resultRef and nextOffset (as offset), or contains to locate a field. References expire when this session cache is cleared or older results are evicted.`,
      });
      if (page.length <= MODEL_RESULT_MAX_CHARS) return page;
      if (length === 0) throw new Error('Result evidence exceeds the model result budget.');
      length = Math.max(
        0,
        length - Math.max(1, Math.ceil((page.length - MODEL_RESULT_MAX_CHARS) / 2))
      );
    }
  }

  createReadTool(): ToolDefinition {
    return {
      name: RESULT_READ_TOOL,
      label: 'Read stored tool result',
      description:
        'Read a bounded text page from a resultRef returned by a tool in this conversation. Use contains to locate a field; offset/nextOffset are character positions in the original text.',
      parameters: Type.Object({
        resultRef: Type.String(),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 4000 })),
        contains: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      }),
      execute: async (_id, input) => {
        const params = input as {
          resultRef: string;
          offset?: number;
          limit?: number;
          contains?: string;
        };
        return {
          content: [
            {
              type: 'text',
              text: this.page(
                params.resultRef,
                params.offset ?? 0,
                params.limit ?? 3000,
                params.contains
              ),
            },
          ],
          details: undefined,
        };
      },
    };
  }

  wrap(tools: ToolDefinition[], onTruncated: () => void): ToolDefinition[] {
    return tools.map((tool) => ({
      ...tool,
      execute: async (...args) => this.bound(await tool.execute(...args), onTruncated),
    }));
  }
}
