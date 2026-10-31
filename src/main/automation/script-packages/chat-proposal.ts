/**
 * 对话「转成脚本」 proposal: the qualifying turn's verified endpoints, headers, rules and result
 * columns, extracted by one model call into structured 要点 and redacted before and after. What
 * the dialog shows is exactly what the generation agent receives.
 */
import type { Message, SessionStatus } from '../../../shared/contracts/session';
import type { ScriptPackageSummary } from '../../../shared/automation/script-package';
import {
  CHAT_SCRIPT_ATTACHMENTS_LIMIT,
  countChatEndpoints,
  detectScheduleTime,
  eligibleChatTurns,
  emptyLine,
  pointsFromTurn,
  renderChatScriptPoints,
  sanitizeForScript,
  splitChatTurns,
  turnOptionLabel,
  type ChatScriptPoints,
  type ChatScriptProposal,
  type ChatScriptTurn,
} from '../../../shared/chat-to-script';
import { collectSecretValues } from '../../../shared/fix-error';
import { extractJsonObjectText } from '../../../shared/structured-text';

export type ChatPointsExtractor = (prompt: string, systemPrompt: string) => Promise<string>;

export interface BuildChatScriptProposalInput {
  sessionId: string;
  sessionTitle: string;
  sessionStatus?: SessionStatus;
  messages: Message[];
  /** Any message of the wanted turn (entry / proposal card); defaults to the latest one. */
  messageId?: string;
  packages: ScriptPackageSummary[];
  /** One-shot model call; omitted or failing → 要点 built from the turn directly. */
  extract?: ChatPointsExtractor;
  /** Extra values to redact (e.g. from the app config). */
  secrets?: string[];
}

export class ChatScriptProposalError extends Error {}

const EXTRACT_SYSTEM = [
  'You turn one finished data-fetch conversation turn into the key points for a script that will run the same fetch daily without AI.',
  'Reply with ONE JSON object only (no markdown):',
  '{"packageName": "short Chinese name, ≤ 16 chars", "goal": "...", "endpoints": [{"label": "榜单|详情|接口", "method": "GET", "url": "full URL with the query that worked", "note": "negative findings in one short clause, e.g. type=day / week 返回空数组"}], "headers": ["浏览器 User-Agent", "Referer: https://..."], "rules": ["fallbacks, ordering, formatting, null handling — one short clause each"], "columns": ["result column names in order"], "reference": "rows and one notable fact, e.g. 10 行，ToolForge 7 次居首", "emptyFallback": "what the turn verified to use when the primary query is empty, e.g. 改用月榜 (null when nothing was verified)", "scheduleTime": "HH:MM if the user asked for a time, else null"}',
  'Only use endpoints that returned data in this turn (status ok). Keep only the User-Agent, Referer, Accept and Content-Type headers; never include Authorization, Cookie, tokens, keys, environment variables or local paths. Chinese text, terse.',
].join('\n');

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function extractionPrompt(turn: ChatScriptTurn, laterUserTexts: string[]): string {
  return JSON.stringify(
    {
      userRequest: clip(turn.userText, 1500),
      laterUserMessages: laterUserTexts.map((text) => clip(text, 300)),
      fetches: turn.fetches.slice(-16).map((fetch) => ({
        status: fetch.ok ? 'ok' : 'failed',
        tool: fetch.tool,
        method: fetch.method,
        url: fetch.url,
        detail: clip(fetch.detail, 900),
        result: clip(fetch.result, 700),
      })),
      results: turn.results,
      finalAnswer: clip(turn.answer, 3000),
      lastFetchCode: turn.code ? clip(turn.code.content, 2500) : undefined,
    },
    null,
    1
  );
}

function asStrings(value: unknown, max = 12): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, max)
        .map((item) => item.trim())
    : [];
}

function parsePoints(
  text: string,
  secrets: string[]
): (ChatScriptPoints & { packageName?: string; scheduleTime?: string }) | null {
  try {
    const value = JSON.parse(extractJsonObjectText(text)) as Record<string, unknown>;
    const clean = (input: unknown, max = 400) =>
      typeof input === 'string' ? clip(sanitizeForScript(input.trim(), secrets), max) : '';
    const endpoints = Array.isArray(value.endpoints)
      ? value.endpoints
          .filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof (item as { url?: unknown }).url === 'string'
          )
          .slice(0, 6)
          .map((item) => ({
            label: clean(item.label, 20) || undefined,
            method: clean(item.method, 10).toUpperCase() || undefined,
            url: clean(item.url, 400),
            note: clean(item.note, 200) || undefined,
          }))
      : [];
    const headers = asStrings(value.headers, 4)
      .map((header) => sanitizeForScript(header, secrets))
      .filter((header) => /user-agent|referer|accept|content-type|浏览器/i.test(header));
    const schedule = clean(value.scheduleTime, 5);
    return {
      goal: clean(value.goal, 300),
      endpoints,
      headers,
      rules: asStrings(value.rules, 8).map((rule) => clip(sanitizeForScript(rule, secrets), 200)),
      columns: asStrings(value.columns, 30).map((column) => clip(column, 40)),
      reference: clean(value.reference, 120) || undefined,
      emptyFallback: clean(value.emptyFallback, 120) || null,
      packageName: clean(value.packageName, 24) || undefined,
      scheduleTime: /^\d{2}:\d{2}$/.test(schedule) ? schedule : undefined,
    };
  } catch {
    return null;
  }
}

/** Redacted attachments within the total budget (drop when too large). */
function references(turn: ChatScriptTurn): Array<{ name: string; content: string }> {
  if (!turn.code) return [];
  const size = new TextEncoder().encode(turn.code.content).length;
  return size <= CHAT_SCRIPT_ATTACHMENTS_LIMIT ? [turn.code] : [];
}

export async function buildChatScriptProposal(
  input: BuildChatScriptProposalInput
): Promise<ChatScriptProposal> {
  const secrets = [...collectSecretValues(process.env), ...(input.secrets ?? [])];
  const turns = eligibleChatTurns(
    input.messages,
    { running: input.sessionStatus === 'running', sessionError: input.sessionStatus === 'error' },
    secrets
  );
  if (turns.length === 0)
    throw new ChatScriptProposalError('这个对话还没有成功联网取数并产出表格或文件的轮次');
  const wanted = input.messageId;
  const turn =
    (wanted &&
      turns.find(
        (item) =>
          item.anchorId === wanted ||
          item.messageIds.includes(wanted) ||
          item.userMessageId === wanted
      )) ||
    // A proposal card placed after the turn: the latest qualifying turn before it.
    (wanted && latestBefore(input.messages, turns, wanted)) ||
    turns[turns.length - 1];
  const fromTurn = (number: number) =>
    input.packages.find(
      (pkg) => pkg.origin?.sessionId === input.sessionId && pkg.origin.turn === number
    );
  const allTurns = splitChatTurns(input.messages);
  const laterUserTexts = allTurns
    .filter((item) => item.turn > turn.turn)
    .map((item) =>
      sanitizeForScript(
        item.user.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as { text: string }).text)
          .join('\n'),
        secrets
      )
    );
  let points: ReturnType<typeof parsePoints> = null;
  let fallback = false;
  if (input.extract) {
    try {
      points = parsePoints(
        await input.extract(extractionPrompt(turn, laterUserTexts), EXTRACT_SYSTEM),
        secrets
      );
    } catch {
      points = null;
    }
  }
  if (!points || points.endpoints.length === 0) {
    fallback = true;
    points = {
      ...pointsFromTurn(turn),
      ...(points?.packageName ? { packageName: points.packageName } : {}),
    };
  }
  const refs = references(turn);
  const emptyPolicy = points.emptyFallback ? 'fallback' : 'fail';
  const rendered = renderChatScriptPoints(points, {
    sessionTitle: input.sessionTitle,
    turn: turn.turn,
    emptyPolicy,
    code: refs[0]?.name,
  });
  const existing = fromTurn(turn.turn);
  const endpoints = countChatEndpoints(turn);
  return {
    sessionId: input.sessionId,
    sessionTitle: input.sessionTitle,
    turn: turn.turn,
    anchorId: turn.anchorId,
    subtitle: `${input.sessionTitle} · 已跑通 · ${fallback ? endpoints : points.endpoints.length || endpoints} 个接口`,
    name: existing?.name ?? (points.packageName || clip(input.sessionTitle, 24)),
    points: rendered,
    emptyPolicy,
    emptyLines: {
      fallback: points.emptyFallback ? emptyLine('fallback', points.emptyFallback) : null,
      fail: emptyLine('fail'),
    },
    needsAuth: turn.needsAuth,
    references: refs,
    scheduleTime:
      points.scheduleTime ??
      [...laterUserTexts, turn.userText].map(detectScheduleTime).find(Boolean),
    turns: turns.map((item) => {
      const pkg = fromTurn(item.turn);
      return {
        turn: item.turn,
        anchorId: item.anchorId,
        label: turnOptionLabel(item),
        needsAuth: item.needsAuth,
        endpoints: countChatEndpoints(item),
        ...(pkg ? { existing: { packageId: pkg.id, name: pkg.name } } : {}),
      };
    }),
    ...(existing
      ? {
          existing: {
            packageId: existing.id,
            name: existing.name,
            baseVersion: existing.draft?.version ?? existing.published?.version ?? null,
            label: `更新 ${existing.name}（新草稿）`,
          },
        }
      : {}),
    ...(fallback ? { fallback } : {}),
  };
}

function latestBefore(
  messages: Message[],
  turns: ChatScriptTurn[],
  messageId: string
): ChatScriptTurn | undefined {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return undefined;
  const before = new Set(messages.slice(0, index + 1).map((message) => message.id));
  return [...turns]
    .reverse()
    .find((turn) => before.has(turn.anchorId) || before.has(turn.userMessageId));
}
