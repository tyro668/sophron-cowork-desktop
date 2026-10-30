import { z } from 'zod';

/** Automation action that runs a saved script package without any AI call. */
export const SCRIPT_RUN_ACTION = 'script.run';

export const SCRIPT_RUNTIMES = ['python', 'node'] as const;
export type ScriptRuntime = (typeof SCRIPT_RUNTIMES)[number];

/** `manifest.json` at the root of a script package folder. */
export const scriptManifestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  entry: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !value.startsWith('/') && !value.split(/[\\/]/).includes('..'), {
      message: 'entry must be a relative path inside the package',
    }),
  runtime: z.enum(SCRIPT_RUNTIMES),
  output: z
    .object({
      format: z.enum(['csv', 'json']).default('csv'),
      /** Columns the output must contain (checked after every run). */
      columns: z.array(z.string().trim().min(1)).optional(),
    })
    .optional(),
});
export type ScriptManifest = z.infer<typeof scriptManifestSchema>;

export interface ScriptPackageRunInfo {
  at: number;
  rows: number;
  durationMs: number;
}

export const SCRIPT_VERSION_STATUSES = ['draft', 'published', 'archived'] as const;
export type ScriptVersionStatus = (typeof SCRIPT_VERSION_STATUSES)[number];

/** Where a version came from (shown as 来源 in the version history). */
export const SCRIPT_VERSION_SOURCES = ['chat', 'rule', 'ai_repair', 'manual'] as const;
export type ScriptVersionSource = (typeof SCRIPT_VERSION_SOURCES)[number];

/** One immutable snapshot of a package; automations only run the published one. */
export interface ScriptPackageVersion {
  version: number;
  status: ScriptVersionStatus;
  source: ScriptVersionSource;
  entry: string;
  runtime: ScriptRuntime;
  /** Rule prompt for 规则生成 versions; the failure reason for AI repairs. */
  rulePrompt?: string;
  /** Version this one was derived from (null = from scratch). */
  baseVersion?: number | null;
  sessionId?: string;
  /** Rows of the last successful trial run of this version. */
  rows?: number;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  /** Git commit of this version (short form for display). */
  commit?: string;
  /** Changes against the published version, from git (absent for the published one). */
  diff?: ScriptTreeDiff;
}

export interface ScriptTreeDiff {
  added: string[];
  modified: string[];
  removed: string[];
}

export interface ScriptPackageFile {
  path: string;
  content: string;
}

export interface ScriptPackageVersionDetail extends ScriptPackageVersion {
  files: ScriptPackageFile[];
}

export interface ScriptPackageSummary {
  id: string;
  name: string;
  description?: string;
  dir: string;
  entry: string;
  runtime: ScriptRuntime;
  /** e.g. "Python 3.12"; known after the first install or run. */
  runtimeVersion?: string;
  depsFile?: 'requirements.txt' | 'package.json';
  depsReady: boolean;
  lastSuccess?: ScriptPackageRunInfo;
  lastError?: { at: number; message: string };
  /** The version automations run; undefined until one is published. */
  published?: ScriptPackageVersion;
  /** Newest draft newer than the published version (e.g. an AI repair awaiting review). */
  draft?: ScriptPackageVersion;
  versionCount: number;
  /** Manifest problem; the package is listed but cannot run. */
  invalid?: string;
}

export interface ScriptTestRunResult {
  ok: boolean;
  version?: number;
  rows?: number;
  columns?: string[];
  durationMs: number;
  error?: string;
  installedDeps: boolean;
  /** First lines of the CSV output. */
  preview?: string;
  /** First rows of the output for the 试运行预览 grid. */
  previewRows?: Array<Record<string, string>>;
  /** Tail of the entry's stdout/stderr. */
  log?: string;
  /** Exit code of the entry when it ran and failed. */
  exitCode?: number;
}

export interface ScriptGenerateDraftInput {
  /** Existing package; omitted to create a new one named `name`. */
  packageId?: string;
  name?: string;
  rulePrompt: string;
  /** Version to modify; null = generate from scratch. */
  baseVersion: number | null;
  runtime: ScriptRuntime;
  modelConfigSetId?: string | null;
  progressId?: string;
  /** 交给 AI 修复: edit `baseVersion` (the current draft) from a trial-run failure. */
  fix?: ScriptFixInput;
}

/** A trial-run failure handed to the model (the main process redacts paths and secrets). */
export interface ScriptFixInput {
  error: string;
  log?: string;
  exitCode?: number;
  durationMs?: number;
  note?: string;
  round?: number;
  maxRounds?: number;
  previousAttempts?: string[];
}

export interface ScriptGenerateDraftResult {
  summary: ScriptPackageSummary;
  version: ScriptPackageVersionDetail;
  /** Fix turns: changed files, the model's one-line explanation, and whether the AI 修复 draft was overwritten. */
  changedFiles?: string[];
  fixSummary?: string;
  replaced?: boolean;
}

export interface ScriptGenerateProgressEvent {
  progressId: string;
  phase: 'source_summary' | 'source_analysis' | 'code_generation' | 'saving' | 'complete' | 'error';
  kind: 'message' | 'delta';
  text: string;
}

/** Editor state kept between visits (rule prompt typed but not generated yet). */
export interface ScriptPackageEditorState {
  rulePrompt?: string;
  runtime?: ScriptRuntime;
  modelConfigSetId?: string | null;
}

export const SCRIPT_TIMEOUT_OPTIONS_MS = [30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000];
export const DEFAULT_SCRIPT_TIMEOUT_MS = 120_000;

export const scriptRunConfigSchema = z.object({
  packageId: z.string().trim().min(1),
  timeoutMs: z.number().int().min(1_000).max(3_600_000).default(DEFAULT_SCRIPT_TIMEOUT_MS),
  /** Target raw table; empty means "create one named after the package" on first run. */
  rawTableId: z.string().trim().optional(),
  rawTableName: z.string().trim().optional(),
  onScriptError: z.enum(['notify', 'ai_repair']).default('notify'),
});
export type ScriptRunConfig = z.infer<typeof scriptRunConfigSchema>;
