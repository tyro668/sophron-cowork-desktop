import type { AppConfig } from '../../config/config-store';
import type { AgentRuntimeConfig } from '../../../shared/contracts';
import { runPiAiOneShot } from '../../agent/pi-ai-one-shot';
import { extractJsonObjectText } from '../../../shared/structured-text';
import {
  scriptManifestSchema,
  type ScriptPackageFile,
  type ScriptRuntime,
} from '../../../shared/automation/script-package';
import {
  buildFixPayload,
  changedFilePaths,
  collectSecretValues,
  type FixErrorRequest,
  type FixPayload,
  createFixStreamSplitter,
} from '../../../shared/fix-error';

export interface GenerateScriptFilesInput {
  name: string;
  rulePrompt: string;
  runtime: ScriptRuntime;
  /** Files of the version being modified; empty = from scratch. */
  baseFiles: ScriptPackageFile[];
  baseLabel?: string;
  lastError?: string;
  runtimeConfig?: AgentRuntimeConfig;
  onDelta?: (text: string) => void;
}

export interface FixScriptFilesInput {
  name: string;
  runtime: ScriptRuntime;
  rulePrompt?: string;
  /** Current files of the draft being fixed. */
  files: ScriptPackageFile[];
  baseLabel: string;
  request: FixErrorRequest;
  runtimeConfig?: AgentRuntimeConfig;
  onProgress?: (
    phase: 'source_summary' | 'source_analysis' | 'code_generation',
    kind: 'message' | 'delta',
    text: string
  ) => void;
}

export interface FixScriptFilesResult {
  files: ScriptPackageFile[];
  changedFiles: string[];
  summary: string;
  analysis: string;
  payload: FixPayload;
}

export interface ScriptFilesGenerator {
  generate(input: GenerateScriptFilesInput): Promise<ScriptPackageFile[]>;
  /** Follow-up turn: fix the current draft from a trial-run failure. */
  fix?(input: FixScriptFilesInput): Promise<FixScriptFilesResult>;
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

/** One-shot code generation for 规则生成 drafts (same model plumbing as raw-table 自定义). */
export function createLlmScriptFilesGenerator(
  getConfig: () => AppConfig | Promise<AppConfig>
): ScriptFilesGenerator {
  return {
    async generate(input) {
      const config = input.runtimeConfig ?? (await getConfig());
      const response = await runPiAiOneShot(
        buildScriptGenerationUserPrompt(input),
        buildScriptGenerationSystemPrompt(input.runtime),
        config,
        { temperature: 0.1, maxTokens: 16_000, onTextDelta: input.onDelta }
      );
      if (!response.text.trim()) throw new Error('模型没有返回内容');
      return mergeGeneratedScriptFiles(
        input.baseFiles,
        parseGeneratedScriptFiles(response.text),
        input
      );
    },
    async fix(input) {
      const appConfig = await getConfig();
      const config = input.runtimeConfig ?? appConfig;
      const secrets = [
        ...collectSecretValues(process.env),
        ...collectSecretValues(appConfig),
        ...collectSecretValues(input.runtimeConfig),
      ];
      const payload = buildScriptFixPayload(input, secrets);
      input.onProgress?.(
        'source_summary',
        'message',
        `调用栈 ${payload.callStack.length} 层${payload.location ? ` · 定位 ${payload.location.file}:${payload.location.line}${payload.location.func ? ` ${payload.location.func}()` : ''}` : ''}`
      );
      input.onProgress?.(
        'source_summary',
        'message',
        `读取 ${input.files.length} 个文件（${input.baseLabel}）`
      );
      const onDelta = createFixStreamSplitter((event) =>
        input.onProgress?.(event.phase, event.kind, event.text)
      );
      const response = await runPiAiOneShot(
        buildScriptFixUserPrompt(input, payload),
        buildScriptFixSystemPrompt(input.runtime),
        config,
        { temperature: 0.1, maxTokens: 16_000, onTextDelta: onDelta }
      );
      if (!response.text.trim()) throw new Error('模型没有返回内容');
      const generated = parseGeneratedScriptFiles(response.text);
      const record = JSON.parse(extractJsonObjectText(response.text)) as {
        summary?: unknown;
        analysis?: unknown;
      };
      const merged = mergeGeneratedScriptFiles(
        input.files,
        { files: generated.files, deleted: [] },
        input
      );
      // Keep manifest.json byte-for-byte unless the model changed it (merge re-serializes it).
      const originalManifest = input.files.find((file) => file.path === 'manifest.json');
      const files =
        originalManifest && !generated.files.some((file) => file.path === 'manifest.json')
          ? merged.map((file) => (file.path === 'manifest.json' ? originalManifest : file))
          : merged;
      const changedFiles = changedFilePaths(input.files, files);
      if (changedFiles.length === 0) throw new Error('AI 修复没有改动任何文件');
      return {
        files,
        changedFiles,
        summary: typeof record.summary === 'string' ? record.summary.trim() : '',
        analysis: typeof record.analysis === 'string' ? record.analysis.trim() : '',
        payload,
      };
    },
  };
}

function buildScriptFixSystemPrompt(runtime: ScriptRuntime): string {
  return [
    buildScriptGenerationSystemPrompt(runtime),
    '',
    'This is a FIX turn on the current draft, not a regeneration.',
    'You receive the failure of the last trial run (error, call stack with package-relative paths, stderr tail, the failing file in full, the names of the other files, config.json as the input) and an optional user note.',
    'Find the root cause and make the smallest change that fixes it. Keep the output columns from manifest.json unless the note asks otherwise.',
    'If the run succeeded but the result is wrong (missing columns, a column that is entirely empty), fix the logic so every expected column is filled.',
    'Return only strict JSON: {"analysis":"2-4 short Chinese sentences: root cause and what you change","files":[{"path":"relative/path","content":"complete new file content"}],"summary":"one short Chinese sentence describing the change"}.',
    'failure.round.previousAttempts (auto-fix) lists the original error and what each earlier round changed and why it still failed. The files you get already contain those changes: keep everything they fixed (the original error and earlier failures must stay fixed, values stay parsed/typed as before) and only add what the new failure needs.',
    "failure.userNote holds the user's 补充 notes and follow-up requests for this draft, oldest first. They override the original rule wherever they conflict, and earlier ones stay in force: never undo a fix an earlier note asked for.",
    'Only change files whose full content you were given (failure.failingFile, failure.stackFiles, config.json, manifest.json); return each changed file with its complete new content. Do not delete or rename files.',
  ].join('\n');
}

function buildScriptFixUserPrompt(input: FixScriptFilesInput, payload: FixPayload): string {
  return JSON.stringify(
    {
      task: `Fix the current draft (${input.baseLabel}) of the script package "${input.name}" so the trial run passes.`,
      runtime: input.runtime,
      ...(input.rulePrompt ? { rulePrompt: input.rulePrompt } : {}),
      failure: payload,
      outputJsonSchema: {
        analysis: 'root cause and fix, Chinese',
        files: [{ path: 'relative path', content: 'complete UTF-8 file content' }],
        summary: 'one sentence, Chinese',
      },
    },
    null,
    2
  );
}

export function buildScriptGenerationSystemPrompt(runtime: ScriptRuntime): string {
  const entry = runtime === 'node' ? 'main.js' : 'main.py';
  return [
    'You write executable "script packages": small multi-file projects that an automation runs on a schedule WITHOUT any model call.',
    'Return only strict JSON, no markdown or code fences: {"files":[{"path":"relative/path","content":"complete file content"}],"delete":["relative/path"],"summary":"one Chinese sentence describing the change"}.',
    'Return complete contents for every file you add or change; files you do not return stay as they are. List files to remove in "delete".',
    `manifest.json: {"name", "description", "entry": "${entry}", "runtime": "${runtime}", "output": {"format": "csv", "columns": [...]}}. Keep runtime "${runtime}".`,
    'The entry reads parameters from the JSON file at env SOPHRON_CONFIG (keep parameters such as URLs, ids and limits in config.json), writes the result to the path in env SOPHRON_OUTPUT (CSV with a header row, UTF-8) and exits non-zero with a one-line reason on stderr when it fails. The working directory is the package folder.',
    runtime === 'node'
      ? 'Node.js 20+: use CommonJS (require) unless package.json sets "type": "module"; global fetch is available. Put npm libraries in package.json "dependencies" with exact versions; never rely on globally installed modules.'
      : 'Python 3.9+: standard library preferred; third-party libraries go into requirements.txt with pinned versions (requirements.txt may be empty).',
    'Split the code into the entry plus at least one helper module (HTTP client, parsing/transform).',
    'Public data only: no logins, cookies, secrets or headless browsers. Use timeouts and a User-Agent header on HTTP requests.',
    'No TODOs or placeholders.',
  ].join('\n');
}

function buildScriptGenerationUserPrompt(input: GenerateScriptFilesInput): string {
  return JSON.stringify(
    {
      task:
        input.baseFiles.length > 0
          ? `Modify the existing script package (${input.baseLabel ?? 'current version'}) according to the rule prompt.`
          : 'Write a new script package from scratch according to the rule prompt.',
      packageName: input.name,
      runtime: input.runtime,
      rulePrompt: input.rulePrompt,
      ...(input.lastError ? { lastRunError: input.lastError } : {}),
      existingFiles: input.baseFiles.map((file) => ({ path: file.path, content: file.content })),
    },
    null,
    2
  );
}

interface GeneratedScriptFiles {
  files: ScriptPackageFile[];
  deleted: string[];
}

export function parseGeneratedScriptFiles(text: string): GeneratedScriptFiles {
  const parsed = JSON.parse(extractJsonObjectText(text)) as unknown;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { files?: unknown }).files)
  )
    throw new Error('模型返回的不是 {"files": [...]} JSON');
  const record = parsed as { files: unknown[]; delete?: unknown };
  const files = record.files.flatMap((file) => {
    if (!file || typeof file !== 'object') return [];
    const { path, content } = file as { path?: unknown; content?: unknown };
    if (typeof path !== 'string' || typeof content !== 'string') return [];
    return [{ path: safePath(path), content }];
  });
  const deleted = Array.isArray(record.delete)
    ? record.delete.filter((item): item is string => typeof item === 'string').map(safePath)
    : [];
  return { files, deleted };
}

export function mergeGeneratedScriptFiles(
  base: ScriptPackageFile[],
  generated: GeneratedScriptFiles,
  input: Pick<GenerateScriptFilesInput, 'name' | 'runtime'>
): ScriptPackageFile[] {
  const files = new Map(base.map((file) => [file.path, file]));
  for (const path of generated.deleted) if (path !== 'manifest.json') files.delete(path);
  for (const file of generated.files) files.set(file.path, file);
  const manifestFile = files.get('manifest.json');
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
  if (!files.has(manifest.data.entry))
    throw new Error(`生成结果缺少入口文件 ${manifest.data.entry}`);
  files.set('manifest.json', {
    path: 'manifest.json',
    content: `${JSON.stringify(manifestJson, null, 2)}\n`,
  });
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function safePath(value: string): string {
  const normalized = value
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '')
    .trim();
  if (
    !normalized ||
    normalized.split('/').some((part) => part === '..' || part === '.git' || part === '.sophron')
  )
    throw new Error(`生成的文件路径不安全：${value}`);
  return normalized;
}
