import * as fs from 'fs';
import * as path from 'path';
import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { AppConfig } from '../../config/config-store';
import type { AgentRuntimeConfig } from '../../../shared/contracts';
import {
  HeadlessToolAgent,
  type HeadlessAgentEvent,
  type HeadlessAgentStop,
} from '../../agent/headless-tool-agent';
import { createWorkspaceTools } from '../../agent/workspace-tools';
import { knownSecretValues } from '../../exec-guard/redact';
import {
  scriptManifestSchema,
  type ScriptDraftCheck,
  type ScriptPackageFile,
  type ScriptRuntime,
} from '../../../shared/automation/script-package';
import {
  buildFixPayload,
  collectSecretValues,
  type FixErrorRequest,
  type FixPayload,
} from '../../../shared/fix-error';

/** Limits of one generation / fix agent run (each self-test counts as a tool call). */
/** Extra turns after the cap when the agent has not written / tested the package yet. */
const GRACE_TURNS = 8;

export const SCRIPT_AGENT_LIMITS = {
  generate: { maxTurns: 40, timeoutMs: 12 * 60 * 1000 },
  fix: { maxTurns: 30, timeoutMs: 8 * 60 * 1000 },
} as const;

/** Result of trial-running the package working tree (with the pass verdict applied). */
export type ScriptCheck = ScriptDraftCheck;

/** The package folder the agent edits, and a trial run of what is in it. */
export interface ScriptWorkspace {
  dir: string;
  test(): Promise<ScriptCheck>;
  /** Package secrets: env vars for the agent's bash and every run (values never in prompts). */
  secrets?: Record<string, string>;
}

export type ScriptAgentPhase = 'source_summary' | 'source_analysis' | 'code_generation' | 'verify';
export type ScriptAgentProgress = (phase: ScriptAgentPhase, text: string) => void;

interface ScriptAgentRunInput {
  name: string;
  runtime: ScriptRuntime;
  workspace: ScriptWorkspace;
  runtimeConfig?: AgentRuntimeConfig;
  signal?: AbortSignal;
  onProgress?: ScriptAgentProgress;
}

export interface GenerateScriptFilesInput extends ScriptAgentRunInput {
  rulePrompt: string;
  /** Files of the version being modified (already in the workspace); empty = from scratch. */
  baseFiles: ScriptPackageFile[];
  baseLabel?: string;
  lastError?: string;
  /** 对话「转成脚本」: the rule prompt holds key points a conversation already verified. */
  fromConversation?: boolean;
  /** Redacted reference files (the conversation's last working fetch code). */
  references?: Array<{ name: string; content: string }>;
}

export interface FixScriptFilesInput extends ScriptAgentRunInput {
  rulePrompt?: string;
  /** Current files of the draft being fixed (already in the workspace). */
  files: ScriptPackageFile[];
  baseLabel: string;
  request: FixErrorRequest;
}

export interface ScriptAgentOutcome {
  /** The agent's closing summary (Chinese). */
  summary: string;
  stop: HeadlessAgentStop;
  error?: string;
  /** Last self-test the agent ran, if any. */
  lastCheck?: ScriptCheck;
  selfTests: number;
  /** Fix turns: the redacted failure context the agent got. */
  payload?: FixPayload;
}

export interface ScriptFilesGenerator {
  /** 规则生成: explore the source, write the package into the workspace, self-test. */
  generate(input: GenerateScriptFilesInput): Promise<ScriptAgentOutcome>;
  /** 交给 AI 修复: fix the workspace files from a trial-run failure, self-test. */
  fix(input: FixScriptFilesInput): Promise<ScriptAgentOutcome>;
}

const DEPENDENCY_FILES = new Set(['package-lock.json', '.gitignore']);

/** Redacted fix context; config.json is the script's input, so it is summarised as such. */
export function buildScriptFixPayload(
  input: Pick<FixScriptFilesInput, 'files' | 'request'>,
  secrets: string[] = []
): FixPayload {
  const files = input.files.filter((file) => !DEPENDENCY_FILES.has(file.path));
  const manifest = files.find((file) => file.path === 'manifest.json');
  let entry: string | undefined;
  try {
    entry = manifest ? (JSON.parse(manifest.content) as { entry?: string }).entry : undefined;
  } catch {
    entry = undefined;
  }
  const config = files.find((file) => file.path === 'config.json');
  let configValue: unknown;
  try {
    configValue = config ? JSON.parse(config.content) : undefined;
  } catch {
    configValue = config?.content.slice(0, 4000);
  }
  const listKey =
    configValue && typeof configValue === 'object' && !Array.isArray(configValue)
      ? Object.entries(configValue as Record<string, unknown>).find(([, value]) =>
          Array.isArray(value)
        )
      : undefined;
  return buildFixPayload({
    request: input.request,
    files,
    primaryFile: entry,
    input: config
      ? {
          label: `config.json${listKey ? ` · ${listKey[0]} ${(listKey[1] as unknown[]).length} 条` : ''}`,
          rows: listKey ? (listKey[1] as unknown[]) : [],
          extra: {
            'config.json': configValue,
            'manifest.json': manifest ? safeParse(manifest.content) : undefined,
          },
        }
      : manifest
        ? { label: 'manifest.json', extra: { 'manifest.json': safeParse(manifest.content) } }
        : undefined,
    secrets,
  });
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 2000);
  }
}

/** One readable console line for a bash call: "请求 <url>" for curl, otherwise the trimmed command. */
export function describeCommand(command: string): string {
  const text = command
    .replace(/^\s*cd\s+\S+\s*&&\s*/, '')
    .replace(/\b(UA|USER_AGENT)=("[^"]*"|'[^']*')\s*;?\s*/g, '')
    .replace(/(-A|--user-agent|-H|--header|-e|--referer)\s+("[^"]*"|'[^']*'|\S+)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const urls = [...text.matchAll(/https?:\/\/[^\s"'\\)]+/g)].map((match) => match[0]);
  if (/^(curl|wget)\b/.test(text) && urls.length > 0) {
    return `请求 ${clip(urls[0], 200)}${urls.length > 1 ? ` 等 ${urls.length} 个地址` : ''}`;
  }
  if (/^python3?\b/.test(text) && urls.length > 0) {
    return `运行 Python 探查 ${clip(urls[0], 160)}`;
  }
  return `执行：${clip(text)}`;
}

/** Agent-based 规则生成 / AI 修复: the same tools as chat (bash, web, files, trial run). */
export function createAgentScriptFilesGenerator(
  getConfig: () => AppConfig | Promise<AppConfig>
): ScriptFilesGenerator {
  return {
    async generate(input) {
      const config = input.runtimeConfig ?? (await getConfig());
      return runScriptAgent(input, {
        config,
        systemPrompt: input.fromConversation
          ? buildScriptConversationSystemPrompt(input.runtime)
          : buildScriptAgentSystemPrompt(input.runtime),
        prompt: buildScriptGenerationUserPrompt(input),
        limits: SCRIPT_AGENT_LIMITS.generate,
      });
    },
    async fix(input) {
      const appConfig = await getConfig();
      const config = input.runtimeConfig ?? appConfig;
      const secrets = [
        ...knownSecretValues(),
        ...collectSecretValues(appConfig),
        ...collectSecretValues(input.runtimeConfig),
        ...Object.values(input.workspace.secrets ?? {}),
      ];
      const payload = buildScriptFixPayload(input, secrets);
      input.onProgress?.(
        'source_summary',
        `调用栈 ${payload.callStack.length} 层${payload.location ? ` · 定位 ${payload.location.file}:${payload.location.line}${payload.location.func ? ` ${payload.location.func}()` : ''}` : ''}`
      );
      input.onProgress?.(
        'source_summary',
        `读取 ${input.files.length} 个文件（${input.baseLabel}）`
      );
      const outcome = await runScriptAgent(input, {
        config,
        systemPrompt: buildScriptFixSystemPrompt(input.runtime),
        prompt: buildScriptFixUserPrompt(input, payload),
        limits: SCRIPT_AGENT_LIMITS.fix,
      });
      return { ...outcome, payload };
    },
  };
}

async function runScriptAgent(
  input: ScriptAgentRunInput,
  options: {
    config: AppConfig | AgentRuntimeConfig;
    systemPrompt: string;
    prompt: string;
    limits: { maxTurns: number; timeoutMs: number };
  }
): Promise<ScriptAgentOutcome> {
  const progress = input.onProgress ?? (() => undefined);
  let lastCheck: ScriptCheck | undefined;
  let selfTests = 0;
  const testTool = createScriptTestTool(input.workspace, (check) => {
    lastCheck = check;
    selfTests += 1;
  });
  const agent = new HeadlessToolAgent({
    config: options.config,
    systemPrompt: options.systemPrompt,
    tools: [
      ...createWorkspaceTools({
        dir: input.workspace.dir,
        bash: true,
        web: true,
        env: input.workspace.secrets,
      }),
      testTool,
    ],
    maxTurns: options.limits.maxTurns,
    timeoutMs: options.limits.timeoutMs,
    signal: input.signal,
    maxTokens: 16_000,
    onEvent: (event) => describeAgentEvent(event, progress),
    budgetNotice: ({ turn, maxTurns }) => {
      const left = maxTurns - turn;
      const hasEntry = fs.existsSync(path.join(input.workspace.dir, 'manifest.json'));
      if (!hasEntry && (turn === Math.floor(maxTurns / 3) || left === 8)) {
        return `[budget] 已用 ${turn}/${maxTurns} 轮，还没有写 manifest.json。停止探查，立即用已掌握的信息写出可运行的完整脚本包，再调用 script_package_test。`;
      }
      if (left === 5 && lastCheck?.passed !== true) {
        return `[budget] 只剩 ${left} 轮。集中修复最后一次试运行的问题并再次调用 script_package_test，然后结束。`;
      }
      return undefined;
    },
  });
  try {
    let result = await agent.prompt(options.prompt);
    if (result.stop === 'aborted') throw new ScriptAgentCancelled();
    const missingManifest = !fs.existsSync(path.join(input.workspace.dir, 'manifest.json'));
    if (result.stop === 'max_turns' && (missingManifest || lastCheck === undefined)) {
      progress('verify', '轮次用尽，要求智能体立即写出脚本并试运行');
      result = await agent.prompt(
        '[budget] 轮次已用尽。不要再探查：用已掌握的信息立即写出完整脚本包（manifest.json、入口、config.json），调用一次 script_package_test，然后用 2-4 句中文总结。',
        { maxTurns: GRACE_TURNS }
      );
      if (result.stop === 'aborted') throw new ScriptAgentCancelled();
    }
    return {
      summary: result.text.slice(0, 1200),
      stop: result.stop,
      ...(result.error ? { error: result.error } : {}),
      lastCheck,
      selfTests,
    };
  } finally {
    agent.dispose();
  }
}

export class ScriptAgentCancelled extends Error {
  constructor() {
    super('已取消');
    this.name = 'ScriptAgentCancelled';
  }
}

/** Format a self-test for the model: verdict, rows, columns, CSV head, log tail. */
export function formatScriptCheck(check: ScriptCheck): string {
  return [
    check.passed
      ? `PASSED · ${check.rows ?? 0} rows · columns: ${(check.columns ?? []).join(', ')}${check.warnings?.length ? `\nwarnings: ${check.warnings.join('; ')}` : ''}`
      : `FAILED: ${check.reason ?? 'unknown'}${check.exitCode !== undefined ? ` (exit ${check.exitCode})` : ''}`,
    `duration: ${Math.round(check.durationMs / 100) / 10}s`,
    check.preview ? `output head:\n${check.preview}` : '',
    check.log ? `log tail:\n${check.log.slice(-3000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const scriptTestSchema = Type.Object({});

function createScriptTestTool(
  workspace: ScriptWorkspace,
  onCheck: (check: ScriptCheck) => void
): AgentTool<typeof scriptTestSchema> {
  return {
    name: 'script_package_test',
    label: 'script_package_test',
    description:
      'Trial-run the package in the working folder exactly like the automation does (installs requirements.txt / package.json deps, sets SOPHRON_CONFIG / SOPHRON_OUTPUT, runs the entry) and judge the result: exit 0, every manifest output column present, at least one row, no expected column entirely empty. Returns the verdict, rows, CSV head and log tail.',
    parameters: scriptTestSchema,
    async execute() {
      const check = await workspace.test();
      onCheck(check);
      return { content: [{ type: 'text', text: formatScriptCheck(check) }], details: undefined };
    },
  };
}

function clip(text: string, max = 160): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Readable console lines for agent tool calls (never raw JSON). */
export function describeAgentEvent(event: HeadlessAgentEvent, progress: ScriptAgentProgress): void {
  if (event.type === 'tool_start') {
    const args = event.args;
    const pathArg = typeof args.path === 'string' ? args.path : '';
    switch (event.name) {
      case 'bash':
        progress('source_analysis', describeCommand(String(args.command ?? '')));
        return;
      case 'webfetch':
        progress('source_analysis', `请求 ${clip(String(args.url ?? ''), 200)}`);
        return;
      case 'websearch':
        progress('source_analysis', `搜索：${clip(String(args.query ?? ''))}`);
        return;
      case 'read':
      case 'ls':
        progress('source_analysis', `查看 ${pathArg || '.'}`);
        return;
      case 'write': {
        const lines = typeof args.content === 'string' ? args.content.split('\n').length : 0;
        progress('code_generation', `写入 ${pathArg}（${lines} 行）`);
        return;
      }
      case 'edit':
        progress('code_generation', `修改 ${pathArg}`);
        return;
      case 'script_package_test':
        progress('verify', '试运行当前代码…');
        return;
      default:
        progress('source_analysis', event.name);
    }
    return;
  }
  if (event.type === 'tool_end') {
    if (event.name === 'script_package_test') {
      const first = event.text.split('\n')[0] ?? '';
      progress(
        'verify',
        first.startsWith('PASSED')
          ? `✓ 通过：${first.replace(/^PASSED · /, '')}`
          : `✕ ${clip(first.replace(/^FAILED: /, '未通过：'), 240)}`
      );
      return;
    }
    if (event.name === 'webfetch') {
      const status = /Status: (\d+)/.exec(event.text)?.[1];
      const length = /Body length: (\d+)/.exec(event.text)?.[1];
      if (event.isError) progress('source_analysis', `  ✕ ${clip(event.text, 200)}`);
      else if (status) progress('source_analysis', `  → ${status} · ${length ?? '?'} 字符`);
      return;
    }
    if (event.isError)
      progress(
        event.name === 'write' || event.name === 'edit' ? 'code_generation' : 'source_analysis',
        `  ✕ ${clip(event.text, 200)}`
      );
  }
}

const COMMON_RULES = (runtime: ScriptRuntime): string[] => {
  const entry = runtime === 'node' ? 'main.js' : 'main.py';
  return [
    'You build executable "script packages": small multi-file projects that an automation runs on a schedule WITHOUT any model call.',
    `manifest.json: {"name", "description", "entry": "${entry}", "runtime": "${runtime}", "output": {"format": "csv", "columns": [{"name": "...", "type": "string" | "number" | "integer" | "date" | "boolean", "nullable": true?}, ...]}}. Keep runtime "${runtime}". Declare every output column with its type (checked after every run: values must match, no placeholder-only columns, no repeated header rows); mark columns that may be empty "nullable": true.`,
    'The entry reads parameters from the JSON file at env SOPHRON_CONFIG (keep URLs, endpoints, query params, headers, ids and limits in config.json), writes the result to the path in env SOPHRON_OUTPUT (CSV with a header row, UTF-8) and exits non-zero with a one-line reason on stderr when it fails. The working directory is the package folder.',
    runtime === 'node'
      ? 'Node.js 20+: use CommonJS (require) unless package.json sets "type": "module"; global fetch is available. Put npm libraries in package.json "dependencies" with exact versions; never rely on globally installed modules.'
      : 'Python 3.9+: standard library preferred (urllib.request, json, html.parser); third-party libraries go into requirements.txt with pinned versions (requirements.txt may be empty).',
    'Split the code into the entry plus at least one helper module (HTTP client, parsing/transform).',
    'Credentials: never write keys, tokens, passwords or cookies into any file (config.json, code, comments) — files are committed to version history and such commits are rejected. The package\'s secrets are environment variables (names in "secrets"; ${SECRET:NAME} in the rule prompt means the env var NAME): read them with os.environ["NAME"] / process.env.NAME at run time; in bash probes use "$NAME". A required secret env var that is missing is a failure: exit non-zero with a Chinese reason naming it.',
    'Authentication failures (HTTP 401/403, an "invalid key / unauthorized / quota" response) are failures: exit non-zero with a clear Chinese reason. NEVER switch to another data source, endpoint or website, and never fabricate data, when the requested source rejects the request.',
    'No logins with user passwords and no headless browsers. Every HTTP request has a timeout and sends a real browser User-Agent (e.g. Chrome on Windows), an Accept header, and the Referer / Origin of the site the data belongs to; put these headers in config.json.',
    'Front-end rendered pages (an HTML shell with little text, a root <div id="app"> and script bundles): do NOT scrape the static HTML. Find the XHR/JSON API the page actually calls: download the JS bundles (browser UA + the site Referer; static hosts often return 403 without them), search them for apiBaseUrl / baseURL / fetch( / axios / "/api" / endpoint paths and the component that renders the data you need, then call the candidate endpoints and inspect the JSON. Prefer a JSON/CSV API over HTML scraping; fall back to embedded JSON (__NEXT_DATA__, window.__INITIAL_STATE__) before parsing HTML.',
    'Empty results are failures: the script must never write a header-only table. If the requested slice can be legitimately empty (e.g. "today" / daily ranking has no entries yet), config.json must state the behaviour explicitly under "on_empty": {"action": "fallback" | "error", "fallback": {...the params to use instead, e.g. a weekly or monthly ranking...}, "note": "Chinese, one sentence"}. With "fallback" the script retries the SAME source with the fallback params (never a different source) and writes a column (e.g. 榜单/数据范围) saying which slice the rows come from; with "error" it exits non-zero with a clear Chinese reason. Whenever the fallback is used the script prints one line "SOPHRON_NOTICE: <Chinese sentence, e.g. 今日榜单为空，已改用本周榜单>" to stdout so the app shows a warning instead of a plain success.',
    'Check that the values match the request (dates really are today when asked for today, rankings are in order, no navigation/ads rows).',
    'No TODOs or placeholders.',
  ];
};

const AGENT_WORKFLOW = [
  'You work like a developer in a terminal. Your cwd is the package folder: write/edit files there with the write and edit tools (paths relative to it). Do not touch .git, .sophron, .venv or node_modules; keep scratch downloads in /tmp, not in the package folder.',
  'Tools: bash (curl, python3, grep… for exploring), webfetch (GET/POST with custom headers), websearch, read/ls, write/edit, script_package_test (trial run + verdict).',
  'Workflow: 1) explore the data source first and find the real endpoint, parameters and required headers; 2) write the package; 3) run script_package_test; 4) if it fails or the data looks wrong, investigate (look at the actual responses again) and fix; repeat until script_package_test PASSES. Do not stop while the last script_package_test failed, unless the source is genuinely unusable — then say exactly why.',
  'Be efficient: you have a limited number of turns (about 40) and minutes. Explore for at most ~12 turns, then WRITE a first runnable version and run script_package_test — a failing trial run tells you more than more exploring. Combine probes into one bash call (e.g. a short python3 script that fetches the endpoint and prints only the keys / first items you need). Do not print huge files; grep bundles for what you need.',
  'Finish with a short Chinese summary (2-4 sentences): data source (endpoint + key params), output columns, and the on_empty behaviour. No markdown tables, no code.',
];

/** System prompt of the 规则生成 agent. */
export function buildScriptAgentSystemPrompt(runtime: ScriptRuntime): string {
  return [...COMMON_RULES(runtime), '', ...AGENT_WORKFLOW].join('\n');
}

/** 对话「转成脚本」: the endpoints are already verified, so confirm them instead of re-exploring. */
export function buildScriptConversationSystemPrompt(runtime: ScriptRuntime): string {
  return [
    buildScriptAgentSystemPrompt(runtime),
    '',
    "The rule prompt comes from a conversation that already fetched this data successfully (【来自对话…已验证】): its endpoints, parameters, headers, rules and result columns were verified there, and referenceFiles may hold the conversation's last working fetch code (redacted, for reference only — never copy <redacted> / <workdir> placeholders into the package).",
    'Start from those endpoints: confirm them with ONE quick probe (curl / python3), then write the package right away and run script_package_test. Only explore further when a verified endpoint no longer works. Follow the 空数据 line for config.json on_empty.',
  ].join('\n');
}

/** Rules for script code (shared with the chat agent guide and tests). */
export function buildScriptGenerationSystemPrompt(runtime: ScriptRuntime): string {
  return COMMON_RULES(runtime).join('\n');
}

function buildScriptFixSystemPrompt(runtime: ScriptRuntime): string {
  return [
    buildScriptAgentSystemPrompt(runtime),
    '',
    'This is a FIX turn on the current draft (its files are in the folder), not a regeneration.',
    'You get the failure of the last trial run (error, call stack with package-relative paths, stderr tail, the failing file, config.json as the input) and optional user notes. Find the root cause — verify it against the live source with webfetch / curl when the failure involves remote data (status codes, changed fields, empty JSON, an HTML shell instead of data) — and make the smallest change that fixes it. Keep the manifest output columns unless a note asks otherwise.',
    'If the run succeeded but the result is wrong (0 rows, missing columns, a column that is entirely empty), fix the logic so every expected column is filled.',
    'failure.round.previousAttempts lists the original error and what earlier rounds changed and why they still failed: keep everything they fixed and only add what the new failure needs.',
    "failure.userNote holds the user's 补充 notes, oldest first. They override the original rule wherever they conflict.",
    'Run script_package_test after your change and keep fixing until it passes. Do not delete or rename files unless the fix requires it.',
  ].join('\n');
}

function localDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function secretNamesField(workspace: ScriptWorkspace): { secrets?: string[] } {
  const names = Object.keys(workspace.secrets ?? {});
  return names.length > 0 ? { secrets: names } : {};
}

function buildScriptGenerationUserPrompt(input: GenerateScriptFilesInput): string {
  return JSON.stringify(
    {
      task:
        input.baseFiles.length > 0
          ? `Modify the existing script package (${input.baseLabel ?? 'current version'}, its files are in the folder) according to the rule prompt, then make script_package_test pass.`
          : 'Write a new script package in the (empty) folder according to the rule prompt, then make script_package_test pass.',
      packageName: input.name,
      runtime: input.runtime,
      rulePrompt: input.rulePrompt,
      ...secretNamesField(input.workspace),
      ...(input.lastError ? { lastRunError: input.lastError } : {}),
      existingFiles: input.baseFiles.map((file) => file.path),
      ...(input.references?.length ? { referenceFiles: input.references } : {}),
      today: localDate(),
    },
    null,
    2
  );
}

function buildScriptFixUserPrompt(input: FixScriptFilesInput, payload: FixPayload): string {
  return JSON.stringify(
    {
      task: `Fix the current draft (${input.baseLabel}) of the script package "${input.name}" in the folder so script_package_test passes.`,
      runtime: input.runtime,
      ...(input.rulePrompt ? { rulePrompt: input.rulePrompt } : {}),
      ...secretNamesField(input.workspace),
      failure: payload,
      files: input.files.map((file) => file.path),
      today: localDate(),
    },
    null,
    2
  );
}

/**
 * Validate the manifest the agent left in the folder and pin name / runtime. Returns the
 * normalized manifest content to write back.
 */
export function normalizeScriptManifest(
  files: ScriptPackageFile[],
  input: { name: string; runtime: ScriptRuntime }
): string {
  const manifestFile = files.find((file) => file.path === 'manifest.json');
  if (!manifestFile) throw new Error('生成结果缺少 manifest.json');
  let manifestJson: Record<string, unknown>;
  try {
    manifestJson = JSON.parse(manifestFile.content) as Record<string, unknown>;
  } catch {
    throw new Error('生成的 manifest.json 不是合法 JSON');
  }
  manifestJson.name = input.name || manifestJson.name;
  manifestJson.runtime = input.runtime;
  const manifest = scriptManifestSchema.safeParse(manifestJson);
  if (!manifest.success)
    throw new Error(
      `manifest.json 无效：${manifest.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`
    );
  if (!files.some((file) => file.path === manifest.data.entry))
    throw new Error(`生成结果缺少入口文件 ${manifest.data.entry}`);
  return `${JSON.stringify(manifestJson, null, 2)}\n`;
}
