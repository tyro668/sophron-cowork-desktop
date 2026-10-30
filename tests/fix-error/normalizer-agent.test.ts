import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { registerFauxProvider } from '@earendil-works/pi-ai/compat';
import { DataCommandService } from '../../src/main/data/data-command-service';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../../src/main/data/data-pipeline-store';
import {
  createLlmRawTableNormalizerProjectGenerator,
  type RawTableNormalizerProjectGenerator,
  type RefineRawTableNormalizerProjectInput,
} from '../../src/main/data/raw-table-normalizer-generator';
import { createRawTableNormalizerProjectTemplate } from '../../src/shared/raw-table-normalizer/templates';
import type { AppConfig } from '../../src/main/config/config-store';

const fauxHolder: { model?: unknown } = {};
vi.mock('../../src/main/agent/pi-ai-one-shot', () => ({
  resolvePiAiTarget: vi.fn(async () => ({ model: fauxHolder.model, apiKey: 'test' })),
  runPiAiOneShot: vi.fn(),
}));

const EMPTY = String.raw`
export async function transform(context, outputDir) {
  await outputDir.mkdir({ recursive: true });
  const outputPath = outputDir.join("normalized.csv");
  await outputPath.writeFile("id,name\n", "utf8");
  return { output: outputPath.toString(), format: "csv", rowCount: 0, columns: [{ name: "id", type: "string" }, { name: "name", type: "string" }], warnings: [] };
}
`;
const COPY = String.raw`
import { readFile } from "node:fs/promises";
export async function transform(context, outputDir) {
  await outputDir.mkdir({ recursive: true });
  const outputPath = outputDir.join("normalized.csv");
  const source = context.preparedSources?.files?.[0]?.path ?? context.sourcePath;
  const text = await readFile(source, "utf8");
  await outputPath.writeFile(text.trim() + "\n", "utf8");
  return { output: outputPath.toString(), format: "csv", rowCount: text.trim().split(/\r?\n/).length - 1, columns: [{ name: "id", type: "string" }, { name: "name", type: "string" }], warnings: [] };
}
`;

const stores: DataPipelineStore[] = [];
const roots: string[] = [];
afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function setup(generator: RawTableNormalizerProjectGenerator) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-normalizer-agent-'));
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
  fs.writeFileSync(csvPath, 'id,name\n1,Alice\n2,Bob\n', 'utf8');
  return { service, csvPath };
}

const withTransform = (content: string) =>
  createRawTableNormalizerProjectTemplate('node', 'copy').files.map((file) =>
    file.path === 'src/transform.js' ? { ...file, content } : file
  );

describe('normalizer 规则生成 self-test', () => {
  it('previews the generated draft and hands a 0-row result to the agent until it passes', async () => {
    const refines: RefineRawTableNormalizerProjectInput[] = [];
    const checks: Array<{ passed: boolean; reason?: string; rows?: number }> = [];
    const generator: RawTableNormalizerProjectGenerator = {
      async generate(input) {
        return {
          ...createRawTableNormalizerProjectTemplate('node', input.rulePrompt),
          files: withTransform(EMPTY),
        };
      },
      async refine(input) {
        refines.push(input);
        checks.push(await input.preview(input.files));
        const files = withTransform(COPY);
        checks.push(await input.preview(files));
        return { files, changedFiles: ['src/transform.js'], summary: '读取全部数据行' };
      },
    };
    const { service, csvPath } = setup(generator);
    const phases: string[] = [];
    const result = await service.generateRawTableNormalizerDraft({
      name: 'orders',
      sourcePath: csvPath,
      sourceKind: 'csv',
      primaryLanguage: 'node',
      rulePrompt: 'copy rows',
      onProgress: (event) => phases.push(`${event.phase}:${event.text}`),
    });
    expect(refines).toHaveLength(1);
    expect(refines[0].failure).toContain('输出 0 行');
    expect(checks[0]).toMatchObject({ passed: false });
    expect(checks[1]).toMatchObject({ passed: true, rows: 2 });
    expect(result.version.files.find((file) => file.path === 'src/transform.js')?.content).toBe(
      COPY
    );
    expect(phases.some((line) => line.startsWith('verify:✕ 预览未通过'))).toBe(true);
    expect(phases.some((line) => line.startsWith('verify:✓ 预览通过：2 行'))).toBe(true);
  });

  it('a passing first preview skips the agent', async () => {
    const refine = vi.fn();
    const { service, csvPath } = setup({
      async generate(input) {
        return {
          ...createRawTableNormalizerProjectTemplate('node', input.rulePrompt),
          files: withTransform(COPY),
        };
      },
      refine,
    });
    await service.generateRawTableNormalizerDraft({
      name: 'orders',
      sourcePath: csvPath,
      sourceKind: 'csv',
      primaryLanguage: 'node',
      rulePrompt: 'copy rows',
    });
    expect(refine).not.toHaveBeenCalled();
  });
});

describe('normalizer agent (file tools + preview)', () => {
  it('edits the project in a scratch folder and previews until it passes', async () => {
    const faux = registerFauxProvider({ provider: 'faux-normalizer' });
    fauxHolder.model = faux.getModel();
    try {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('normalizer_preview', {})], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxToolCall('write', { path: 'src/transform.js', content: COPY })], {
          stopReason: 'toolUse',
        }),
        fauxAssistantMessage([fauxToolCall('normalizer_preview', {})], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxText('改为读取全部数据行。')]),
      ]);
      const previews: string[] = [];
      const generator = createLlmRawTableNormalizerProjectGenerator(() => ({}) as AppConfig);
      const result = await generator.refine!({
        name: 'orders',
        primaryLanguage: 'node',
        rulePrompt: 'copy',
        files: withTransform(EMPTY),
        failure: '通过但结果异常：输出 0 行',
        preview: async (files) => {
          const content = files.find((file) => file.path === 'src/transform.js')!.content;
          previews.push(content === COPY ? 'copy' : 'empty');
          return content === COPY
            ? { passed: true, rows: 2, columns: ['id', 'name'], durationMs: 1 }
            : { passed: false, reason: '通过但结果异常：输出 0 行', durationMs: 1 };
        },
      });
      expect(previews).toEqual(['empty', 'copy']);
      expect(result.changedFiles).toEqual(['src/transform.js']);
      expect(result.summary).toBe('改为读取全部数据行。');
      expect(result.lastCheck).toMatchObject({ passed: true });
    } finally {
      faux.unregister();
    }
  });
});
