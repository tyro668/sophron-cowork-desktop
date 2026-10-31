/**
 * Self-testing agent for raw-table 自定义 normalizers: edits the project files in a throwaway
 * folder (file tools only — no shell, no network) and previews them on the real source until
 * the preview passes. Used after 规则生成 when the first preview fails, and for 交给 AI 修复.
 */
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { AppConfig } from '../config/config-store';
import type {
  AgentRuntimeConfig,
  DataNormalizerLanguage,
  DataNormalizerProjectFile,
  DataRawTableSourceSummary,
} from '../../shared/contracts';
import {
  HeadlessToolAgent,
  formatAgentUsage,
  type HeadlessAgentStop,
} from '../agent/headless-tool-agent';
import { createWorkspaceTools } from '../agent/workspace-tools';
import { changedFilePaths, type FixPayload } from '../../shared/fix-error';

export const NORMALIZER_AGENT_LIMITS = {
  maxTurns: 24,
  timeoutMs: 6 * 60 * 1000,
  maxTotalTokens: 1_500_000,
} as const;

/** One preview of project files on the real source, with the pass verdict applied. */
export interface NormalizerPreviewCheck {
  passed: boolean;
  reason?: string;
  rows?: number;
  columns?: string[];
  /** CSV head of the preview. */
  sample?: string;
  durationMs: number;
}

export type NormalizerPreviewFn = (
  files: DataNormalizerProjectFile[]
) => Promise<NormalizerPreviewCheck>;

export interface NormalizerAgentInput {
  mode: 'generate' | 'fix';
  name: string;
  language: DataNormalizerLanguage;
  rulePrompt: string;
  files: DataNormalizerProjectFile[];
  /** The failure the agent starts from. */
  failure: string;
  payload?: FixPayload;
  sourceSummary?: DataRawTableSourceSummary;
  preview: NormalizerPreviewFn;
  validate: (files: DataNormalizerProjectFile[]) => void;
  systemRules: string;
  config: AppConfig | AgentRuntimeConfig;
  signal?: AbortSignal;
  onProgress?: (phase: 'source_analysis' | 'code_generation' | 'verify', text: string) => void;
}

export interface NormalizerAgentResult {
  files: DataNormalizerProjectFile[];
  changedFiles: string[];
  summary: string;
  stop: HeadlessAgentStop;
  lastCheck?: NormalizerPreviewCheck;
  selfTests: number;
}

const SKIP = new Set([
  '.git',
  '.sophron',
  '.venv',
  '.normalizer-env',
  'node_modules',
  '__pycache__',
  'output',
]);

async function readProjectFiles(dir: string, prefix = ''): Promise<DataNormalizerProjectFile[]> {
  const result: DataNormalizerProjectFile[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await readProjectFiles(full, rel)));
    else if (entry.isFile()) {
      const content = await readFile(full);
      if (!content.includes(0)) result.push({ path: rel, content: content.toString('utf8') });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

async function writeProjectFiles(dir: string, files: DataNormalizerProjectFile[]): Promise<void> {
  for (const file of files) {
    const target = path.join(dir, ...file.path.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
}

export function formatNormalizerCheck(check: NormalizerPreviewCheck): string {
  return [
    check.passed
      ? `PASSED · ${check.rows ?? 0} rows · columns: ${(check.columns ?? []).join(', ')}`
      : `FAILED: ${check.reason ?? 'unknown'}`,
    check.sample ? `output head:\n${check.sample}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function clip(text: string, max = 200): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export async function runNormalizerAgent(
  input: NormalizerAgentInput
): Promise<NormalizerAgentResult> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sophron-normalizer-agent-'));
  const progress = input.onProgress ?? (() => undefined);
  let lastCheck: NormalizerPreviewCheck | undefined;
  let selfTests = 0;
  try {
    await writeProjectFiles(dir, input.files);
    const schema = Type.Object({});
    const previewTool: AgentTool<typeof schema> = {
      name: 'normalizer_preview',
      label: 'normalizer_preview',
      description:
        'Run the project in the folder on the real input source exactly like 预览 does and judge it: no error, expected columns from docs/source-structure-analysis.json present, at least one row, no expected column entirely empty. Returns the verdict and the output head.',
      parameters: schema,
      async execute() {
        const files = await readProjectFiles(dir);
        let check: NormalizerPreviewCheck;
        try {
          input.validate(files);
          check = await input.preview(files);
        } catch (error) {
          check = {
            passed: false,
            reason: error instanceof Error ? error.message : String(error),
            durationMs: 0,
          };
        }
        lastCheck = check;
        selfTests += 1;
        return {
          content: [{ type: 'text', text: formatNormalizerCheck(check) }],
          details: undefined,
        };
      },
    };
    const agent = new HeadlessToolAgent({
      config: input.config,
      systemPrompt: [
        input.systemRules,
        '',
        'You now work with tools instead of returning JSON. The project files are in your cwd: read them, change them with write / edit (paths relative to the folder), then run normalizer_preview. Repeat until normalizer_preview PASSES. You have no shell and no network; the input sample is in the prompt and the preview output shows the real result.',
        input.mode === 'fix'
          ? 'This is a FIX turn on the current draft: find the root cause of the failure and make the smallest change that fixes it, keeping the output columns.'
          : 'The draft was just generated and its first preview failed: fix it so the preview passes, keeping the intended output columns.',
        'Keep docs/source-structure-analysis.json consistent with the output columns. Finish with one or two Chinese sentences describing what you changed.',
      ].join('\n'),
      tools: [...createWorkspaceTools({ dir }), previewTool],
      maxTurns: NORMALIZER_AGENT_LIMITS.maxTurns,
      timeoutMs: NORMALIZER_AGENT_LIMITS.timeoutMs,
      maxTotalTokens: NORMALIZER_AGENT_LIMITS.maxTotalTokens,
      signal: input.signal,
      maxTokens: 16_000,
      onEvent: (event) => {
        if (event.type === 'tool_start') {
          const target = typeof event.args.path === 'string' ? event.args.path : '';
          if (event.name === 'write') progress('code_generation', `写入 ${target}`);
          else if (event.name === 'edit') progress('code_generation', `修改 ${target}`);
          else if (event.name === 'normalizer_preview') progress('verify', '预览当前代码…');
          else progress('source_analysis', `查看 ${target || '.'}`);
        } else if (event.type === 'tool_end') {
          if (event.name === 'normalizer_preview') {
            const first = event.text.split('\n')[0] ?? '';
            progress(
              'verify',
              first.startsWith('PASSED')
                ? `✓ 通过：${first.replace(/^PASSED · /, '')}`
                : `✕ ${clip(first.replace(/^FAILED: /, '未通过：'))}`
            );
          } else if (event.isError) progress('source_analysis', `  ✕ ${clip(event.text)}`);
        }
      },
    });
    try {
      const result = await agent.prompt(
        JSON.stringify(
          {
            task:
              input.mode === 'fix'
                ? `Fix the input table normalizer "${input.name}" so normalizer_preview passes.`
                : `The generated normalizer "${input.name}" failed its first preview; make normalizer_preview pass.`,
            language: input.language,
            rulePrompt: input.rulePrompt,
            failure: input.payload ?? input.failure,
            files: input.files.map((file) => file.path),
            sourceSummary: input.sourceSummary,
          },
          null,
          2
        )
      );
      progress('verify', formatAgentUsage(result));
      if (result.stop === 'aborted') throw new Error('已取消');
      if (result.stop === 'error' && selfTests === 0)
        throw new Error(`AI 修复失败：${result.error ?? '模型出错'}`);
      const files = await readProjectFiles(dir);
      input.validate(files);
      return {
        files,
        changedFiles: changedFilePaths(input.files, files),
        summary: result.text.slice(0, 600),
        stop: result.stop,
        lastCheck,
        selfTests,
      };
    } finally {
      agent.dispose();
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
