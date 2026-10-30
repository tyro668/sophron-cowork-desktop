import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataCommandService } from '../../src/main/data/data-command-service';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../../src/main/data/data-pipeline-store';
import {
  createLlmRawTableNormalizerProjectGenerator,
  type FixRawTableNormalizerProjectInput,
  type RawTableNormalizerProjectGenerator,
} from '../../src/main/data/raw-table-normalizer-generator';
import { createRawTableNormalizerProjectTemplate } from '../../src/shared/raw-table-normalizer/templates';
import { runPiAiOneShot } from '../../src/main/agent/pi-ai-one-shot';
import type { AppConfig } from '../../src/main/config/config-store';

vi.mock('../../src/main/agent/pi-ai-one-shot', () => ({ runPiAiOneShot: vi.fn() }));

const BROKEN = String.raw`
export async function transform(context, outputDir) {
  throw new Error("field larger than field limit (131072)");
}
`;

const copyTransform = (marker: string) => String.raw`
import { readFile } from "node:fs/promises";
// ${marker}
export async function transform(context, outputDir) {
  await outputDir.mkdir({ recursive: true });
  const outputPath = outputDir.join("normalized.csv");
  const source = context.preparedSources?.files?.[0]?.path ?? context.sourcePath;
  const text = await readFile(source, "utf8");
  const lines = text.trim().split(/\r?\n/);
  await outputPath.writeFile(lines.join("\n") + "\n", "utf8");
  const columns = lines[0].split(",");
  return {
    output: outputPath.toString(),
    format: "csv",
    rowCount: lines.length - 1,
    columns: columns.map((name) => ({ name, type: "string" })),
    warnings: [],
  };
}
`;

const stores: DataPipelineStore[] = [];
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (stores.length) stores.pop()?.close();
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function setup() {
  const fixCalls: FixRawTableNormalizerProjectInput[] = [];
  let generateCalls = 0;
  const generator: RawTableNormalizerProjectGenerator = {
    async generate(input) {
      generateCalls += 1;
      const template = createRawTableNormalizerProjectTemplate(
        input.primaryLanguage,
        input.rulePrompt
      );
      return {
        ...template,
        files: template.files.map((file) =>
          file.path === 'src/transform.js' ? { ...file, content: BROKEN } : file
        ),
      };
    },
    async fix(input) {
      fixCalls.push(input);
      const files = input.files.map((file) =>
        file.path === 'src/transform.js'
          ? { ...file, content: copyTransform(`fix ${fixCalls.length}`) }
          : file
      );
      return {
        files,
        changedFiles: ['src/transform.js'],
        summary: `修复 ${fixCalls.length}`,
        analysis: '',
        payload: { error: 'x', callStack: [], stderrTail: '', otherFiles: [] },
      };
    },
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-normalizer-fix-'));
  roots.push(root);
  const store = createDataPipelineStore(path.join(root, 'workspace.duckdb'), {
    now: () => 1_780_000_000_000,
  });
  stores.push(store);
  const service = new DataCommandService(store, generator, () => ({
    apiOrigin: '',
    apiKey: '',
    updatedAt: 0,
  }));
  const csvPath = path.join(root, 'orders.csv');
  fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');
  return { service, csvPath, fixCalls, getGenerateCalls: () => generateCalls, root };
}

describe('normalizer 交给 AI 修复', () => {
  it('fixes the current draft with its files, overwrites the AI 修复 draft, and starts a new one after publish', async () => {
    const { service, csvPath, fixCalls, getGenerateCalls, root } = setup();
    const base = {
      name: 'orders',
      sourcePath: csvPath,
      sourceKind: 'csv' as const,
      primaryLanguage: 'node' as const,
    };
    const v1 = await service.generateRawTableNormalizerDraft({ ...base, rulePrompt: 'copy rows' });
    const failure = await service
      .previewRawTableNormalizerVersion({
        versionId: v1.version.id,
        sourcePath: csvPath,
        sourceKind: 'csv',
        prepareDependencies: false,
      })
      .then(() => null)
      .catch((error: Error) => error.message);
    expect(failure).toContain('field larger than field limit');

    const progress: string[] = [];
    const fixed = await service.generateRawTableNormalizerDraft({
      ...base,
      artifactId: v1.artifact.id,
      rulePrompt: 'copy rows',
      fix: { baseVersionId: v1.version.id, error: failure!, note: '备注可能很长' },
      onProgress: (event) => progress.push(event.phase),
    });
    expect(getGenerateCalls()).toBe(1); // no regeneration
    expect(fixCalls[0].files.find((file) => file.path === 'src/transform.js')?.content).toBe(
      BROKEN
    );
    expect(fixCalls[0].request).toMatchObject({ error: failure, note: '备注可能很长' });
    expect(fixCalls[0].sourceSummary?.files[0]?.sampleRows?.[0]).toEqual(['id', 'name']);
    expect(fixed.version).toMatchObject({ version: 2, status: 'draft', source: 'ai_repair' });
    expect(fixed.changedFiles).toEqual(['src/transform.js']);
    expect(fixed.replaced).toBe(false);
    expect(progress).toContain('source_summary');
    expect(progress).toContain('saving');

    const preview = await service.previewRawTableNormalizerVersion({
      versionId: fixed.version.id,
      sourcePath: csvPath,
      sourceKind: 'csv',
      prepareDependencies: false,
    });
    expect(preview.preview.rows[0]).toEqual({ id: '1', name: 'Alice' });

    // A second fix on the AI 修复 draft overwrites it instead of adding v3.
    const again = await service.generateRawTableNormalizerDraft({
      ...base,
      artifactId: v1.artifact.id,
      rulePrompt: 'copy rows',
      fix: {
        baseVersionId: fixed.version.id,
        error: '通过但结果异常：「name」列全为空',
        round: 2,
        maxRounds: 3,
      },
    });
    expect(again.version).toMatchObject({ id: fixed.version.id, version: 2, source: 'ai_repair' });
    expect(again.replaced).toBe(true);
    expect(again.version.files.find((file) => file.path === 'src/transform.js')?.content).toContain(
      'fix 2'
    );
    expect(fixCalls[1].files.find((file) => file.path === 'src/transform.js')?.content).toContain(
      'fix 1'
    );
    const listed = await service.listRawTableNormalizerVersions({ artifactId: v1.artifact.id });
    expect(listed.versions.map((version) => version.version).sort()).toEqual([1, 2]);

    // Once published, the next fix creates a new draft.
    await service.publishRawTableNormalizerVersion({ versionId: again.version.id });
    const third = await service.generateRawTableNormalizerDraft({
      ...base,
      artifactId: v1.artifact.id,
      rulePrompt: 'copy rows',
      fix: { baseVersionId: again.version.id, error: 'ValueError: x' },
    });
    expect(third.version).toMatchObject({ version: 3, status: 'draft', source: 'ai_repair' });
    const published = (
      await service.listRawTableNormalizerVersions({ artifactId: v1.artifact.id })
    ).versions.find((version) => version.status === 'published');
    expect(published?.version).toBe(2);
    expect(fs.existsSync(path.join(root, 'normalizers', v1.artifact.id, '.git'))).toBe(true);
  });
});

describe('LLM normalizer fix turn', () => {
  it('sends the current failing file (not a template) and merges only the changed files', async () => {
    const secret = 'fr_secret_token_0123456789abcdef';
    vi.stubEnv('FINERES_TOKEN', secret);
    const template = createRawTableNormalizerProjectTemplate('node', 'copy');
    const current = template.files.map((file) =>
      file.path === 'src/transform.js'
        ? { ...file, content: `${BROKEN}\nconst KEY_HINT = "${secret}";\n` }
        : file
    );
    vi.mocked(runPiAiOneShot).mockImplementation(async (_user, _system, _config, options) => {
      const text = JSON.stringify({
        analysis: '源字段超长，改为逐行读取。',
        files: [{ path: 'src/transform.js', content: copyTransform('llm fix') }],
        summary: '改为逐行读取',
      });
      options?.onTextDelta?.(text.slice(0, 20));
      options?.onTextDelta?.(text.slice(20));
      return { text } as Awaited<ReturnType<typeof runPiAiOneShot>>;
    });
    const phases: string[] = [];
    const generator = createLlmRawTableNormalizerProjectGenerator(() => ({}) as AppConfig);
    const result = await generator.fix!({
      name: 'orders',
      primaryLanguage: 'node',
      rulePrompt: 'copy',
      files: current,
      baseLabel: 'v1 草稿',
      request: {
        error: `Error invoking remote method 'data.previewRawTableNormalizerVersion': DataCommandError: [RUN_FAILED] Normalizer command failed with exit code 1: file:///home/box/n/.sophron/run/v1/src/transform.js:3\nError: field larger than field limit (131072)\n    at transform (file:///home/box/n/.sophron/run/v1/src/transform.js:3:9)`,
        note: '保留完整内容',
      },
      onProgress: (event) => phases.push(event.phase),
    });
    const prompt = String(vi.mocked(runPiAiOneShot).mock.calls[0][0]);
    const sent = JSON.parse(prompt) as {
      failure: {
        failingFile: { path: string; content: string };
        otherFiles: string[];
        userNote: string;
      };
    };
    expect(sent.failure.failingFile.path).toBe('src/transform.js');
    expect(sent.failure.failingFile.content).toContain('field larger than field limit');
    expect(sent.failure.otherFiles).toContain('src/cli.js');
    expect(sent.failure.userNote).toBe('保留完整内容');
    expect(prompt).not.toContain(secret);
    expect(prompt).not.toContain('/home/box');
    expect(prompt).not.toContain('Error invoking remote method');
    expect(String(vi.mocked(runPiAiOneShot).mock.calls[0][1])).toContain('FIX turn');
    expect(result.changedFiles).toEqual(['src/transform.js']);
    expect(result.files.map((file) => file.path)).toEqual(current.map((file) => file.path).sort());
    expect(result.summary).toBe('改为逐行读取');
    expect(phases).toContain('source_analysis');
    expect(phases).toContain('code_generation');
  });

  it('rejects a fix that changes nothing', async () => {
    const template = createRawTableNormalizerProjectTemplate('node', 'copy');
    const current = template.files.map((file) =>
      file.path === 'src/transform.js' ? { ...file, content: copyTransform('same') } : file
    );
    vi.mocked(runPiAiOneShot).mockResolvedValue({
      text: JSON.stringify({
        files: [{ path: 'src/transform.js', content: copyTransform('same') }],
      }),
    } as Awaited<ReturnType<typeof runPiAiOneShot>>);
    const generator = createLlmRawTableNormalizerProjectGenerator(() => ({}) as AppConfig);
    await expect(
      generator.fix!({
        name: 'n',
        primaryLanguage: 'node',
        rulePrompt: 'r',
        files: current,
        baseLabel: 'v1',
        request: { error: '通过但结果异常：「a」列全为空' },
      })
    ).rejects.toThrow('没有改动');
  });
});
