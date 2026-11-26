import type { SessionEntry, CompactionResult } from '@earendil-works/pi-coding-agent';
import { logWarn } from '../utils/logger';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Message, ContentBlock } from '../../shared/contracts';

export const APP_TURN_ENTRY = 'sophron.user-message';

export function historyUserText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'file_attachment':
      return `[Attachment: ${block.filename} (${block.relativePath})]`;
    case 'cloud_table_attachment':
      return block.tables
        .map((table) => `[Table: ${table.tableName}, id=${table.tableId}, resource=${table.id}]`)
        .join('\n');
    case 'image':
      return `[Historical image: ${block.source.media_type}]`;
    case 'data_pipeline_request': {
      const binding = { ...block.request };
      delete binding.workflow;
      return `[Pipeline request: ${JSON.stringify(binding)}]`;
    }
    default:
      return '';
  }
}

function excerpt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit < 5) return text.slice(0, limit);
  const head = Math.ceil((limit - 3) * 0.7);
  const tail = limit - 3 - head;
  return text.slice(0, head) + ' … ' + text.slice(text.length - tail);
}

interface HistoryDigest {
  compaction?: string;
  requests: string[];
  resources: string[];
  receipts: string[];
  responses: string[];
}

function boundedLines(lines: string[], budget: number): string[] {
  const unique = [...new Set(lines)];
  if (unique.reduce((size, line) => size + line.length + 1, 0) <= budget) return unique;
  const count = Math.max(1, Math.floor(budget / 65));
  const selected =
    unique.length <= count ? unique : [unique[0], ...(count > 1 ? unique.slice(1 - count) : [])];
  let remaining = budget;
  return selected.map((line, index) => {
    const part = excerpt(line, Math.max(0, Math.floor(remaining / (selected.length - index)) - 1));
    remaining -= part.length + 1;
    return part;
  });
}

export function summarizeHistory(messages: Message[], previous?: HistoryDigest): HistoryDigest {
  const requests = [...(previous?.requests ?? [])];
  const resources = [...(previous?.resources ?? [])];
  const receipts = [...(previous?.receipts ?? [])];
  const responses = [...(previous?.responses ?? [])];
  for (const message of messages) {
    for (const block of message.content) {
      if (message.role === 'user') {
        const text = historyUserText(block);
        if (text) (block.type === 'text' ? requests : resources).push(text);
      } else if (block.type === 'tool_result') {
        const value = block.dataPipelineCompletion ?? block.structuredContent ?? block.content;
        const receipt = typeof value === 'string' ? value : JSON.stringify(value);
        receipts.push(
          `tool ${block.toolUseId}${block.isError ? ' (error)' : ''}: ${excerpt(receipt, 450)}`
        );
      } else if (
        block.type === 'text' &&
        block.text &&
        !/<(?:tool_use|tool_call|function_call|parameter)[ =>]/i.test(block.text)
      ) {
        responses.push(excerpt(block.text, 300));
      }
    }
  }
  return {
    compaction: previous?.compaction,
    requests: boundedLines(requests, 6000),
    resources: boundedLines(resources, 2500),
    receipts: boundedLines(receipts, 2500),
    responses: boundedLines(responses, 1000),
  };
}

export function renderHistorySummary(digest: HistoryDigest, budget: number): string {
  const fields: Array<[string, string[], number]> = [
    ['Earlier user requests', digest.requests, 0.45],
    ['Selected resources', digest.resources, 0.25],
    ['Tool receipts', digest.receipts, 0.22],
    ['Compaction notes', digest.compaction ? [digest.compaction] : [], 0.3],
    ['Earlier responses', digest.responses, 0.08],
  ];
  const present = fields.filter(([, lines]) => lines.length);
  let room = budget - present.reduce((size, [title]) => size + title.length + 3, 0);
  let remainingWeight = present.reduce((sum, [, , weight]) => sum + weight, 0);
  return excerpt(
    present
      .map(([title, lines, weight]) => {
        const limit = Math.max(0, Math.floor((room * weight) / remainingWeight));
        const text = boundedLines(lines, limit).join('\n');
        room -= text.length;
        remainingWeight -= weight;
        return `${title}:\n${text}`;
      })
      .join('\n'),
    budget
  );
}

function fingerprint(messages: Message[]): string {
  const hash = createHash('sha256');
  for (const message of messages) {
    const content = message.content.map((block) => {
      if (message.role === 'user') return historyUserText(block);
      if (block.type === 'tool_result')
        return [
          block.toolUseId,
          block.isError,
          block.content,
          block.structuredContent,
          block.dataPipelineCompletion,
        ];
      if (block.type === 'text') return block.text;
      return block.type;
    });
    hash.update(JSON.stringify([message.id, message.role, content]));
  }
  return hash.digest('hex');
}

export class HistorySummaryRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly sessionId: string
  ) {}

  load(messages: Message[]): { count: number; digest: HistoryDigest } | undefined {
    const row = this.db
      .prepare('SELECT * FROM session_history_summaries WHERE session_id=?')
      .get(this.sessionId) as
      | { first_message_id: string; last_message_id: string; range_hash: string; summary: string }
      | undefined;
    if (!row || messages[0]?.id !== row.first_message_id) return;
    const end = messages.findIndex((message) => message.id === row.last_message_id);
    if (end < 0 || fingerprint(messages.slice(0, end + 1)) !== row.range_hash) return;
    return { count: end + 1, digest: JSON.parse(row.summary) as HistoryDigest };
  }

  saveCompaction(
    messages: Message[],
    branch: SessionEntry[],
    result: Pick<CompactionResult, 'summary' | 'firstKeptEntryId'>
  ): void {
    const cut = branch.findIndex((entry) => entry.id === result.firstKeptEntryId);
    if (cut < 0) return;
    let marker = cut;
    while (marker >= 0) {
      const entry = branch[marker];
      if (entry.type === 'custom' && entry.customType === APP_TURN_ENTRY) {
        const firstKept = messages.findIndex(
          (message) => message.id === entry.data && message.role === 'user'
        );
        if (firstKept < 1) return;
        const covered = messages.slice(0, firstKept);
        const digest = summarizeHistory(covered);
        // A mid-turn cut may summarize half a tool exchange. Retain that entire
        // turn verbatim and include native notes only at a verified turn boundary.
        const splitTurn = branch
          .slice(marker + 1, cut)
          .some((item) => item.type === 'message' && item.message.role !== 'system');
        if (!splitTurn) digest.compaction = excerpt(result.summary, 4000);
        this.save(covered, digest);
        return;
      }
      marker--;
    }
  }

  save(messages: Message[], digest: HistoryDigest): void {
    if (!messages.length) return;
    try {
      this.db
        .prepare(
          `INSERT INTO session_history_summaries (session_id,first_message_id,last_message_id,range_hash,summary)
      VALUES (?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET first_message_id=excluded.first_message_id,
      last_message_id=excluded.last_message_id,range_hash=excluded.range_hash,summary=excluded.summary`
        )
        .run(
          this.sessionId,
          messages[0].id,
          messages[messages.length - 1].id,
          fingerprint(messages),
          JSON.stringify(digest)
        );
    } catch (error) {
      logWarn('[HistorySummary] Could not cache conversation summary', error);
    }
  }
}
