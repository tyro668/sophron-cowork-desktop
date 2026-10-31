/**
 * 对话「转成脚本」: which conversation turns qualify (finished, fetched data from the network
 * successfully, produced a structured result) and the redacted facts handed to the script
 * generation agent. Pure functions shared by the renderer (entry visibility) and the main
 * process (proposal builder).
 */
import type {
  ContentBlock,
  Message,
  ToolResultContent,
  ToolUseContent,
} from '../contracts/session';
import { redactSecrets } from '../fix-error';

/** Limits from the design: 要点 = 规则描述 limit, code attachment, all attachments. */
export const CHAT_SCRIPT_POINTS_LIMIT = 4000;
export const CHAT_SCRIPT_CODE_LIMIT = 4096;
export const CHAT_SCRIPT_ATTACHMENTS_LIMIT = 16 * 1024;
export const CHAT_SCRIPT_SAMPLE_ROWS = 5;
export const CHAT_SCRIPT_CELL_LIMIT = 80;

export type ChatScriptResultKind = 'table' | 'file' | 'data_object';

export interface ChatScriptResult {
  kind: ChatScriptResultKind;
  /** Markdown table: header and up to CHAT_SCRIPT_SAMPLE_ROWS rows; file / object: its name. */
  columns?: string[];
  rows?: number;
  sample?: string[][];
  name?: string;
}

export interface ChatScriptFetch {
  tool: 'webfetch' | 'bash';
  /** webfetch URL, or the first URL in a bash command. */
  url?: string;
  method?: string;
  /** Redacted bash command (or webfetch headers) for the extractor. */
  detail: string;
  /** Redacted head of the tool result. */
  result: string;
  ok: boolean;
}

export interface ChatScriptTurn {
  /** 1-based number of the user message that starts the turn. */
  turn: number;
  userMessageId: string;
  /** Last assistant message of the turn: entry, backlink and proposal anchor. */
  anchorId: string;
  userText: string;
  /** Final answer text of the turn. */
  answer: string;
  fetches: ChatScriptFetch[];
  results: ChatScriptResult[];
  /** A successful fetch carried credentials (Authorization, Cookie, token / key params). */
  needsAuth: boolean;
  cancelled: boolean;
  /** script_package_save / script_package_propose calls in this turn. */
  proposed: boolean;
  /** script_package_propose card of this turn (「每天自动跑」 intent). */
  proposal?: { scheduleTime?: string };
  /** Last successful fetch code (heredoc / written file / command), redacted, ≤ 4 KB. */
  code?: { name: string; content: string };
  /** Assistant message ids of the turn (for mapping the propose card). */
  messageIds: string[];
}

export interface ChatScriptEligibility {
  eligible: boolean;
  reason?: 'running' | 'cancelled' | 'no_fetch' | 'no_result' | 'error';
}

// ── text helpers ────────────────────────────────────────────────────────

function blocksOf(message: Message): ContentBlock[] {
  return Array.isArray(message.content) ? message.content : [];
}

function textOf(message: Message): string {
  return blocksOf(message)
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('\n')
    .trim();
}

const HEADER_SECRET =
  /\b((?:authorization|cookie|set-cookie|x-[\w-]*(?:token|key|auth)[\w-]*|[\w-]*api[-_]?key)\s*:\s*)([^"'\s][^"'\n]*)/gi;
const PY_HEADER_SECRET =
  /(["'](?:authorization|cookie|x-[\w-]*(?:token|key|auth)[\w-]*|[\w-]*api[-_]?key|token|access_token|secret)["']\s*:\s*["'])([^"']+)(["'])/gi;
const PARAM_SECRET =
  /([?&](?:access_?token|token|api_?key|apikey|key|secret|password|sign|signature|session)=)[^&\s"'#]+/gi;
const HOME_PATH =
  /(?:\/home\/[^/\s"'`]+|\/Users\/[^/\s"'`]+|\/root|[A-Za-z]:\\Users\\[^\\\s"'`]+)(?:[\\/][^\s"'`<>|]*)?/g;
const TMP_PATH = /(?<![\w:/])\/(?:tmp|var\/folders|private\/var)\/[^\s"'`<>|]*/g;
const ENV_REF =
  /\$\{?[A-Z][A-Z0-9_]{2,}\}?|process\.env\.[A-Z_][A-Z0-9_]*|os\.environ(?:\.get)?\(?\[?["'][A-Z_]+["']\]?\)?/g;

/** Redact secrets, credentials, env references and local paths for the generation agent. */
export function sanitizeForScript(text: string, secrets: string[] = []): string {
  return redactSecrets(String(text ?? ''), secrets)
    .replace(/\[REDACTED\]/g, '<redacted>')
    .replace(PY_HEADER_SECRET, '$1<redacted>$3')
    .replace(HEADER_SECRET, '$1<redacted>')
    .replace(PARAM_SECRET, '$1<redacted>')
    .replace(ENV_REF, '<env>')
    .replace(HOME_PATH, '<workdir>')
    .replace(TMP_PATH, '<workdir>');
}

const AUTH_HINT =
  /(authorization\s*[:=]|cookie\s*[:=]|x-[\w-]*token\s*[:=]|bearer\s+[A-Za-z0-9._-]{8,}|[?&](?:access_?token|api_?key|apikey|token|secret)=[^&\s"']{4,}|["'](?:authorization|cookie|x-[\w-]*token|api[_-]?key|access_token)["']\s*:\s*["'][^"']{4,})/i;

/** Network fetch in a bash command (curl / wget / requests / fetch / an http(s) URL). */
export function isFetchCommand(command: string): boolean {
  return (
    /https?:\/\//i.test(command) ||
    /\b(?:curl|wget|requests\.|urllib|httpx|aiohttp|fetch\s*\()/i.test(command)
  );
}

function firstUrl(text: string): string | undefined {
  return /https?:\/\/[^\s"'\\)<>]+/i.exec(text)?.[0];
}

/** Markdown tables in a text: header cells and data rows (separator excluded). */
export function markdownTables(text: string): Array<{ columns: string[]; rows: string[][] }> {
  const tables: Array<{ columns: string[]; rows: string[][] }> = [];
  const lines = String(text ?? '').split(/\r?\n/);
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index].trim();
    const separator = lines[index + 1].trim();
    if (!header.includes('|') || !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(separator))
      continue;
    const columns = cells(header);
    const rows: string[][] = [];
    let cursor = index + 2;
    while (cursor < lines.length && lines[cursor].trim().includes('|')) {
      rows.push(cells(lines[cursor]));
      cursor += 1;
    }
    tables.push({ columns, rows });
    index = cursor - 1;
  }
  return tables;
}

const DATA_LINK = /\[([^\]\n]+)\]\((?:#\/data\/|sophron:\/\/data\/)([a-z-]+)\/[^)\s]+\)/gi;
const OUTPUT_FILE = /([\w\u4e00-\u9fa5.-]+\.(?:csv|json|xlsx))\b/i;
const WRITES_OUTPUT =
  /(?:>\s*["']?[^\s"']+\.(?:csv|json|xlsx)|to_csv\(|to_excel\(|to_json\(|json\.dump\(|csv\.writer|DictWriter|writeFileSync\([^)]*\.(?:csv|json)|-o\s+["']?[^\s"']+\.(?:csv|json|xlsx))/i;

function clipCell(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > CHAT_SCRIPT_CELL_LIMIT
    ? `${text.slice(0, CHAT_SCRIPT_CELL_LIMIT - 1)}…`
    : text;
}

function clipBytes(text: string, bytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= bytes) return text;
  let end = Math.min(text.length, bytes);
  while (end > 0 && encoder.encode(text.slice(0, end)).length > bytes - 20) end -= 64;
  return `${text.slice(0, Math.max(0, end))}\n… (truncated)`;
}

// ── turns ───────────────────────────────────────────────────────────────

/** Turns: a user message and the assistant messages after it. */
export function splitChatTurns(
  messages: Message[]
): Array<{ user: Message; replies: Message[]; turn: number }> {
  const turns: Array<{ user: Message; replies: Message[]; turn: number }> = [];
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({ user: message, replies: [], turn: turns.length + 1 });
    } else if (message.role === 'assistant' && turns.length > 0) {
      turns[turns.length - 1].replies.push(message);
    }
  }
  return turns;
}

const PROPOSE_OR_SAVE = /(^|[_.:])script_package_(save|propose)$/;

/** Facts of one turn (what it fetched, what it produced). */
export function analyzeChatTurn(
  turn: { user: Message; replies: Message[]; turn: number },
  secrets: string[] = []
): ChatScriptTurn | null {
  const replies = turn.replies.filter(
    (message) => !(typeof message.id === 'string' && message.id.startsWith('partial-'))
  );
  if (replies.length === 0) return null;
  const blocks = replies.flatMap(blocksOf);
  const uses = new Map<string, ToolUseContent>();
  const results = new Map<string, ToolResultContent>();
  for (const block of blocks) {
    if (block.type === 'tool_use') uses.set(block.id, block);
    if (block.type === 'tool_result') results.set(block.toolUseId, block);
  }
  const fetches: ChatScriptFetch[] = [];
  const outputs: ChatScriptResult[] = [];
  const written = new Map<string, string>();
  let code: ChatScriptTurn['code'];
  let needsAuth = false;
  let proposed = false;
  let proposal: ChatScriptTurn['proposal'];
  for (const use of uses.values()) {
    const result = results.get(use.id);
    const ok = Boolean(result) && result?.isError !== true;
    const name = use.name.replace(/^.*[.:]/, '');
    const input = (use.input ?? {}) as Record<string, unknown>;
    if (PROPOSE_OR_SAVE.test(use.name) && ok) proposed = true;
    if (/(^|[_.:])script_package_propose$/.test(use.name) && ok) {
      const time = typeof input.scheduleTime === 'string' ? input.scheduleTime : '';
      proposal = /^\d{2}:\d{2}$/.test(time) ? { scheduleTime: time } : {};
    }
    if (name === 'write' && typeof input.path === 'string' && typeof input.content === 'string') {
      written.set(input.path.split(/[\\/]/).pop() ?? input.path, input.content);
      if (ok && /\.(csv|json|xlsx)$/i.test(input.path))
        outputs.push({ kind: 'file', name: input.path.split(/[\\/]/).pop() });
    }
    if (/^data_create_raw_table|^data_create_result_table|^data_run_pipeline/.test(name) && ok) {
      for (const match of (result?.content ?? '').matchAll(DATA_LINK))
        outputs.push({ kind: 'data_object', name: match[1] });
    }
    if (name === 'webfetch' || name === 'web_fetch') {
      const url = typeof input.url === 'string' ? input.url : '';
      const headers = input.headers ? JSON.stringify(input.headers) : '';
      if (ok && AUTH_HINT.test(`${url} ${headers}`)) needsAuth = true;
      fetches.push({
        tool: 'webfetch',
        url: sanitizeForScript(url, secrets),
        method: typeof input.method === 'string' ? input.method.toUpperCase() : 'GET',
        detail: sanitizeForScript(headers, secrets).slice(0, 600),
        result: sanitizeForScript(result?.content ?? '', secrets).slice(0, 1200),
        ok,
      });
    }
    if (name === 'bash') {
      const command = typeof input.command === 'string' ? input.command : '';
      // `python3 fetch.py` runs a file written earlier in the turn: that file's code counts.
      const ran = /\b(?:python3?|node)\s+([\w./-]+\.(?:py|m?js))/.exec(command);
      const ranCode = ran ? written.get(ran[1].split('/').pop() ?? '') : undefined;
      if (!isFetchCommand(command) && !(ranCode && isFetchCommand(ranCode))) continue;
      if (ok && AUTH_HINT.test(command)) needsAuth = true;
      fetches.push({
        tool: 'bash',
        url:
          sanitizeForScript(firstUrl(command) ?? firstUrl(ranCode ?? '') ?? '', secrets) ||
          undefined,
        detail: sanitizeForScript(command, secrets).slice(0, 1500),
        result: sanitizeForScript(result?.content ?? '', secrets).slice(0, 1200),
        ok,
      });
      if (ok) {
        const runs = /\b(?:python3?|node)\s+([\w./-]+\.(?:py|m?js))/.exec(command);
        const file = runs ? written.get(runs[1].split('/').pop() ?? '') : undefined;
        const source = file ?? command;
        code = {
          name: runs
            ? (runs[1].split('/').pop() ?? 'fetch')
            : /python/.test(command)
              ? 'fetch.py'
              : 'fetch.sh',
          content: clipBytes(sanitizeForScript(source, secrets), CHAT_SCRIPT_CODE_LIMIT),
        };
        if (WRITES_OUTPUT.test(command)) {
          const fileName = OUTPUT_FILE.exec(command)?.[1];
          outputs.push({ kind: 'file', name: fileName ?? 'output' });
        }
      }
    }
  }
  const answerMessage = [...replies].reverse().find((message) => textOf(message));
  const answer = answerMessage ? textOf(answerMessage) : '';
  for (const table of markdownTables(answer)) {
    if (table.rows.length < 2) continue;
    outputs.unshift({
      kind: 'table',
      columns: table.columns.map(clipCell),
      rows: table.rows.length,
      sample: table.rows.slice(0, CHAT_SCRIPT_SAMPLE_ROWS).map((row) => row.map(clipCell)),
    });
  }
  for (const match of answer.matchAll(DATA_LINK))
    outputs.push({ kind: 'data_object', name: match[1] });
  const last = replies[replies.length - 1];
  return {
    turn: turn.turn,
    userMessageId: turn.user.id,
    anchorId: last.id,
    userText: sanitizeForScript(textOf(turn.user), secrets),
    answer: sanitizeForScript(answer, secrets),
    fetches,
    results: dedupeResults(outputs),
    needsAuth,
    cancelled:
      replies.some((message) => message.localStatus === 'cancelled') ||
      turn.user.localStatus === 'cancelled',
    proposed,
    ...(proposal ? { proposal } : {}),
    ...(code ? { code } : {}),
    messageIds: replies.map((message) => message.id),
  };
}

function dedupeResults(results: ChatScriptResult[]): ChatScriptResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.kind}:${result.name ?? result.columns?.join('|') ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Strict trigger: finished, a successful network fetch, a structured result. */
export function chatTurnEligibility(
  turn: ChatScriptTurn,
  state: { running?: boolean; sessionError?: boolean; isLastTurn?: boolean } = {}
): ChatScriptEligibility {
  if (state.isLastTurn && state.running) return { eligible: false, reason: 'running' };
  if (state.isLastTurn && state.sessionError) return { eligible: false, reason: 'error' };
  if (turn.cancelled) return { eligible: false, reason: 'cancelled' };
  if (!turn.fetches.some((fetch) => fetch.ok)) return { eligible: false, reason: 'no_fetch' };
  if (turn.results.length === 0) return { eligible: false, reason: 'no_result' };
  return { eligible: true };
}

/** Eligible turns of a conversation, oldest first. */
export function eligibleChatTurns(
  messages: Message[],
  state: { running?: boolean; sessionError?: boolean } = {},
  secrets: string[] = []
): ChatScriptTurn[] {
  const turns = splitChatTurns(messages);
  return turns
    .map((turn, index) => ({
      analysed: analyzeChatTurn(turn, secrets),
      last: index === turns.length - 1,
    }))
    .filter(
      (item): item is { analysed: ChatScriptTurn; last: boolean } =>
        Boolean(item.analysed) &&
        chatTurnEligibility(item.analysed!, { ...state, isLastTurn: item.last }).eligible
    )
    .map((item) => item.analysed);
}

/** "表格 10 行 × 5 列" / "文件 a.csv" / "原始表 X" for the 取结果 dropdown and cards. */
export function describeChatResult(result: ChatScriptResult | undefined): string {
  if (!result) return '';
  if (result.kind === 'table')
    return `表格 ${result.rows ?? 0} 行 × ${result.columns?.length ?? 0} 列`;
  if (result.kind === 'file') return `文件 ${result.name ?? ''}`.trim();
  return `数据对象 ${result.name ?? ''}`.trim();
}

const STATIC_ASSET = /\.(?:js|mjs|css|png|jpe?g|gif|svg|ico|woff2?|map|html?)$/i;

function endpointKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (STATIC_ASSET.test(url.pathname)) return null;
    return `${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/**
 * "2 个接口": distinct endpoints of the last working fetch code (exploration probes excluded);
 * without code, distinct non-static URLs of the successful fetches.
 */
export function countChatEndpoints(turn: ChatScriptTurn): number {
  const fromCode = new Set(
    [...(turn.code?.content ?? '').matchAll(/https?:\/\/[^\s"'`<>()]+/g)]
      // Templated paths (".../p/{ident}") are result links, not endpoints.
      .filter((match) => !/^[^?]*[{]/.test(match[0]))
      .map((match) => endpointKey(match[0].replace(/[{].*$/, '')))
      .filter((key): key is string => Boolean(key))
  );
  if (fromCode.size > 0) return fromCode.size;
  const keys = new Set<string>();
  for (const fetch of turn.fetches) {
    if (!fetch.ok || !fetch.url) continue;
    const key = endpointKey(fetch.url);
    if (key) keys.add(key);
  }
  return keys.size;
}

/** "每天 9 点" / "9:30" / "早上 8 点" in user text → "HH:MM". */
export function detectScheduleTime(text: string): string | undefined {
  const match =
    /(早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*(?:[:：点时])\s*(\d{1,2}|半)?/.exec(text) ??
    undefined;
  if (!match) return undefined;
  let hour = Number(match[2]);
  if (!Number.isFinite(hour) || hour > 23) return undefined;
  if ((match[1] === '下午' || match[1] === '晚上') && hour < 12) hour += 12;
  const minute = match[3] === '半' ? 30 : match[3] ? Number(match[3]) : 0;
  if (minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// ── 要点 rendering ─────────────────────────────────────────────────────

export interface ChatScriptPoints {
  goal: string;
  endpoints: Array<{ label?: string; method?: string; url: string; note?: string }>;
  headers: string[];
  rules: string[];
  columns: string[];
  reference?: string;
  /** Verified fallback when the primary query is empty (null when none was verified). */
  emptyFallback?: string | null;
}

export type ChatScriptEmptyPolicy = 'fallback' | 'fail';

/** Render the editable 要点 text (the rule prompt sent to the generation agent). */
export function renderChatScriptPoints(
  points: ChatScriptPoints,
  meta: { sessionTitle: string; turn: number; emptyPolicy: ChatScriptEmptyPolicy; code?: string }
): string {
  const lines = [`【来自对话：${meta.sessionTitle} · 第 ${meta.turn} 轮，已验证】`];
  if (points.goal) lines.push(`目标：${points.goal}`);
  for (const endpoint of points.endpoints) {
    lines.push(
      `${endpoint.label || '接口'}：${endpoint.method ? `${endpoint.method} ` : ''}${endpoint.url}${endpoint.note ? `（${endpoint.note}）` : ''}`
    );
  }
  if (points.headers.length) lines.push(`请求头：${points.headers.join('；')}`);
  if (points.rules.length) lines.push(`规则：${points.rules.join('；')}`);
  if (points.columns.length)
    lines.push(
      `结果列：${points.columns.join(', ')}${points.reference ? `（参考：${points.reference}）` : ''}`
    );
  lines.push(emptyLine(meta.emptyPolicy, points.emptyFallback));
  if (meta.code)
    lines.push(`附：对话里最后一次成功的取数代码 ${meta.code}（已脱敏，≤4 KB，仅供参考）`);
  return clipPoints(lines.join('\n'));
}

export function emptyLine(policy: ChatScriptEmptyPolicy, fallback?: string | null): string {
  return policy === 'fallback' && fallback
    ? `空数据：${fallback}（对话中已验证）`
    : '空数据：当天无数据时以非零退出码报错（判为失败）';
}

/** Replace the 空数据 line after the user switches the dropdown (keeps their other edits). */
export function replaceEmptyLine(text: string, line: string): string {
  return /^空数据：.*$/m.test(text) ? text.replace(/^空数据：.*$/m, line) : `${text}\n${line}`;
}

export function clipPoints(text: string): string {
  return text.length > CHAT_SCRIPT_POINTS_LIMIT ? text.slice(0, CHAT_SCRIPT_POINTS_LIMIT) : text;
}

/** Fallback 要点 when the one-shot extraction is unavailable: deterministic from the turn. */
export function pointsFromTurn(turn: ChatScriptTurn): ChatScriptPoints {
  const table = turn.results.find((result) => result.kind === 'table');
  const seen = new Set<string>();
  const endpoints: ChatScriptPoints['endpoints'] = [];
  for (const fetch of turn.fetches) {
    if (!fetch.ok || !fetch.url || seen.has(fetch.url)) continue;
    seen.add(fetch.url);
    endpoints.push({ method: fetch.method ?? 'GET', url: fetch.url });
    if (endpoints.length >= 4) break;
  }
  return {
    goal: turn.userText.replace(/\s+/g, ' ').slice(0, 300),
    endpoints,
    headers: ['浏览器 User-Agent', 'Referer: 数据页所在站点'],
    rules: [],
    columns: table?.columns ?? [],
    reference: table ? `${table.rows} 行` : undefined,
    emptyFallback: null,
  };
}

// ── proposal (IPC payload) ─────────────────────────────────────────────

export interface ChatScriptTurnOption {
  turn: number;
  anchorId: string;
  /** "第 1 轮 · 表格 10 行 × 5 列" */
  label: string;
  needsAuth: boolean;
  endpoints: number;
  /** Package already generated from this turn (再次转成脚本 updates it by default). */
  existing?: { packageId: string; name: string };
}

export interface ChatScriptProposal {
  sessionId: string;
  sessionTitle: string;
  turn: number;
  anchorId: string;
  /** "OSChina更新榜单获取 · 已跑通 · 2 个接口" */
  subtitle: string;
  name: string;
  points: string;
  emptyPolicy: ChatScriptEmptyPolicy;
  /** Lines for the 空数据 dropdown. */
  emptyLines: { fallback: string | null; fail: string };
  needsAuth: boolean;
  references: Array<{ name: string; content: string }>;
  scheduleTime?: string;
  turns: ChatScriptTurnOption[];
  existing?: { packageId: string; name: string; baseVersion: number | null; label: string };
  /** The extraction model was unavailable; 要点 were built from the turn directly. */
  fallback?: boolean;
}

export function turnOptionLabel(turn: ChatScriptTurn): string {
  return [`第 ${turn.turn} 轮`, describeChatResult(turn.results[0])].filter(Boolean).join(' · ');
}

/** What the confirm dialog hands to the script editor (it starts generating right away). */
export interface ChatScriptLaunch {
  origin: { sessionId: string; sessionTitle: string; turn: number; messageId: string };
  name: string;
  runtime: 'python' | 'node';
  rulePrompt: string;
  references: Array<{ name: string; content: string }>;
  /** 再次转成脚本 → 更新已有包: generate a new draft of this package. */
  packageId?: string;
  baseVersion?: number | null;
  afterPublish: 'none' | 'create_automation';
  scheduleTime?: string;
  /** Reopened after a failed generation: show the rules instead of generating again. */
  paused?: boolean;
}

/** Per anchor message: the 转成脚本 entry (eligible turn) and the propose card's target turn. */
export interface ChatScriptAnchor {
  turn: ChatScriptTurn;
  eligible: boolean;
  proposal?: { scheduleTime?: string; target: ChatScriptTurn | null };
}

export function chatScriptAnchors(
  messages: Message[],
  state: { running?: boolean; sessionError?: boolean } = {}
): Map<string, ChatScriptAnchor> {
  const result = new Map<string, ChatScriptAnchor>();
  const turns = splitChatTurns(messages);
  let latestEligible: ChatScriptTurn | null = null;
  turns.forEach((raw, index) => {
    const turn = analyzeChatTurn(raw);
    if (!turn) return;
    const eligible = chatTurnEligibility(turn, {
      ...state,
      isLastTurn: index === turns.length - 1,
    }).eligible;
    if (eligible) latestEligible = turn;
    if (!eligible && !turn.proposal) return;
    result.set(turn.anchorId, {
      turn,
      eligible,
      ...(turn.proposal
        ? {
            proposal: {
              ...(turn.proposal.scheduleTime ? { scheduleTime: turn.proposal.scheduleTime } : {}),
              target: latestEligible,
            },
          }
        : {}),
    });
  });
  return result;
}
