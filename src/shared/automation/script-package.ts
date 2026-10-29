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

export interface ScriptPackagePending {
  createdAt: number;
  rows: number;
  sessionId?: string;
  reason: string;
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
  pending?: ScriptPackagePending;
  /** Manifest problem; the package is listed but cannot run. */
  invalid?: string;
}

export interface ScriptTestRunResult {
  ok: boolean;
  rows?: number;
  columns?: string[];
  durationMs: number;
  error?: string;
  installedDeps: boolean;
  /** First lines of the CSV output. */
  preview?: string;
  /** Tail of the entry's stdout/stderr. */
  log?: string;
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
