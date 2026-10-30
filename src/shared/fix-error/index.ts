/**
 * Shared helpers for the 预览 / 试运行 报错修复 flow (raw-table 自定义 and script packages):
 * parse a run failure into a structured report, build the redacted payload sent to the model,
 * judge whether a rerun really passed, and drive the bounded auto-fix loop.
 * Pure functions only; used by main (payload + redaction) and renderer (panel + loop).
 */

export interface FixErrorLocation {
  /** Path relative to the project / package root. */
  file: string;
  line: number;
  func?: string;
}

export interface FixErrorFrame extends FixErrorLocation {
  code?: string;
}

export interface FixErrorReport {
  /** One-line error, e.g. `KeyError: 'name'`. */
  message: string;
  location?: FixErrorLocation;
  /** Cleaned multi-line traceback / stderr tail (relative paths, no IPC prefix). */
  traceback: string;
  frames: FixErrorFrame[];
  exitCode?: number;
  durationMs?: number;
}

export interface FixErrorRequest {
  /** Raw error message as thrown / returned (may include the IPC prefix). */
  error: string;
  /** stdout/stderr tail when it is separate from the error (script test runs). */
  log?: string;
  exitCode?: number;
  durationMs?: number;
  /** Optional 补充 note typed by the user. */
  note?: string;
  /** 1-based round of an auto-fix loop and its limit. */
  round?: number;
  maxRounds?: number;
  /** Reasons of earlier failed rounds in the same loop. */
  previousAttempts?: string[];
}

export const AUTO_FIX_ROUND_OPTIONS = [0, 1, 3, 5] as const;
export const DEFAULT_AUTO_FIX_ROUNDS = 3;
export const STDERR_TAIL_BYTES = 4096;
export const SAMPLE_ROW_LIMIT = 20;
export const SAMPLE_FIELD_LIMIT = 200;

const IPC_PREFIX = /^\s*Error invoking remote method '[^']*':\s*/;
const COMMAND_ERROR_PREFIX = /^\s*(?:[A-Za-z]*Error:\s*)?\[[A-Z_]+\]\s*/;
const NORMALIZER_PREFIX = /^\s*Normalizer command failed with exit code (-?\d+):\s*/;

/** Drop the Electron IPC wrapper and `XxxError: [CODE]` prefix; pull out a leading exit code. */
export function stripErrorPrefix(raw: string): { text: string; exitCode?: number } {
  let text = String(raw ?? '');
  for (let i = 0; i < 3; i += 1) {
    const next = text.replace(IPC_PREFIX, '').replace(COMMAND_ERROR_PREFIX, '');
    if (next === text) break;
    text = next;
  }
  const match = NORMALIZER_PREFIX.exec(text);
  if (match) return { text: text.slice(match[0].length), exitCode: Number(match[1]) };
  return { text };
}

const RUN_DIR =
  /(?:[A-Za-z]:)?(?:[\\/][^\\/\s"'`<>|]+)*?[\\/]\.sophron[\\/]runs?[\\/][^\\/\s"'`<>|]+[\\/]/g;
const SITE_PACKAGES = /(?:[A-Za-z]:)?(?:[\\/][^\\/\s"'`<>|]+)*?[\\/](?:site|dist)-packages[\\/]/g;
const PY_STDLIB =
  /(?:[A-Za-z]:)?(?:[\\/][^\\/\s"'`<>|]+)*?[\\/](?:lib|Lib)[\\/]python\d+(?:\.\d+)?[\\/]/g;
const NODE_MODULES = /(?:[A-Za-z]:)?(?:[\\/][^\\/\s"'`<>|]+)*?[\\/]node_modules[\\/]/g;
const HOME_DIR =
  /(?:\/home\/[^/\s"'`]+|\/Users\/[^/\s"'`]+|\/root|[A-Za-z]:\\Users\\[^\\\s"'`]+)(?=[\\/]|\b)/g;
const OTHER_ABS =
  /(^|[\s"'`(=:])((?:\/|~\/|[A-Za-z]:\\)(?:[^\\/\s"'`<>|:]+[\\/])+)([^\\/\s"'`<>|:,)]+)/gm;

/** Make paths relative to the project run folder; hide every other absolute path. */
export function relativizePaths(text: string): string {
  return String(text ?? '')
    .replace(RUN_DIR, '')
    .replace(SITE_PACKAGES, '<site-packages>/')
    .replace(PY_STDLIB, '<python>/')
    .replace(NODE_MODULES, '<node_modules>/')
    .replace(HOME_DIR, '~')
    .replace(OTHER_ABS, (_all, lead: string, _dir: string, base: string) => `${lead}…/${base}`)
    .replace(/file:\/\/…\//g, '…/');
}

const PY_FRAME = /^\s*File "([^"]+)", line (\d+)(?:, in (.+))?\s*$/;
const NODE_FRAME = /^\s*at (?:(.+?) \()?(?:file:\/\/)?([^()\s]+?):(\d+)(?::\d+)?\)?\s*$/;

function isProjectPath(file: string, projectFiles?: string[]): boolean {
  if (!file || file.startsWith('<') || file.startsWith('…') || file.startsWith('~')) return false;
  if (/^(?:node:|internal\/)/.test(file)) return false;
  if (projectFiles && projectFiles.length > 0)
    return projectFiles.includes(file.replace(/\\/g, '/'));
  return !/^(?:[\\/]|[A-Za-z]:)/.test(file);
}

function parseFrames(lines: string[]): { frames: FixErrorFrame[]; node: boolean } {
  const frames: FixErrorFrame[] = [];
  let node = false;
  lines.forEach((line, index) => {
    const py = PY_FRAME.exec(line);
    if (py) {
      const next = lines[index + 1];
      frames.push({
        file: py[1].replace(/\\/g, '/'),
        line: Number(py[2]),
        ...(py[3] ? { func: py[3].trim() } : {}),
        ...(next && !PY_FRAME.test(next) && /^\s{4,}\S/.test(next) ? { code: next.trim() } : {}),
      });
      return;
    }
    const js = NODE_FRAME.exec(line);
    if (js) {
      node = true;
      frames.push({
        file: js[2].replace(/\\/g, '/'),
        line: Number(js[3]),
        ...(js[1] ? { func: js[1].trim() } : {}),
      });
    }
  });
  return { frames, node };
}

const ERROR_LINE = /^(?:[\w.]+(?:Error|Exception|Exit|Interrupt|Warning)|Error|panic)\b.*?:?.*$/;

/** Structured report from a raw failure (normalizer preview error or script test run). */
export function parseErrorReport(
  request: Pick<FixErrorRequest, 'error' | 'log' | 'exitCode' | 'durationMs'>,
  projectFiles?: string[]
): FixErrorReport {
  const stripped = stripErrorPrefix(request.error);
  const errorText = relativizePaths(stripped.text).replace(/\r\n/g, '\n').trim();
  const logText = relativizePaths(request.log ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
  // Script runs report a one-line reason plus a separate log; avoid repeating the reason.
  const traceback =
    logText && errorText && logText.includes(errorText)
      ? logText
      : [logText, errorText].filter(Boolean).join('\n');
  const lines = traceback.split('\n');
  const { frames, node } = parseFrames(lines);
  const projectFrames = frames.filter((frame) => isProjectPath(frame.file, projectFiles));
  const pick = node ? projectFrames[0] : projectFrames.at(-1);
  const meaningful = lines.map((line) => line.trim()).filter(Boolean);
  // A 通过但结果异常 verdict leads with its reason; the lines after it are an output sample.
  const verdictLine = errorText.split('\n')[0]?.trim();
  const errorLine = verdictLine?.startsWith('通过但结果异常')
    ? verdictLine
    : ([...meaningful].reverse().find((line) => ERROR_LINE.test(line) && !PY_FRAME.test(line)) ??
      (errorText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1) ||
        meaningful.at(-1)));
  return {
    message: (errorLine ?? '未知错误').slice(0, 300),
    ...(pick
      ? {
          location: { file: pick.file, line: pick.line, ...(pick.func ? { func: pick.func } : {}) },
        }
      : {}),
    traceback,
    frames,
    ...((request.exitCode ?? stripped.exitCode) !== undefined
      ? { exitCode: request.exitCode ?? stripped.exitCode }
      : {}),
    ...(request.durationMs !== undefined ? { durationMs: request.durationMs } : {}),
  };
}

/** Short failure reason for the step bar / round rows. */
export function summarizeError(raw: string): string {
  return parseErrorReport({ error: raw }).message;
}

export function formatLocation(location: FixErrorLocation | undefined): string {
  if (!location) return '';
  return `${location.file}:${location.line}${location.func && location.func !== '<module>' ? ` · ${location.func}` : ''}`;
}

/** Plain-text report for 复制报错 (same redaction as the model payload). */
export function formatErrorReportText(
  report: FixErrorReport,
  extra: { title?: string; input?: string; note?: string } = {},
  secrets: string[] = []
): string {
  const lines = [
    extra.title,
    `错误：${report.message}`,
    report.location ? `位置：${formatLocation(report.location)}` : '',
    extra.input ? `输入：${extra.input}` : '',
    '日志：',
    report.traceback,
    [
      report.exitCode !== undefined ? `退出码 ${report.exitCode}` : '',
      report.durationMs !== undefined ? `耗时 ${(report.durationMs / 1000).toFixed(1)} 秒` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    extra.note?.trim() ? `补充：${extra.note.trim()}` : '',
  ];
  return redactSecrets(
    lines.filter((line) => line !== undefined && line !== '').join('\n'),
    secrets
  );
}

// ── redaction ──────────────────────────────────────────────────────────

const SECRET_KEY =
  /(token|secret|passw(or)?d|api[_-]?key|access[_-]?key|private[_-]?key|credential|cookie|session|auth)/i;

/** String values under secret-looking keys (config objects, env maps), for exact redaction. */
export function collectSecretValues(
  source: unknown,
  depth = 0,
  out: Set<string> = new Set()
): string[] {
  if (!source || typeof source !== 'object' || depth > 6) return [...out];
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (SECRET_KEY.test(key) && trimmed.length >= 8 && !/\s/.test(trimmed)) out.add(trimmed);
    } else if (value && typeof value === 'object') {
      collectSecretValues(value, depth + 1, out);
    }
  }
  return [...out];
}

const ENV_ASSIGN =
  /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIALS?|COOKIE|AUTH)[A-Z0-9_]*)(\s*[=:]\s*)(["']?)[^\s"']{4,}\3/g;
const JSON_SECRET =
  /("(?:[\w-]*(?:token|secret|password|passwd|api[_-]?key|apikey|access[_-]?key|authorization|cookie)[\w-]*)"\s*:\s*")[^"]{4,}(")/gi;
const BEARER = /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{16,}/g;
const KNOWN_PREFIX =
  /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[abpr]|glpat|AKIA)[-_]?[A-Za-z0-9_-]{16,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;
const URL_SECRET_PARAM =
  /([?&](?:access_)?(?:token|key|apikey|api_key|secret|password|sig|signature)=)[^&\s"']+/gi;

/** Remove secrets: exact known values, env-style assignments, bearer tokens, JWTs, keys in URLs. */
export function redactSecrets(text: string, secrets: string[] = []): string {
  let result = String(text ?? '');
  const exact = [
    ...new Set(secrets.map((value) => value.trim()).filter((value) => value.length >= 6)),
  ].sort((a, b) => b.length - a.length);
  for (const value of exact) result = result.split(value).join('[REDACTED]');
  return result
    .replace(
      ENV_ASSIGN,
      (_all, key: string, sep: string, quote: string) => `${key}${sep}${quote}[REDACTED]${quote}`
    )
    .replace(JSON_SECRET, '$1[REDACTED]$2')
    .replace(BEARER, '$1 [REDACTED]')
    .replace(KNOWN_PREFIX, '[REDACTED]')
    .replace(JWT, '[REDACTED]')
    .replace(URL_CREDENTIALS, '$1[REDACTED]@')
    .replace(URL_SECRET_PARAM, '$1[REDACTED]');
}

/** Last `bytes` of text (UTF-8), cut at a line start when possible. */
export function tailBytes(text: string, bytes = STDERR_TAIL_BYTES): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= bytes) return text;
  let start = Math.max(0, text.length - bytes);
  while (start < text.length && encoder.encode(text.slice(start)).length > bytes) start += 1;
  const cut = text.slice(start);
  const newline = cut.indexOf('\n');
  return newline >= 0 && newline < cut.length - 1 ? cut.slice(newline + 1) : cut;
}

function truncateField(value: unknown, limit = SAMPLE_FIELD_LIMIT, depth = 0): unknown {
  if (typeof value === 'string')
    return value.length > limit ? `${value.slice(0, limit)}…(${value.length} 字符)` : value;
  if (depth > 4)
    return Array.isArray(value)
      ? `[${value.length} 项]`
      : value && typeof value === 'object'
        ? '{…}'
        : value;
  if (Array.isArray(value)) {
    const items = value
      .slice(0, SAMPLE_ROW_LIMIT)
      .map((item) => truncateField(item, limit, depth + 1));
    return value.length > SAMPLE_ROW_LIMIT ? [...items, `…(共 ${value.length} 项)`] : items;
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 80)
        .map(([key, item]) => [key, truncateField(item, limit, depth + 1)])
    );
  return value;
}

/** At most 20 rows with long fields cut. */
export function sampleRows<T>(rows: T[] | undefined, limit = SAMPLE_ROW_LIMIT): unknown[] {
  return (rows ?? []).slice(0, limit).map((row) => {
    if (Array.isArray(row)) return row.map((cell) => truncateField(cell));
    if (row && typeof row === 'object')
      return Object.fromEntries(
        Object.entries(row as Record<string, unknown>).map(([key, value]) => [
          key,
          truncateField(value),
        ])
      );
    return truncateField(row);
  });
}

export interface FixPayloadInput {
  request: FixErrorRequest;
  /** Current files of the draft being fixed. */
  files: Array<{ path: string; content: string }>;
  /** Short description of the input (file name, kind, size) and a sample. */
  input?: { label?: string; columns?: string[]; rows?: unknown[]; extra?: unknown };
  /** Exact secret values to scrub (env/config tokens). */
  secrets?: string[];
  /** File treated as failing when the stack has no project frame (e.g. 通过但结果异常). */
  primaryFile?: string;
}

export interface FixPayload {
  error: string;
  location?: FixErrorLocation;
  callStack: FixErrorFrame[];
  exitCode?: number;
  stderrTail: string;
  failingFile?: { path: string; content: string };
  /** Other project files on the call stack, in full (at most 2). */
  stackFiles?: Array<{ path: string; content: string }>;
  otherFiles: string[];
  input?: { label?: string; columns?: string[]; sampleRows: unknown[]; extra?: unknown };
  userNote?: string;
  round?: { current: number; max: number; previousAttempts: string[] };
}

/**
 * What the model sees for a fix turn: error, relative call stack, last 4 KB of stderr, the
 * failing file in full plus the names of the others, and ≤20 sample rows. Never env vars,
 * absolute paths or secrets.
 */
export function buildFixPayload(input: FixPayloadInput): FixPayload {
  const paths = input.files.map((file) => file.path);
  const report = parseErrorReport(input.request, paths);
  const failingPath =
    report.location?.file ??
    [...report.frames].reverse().find((frame) => paths.includes(frame.file))?.file ??
    input.primaryFile;
  const failing = input.files.find((file) => file.path === failingPath);
  const stackPaths = [...new Set(report.frames.map((frame) => frame.file))].filter(
    (path) => path !== failing?.path && paths.includes(path)
  );
  const stackFiles = input.files.filter((file) => stackPaths.includes(file.path)).slice(-2);
  const secrets = input.secrets ?? [];
  const scrub = (text: string) => redactSecrets(relativizePaths(text), secrets);
  const payload: FixPayload = {
    error: scrub(report.message),
    ...(report.location ? { location: report.location } : {}),
    callStack: report.frames.map((frame) => ({
      ...frame,
      file: scrub(frame.file),
      ...(frame.code ? { code: scrub(frame.code) } : {}),
    })),
    ...(report.exitCode !== undefined ? { exitCode: report.exitCode } : {}),
    stderrTail: scrub(tailBytes(report.traceback)),
    ...(failing
      ? { failingFile: { path: failing.path, content: redactSecrets(failing.content, secrets) } }
      : {}),
    ...(stackFiles.length > 0
      ? {
          stackFiles: stackFiles.map((file) => ({
            path: file.path,
            content: redactSecrets(file.content, secrets),
          })),
        }
      : {}),
    otherFiles: paths.filter(
      (path) => path !== failing?.path && !stackFiles.some((file) => file.path === path)
    ),
    ...(input.input
      ? {
          input: {
            ...(input.input.label ? { label: scrub(input.input.label) } : {}),
            ...(input.input.columns ? { columns: input.input.columns.slice(0, 200) } : {}),
            sampleRows: sampleRows(input.input.rows),
            ...(input.input.extra !== undefined ? { extra: truncateField(input.input.extra) } : {}),
          },
        }
      : {}),
    ...(input.request.note?.trim()
      ? { userNote: scrub(input.request.note.trim()).slice(0, 2000) }
      : {}),
    ...(input.request.round
      ? {
          round: {
            current: input.request.round,
            max: input.request.maxRounds ?? input.request.round,
            previousAttempts: (input.request.previousAttempts ?? []).map(scrub).slice(-5),
          },
        }
      : {}),
  };
  // Final pass over the serialized form catches secrets inside sample rows / extra.
  return JSON.parse(redactSecrets(relativizePaths(JSON.stringify(payload)), secrets)) as FixPayload;
}

// ── pass criteria ──────────────────────────────────────────────────────

export interface ExpectedColumn {
  name: string;
  /** Columns that may legitimately be empty. */
  nullable?: boolean;
}

export interface PassCheckInput {
  ok: boolean;
  error?: string;
  exitCode?: number;
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  totalRows?: number;
  expectedColumns?: ExpectedColumn[];
}

export interface PassCheckResult {
  ok: boolean;
  /** Failure reason; for 通过但结果异常 it starts with that phrase. */
  reason?: string;
  /** True when the run itself succeeded but the result looks wrong. */
  suspicious?: boolean;
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * Exit code 0, expected columns present, at least one row, and no expected non-nullable column
 * entirely empty. Used by trial runs, previews, generation self-tests and automation runs.
 */
export function evaluatePass(input: PassCheckInput): PassCheckResult {
  if (!input.ok || (input.exitCode !== undefined && input.exitCode !== 0)) {
    return {
      ok: false,
      reason: input.error ? summarizeError(input.error) : `退出码 ${input.exitCode ?? '未知'}`,
    };
  }
  const columns = input.columns ?? [];
  const expected = (input.expectedColumns ?? []).filter((column) => column.name.trim());
  const missing = expected
    .filter((column) => !columns.includes(column.name))
    .map((column) => column.name);
  if (missing.length > 0) {
    return {
      ok: false,
      suspicious: true,
      reason: `通过但结果异常：缺少列 ${missing.slice(0, 6).join('、')}（输出列：${columns.slice(0, 8).join('、') || '无'}）`,
    };
  }
  if (expected.length > 0 && columns.length > 0) {
    const extra = columns.filter((column) => !expected.some((item) => item.name === column));
    if (extra.length > 0 && extra.length === columns.length) {
      return { ok: false, suspicious: true, reason: `通过但结果异常：输出列与预期不一致` };
    }
  }
  const rows = input.rows ?? [];
  const total = input.totalRows ?? (input.rows ? rows.length : undefined);
  if (total === 0) {
    return { ok: false, suspicious: true, reason: '通过但结果异常：输出 0 行' };
  }
  if (rows.length > 0 && expected.length === 0 && columns.length > 0) {
    // No declared columns: the output still has to carry some data.
    if (rows.every((row) => columns.every((column) => isBlank(row[column])))) {
      return { ok: false, suspicious: true, reason: '通过但结果异常：所有列全为空' };
    }
  }
  if (rows.length > 0) {
    const empty = expected
      .filter((column) => !column.nullable)
      .filter((column) => rows.every((row) => isBlank(row[column.name])))
      .map((column) => column.name);
    if (empty.length > 0) {
      return {
        ok: false,
        suspicious: true,
        reason: `通过但结果异常：「${empty.slice(0, 6).join('」「')}」列全为空`,
      };
    }
  }
  return { ok: true };
}

/** Expected columns from a normalizer project's docs/source-structure-analysis.json. */
export function expectedColumnsFromAnalysis(content: string | undefined): ExpectedColumn[] {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content) as { sourceStructureAnalysis?: { outputColumns?: unknown } };
    const list = parsed?.sourceStructureAnalysis?.outputColumns;
    if (!Array.isArray(list)) return [];
    return list.flatMap((item): ExpectedColumn[] => {
      if (typeof item === 'string') return item.trim() ? [{ name: item.trim() }] : [];
      if (!item || typeof item !== 'object') return [];
      const record = item as { name?: unknown; nullable?: unknown };
      if (typeof record.name !== 'string' || !record.name.trim()) return [];
      return [{ name: record.name.trim(), nullable: record.nullable === true }];
    });
  } catch {
    return [];
  }
}

/** Expected columns from a script package manifest.json (output.columns). */
export function expectedColumnsFromManifest(content: string | undefined): ExpectedColumn[] {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content) as { output?: { columns?: unknown } };
    const list = parsed?.output?.columns;
    return Array.isArray(list)
      ? list
          .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
          .map((name) => ({ name: name.trim() }))
      : [];
  } catch {
    return [];
  }
}

// ── auto-fix loop ──────────────────────────────────────────────────────

export interface AutoFixRound {
  round: number;
  /** Version the fix was saved as. */
  version?: number;
  status: 'fixing' | 'verifying' | 'passed' | 'failed' | 'error';
  /** Failure reason of the verification (or the fix step itself). */
  reason?: string;
  changedFiles?: string[];
  summary?: string;
}

export interface AutoFixLoopOptions<F extends { message: string }> {
  /** 1 = a single fix (自动修复 关闭), up to 5. */
  maxRounds: number;
  initialFailure: F;
  /** Apply one fix turn on the current draft. */
  fix: (
    failure: F,
    round: number,
    previous: string[]
  ) => Promise<{ version?: number; changedFiles?: string[]; summary?: string }>;
  /** Re-run the preview / trial; return null when it passed, else the new failure. */
  verify: (round: number) => Promise<F | null>;
  onRound?: (round: AutoFixRound) => void;
  shouldStop?: () => boolean;
}

export interface AutoFixLoopResult {
  passed: boolean;
  rounds: AutoFixRound[];
  stoppedReason?: 'limit' | 'fix_error' | 'cancelled';
}

/** Fix → verify, repeating with the new failure until it passes or maxRounds is reached. */
export async function runAutoFixLoop<F extends { message: string }>(
  options: AutoFixLoopOptions<F>
): Promise<AutoFixLoopResult> {
  const max = Math.max(1, Math.min(5, Math.floor(options.maxRounds || 1)));
  const rounds: AutoFixRound[] = [];
  // What earlier rounds changed and why they still failed, starting with the original error,
  // so a later round keeps the earlier fixes instead of trading one failure for another.
  const previous: string[] = [];
  let failure = options.initialFailure;
  for (let round = 1; round <= max; round += 1) {
    if (options.shouldStop?.()) return { passed: false, rounds, stoppedReason: 'cancelled' };
    const entry: AutoFixRound = { round, status: 'fixing' };
    rounds.push(entry);
    options.onRound?.({ ...entry });
    try {
      const fixed = await options.fix(failure, round, [...previous]);
      Object.assign(entry, fixed, { status: 'verifying' as const });
    } catch (error) {
      entry.status = 'error';
      entry.reason = error instanceof Error ? error.message : String(error);
      options.onRound?.({ ...entry });
      return { passed: false, rounds, stoppedReason: 'fix_error' };
    }
    options.onRound?.({ ...entry });
    const next = await options.verify(round);
    if (!next) {
      entry.status = 'passed';
      options.onRound?.({ ...entry });
      return { passed: true, rounds };
    }
    entry.status = 'failed';
    entry.reason = next.message;
    options.onRound?.({ ...entry });
    if (round === 1) previous.push(`原始报错：${options.initialFailure.message}`);
    previous.push(
      `第 ${round} 轮${entry.summary ? `改动「${entry.summary}」` : ''}后仍未通过：${next.message}`
    );
    failure = next;
  }
  return { passed: false, rounds, stoppedReason: 'limit' };
}

// ── line diff ──────────────────────────────────────────────────────────

export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

/** LCS line diff (Myers-free, fine for project files of a few thousand lines). */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.replace(/\r\n/g, '\n').split('\n');
  const b = after === '' ? [] : after.replace(/\r\n/g, '\n').split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix += 1;
  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  const out: DiffLine[] = [];
  for (let i = 0; i < prefix; i += 1)
    out.push({ kind: 'same', text: a[i], oldLine: i + 1, newLine: i + 1 });
  if (midA.length * midB.length > 4_000_000) {
    midA.forEach((text, i) => out.push({ kind: 'del', text, oldLine: prefix + i + 1 }));
    midB.forEach((text, i) => out.push({ kind: 'add', text, newLine: prefix + i + 1 }));
  } else {
    const n = midA.length;
    const m = midB.length;
    const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1)
      for (let j = m - 1; j >= 0; j -= 1)
        table[i][j] =
          midA[i] === midB[j]
            ? table[i + 1][j + 1] + 1
            : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        out.push({ kind: 'same', text: midA[i], oldLine: prefix + i + 1, newLine: prefix + j + 1 });
        i += 1;
        j += 1;
      } else if (i < n && (j >= m || table[i + 1][j] >= table[i][j + 1])) {
        // Deletions first on ties, so a changed line reads − old then + new.
        out.push({ kind: 'del', text: midA[i], oldLine: prefix + i + 1 });
        i += 1;
      } else {
        out.push({ kind: 'add', text: midB[j], newLine: prefix + j + 1 });
        j += 1;
      }
    }
  }
  for (let k = 0; k < suffix; k += 1)
    out.push({
      kind: 'same',
      text: a[a.length - suffix + k],
      oldLine: a.length - suffix + k + 1,
      newLine: b.length - suffix + k + 1,
    });
  return out;
}

/** Group a diff into hunks with `context` unchanged lines around each change. */
export function diffHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const changed = lines
    .map((line, index) => (line.kind === 'same' ? -1 : index))
    .filter((index) => index >= 0);
  if (changed.length === 0) return [];
  const ranges: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length - 1, index + context);
    const last = ranges.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  return ranges.map(([start, end]) => {
    const slice = lines.slice(start, end + 1);
    const oldStart = slice.find((line) => line.oldLine)?.oldLine ?? 0;
    const newStart = slice.find((line) => line.newLine)?.newLine ?? 0;
    const oldCount = slice.filter((line) => line.kind !== 'add').length;
    const newCount = slice.filter((line) => line.kind !== 'del').length;
    return { header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, lines: slice };
  });
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((line) => line.kind === 'add').length,
    removed: lines.filter((line) => line.kind === 'del').length,
  };
}

/** Paths whose content differs between two file lists (added or modified). */
export function changedFilePaths(
  before: Array<{ path: string; content: string }>,
  after: Array<{ path: string; content: string }>
): string[] {
  const old = new Map(before.map((file) => [file.path, file.content]));
  return after.filter((file) => old.get(file.path) !== file.content).map((file) => file.path);
}

// ── fix target ─────────────────────────────────────────────────────────

/**
 * Where an AI 修复 will be saved (mirrors findReusableDraft): the newest version when it is an
 * unpublished AI 修复 draft newer than the published one, otherwise a new version.
 */
export function predictFixDraft(
  records: Array<{ version: number; status: string; source: string }>
): { version: number; overwrite: boolean } {
  const sorted = [...records].sort((a, b) => a.version - b.version);
  const latest = sorted.at(-1);
  const published = sorted.filter((record) => record.status === 'published').at(-1);
  if (
    latest &&
    latest.status === 'draft' &&
    latest.source === 'ai_repair' &&
    latest.version > (published?.version ?? 0)
  ) {
    return { version: latest.version, overwrite: true };
  }
  return { version: (latest?.version ?? 0) + 1, overwrite: false };
}

/** 「config.json · items 2 条」: the script's input as shown in the 输入 row. */
export function describeConfigInput(content: string | undefined): string {
  if (content === undefined) return '';
  try {
    const value = JSON.parse(content) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const list = Object.entries(value as Record<string, unknown>).find(([, item]) =>
        Array.isArray(item)
      );
      if (list) return `config.json · ${list[0]} ${(list[1] as unknown[]).length} 条`;
      return `config.json · ${Object.keys(value).length} 项参数`;
    }
  } catch {
    // fall through
  }
  return 'config.json';
}

/** Decode the prefix of a JSON string body up to (not including) its closing quote. */
function decodeJsonStringPrefix(raw: string): string {
  let out = '';
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') break;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = raw[index + 1];
    if (next === undefined) break; // escape split across deltas
    if (next === 'u') {
      const hex = raw.slice(index + 2, index + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16));
      index += 5;
      continue;
    }
    const map: Record<string, string> = { n: '\n', t: '\t', r: '', b: '', f: '' };
    out += map[next] ?? next;
    index += 1;
  }
  return out;
}

export interface FixStreamEvent {
  phase: 'source_analysis' | 'code_generation';
  kind: 'message' | 'delta';
  text: string;
}

/**
 * Turn the model's streamed fix JSON ({"analysis": …, "files": [...], "summary": …}) into
 * readable console progress: the decoded analysis text for 分析原因, then one "修改 <path>"
 * line per file for 修改文件 — never the raw escaped JSON / file bodies.
 */
export function createFixStreamSplitter(emit: (event: FixStreamEvent) => void) {
  let buffer = '';
  let analysisLength = 0;
  const paths = new Set<string>();
  return (delta: string) => {
    if (!delta) return;
    buffer += delta;
    const filesIndex = buffer.search(/"files"\s*:/);
    const head = filesIndex >= 0 ? buffer.slice(0, filesIndex) : buffer;
    const analysis = /"analysis"\s*:\s*"/.exec(head);
    if (analysis) {
      const decoded = decodeJsonStringPrefix(head.slice(analysis.index + analysis[0].length));
      if (decoded.length > analysisLength) {
        emit({ phase: 'source_analysis', kind: 'delta', text: decoded.slice(analysisLength) });
        analysisLength = decoded.length;
      }
    }
    if (filesIndex < 0) return;
    for (const match of buffer.slice(filesIndex).matchAll(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      let path = match[1];
      try {
        path = JSON.parse(`"${match[1]}"`) as string;
      } catch {
        // keep the raw text
      }
      if (paths.has(path)) continue;
      paths.add(path);
      emit({ phase: 'code_generation', kind: 'message', text: `修改 ${path}` });
    }
  };
}
