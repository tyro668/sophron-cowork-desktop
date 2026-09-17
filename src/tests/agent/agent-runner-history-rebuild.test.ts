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
              name: 'data_list_tasks',
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
          name: 'data_list_tasks',
          arguments: { query: 'daily' },
        },
      ],
      stopReason: 'toolUse',
    });
    expect(history[2]).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'data_list_tasks',
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
              text: '<tool_use name="data_list_tasks"><parameter=query>daily</parameter>',
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
        'Checking now: <tool_use name="data_list_tasks"><parameter=query>daily</parameter></function>'
      )
    ).toBe(true);
  });

  it('blocks a pseudo tool call split across streaming chunks without emitting the marker', () => {
    const guard = new PseudoToolCallStreamGuard();
    const first = guard.push('Checking now: <too');
    const second = guard.push('l_use na');
    const third = guard.push('me="data_list_tasks">');

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
