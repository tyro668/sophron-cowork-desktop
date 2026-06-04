import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { DataCommandService } from '../src/main/data/data-command-service';
import { createDataTaskStore, type DataTaskStore } from '../src/main/data/data-task-store';
import type { InputTableNormalizerProjectGenerator } from '../src/main/data/input-table-normalizer-generator';
import { createInputTableNormalizerProjectTemplate } from '../src/shared/input-table-normalizer/templates';

const tempRoots: string[] = [];
const stores: DataTaskStore[] = [];

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

describe('DataCommandService', () => {
  it('creates input/output/task resources, saves workflow DSL, and runs the task', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n2,Bob\n', 'utf8');

    const input = await service.createInputTable({
      name: 'customers',
      sourceKind: 'csv',
      filePath: csvPath,
      previewRows: 2,
    });
    expect(input.inputTable.name).toBe('customers');
    expect(input.preview?.totalRows).toBe(2);

    const output = await service.createOutputTable({
      name: 'customers output',
      sourceInputTableId: input.inputTable.id,
    });
    expect(output.outputTable.name).toBe('customers output');
    expect(output.outputTable.rowCount).toBe(2);

    const task = await service.createTask({
      name: 'Copy customers',
      sourceInputTableId: input.inputTable.id,
      outputTableId: output.outputTable.id,
    });
    expect(task.task.sourceDatasetId).toBe(input.inputTable.id);
    expect(task.task.outputTable).toBe(output.outputTable.tableName);

    const listedInputTablesBeforeRun = await service.listInputTables({});
    const listedOutputTablesBeforeRun = await service.listOutputTables({});
    expect(listedInputTablesBeforeRun.inputTables[0]?.relatedTaskNames).toContain(
      'Copy customers'
    );
    expect(listedOutputTablesBeforeRun.outputTables[0]?.relatedTaskNames).toContain(
      'Copy customers'
    );

    const dsl = `
      input source dataset "${input.inputTable.id}" as customers

      from customers
        | output table "customers_copy" mode replace
    `;
    const dryRun = await service.applyWorkflowDsl({
      taskId: task.task.id,
      dsl,
      outputTableId: output.outputTable.id,
      dryRun: true,
    });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.workflow.nodes.map((node) => node.type)).toEqual(['input_source', 'output']);
    expect(dryRun.workflow.nodes.find((node) => node.type === 'output')?.config.outputDatasetId).toBe(
      output.outputTable.id
    );

    const saved = await service.applyWorkflowDsl({
      taskId: task.task.id,
      outputTableId: output.outputTable.id,
      dsl,
    });
    const outputNode = saved.workflow.nodes.find((node) => node.type === 'output');
    expect(outputNode?.config.outputDatasetId).toBe(output.outputTable.id);

    const temporaryRun = await service.runTask({
      taskId: task.task.id,
      mode: 'temporary',
      previewRows: 2,
    });
    expect(temporaryRun.task.status).toBe('completed');
    expect(temporaryRun.task.outputTable).toMatch(/^temp_task_/);
    expect(temporaryRun.preview?.totalRows).toBe(2);

    const persistedRun = await service.runTask({
      taskId: task.task.id,
      mode: 'persisted',
      previewRows: 2,
    });
    expect(persistedRun.task.status).toBe('completed');
    expect(persistedRun.task.sourceDatasetId).toBe(input.inputTable.id);
    expect(persistedRun.preview?.totalRows).toBe(2);

    const exported = await service.exportWorkflowDsl({ taskId: task.task.id });
    expect(exported.text).toContain(`input source dataset "${input.inputTable.id}" as customers`);

    const outputPreview = await service.previewTable({
      tableKind: 'output',
      id: output.outputTable.id,
      limit: 2,
    });
    expect(outputPreview.preview.totalRows).toBe(2);
    expect(outputPreview.preview.columns).toEqual(['id', 'name']);
  });

  it('rejects JSON workflow payloads with a clear DSL format diagnostic', async () => {
    const { service } = createService();
    const task = await service.createTask({ name: 'Bad DSL task' });

    const result = await service.applyWorkflowDsl({
      taskId: task.task.id,
      dryRun: true,
      dsl: '{"nodes":[],"edges":[]}',
    });

    expect(result.diagnostics?.[0]).toMatchObject({
      severity: 'error',
      code: 'invalidDslFormat',
    });
    expect(result.diagnostics?.[0]?.message).toContain('not JSON');
  });

  it('reports duplicate names with stable command errors', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');
    await service.createInputTable({ name: 'customers', filePath: csvPath });

    await expect(service.createInputTable({ name: 'customers', filePath: csvPath })).rejects.toThrow(
      '[RESOURCE_ALREADY_EXISTS]'
    );
  });

  it('generates, previews, publishes, and lists custom normalizer versions', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');

    const draft = await service.generateInputTableNormalizerDraft({
      name: 'customers normalizer',
      sourcePath: csvPath,
      sourceKind: 'csv',
      rulePrompt: 'Normalize the customer CSV into a standard table.',
      primaryLanguage: 'node',
    });

    expect(draft.version.status).toBe('draft');
    expect(draft.summary.fileCount).toBe(1);
    expect(draft.version.files.some((file) => file.path === 'src/cli.js')).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          tempRoot,
          'input-table-normalizers',
          'projects',
          draft.artifact.id,
          draft.version.id,
          'src',
          'cli.js'
        )
      )
    ).toBe(true);

    const preview = await service.previewInputTableNormalizerVersion({
      versionId: draft.version.id,
      sourcePath: csvPath,
      sourceKind: 'csv',
      prepareDependencies: false,
      limit: 5,
    });
    expect(preview.preview.totalRows).toBe(1);
    expect(preview.preview.columns).toEqual(['id', 'name']);
    expect(preview.preview.rows[0]).toEqual({ id: '1', name: 'Alice' });

    const published = await service.publishInputTableNormalizerVersion({
      versionId: draft.version.id,
    });
    expect(published.version.status).toBe('published');
    expect(published.artifact.activeVersionId).toBe(draft.version.id);

    const versions = await service.listInputTableNormalizerVersions({
      artifactId: draft.artifact.id,
    });
    expect(versions.versions).toHaveLength(1);
    expect(versions.versions[0]).toMatchObject({
      id: draft.version.id,
      status: 'published',
    });

    const secondDraft = await service.generateInputTableNormalizerDraft({
      artifactId: draft.artifact.id,
      name: 'customers normalizer',
      sourcePath: csvPath,
      sourceKind: 'csv',
      rulePrompt: 'Normalize the customer CSV into a standard table with a second draft.',
      primaryLanguage: 'node',
    });
    expect(secondDraft.version.status).toBe('draft');
    const secondDraftProjectDir = path.join(
      tempRoot,
      'input-table-normalizers',
      'projects',
      secondDraft.artifact.id,
      secondDraft.version.id
    );
    expect(fs.existsSync(secondDraftProjectDir)).toBe(true);

    await expect(
      service.deleteInputTableNormalizerVersion({
        versionId: published.version.id,
      })
    ).rejects.toThrow('Published normalizer versions cannot be deleted');

    await expect(
      service.deleteInputTableNormalizerVersion({
        versionId: secondDraft.version.id,
      })
    ).resolves.toEqual({ success: true });
    expect(fs.existsSync(secondDraftProjectDir)).toBe(false);

    const versionsAfterDelete = await service.listInputTableNormalizerVersions({
      artifactId: draft.artifact.id,
    });
    expect(versionsAfterDelete.versions).toHaveLength(1);
    expect(versionsAfterDelete.versions[0]?.id).toBe(published.version.id);
  });

  it('creates an input table through the custom processing strategy DSL', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n2,Bob\n', 'utf8');

    const result = await service.createInputTableWithProcessingStrategy({
      name: 'customers normalized',
      sourceKind: 'csv',
      filePath: csvPath,
      previewRows: 2,
      processingStrategy: {
        strategy: 'customize',
        rulePrompt: 'Normalize the customer CSV into a standard two-dimensional table.',
        primaryLanguage: 'node',
      },
    });

    expect(result.processingStrategy).toBe('customize');
    expect(result.normalizer?.publishedVersion.status).toBe('published');
    expect(result.inputTable.inputConfig.dataProcessing).toMatchObject({
      strategy: 'customize',
      artifactId: result.normalizer?.artifact.id,
      artifactVersionId: result.normalizer?.publishedVersion.id,
      artifactVersionStatus: 'published',
    });
    expect(result.preview?.columns).toEqual(['id', 'name']);
    expect(result.preview?.totalRows).toBe(2);
  });

  it('emits progress while generating a custom normalizer draft', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'customers.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');
    const progressEvents: Array<{ phase: string; kind: string; text: string }> = [];

    await service.generateInputTableNormalizerDraft({
      name: 'customers normalizer',
      sourcePath: csvPath,
      sourceKind: 'csv',
      rulePrompt: 'Normalize the customer CSV into a standard table.',
      primaryLanguage: 'node',
      onProgress: (event) => progressEvents.push(event),
    });

    expect(progressEvents.map((event) => event.phase)).toEqual(
      expect.arrayContaining(['source_summary', 'code_generation', 'saving', 'complete'])
    );
    expect(progressEvents).toContainEqual({
      phase: 'code_generation',
      kind: 'delta',
      text: 'fake generated project delta',
    });
  });

  it('generates a custom normalizer that flattens irregular Excel tables and dedupes headers', async () => {
    const { service, tempRoot } = createService();
    const excelPath = path.join(tempRoot, 'irregular.xlsx');
    writeWorkbook(excelPath, {
      Sheet1: [
        ['不规则表处理'],
        ['生成时间', '2026-06-03'],
        ['姓名', '姓名', '金额'],
        ['Alice', 'A-001', 100],
        ['Bob', 'B-002', 200],
      ],
    });

    const draft = await service.generateInputTableNormalizerDraft({
      name: '不规则表处理 normalizer',
      sourcePath: excelPath,
      sourceKind: 'excel',
      config: {
        sourceKind: 'excel',
        sheetName: 'Sheet1',
        sheetNames: ['Sheet1'],
        headerMode: 'auto',
        headerRow: 1,
      },
      rulePrompt: '把表格变成标准的二维表，列重复的时候，把第二个名字加个序号',
      primaryLanguage: 'node',
    });

    const preview = await service.previewInputTableNormalizerVersion({
      versionId: draft.version.id,
      sourcePath: excelPath,
      sourceKind: 'excel',
      config: {
        sourceKind: 'excel',
        sheetName: 'Sheet1',
        sheetNames: ['Sheet1'],
        headerMode: 'auto',
        headerRow: 1,
      },
      prepareDependencies: false,
      limit: 10,
    });

    expect(preview.preview.columns).toEqual(['姓名', '姓名_2', '金额']);
    expect(preview.preview.totalRows).toBe(2);
    expect(preview.preview.rows[0]).toEqual({ 姓名: 'Alice', 姓名_2: 'A-001', 金额: '100' });
  });

  it('generates a custom normalizer that preserves Chinese two-level Excel headers', async () => {
    const { service, tempRoot } = createService();
    const excelPath = path.join(tempRoot, 'two-level-header.xlsx');
    writeWorkbookWithMerges(
      excelPath,
      {
        Sheet1: [
          [null, '9.35971E+11', null, null, null, null, null],
          ['时间\n顺着填', '整体数据', null, null, '手淘搜索', null, null],
          [null, '总访客', '总支付\n人数', '转化率', '访客数', '支付人数', '转化率'],
          ['5/1/26', '1,473', '223', '15.14%', '159', '38', '23.90%'],
          ['5/2/26', '1,280', '146', '11.41%', '246', '43', '17.48%'],
        ],
      },
      {
        Sheet1: ['A2:A3', 'B2:D2', 'E2:G2'],
      }
    );

    const config = {
      sourceKind: 'excel' as const,
      sheetName: 'Sheet1',
      sheetNames: ['Sheet1'],
      headerMode: 'auto' as const,
      headerRow: 1,
    };
    const draft = await service.generateInputTableNormalizerDraft({
      name: '两层表头 normalizer',
      sourcePath: excelPath,
      sourceKind: 'excel',
      config,
      rulePrompt:
        '把表格变成标准的二维表，列重复的时候，把第二个名字加个序号，保留中文的列名信息，有两层表头的情况，用第一层-第二次名字，这种形式表示表头',
      primaryLanguage: 'node',
    });

    const generatedTransform = draft.version.files.find((file) => file.path === 'src/transform.js')
      ?.content;
    expect(generatedTransform).toContain('export async function transform');
    expect(generatedTransform).toContain('buildColumns');
    expect(generatedTransform).not.toContain('This project is a scaffold');

    const preview = await service.previewInputTableNormalizerVersion({
      versionId: draft.version.id,
      sourcePath: excelPath,
      sourceKind: 'excel',
      config,
      prepareDependencies: false,
      limit: 10,
    });

    expect(preview.preview.columns).toEqual([
      '时间 顺着填',
      '整体数据-总访客',
      '整体数据-总支付 人数',
      '整体数据-转化率',
      '手淘搜索-访客数',
      '手淘搜索-支付人数',
      '手淘搜索-转化率',
    ]);
    expect(preview.preview.totalRows).toBe(2);
    expect(preview.preview.rows[0]?.['时间 顺着填']).toBeTruthy();
    expect(preview.preview.rows[0]).toMatchObject({
      '整体数据-总访客': '1,473',
      '整体数据-总支付 人数': '223',
      '整体数据-转化率': '15.14%',
      '手淘搜索-访客数': '159',
      '手淘搜索-支付人数': '38',
      '手淘搜索-转化率': '23.90%',
    });
  });

  it('previews normalizer CSV output with quoted multiline headers', async () => {
    const { service, tempRoot } = createService();
    const csvPath = path.join(tempRoot, 'source.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n', 'utf8');
    const draft = await service.generateInputTableNormalizerDraft({
      name: '多行表头输出 normalizer',
      sourcePath: csvPath,
      sourceKind: 'csv',
      rulePrompt: 'quoted multiline header output',
      primaryLanguage: 'node',
    });

    const preview = await service.previewInputTableNormalizerVersion({
      versionId: draft.version.id,
      sourcePath: csvPath,
      sourceKind: 'csv',
      prepareDependencies: false,
      limit: 5,
    });

    expect(preview.preview.totalRows).toBe(1);
    expect(preview.preview.columns).toEqual(['时间\n顺着填', '整体数据-总支付\n人数']);
    expect(preview.preview.rows[0]).toMatchObject({
      '时间\n顺着填': '5/1/26',
      '整体数据-总支付\n人数': '223',
    });
  });

  it('summarizes a multi-sheet Excel file with bounded header candidates', async () => {
    const { service, tempRoot } = createService();
    const excelPath = path.join(tempRoot, 'finance-report.xlsx');
    writeWorkbook(excelPath, {
      Summary: [
        ['Finance Report'],
        ['Generated by test'],
        ['Department', 'Month', 'Amount'],
        ['Sales', '2026-01', 100],
        ['Support', '2026-01', 50],
      ],
      Details: [
        ['Region', 'Employee', 'Month', 'Amount'],
        ['East', 'Alice', '2026-01', 10],
        ['West', 'Bob', '2026-01', 20],
      ],
    });

    const result = await service.summarizeInputTableSource({
      sourcePath: excelPath,
      sourceKind: 'excel',
      maxSheetsPerFile: 2,
      maxRowsPerSheet: 5,
      maxColumnsPerRow: 4,
    });

    expect(result.summary.sourceKind).toBe('excel');
    expect(result.summary.fileCount).toBe(1);
    expect(result.summary.files[0]?.sheets?.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'Details',
    ]);
    expect(result.summary.files[0]?.sheets?.[0]?.headerCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 3,
          values: ['Department', 'Month', 'Amount'],
        }),
      ])
    );
    expect(result.summary.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('summarizes a folder and generates a normalizer draft with the summary hash', async () => {
    const { service, tempRoot } = createService();
    const folderPath = path.join(tempRoot, 'monthly');
    fs.mkdirSync(folderPath);
    fs.writeFileSync(path.join(folderPath, 'jan.csv'), 'id,amount\n1,10\n', 'utf8');
    fs.writeFileSync(path.join(folderPath, 'feb.csv'), 'id,amount\n2,20\n', 'utf8');

    const summary = await service.summarizeInputTableSource({
      sourcePath: folderPath,
      sourceKind: 'folder',
      maxFiles: 1,
      maxRowsPerSheet: 2,
    });
    expect(summary.summary.sourceKind).toBe('folder');
    expect(summary.summary.fileCount).toBe(2);
    expect(summary.summary.sampledFileCount).toBe(1);
    expect(summary.summary.truncated).toBe(true);
    expect(summary.summary.files[0]?.sampleRows?.[0]).toEqual(['id', 'amount']);

    const draft = await service.generateInputTableNormalizerDraft({
      name: 'monthly normalizer',
      sourcePath: folderPath,
      sourceKind: 'folder',
      rulePrompt: 'Combine monthly CSV files into a standard table.',
      primaryLanguage: 'node',
    });
    expect(draft.summary.fileCount).toBe(2);
    expect(draft.version.sourceSummaryHash).toBe(draft.summary.hash);
    expect(draft.version.files.map((file) => file.path)).toContain('package-lock.json');
  });

  it('samples 20 source rows and Excel merge metadata before generating a normalizer draft', async () => {
    const { service, tempRoot } = createService();
    const excelPath = path.join(tempRoot, 'merged-report.xlsx');
    writeWorkbookWithMerges(
      excelPath,
      {
        Sheet1: [
          ['报表标题', null, null],
          ['分组', null, '金额'],
          ['姓名', '编号', '金额'],
          ...Array.from({ length: 24 }, (_, index) => [
            `客户${index + 1}`,
            `C-${String(index + 1).padStart(3, '0')}`,
            index + 1,
          ]),
        ],
      },
      {
        Sheet1: ['A1:C1', 'A2:B2'],
      }
    );

    const draft = await service.generateInputTableNormalizerDraft({
      name: '合并单元格 normalizer',
      sourcePath: excelPath,
      sourceKind: 'excel',
      rulePrompt: '分析合并单元格和前 20 行，再生成标准二维表处理代码',
      primaryLanguage: 'node',
    });

    const sheet = draft.summary.files[0]?.sheets?.[0];
    expect(sheet?.sampleRows).toHaveLength(20);
    expect(sheet?.sampleRows[0]).toEqual(['报表标题', '报表标题', '报表标题']);
    expect(sheet?.mergedCells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          range: 'A1:C1',
          startRow: 1,
          endRow: 1,
          startColumn: 1,
          endColumn: 3,
          value: '报表标题',
        }),
        expect.objectContaining({
          range: 'A2:B2',
          value: '分组',
        }),
      ])
    );
  });
});

function createService(): { service: DataCommandService; store: DataTaskStore; tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-data-command-'));
  tempRoots.push(tempRoot);
  const store = createDataTaskStore(path.join(tempRoot, 'workspace.duckdb'), {
    now: () => 1_780_000_000_000,
  });
  stores.push(store);
  return {
    service: new DataCommandService(store, createFakeNormalizerGenerator()),
    store,
    tempRoot,
  };
}

function createFakeNormalizerGenerator(): InputTableNormalizerProjectGenerator {
  return {
    async generate(input) {
      const template = createInputTableNormalizerProjectTemplate(input.primaryLanguage, input.rulePrompt);
      input.onProgress?.({
        phase: 'code_generation',
        kind: 'delta',
        text: 'fake generated project delta',
      });
      return {
        ...template,
        files: template.files.map((file) =>
          file.path === 'src/transform.js'
            ? {
                ...file,
                content: input.rulePrompt.includes('quoted multiline header output')
                  ? GENERATED_NODE_MULTILINE_HEADER_OUTPUT_TRANSFORM
                  : GENERATED_NODE_NORMALIZER_TRANSFORM,
              }
            : file
        ),
      };
    },
  };
}

const GENERATED_NODE_NORMALIZER_TRANSFORM = String.raw`
import { readFile } from "node:fs/promises";

export async function transform(context, outputDir) {
  await outputDir.mkdir({ recursive: true });
  const outputPath = outputDir.join("normalized.csv");
  const rows = [];
  const columns = [];
  for (const source of collectSources(context)) {
    const sourceRows = parseCsv(await readFile(source.path, "utf8"));
    const headerIndex = chooseHeaderIndex(sourceRows, source);
    const sourceColumns = buildColumns(sourceRows, headerIndex);
    for (const column of sourceColumns) {
      if (!columns.includes(column)) columns.push(column);
    }
    for (const row of sourceRows.slice(headerIndex + 1)) {
      if (!row.some((cell) => String(cell ?? "").trim())) continue;
      const record = {};
      sourceColumns.forEach((column, index) => {
        record[column] = String(row[index] ?? "").trim();
      });
      rows.push(record);
    }
  }
  if (columns.length === 0) columns.push("empty");
  const csvRows = [
    columns,
    ...rows.map((row) => columns.map((column) => row[column] ?? "")),
  ];
  await outputPath.writeFile(csvRows.map((row) => row.map(escapeCsvCell).join(",")).join("\n") + "\n", "utf8");
  return {
    output: outputPath.toString(),
    format: "csv",
    rowCount: rows.length,
    columns: columns.map((name) => ({ name, type: "string" })),
    warnings: [],
  };
}

function collectSources(context) {
  if (Array.isArray(context.preparedSources?.files)) return context.preparedSources.files;
  return [{ path: context.sourcePath }];
}

function chooseHeaderIndex(rows, source) {
  const candidates = Array.isArray(source.headerCandidates) ? source.headerCandidates : [];
  const scoredCandidates = candidates
    .map((candidate) => {
      const rowNumber = Number(candidate.rowNumber || 1);
      const row = rows[rowNumber - 1] ?? [];
      return {
        rowNumber,
        score: Number(candidate.nonEmptyCellCount || 0) * 100 + labelCount(row) * 10,
      };
    })
    .sort((left, right) => right.score - left.score || right.rowNumber - left.rowNumber);
  if (scoredCandidates[0]) return scoredCandidates[0].rowNumber - 1;
  let bestIndex = 0;
  let bestScore = -1;
  rows.forEach((row, index) => {
    const nonEmpty = row.filter((cell) => String(cell ?? "").trim()).length;
    const score = nonEmpty * 100 + labelCount(row) * 10 - index;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function buildColumns(rows, headerIndex) {
  const leaf = rows[headerIndex] ?? [];
  const parent = rows[headerIndex - 1] ?? [];
  const useParent = shouldUseParent(parent, leaf);
  const rawColumns = Array.from({ length: Math.max(leaf.length, useParent ? parent.length : 0) }, (_, index) => {
    const parentName = useParent ? normalizeHeader(parent[index]) : "";
    const leafName = normalizeHeader(leaf[index]);
    if (parentName && leafName && parentName !== leafName) return parentName + "-" + leafName;
    return leafName || parentName || "column_" + (index + 1);
  });
  return dedupe(rawColumns);
}

function shouldUseParent(parent, leaf) {
  const parentValues = parent.map(normalizeHeader).filter(Boolean);
  const leafValues = leaf.map(normalizeHeader).filter(Boolean);
  if (parentValues.length < 2 || leafValues.length < 2) return false;
  const repeated = new Set(parentValues).size < parentValues.length;
  const coverage = parentValues.length >= Math.max(2, Math.ceil(leafValues.length * 0.75));
  return repeated || coverage;
}

function dedupe(names) {
  const used = new Map();
  return names.map((name, index) => {
    const base = normalizeHeader(name) || "column_" + (index + 1);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    if (count === 1) return base;
    return base + "_" + count;
  });
}

function labelCount(row) {
  return row.filter((cell) => {
    const text = normalizeHeader(cell);
    return text && !/^-?\d{1,3}(,\d{3})*(\.\d+)?%?$/.test(text) && !/^\d{1,4}[/-]\d{1,2}([/-]\d{1,4})?$/.test(text);
  }).length;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"") {
      if (quoted && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? "\"" + text.replace(/"/g, "\"\"") + "\"" : text;
}
`;

const GENERATED_NODE_MULTILINE_HEADER_OUTPUT_TRANSFORM = String.raw`
export async function transform(_context, outputDir) {
  await outputDir.mkdir({ recursive: true });
  const outputPath = outputDir.join("normalized.csv");
  await outputPath.writeFile('"时间\n顺着填","整体数据-总支付\n人数"\n5/1/26,223\n', "utf8");
  return {
    output: outputPath.toString(),
    format: "csv",
    rowCount: 1,
    columns: [
      { name: "时间\n顺着填", type: "string" },
      { name: "整体数据-总支付\n人数", type: "string" },
    ],
    warnings: [],
  };
}
`;

function writeWorkbook(filePath: string, sheets: Record<string, unknown[][]>): void {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  XLSX.writeFile(workbook, filePath);
}

function writeWorkbookWithMerges(
  filePath: string,
  sheets: Record<string, unknown[][]>,
  merges: Record<string, string[]>
): void {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!merges'] = (merges[name] ?? []).map((range) => XLSX.utils.decode_range(range));
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  }
  XLSX.writeFile(workbook, filePath);
}
