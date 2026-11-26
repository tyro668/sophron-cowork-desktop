import { SessionManager as PiSessionManager } from '@earendil-works/pi-coding-agent';
import type { Message as PiMessage } from '@earendil-works/pi-ai';
import { APP_TURN_ENTRY, HistorySummaryRepository } from '../../main/agent/history-summary';
import { harnessDatabase, temporaryDatabasePath } from '../../../tests/fixtures/harness-db';
import { describe, expect, it } from 'vitest';
import type { Message } from '../../shared/contracts';
import {
  buildColdStartAgentHistory,
  containsPseudoToolCallMarkup,
  PseudoToolCallStreamGuard,
} from '../../main/agent/agent-protocol-safety';

const HISTORY_OPTIONS = {
  api: 'openai-completions',
  provider: 'test-provider',
  model: 'test-model',
  maxChars: 100_000,
};

function message(
  id: string,
  role: Message['role'],
  content: Message['content'],
  timestamp: number
): Message {
  return { id, sessionId: 'session-1', role, content, timestamp };
}

describe('buildColdStartAgentHistory', () => {
  it('restores tool calls and results through native SDK message roles', () => {
    const history = buildColdStartAgentHistory(
      [
        message('u1', 'user', [{ type: 'text', text: 'list my tasks' }], 1),
        message(
          'a1',
          'assistant',
          [
            { type: 'text', text: 'I will check.' },
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'data_list_pipelines',
              input: { query: 'daily' },
            },
          ],
          2
        ),
        message(
          'r1',
          'assistant',
          [{ type: 'tool_result', toolUseId: 'call-1', content: 'Found one task.' }],
          3
        ),
        message('a2', 'assistant', [{ type: 'text', text: 'Found it.' }], 4),
      ],
      HISTORY_OPTIONS
    );

    expect(history.map((item) => item.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'assistant',
    ]);
    expect(history[1]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will check.' },
        {
          type: 'toolCall',
          id: 'call-1',
          name: 'data_list_pipelines',
          arguments: { query: 'daily' },
        },
      ],
      stopReason: 'toolUse',
    });
    expect(history[2]).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'data_list_pipelines',
      isError: false,
    });
    expect(JSON.stringify(history)).not.toContain('<tool_use');
    expect(JSON.stringify(history)).not.toContain('<tool_result');
  });

  it('does not replay persisted thinking or malformed assistant protocol text', () => {
    const history = buildColdStartAgentHistory(
      [
        message('u1', 'user', [{ type: 'text', text: 'create it' }], 1),
        message(
          'a1',
          'assistant',
          [
            { type: 'thinking', thinking: 'private reasoning' },
            {
              type: 'text',
              text: '<tool_use name="data_list_pipelines"><parameter=query>daily</parameter>',
            },
          ],
          2
        ),
      ],
      HISTORY_OPTIONS
    );

    const serialized = JSON.stringify(history);
    expect(serialized).not.toContain('private reasoning');
    expect(serialized).not.toContain('<tool_use');
    expect(serialized).toContain('Previous assistant response omitted');
  });

  it('drops orphan tool calls and results instead of creating invalid provider history', () => {
    const history = buildColdStartAgentHistory(
      [
        message('u1', 'user', [{ type: 'text', text: 'run it' }], 1),
        message(
          'a1',
          'assistant',
          [{ type: 'tool_use', id: 'orphan-call', name: 'run', input: {} }],
          2
        ),
        message(
          'r1',
          'assistant',
          [{ type: 'tool_result', toolUseId: 'unknown-call', content: 'orphan result' }],
          3
        ),
      ],
      HISTORY_OPTIONS
    );

    expect(history).toEqual([{ role: 'user', content: 'run it', timestamp: 1 }]);
  });

  it('does not pair a tool result that appears before its tool call', () => {
    const history = buildColdStartAgentHistory(
      [
        message('u1', 'user', [{ type: 'text', text: 'run it' }], 1),
        message(
          'r1',
          'assistant',
          [{ type: 'tool_result', toolUseId: 'call-1', content: 'out of order' }],
          2
        ),
        message('a1', 'assistant', [{ type: 'tool_use', id: 'call-1', name: 'run', input: {} }], 3),
      ],
      HISTORY_OPTIONS
    );

    expect(history).toEqual([{ role: 'user', content: 'run it', timestamp: 1 }]);
  });

  it('restores constraints, attachment references and receipts from a verified checkpoint under 1000 characters', () => {
    const path = temporaryDatabasePath();
    const db = harnessDatabase(path);
    db.raw.exec("INSERT INTO sessions(id,title,created_at,updated_at) VALUES ('s','Test',0,0)");
    const messages = [
      message('u1', 'user', [{ type: 'text', text: 'Use EUR only' }], 1),
      message(
        'u2',
        'user',
        [
          { type: 'text', text: 'Check the image totals' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'PRIVATE_BINARY' },
          },
          {
            type: 'file_attachment',
            filename: 'ledger.csv',
            relativePath: '.tmp/ledger.csv',
            size: 1,
            inlineDataBase64: 'PRIVATE_BINARY',
          },
          {
            type: 'cloud_table_attachment',
            tables: [{ id: 'cloud-7', tableId: 'table-3', tableName: 'Ledger' }],
          },
        ],
        2
      ),
      message(
        'r2',
        'assistant',
        [
          {
            type: 'tool_result',
            toolUseId: 'write-1',
            content: 'saved',
            structuredContent: { receiptId: 'out-49' },
          },
        ],
        3
      ),
      message('a2', 'assistant', [{ type: 'text', text: 'a'.repeat(5000) }], 4),
    ];
    for (const row of messages)
      db.raw
        .prepare(
          'INSERT INTO messages(id,session_id,role,content,timestamp) VALUES (?, ?, ?, ?, ?)'
        )
        .run(row.id, 's', row.role, JSON.stringify(row.content), row.timestamp);
    const build = (repository: HistorySummaryRepository) =>
      JSON.stringify(
        buildColdStartAgentHistory(messages, {
          ...HISTORY_OPTIONS,
          maxChars: 1000,
          summaries: repository,
        })
      );
    const fresh = build(new HistorySummaryRepository(db.raw, 's'));
    expect(fresh.length).toBeLessThanOrEqual(1000);
    for (const field of [
      'Use EUR only',
      'Check the image totals',
      '.tmp/ledger.csv',
      'cloud-7',
      'table-3',
      'out-49',
    ])
      expect(fresh).toContain(field);
    expect(fresh).not.toContain('PRIVATE_BINARY');
    db.close();
    const reopened = harnessDatabase(path);
    const repository = new HistorySummaryRepository(reopened.raw, 's');
    expect(repository.load(messages)?.count).toBe(4);
    expect(build(repository)).toBe(fresh);
    messages[0] = message('u1', 'user', [{ type: 'text', text: 'Use USD only' }], 1);
    expect(repository.load(messages)).toBeUndefined();
    expect(build(repository)).toContain('Use USD only');
  });
  it('saves native compaction only for its verified range and restores a whole split turn', () => {
    const db = harnessDatabase();
    db.raw.exec(
      "INSERT INTO sessions(id,title,created_at,updated_at) VALUES ('session-1','Test',0,0)"
    );
    const messages = [
      message('u1', 'user', [{ type: 'text', text: 'Keep source records' }], 1),
      message('a1', 'assistant', [{ type: 'text', text: 'Noted' }], 2),
      message('u2', 'user', [{ type: 'text', text: 'Inspect output' }], 3),
      message('call', 'assistant', [{ type: 'tool_use', name: 'inspect', id: 'c', input: {} }], 4),
      message(
        'result',
        'assistant',
        [{ type: 'tool_result', toolUseId: 'c', content: 'received' }],
        5
      ),
    ];
    for (const m of messages)
      db.raw
        .prepare('INSERT INTO messages(id,session_id,role,content,timestamp) VALUES (?,?,?,?,?)')
        .run(m.id, m.sessionId, m.role, JSON.stringify(m.content), m.timestamp);
    const ids = new Map<PiMessage, string>();
    const pi = PiSessionManager.inMemory();
    const seed = buildColdStartAgentHistory(messages, { ...HISTORY_OPTIONS, restoredUserIds: ids });
    const entries = seed.map((item) => {
      const userId = ids.get(item);
      if (userId) pi.appendCustomEntry(APP_TURN_ENTRY, userId);
      return pi.appendMessage(item);
    });
    const repository = new HistorySummaryRepository(db.raw, 'session-1');
    for (const [firstKeptEntryId, atTurnStart] of [
      [entries[2], true],
      [entries[4], false],
    ] as const) {
      repository.saveCompaction(messages, pi.getBranch(), {
        firstKeptEntryId,
        summary: 'Verified context note',
      });
      expect(repository.load(messages)?.count).toBe(2);
      const restored = buildColdStartAgentHistory(messages, {
        ...HISTORY_OPTIONS,
        summaries: repository,
      });
      expect(restored.slice(1)).toEqual(seed.slice(2));
      expect(JSON.stringify(restored).includes('Verified context note')).toBe(atTurnStart);
      expect(JSON.stringify(restored)).toContain('Keep source records');
    }
  });

  it('keeps complete recent user turns within the history budget', () => {
    const messages = [
      message('u1', 'user', [{ type: 'text', text: 'old question' }], 1),
      message('a1', 'assistant', [{ type: 'text', text: 'old answer' }], 2),
      message('u2', 'user', [{ type: 'text', text: 'recent question' }], 3),
      message('a2', 'assistant', [{ type: 'text', text: 'recent answer' }], 4),
    ];
    const recentTurnSize = JSON.stringify(
      buildColdStartAgentHistory(messages.slice(2), HISTORY_OPTIONS)
    ).length;
    const history = buildColdStartAgentHistory(messages, {
      ...HISTORY_OPTIONS,
      maxChars: recentTurnSize,
    });

    expect(history.map((item) => item.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(history)).toContain('recent question');
    expect(JSON.stringify(history)).not.toContain('old question');
  });
});

describe('pseudo tool-call protocol guard', () => {
  it('detects the mixed protocol shape from the reported failure', () => {
    expect(
      containsPseudoToolCallMarkup(
        'Checking now: <tool_use name="data_list_pipelines"><parameter=query>daily</parameter></function>'
      )
    ).toBe(true);
  });

  it('blocks a pseudo tool call split across streaming chunks without emitting the marker', () => {
    const guard = new PseudoToolCallStreamGuard();
    const first = guard.push('Checking now: <too');
    const second = guard.push('l_use na');
    const third = guard.push('me="data_list_pipelines">');

    expect(first).toEqual({ text: 'Checking now: ', violated: false });
    expect(second).toEqual({ text: '', violated: false });
    expect(third).toEqual({ text: '', violated: true });
  });

  it('streams normal angle-bracket text unchanged', () => {
    const guard = new PseudoToolCallStreamGuard();
    const first = guard.push('Use <table> for layout and compare a < b.');
    const final = guard.flush();

    expect(first).toEqual({ text: 'Use <table> for layout and compare a < b.', violated: false });
    expect(final).toEqual({ text: '', violated: false });
  });

  it('allows a non-call-shaped tag mention after the candidate is flushed', () => {
    const guard = new PseudoToolCallStreamGuard();
    const first = guard.push('The literal tag is <tool_use> in this document.');
    const final = guard.flush();

    expect(first).toEqual({ text: 'The literal tag is ', violated: false });
    expect(final).toEqual({ text: '<tool_use> in this document.', violated: false });
  });
});
