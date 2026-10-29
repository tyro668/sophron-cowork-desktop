import type { AppConfig } from '../../config/config-store';
import type { AgentRuntimeConfig } from '../../../shared/contracts';
import { runPiAiOneShot } from '../../agent/pi-ai-one-shot';
import { extractJsonObjectText } from '../../../shared/structured-text';
import {
  scriptManifestSchema,
  type ScriptPackageFile,
  type ScriptRuntime,
} from '../../../shared/automation/script-package';

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

export interface ScriptFilesGenerator {
  generate(input: GenerateScriptFilesInput): Promise<ScriptPackageFile[]>;
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
  };
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
