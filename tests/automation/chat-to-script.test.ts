import { describe, expect, it } from 'vitest';
import type { Message } from '../../src/shared/contracts/session';
import {
  analyzeChatTurn,
  countChatEndpoints,
  chatScriptAnchors,
  detectScheduleTime,
  eligibleChatTurns,
  sanitizeForScript,
  splitChatTurns,
} from '../../src/shared/chat-to-script';
import {
  buildChatScriptProposal,
  ChatScriptProposalError,
} from '../../src/main/automation/script-packages/chat-proposal';
import type { ScriptPackageSummary } from '../../src/shared/automation/script-package';

let seq = 0;
const msg = (role: 'user' | 'assistant', content: Message['content'], extra = {}): Message =>
  ({ id: `m${++seq}`, sessionId: 's1', role, content, timestamp: seq, ...extra }) as Message;
const text = (role: 'user' | 'assistant', value: string) =>
  msg(role, [{ type: 'text', text: value }]);
const tool = (id: string, name: string, input: Record<string, unknown>) =>
  msg('assistant', [{ type: 'tool_use', id, name, input }]);
const result = (id: string, content: string, isError = false) =>
  msg('assistant', [{ type: 'tool_result', toolUseId: id, content, isError }]);

const TABLE = [
  '| 排名 | 软件名 | 版本 |',
  '| --- | --- | --- |',
  '| 1 | ToolForge | 1.2 |',
  '| 2 | NocoBase | 4 |',
  '| 3 | Skyeye | — |',
].join('\n');

function fetchTurn(
  command = 'curl -s -H "User-Agent: Mozilla" "https://apiv1.oschina.net/oschinapi/project/ranking?type=month"'
) {
  return [
    text('user', '从开源中国获取当天的软件更新信息，输出成一张表'),
    tool('t1', 'bash', { command }),
    result('t1', '{"code":200,"result":[{"name":"ToolForge"}]}'),
    text('assistant', `结果如下：\n\n${TABLE}`),
  ];
}

describe('chat-to-script eligibility (strict trigger)', () => {
  it('needs a finished turn with a successful network fetch and a structured result', () => {
    const messages = fetchTurn();
    const turns = eligibleChatTurns(messages);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ turn: 1, anchorId: messages[3].id });
    expect(turns[0].results[0]).toMatchObject({ kind: 'table', rows: 3 });
    // Still running → no entry.
    expect(eligibleChatTurns(messages, { running: true })).toHaveLength(0);
    expect(eligibleChatTurns(messages, { sessionError: true })).toHaveLength(0);
  });

  it('ignores pure Q&A, failed fetches, local work and text-only answers', () => {
    expect(
      eligibleChatTurns([text('user', '什么是 RSS？'), text('assistant', `解释\n\n${TABLE}`)])
    ).toHaveLength(0);
    const failed = fetchTurn();
    (failed[2].content[0] as { isError?: boolean }).isError = true;
    expect(eligibleChatTurns(failed)).toHaveLength(0);
    const local = [
      text('user', '统计一下'),
      tool('t1', 'bash', { command: 'python3 count.py data.csv' }),
      result('t1', 'ok'),
      text('assistant', TABLE),
    ];
    expect(eligibleChatTurns(local)).toHaveLength(0);
    const noTable = [...fetchTurn().slice(0, 3), text('assistant', '一共 10 条更新。')];
    expect(eligibleChatTurns(noTable)).toHaveLength(0);
    const cancelled = fetchTurn();
    cancelled[3] = { ...cancelled[3], localStatus: 'cancelled' } as Message;
    expect(eligibleChatTurns(cancelled)).toHaveLength(0);
  });

  it('accepts webfetch plus a written csv file and flags credentials', () => {
    const messages = [
      text('user', '抓一下'),
      tool('w1', 'webfetch', { url: 'https://api.example.com/list?token=abc123' }),
      result('w1', '[{"a":1}]'),
      tool('w2', 'write', { path: '/home/u/out/list.csv', content: 'a\n1\n' }),
      result('w2', 'ok'),
      text('assistant', '已写入 list.csv'),
    ];
    const [turn] = eligibleChatTurns(messages);
    expect(turn.results).toEqual([{ kind: 'file', name: 'list.csv' }]);
    expect(turn.needsAuth).toBe(true);
    expect(turn.fetches[0].url).toBe('https://api.example.com/list?token=<redacted>');
  });

  it('maps the propose card of a later 「每天自动跑」 turn to the latest qualifying turn', () => {
    const first = fetchTurn();
    const second = [
      text('user', '把这个做成每天早上 9 点自动跑'),
      tool('p1', 'script_package_propose', { scheduleTime: '09:00' }),
      result('p1', '{"proposed":true}'),
      text('assistant', '点「转成脚本」即可。'),
    ];
    const anchors = chatScriptAnchors([...first, ...second]);
    expect(anchors.get(first[3].id)?.eligible).toBe(true);
    const card = anchors.get(second[3].id);
    expect(card?.eligible).toBe(false);
    expect(card?.proposal).toMatchObject({ scheduleTime: '09:00' });
    expect(card?.proposal?.target?.anchorId).toBe(first[3].id);
  });
});

describe('chat-to-script redaction', () => {
  it('removes credentials, env references and local paths', () => {
    const code = [
      'headers = {"Authorization": "Bearer sk-live-123456", "User-Agent": "Mozilla"}',
      'curl -H "Cookie: sid=abcdef" "https://x.com/api?api_key=k123&page=1"',
      'key = os.environ["OSC_TOKEN"]',
      "open('/home/alice/work/out.csv')",
    ].join('\n');
    const clean = sanitizeForScript(code);
    expect(clean).not.toMatch(/sk-live-123456|sid=abcdef|k123|OSC_TOKEN|alice/);
    expect(clean).toContain('"User-Agent": "Mozilla"');
    expect(clean).toContain('page=1');
    expect(clean).toContain('<workdir>');
    expect(clean).toContain('<env>');
  });

  it('keeps the fetch code within 4 KB', () => {
    const long = `python3 - <<'PY'\nimport requests\nrequests.get("https://a.com/x")\n${'# pad\n'.repeat(2000)}PY`;
    const [turn] = eligibleChatTurns(fetchTurn(long));
    expect(new TextEncoder().encode(turn.code!.content).length).toBeLessThanOrEqual(4096 + 32);
  });

  it('detects the daily time from the user text', () => {
    expect(detectScheduleTime('每天早上 9 点自动跑')).toBe('09:00');
    expect(detectScheduleTime('下午3点半')).toBe('15:30');
    expect(detectScheduleTime('8:05 跑一次')).toBe('08:05');
    expect(detectScheduleTime('每天自动跑')).toBeUndefined();
  });
});

describe('buildChatScriptProposal', () => {
  const extract = async () =>
    JSON.stringify({
      packageName: 'OSChina软件更新榜单',
      goal: '获取 OSChina 软件更新榜单',
      endpoints: [
        {
          label: '榜单',
          method: 'GET',
          url: 'https://apiv1.oschina.net/oschinapi/project/ranking?type=month',
          note: 'type=day 返回空数组',
        },
      ],
      headers: ['浏览器 User-Agent', 'Cookie: sid=abc', 'Referer: https://www.oschina.net/'],
      rules: ['日榜为空改用月榜'],
      columns: ['排名', '软件名', '版本'],
      reference: '3 行',
      emptyFallback: '改用月榜',
      scheduleTime: null,
    });

  it('renders redacted 要点 from the one-shot extraction', async () => {
    const messages = fetchTurn();
    const proposal = await buildChatScriptProposal({
      sessionId: 's1',
      sessionTitle: 'OSChina更新榜单获取',
      messages,
      packages: [],
      extract,
    });
    expect(proposal).toMatchObject({
      turn: 1,
      anchorId: messages[3].id,
      name: 'OSChina软件更新榜单',
      emptyPolicy: 'fallback',
      needsAuth: false,
    });
    expect(proposal.points).toContain('【来自对话：OSChina更新榜单获取 · 第 1 轮，已验证】');
    expect(proposal.points).toContain(
      '榜单：GET https://apiv1.oschina.net/oschinapi/project/ranking?type=month'
    );
    expect(proposal.points).toContain('空数据：改用月榜（对话中已验证）');
    expect(proposal.points).not.toContain('Cookie');
    expect(proposal.points.length).toBeLessThanOrEqual(4000);
    expect(proposal.references[0].content).toContain('apiv1.oschina.net');
    expect(proposal.existing).toBeUndefined();
  });

  it('falls back to the turn facts and offers 更新已有包 for a converted turn', async () => {
    const messages = [...fetchTurn(), text('user', '以后每天 8 点跑')];
    const pkg = {
      id: 'osc',
      name: 'OSChina软件更新榜单',
      draft: { version: 2 },
      origin: { sessionId: 's1', sessionTitle: 't', turn: 1, messageId: messages[3].id },
    } as unknown as ScriptPackageSummary;
    const proposal = await buildChatScriptProposal({
      sessionId: 's1',
      sessionTitle: 'OSChina更新榜单获取',
      messages,
      packages: [pkg],
      extract: async () => 'not json',
    });
    expect(proposal.fallback).toBe(true);
    expect(proposal.points).toContain(
      'https://apiv1.oschina.net/oschinapi/project/ranking?type=month'
    );
    expect(proposal.scheduleTime).toBe('08:00');
    expect(proposal.existing).toMatchObject({ packageId: 'osc', baseVersion: 2 });
    expect(proposal.turns[0].existing).toMatchObject({ packageId: 'osc' });
  });

  it('refuses a conversation without a qualifying turn', async () => {
    await expect(
      buildChatScriptProposal({
        sessionId: 's1',
        sessionTitle: 'Q&A',
        messages: [text('user', '你好'), text('assistant', '你好！')],
        packages: [],
      })
    ).rejects.toBeInstanceOf(ChatScriptProposalError);
  });

  it('splits turns by user messages', () => {
    const turns = splitChatTurns([
      ...fetchTurn(),
      text('user', '谢谢'),
      text('assistant', '不客气'),
    ]);
    expect(turns.map((turn) => turn.turn)).toEqual([1, 2]);
    expect(analyzeChatTurn(turns[1])?.fetches).toEqual([]);
  });
});

describe('countChatEndpoints', () => {
  it('counts the endpoints of the working code, not exploration probes or static assets', () => {
    const messages = [
      text('user', '抓榜单'),
      tool('a', 'bash', { command: 'curl -s https://www.oschina.net/project' }),
      result('a', '<html>'),
      tool('b', 'bash', { command: 'curl -s https://static.oschina.net/app.js' }),
      result('b', 'js'),
      tool('w', 'write', {
        path: '/tmp/fetch.py',
        content:
          'import requests\nrequests.get("https://apiv1.oschina.net/oschinapi/project/ranking")\nrequests.get(f"https://apiv1.oschina.net/oschinapi/project/detail?id={pid}")\nlink = f"https://www.oschina.net/p/{ident}"',
      }),
      result('w', 'ok'),
      tool('c', 'bash', { command: 'python3 /tmp/fetch.py' }),
      result('c', 'rows'),
      text('assistant', TABLE),
    ];
    const [turn] = eligibleChatTurns(messages);
    expect(countChatEndpoints(turn)).toBe(2);
  });
});
