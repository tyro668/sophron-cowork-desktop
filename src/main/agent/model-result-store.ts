import type { SessionResultRepository } from '../session/session-result-repository';
import { logWarn } from '../utils/logger';
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
  'rawTableId',
  'resultTableId',
  'requestId',
  'receiptId',
  'resultRef',
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
    } else if (['task', 'rawTable', 'resultTable', 'error'].includes(key)) {
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

/** Bound model-visible output while retaining full results in the owning session. */
export class ModelResultStore {
  constructor(private readonly repository: SessionResultRepository) {}

  bound(
    result: ToolResult,
    onTruncated?: () => void,
    toolCallId: string = randomUUID()
  ): ToolResult {
    let text = result.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    const structured = JSON.stringify(result.structuredContent);
    if (text.length + (structured?.length ?? 0) <= MODEL_RESULT_MAX_CHARS) return result;
    if (structured && !text.includes(structured)) text += '\n' + structured;
    let evidence = { ...evidenceOf(result.structuredContent), ...evidenceOf(result.details) };
    if (JSON.stringify(evidence).length > 1800) {
      text += `\nAdditional execution evidence:\n${JSON.stringify(evidence)}`;
      evidence = compactEvidence(evidence);
    }
    const resultRef = `result_${randomUUID()}`;
    try {
      this.repository.write(resultRef, toolCallId, text, evidence);
    } catch (error) {
      // The tool may already have committed. A storage error must not invite a replay.
      logWarn('[ModelResultStore] Could not archive tool result', error);
      return {
        ...result,
        structuredContent: undefined,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              storageError: 'RESULT_NOT_STORED',
              evidence,
              textFragment: text.slice(0, 500),
            }),
          },
          ...result.content.filter((block) => block.type !== 'text'),
        ],
      };
    }
    onTruncated?.();
    return {
      ...result,
      structuredContent: { resultRef },
      content: [
        { type: 'text', text: this.formatPage({ text, evidence }, resultRef, 0, 3500) },
        ...result.content.filter((block) => block.type !== 'text'),
      ],
    };
  }

  private page(resultRef: string, offset: number, limit: number, contains?: string): string {
    const result = this.repository.read(resultRef);
    if (!result)
      throw new Error('RESULT_REF_EXPIRED: Result reference is unavailable in this conversation.');
    return this.formatPage(result, resultRef, offset, limit, contains);
  }

  private formatPage(
    result: { text: string; evidence: Record<string, unknown> },
    resultRef: string,
    offset: number,
    limit: number,
    contains?: string
  ): string {
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
        readMore: `Use ${RESULT_READ_TOOL} with resultRef and nextOffset (as offset), or contains to locate a field. References belong to this session and expire after seven days.`,
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
      execute: async (...args) => this.bound(await tool.execute(...args), onTruncated, args[0]),
    }));
  }
}
