import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createRawTableNormalizerProjectTemplate,
  createNormalizerDependencyLockHash,
  createNormalizerFileTreeHash,
} from '../src/shared/raw-table-normalizer/templates';
import { parseRawTableNormalizerManifest } from '../src/shared/raw-table-normalizer/manifest';
import { runRawTableNormalizerProject } from '../src/main/data/raw-table-normalizer-runner';
import { validateGeneratedNormalizerProjectFiles } from '../src/main/data/raw-table-normalizer-generator';
import type { DataRawTableNormalizerArtifactVersion } from '../src/renderer/types';

describe('input table normalizer templates', () => {
  it('creates a standard Python project with the shared entrypoint contract', () => {
    const template = createRawTableNormalizerProjectTemplate(
      'python',
      'Normalize all workbook sheets into one table.'
    );

    expect(template.primaryLanguage).toBe('python');
    expect(template.runtime).toMatchObject({ language: 'python', environment: 'venv' });
    expect(template.entrypoint.command).toEqual([
      '${preparedRuntime}',
      '-m',
      'normalizer.cli',
      '--context',
      '${context}',
      '--manifest',
      '${manifest}',
      '--output',
      '${outputDir}',
    ]);
    expect(template.dependencyPrepare.lockFiles).toEqual(['requirements.lock']);
    expect(template.files.map((file) => file.path)).toEqual([
      'pyproject.toml',
      'requirements.lock',
      'normalizer/__init__.py',
      'normalizer/transform.py',
      'normalizer/cli.py',
      'tests/fixtures/context.json',
    ]);
  });

  it('creates a standard Node project with lock file metadata', () => {
    const template = createRawTableNormalizerProjectTemplate('node', 'Read Csv files.');

    expect(template.primaryLanguage).toBe('node');
    expect(template.runtime).toMatchObject({ language: 'node', environment: 'npm' });
    expect(template.entrypoint.command).toEqual([
      '${preparedRuntime}',
      'src/cli.js',
      '--context',
      '${context}',
      '--manifest',
      '${manifest}',
      '--output',
      '${outputDir}',
    ]);
    expect(template.dependencyPrepare.lockFiles).toEqual(['package-lock.json']);
    expect(template.files.some((file) => file.path === 'package-lock.json')).toBe(true);
  });

  it('computes stable file tree and dependency lock hashes', () => {
    const template = createRawTableNormalizerProjectTemplate('python', 'Rule A');
    const sameTemplate = createRawTableNormalizerProjectTemplate('python', 'Rule A');
    const changedTemplate = createRawTableNormalizerProjectTemplate('python', 'Rule B');

    expect(createNormalizerFileTreeHash(template.files)).toBe(
      createNormalizerFileTreeHash(sameTemplate.files)
    );
    expect(createNormalizerFileTreeHash(template.files)).not.toBe(
      createNormalizerFileTreeHash(changedTemplate.files)
    );
    expect(createNormalizerDependencyLockHash(template.files)).toBe(
      createNormalizerDependencyLockHash(changedTemplate.files)
    );
  });

  it('rejects Python transforms that combine max default with multiple arguments', () => {
    expect(() =>
      validateGeneratedNormalizerProjectFiles(
        [
          {
            path: 'normalizer/transform.py',
            content: [
              'from pathlib import Path',
              'from typing import Any',
              '',
              'def transform(context: dict[str, Any], output_dir: Path) -> dict[str, Any]:',
              '    top_row = []',
              '    sub_row = []',
              '    max_cols = max(len(top_row), len(sub_row), default=0)',
              '    return {"output": "normalized.csv", "format": "csv", "rowCount": 0, "columns": [{"name": "empty"}]}',
              '',
            ].join('\n'),
          },
        ],
        'python'
      )
    ).toThrow('invalid max');
  });

  it('allows Python transforms that use max default with an iterable', () => {
    expect(() =>
      validateGeneratedNormalizerProjectFiles(
        [
          {
            path: 'normalizer/transform.py',
            content: [
              'from pathlib import Path',
              'from typing import Any',
              '',
              'def transform(context: dict[str, Any], output_dir: Path) -> dict[str, Any]:',
              '    top_row = []',
              '    sub_row = []',
              '    max_cols = max([len(top_row), len(sub_row)], default=0)',
              '    return {"output": "normalized.csv", "format": "csv", "rowCount": 0, "columns": [{"name": "empty"}]}',
              '',
            ].join('\n'),
          },
        ],
        'python'
      )
    ).not.toThrow();
  });

  it('ignores Python code-like text in comments and strings during AST validation', () => {
    expect(() =>
      validateGeneratedNormalizerProjectFiles(
        [
          {
            path: 'normalizer/transform.py',
            content: [
              '# max(first, second, default=0)',
              'def transform(context, output_dir):',
              '    note = "max(first, second, default=0)"',
              '    return {"output": "normalized.csv", "format": "csv", "rowCount": 0, "columns": [{"name": note}]}',
            ].join('\n'),
          },
        ],
        'python'
      )
    ).not.toThrow();
  });

  it('does not accept transform declarations that only appear in comments', () => {
    expect(() =>
      validateGeneratedNormalizerProjectFiles(
        [
          {
            path: 'src/transform.js',
            content: '// export async function transform(context, outputDir) {}',
          },
        ],
        'node'
      )
    ).toThrow('must export async function transform');
  });

  it('validates the exported Node transform signature from its AST', () => {
    expect(() =>
      validateGeneratedNormalizerProjectFiles(
        [
          {
            path: 'src/transform.js',
            content:
              'export async function transform(context, outputDir) { return { output: "normalized.csv" }; }',
          },
        ],
        'node'
      )
    ).not.toThrow();
  });
});

describe('input table normalizer manifest', () => {
  it('parses a valid manifest and normalizes columns', () => {
    const manifest = parseRawTableNormalizerManifest({
      output: 'normalized.csv',
      format: 'csv',
      rowCount: 2,
      columns: [{ name: ' id ', type: 'integer', nullable: false }, { name: 'name' }],
      warnings: ['draft output'],
    });

    expect(manifest).toEqual({
      output: 'normalized.csv',
      format: 'csv',
      rowCount: 2,
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'name', type: 'string', nullable: undefined },
      ],
      warnings: ['draft output'],
    });
  });

  it('accepts generated manifests that return string column names', () => {
    const manifest = parseRawTableNormalizerManifest({
      output: 'normalized.csv',
      format: 'csv',
      rowCount: 1,
      columns: [' 姓名 ', '整体数据-总访客'],
      warnings: [],
    });

    expect(manifest.columns).toEqual([
      { name: '姓名', type: 'string', nullable: undefined },
      { name: '整体数据-总访客', type: 'string', nullable: undefined },
    ]);
  });

  it('rejects invalid manifests with actionable messages', () => {
    expect(() =>
      parseRawTableNormalizerManifest({
        output: 'normalized.csv',
        format: 'xlsx',
        columns: [{ name: 'id' }],
      })
    ).toThrow('format must be csv or parquet');

    expect(() =>
      parseRawTableNormalizerManifest({
        output: 'normalized.csv',
        format: 'csv',
        columns: [],
      })
    ).toThrow('at least one column');
  });
});

describe('input table normalizer runner', () => {
  it('runs a generated Node normalizer project and reads its manifest output', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-normalizer-test-'));
    const sourcePath = path.join(tempRoot, 'source.csv');
    fs.writeFileSync(sourcePath, 'id,name,name\n1,Alice,Alicia\n', 'utf8');
    const template = createRawTableNormalizerProjectTemplate(
      'node',
      '把表格变成标准的二维表，列重复的时候，把第二个名字加个序号'
    );
    const files = template.files.map((file) =>
      file.path === 'src/transform.js'
        ? { ...file, content: GENERATED_NODE_NORMALIZER_TRANSFORM }
        : file
    );
    const version: DataRawTableNormalizerArtifactVersion = {
      id: 'version_1',
      artifactId: 'artifact_1',
      version: 1,
      status: 'draft',
      source: 'rule',
      commit: '',
      tree: {},
      files,
      fileTreeHash: createNormalizerFileTreeHash(files),
      rulePrompt: '把表格变成标准的二维表，列重复的时候，把第二个名字加个序号',
      sourceSummaryHash: 'summary_hash',
      entrypoint: template.entrypoint,
      dependencyPrepare: template.dependencyPrepare,
      runtime: template.runtime,
      dependencies: template.dependencies,
      dependencyLockHash: createNormalizerDependencyLockHash(files),
      createdAt: 1,
      updatedAt: 1,
      publishedAt: null,
    };

    let result: Awaited<ReturnType<typeof runRawTableNormalizerProject>> | null = null;
    try {
      result = await runRawTableNormalizerProject({
        version,
        prepareDependencies: false,
        timeoutMs: 15_000,
        context: {
          sourcePath,
          sourceKind: 'csv',
        },
      });
      expect(result.manifest).toMatchObject({
        format: 'csv',
        rowCount: 1,
        columns: [
          { name: 'id', type: 'string' },
          { name: 'name', type: 'string' },
          { name: 'name_2', type: 'string' },
        ],
      });
      expect(fs.existsSync(result.manifest.output)).toBe(true);
      expect(fs.readFileSync(result.manifest.output, 'utf8')).toContain('1,Alice,Alicia');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]).toMatchObject({
        command: expect.arrayContaining(['src/cli.js']),
        exitCode: 0,
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      if (result) {
        fs.rmSync(result.workDir, { recursive: true, force: true });
      }
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('runs a normalizer project from an app data workspace when provided', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-normalizer-workspace-test-'));
    const sourcePath = path.join(tempRoot, 'source.csv');
    const workspaceRoot = path.join(tempRoot, 'data', 'raw-table-normalizers', 'runs');
    fs.writeFileSync(sourcePath, 'id,name\n1,Alice\n', 'utf8');
    const template = createRawTableNormalizerProjectTemplate('node', 'Normalize Csv.');
    const files = template.files.map((file) =>
      file.path === 'src/transform.js'
        ? { ...file, content: GENERATED_NODE_NORMALIZER_TRANSFORM }
        : file
    );
    const version: DataRawTableNormalizerArtifactVersion = {
      id: 'version_workspace',
      artifactId: 'artifact_workspace',
      version: 1,
      status: 'draft',
      source: 'rule',
      commit: '',
      tree: {},
      files,
      fileTreeHash: createNormalizerFileTreeHash(files),
      rulePrompt: 'Normalize Csv.',
      sourceSummaryHash: 'summary_hash',
      entrypoint: template.entrypoint,
      dependencyPrepare: template.dependencyPrepare,
      runtime: template.runtime,
      dependencies: template.dependencies,
      dependencyLockHash: createNormalizerDependencyLockHash(files),
      createdAt: 1,
      updatedAt: 1,
      publishedAt: null,
    };

    let result: Awaited<ReturnType<typeof runRawTableNormalizerProject>> | null = null;
    try {
      result = await runRawTableNormalizerProject({
        version,
        workspaceRoot,
        prepareDependencies: false,
        timeoutMs: 15_000,
        context: {
          sourcePath,
          sourceKind: 'csv',
        },
      });
      expect(result.cleanupWorkDir).toBe(false);
      expect(result.workDir.startsWith(workspaceRoot)).toBe(true);
      expect(fs.existsSync(path.join(result.workDir, 'src', 'cli.js'))).toBe(true);
      expect(fs.existsSync(path.join(result.workDir, 'output', 'normalized.csv'))).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('skips Python venv preparation when requirements are empty', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-normalizer-python-test-'));
    const sourcePath = path.join(tempRoot, 'source.csv');
    const workspaceRoot = path.join(tempRoot, 'data', 'raw-table-normalizers', 'runs');
    fs.writeFileSync(sourcePath, 'id,name\n1,Alice\n', 'utf8');
    const template = createRawTableNormalizerProjectTemplate('python', 'Normalize Csv.');
    const files = template.files.map((file) =>
      file.path === 'normalizer/transform.py'
        ? { ...file, content: GENERATED_PYTHON_NORMALIZER_TRANSFORM }
        : file
    );
    const version: DataRawTableNormalizerArtifactVersion = {
      id: 'version_python',
      artifactId: 'artifact_python',
      version: 1,
      status: 'draft',
      source: 'rule',
      commit: '',
      tree: {},
      files,
      fileTreeHash: createNormalizerFileTreeHash(files),
      rulePrompt: 'Normalize Csv.',
      sourceSummaryHash: 'summary_hash',
      entrypoint: template.entrypoint,
      dependencyPrepare: template.dependencyPrepare,
      runtime: template.runtime,
      dependencies: template.dependencies,
      dependencyLockHash: createNormalizerDependencyLockHash(files),
      createdAt: 1,
      updatedAt: 1,
      publishedAt: null,
    };

    try {
      const result = await runRawTableNormalizerProject({
        version,
        workspaceRoot,
        prepareDependencies: true,
        timeoutMs: 15_000,
        context: {
          sourcePath,
          sourceKind: 'csv',
        },
      });
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]?.command).toEqual(expect.arrayContaining(['-m', 'normalizer.cli']));
      expect(result.steps[0]?.command).not.toEqual(expect.arrayContaining(['venv']));
      expect(result.manifest).toMatchObject({
        format: 'csv',
        rowCount: 1,
        columns: [
          { name: 'id', type: 'string' },
          { name: 'name', type: 'string' },
        ],
      });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('prepares Node dependencies in the persisted project directory', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-normalizer-project-test-'));
    const sourcePath = path.join(tempRoot, 'source.csv');
    const workspaceRoot = path.join(tempRoot, 'data', 'raw-table-normalizers', 'runs');
    const projectRoot = path.join(
      tempRoot,
      'data',
      'raw-table-normalizers',
      'projects',
      'artifact_project',
      'version_project'
    );
    fs.writeFileSync(sourcePath, 'id,name\n1,Alice\n', 'utf8');
    const template = createRawTableNormalizerProjectTemplate('node', 'Normalize Csv.');
    const files = template.files.map((file) =>
      file.path === 'src/transform.js'
        ? { ...file, content: GENERATED_NODE_NORMALIZER_TRANSFORM }
        : file
    );
    const version: DataRawTableNormalizerArtifactVersion = {
      id: 'version_project',
      artifactId: 'artifact_project',
      version: 1,
      status: 'draft',
      source: 'rule',
      commit: '',
      tree: {},
      files,
      fileTreeHash: createNormalizerFileTreeHash(files),
      rulePrompt: 'Normalize Csv.',
      sourceSummaryHash: 'summary_hash',
      entrypoint: template.entrypoint,
      dependencyPrepare: template.dependencyPrepare,
      runtime: template.runtime,
      dependencies: template.dependencies,
      dependencyLockHash: createNormalizerDependencyLockHash(files),
      createdAt: 1,
      updatedAt: 1,
      publishedAt: null,
    };

    try {
      const result = await runRawTableNormalizerProject({
        version,
        projectRoot,
        workspaceRoot,
        prepareDependencies: true,
        timeoutMs: 30_000,
        context: {
          sourcePath,
          sourceKind: 'csv',
        },
      });
      expect(result.projectDir).toBe(projectRoot);
      expect(result.workDir.startsWith(workspaceRoot)).toBe(true);
      expect(result.workDir).not.toBe(projectRoot);
      expect(result.steps[0]).toMatchObject({
        command: ['npm', 'ci'],
        cwd: projectRoot,
      });
      expect(result.steps[1].cwd).toBe(projectRoot);
      expect(fs.existsSync(path.join(result.workDir, 'node_modules'))).toBe(false);
      expect(fs.existsSync(path.join(result.workDir, 'output', 'normalized.csv'))).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

const GENERATED_PYTHON_NORMALIZER_TRANSFORM = String.raw`
from __future__ import annotations

import csv
from pathlib import Path
from typing import Any


def transform(context: dict[str, Any], output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "normalized.csv"
    with open(context["sourcePath"], newline="", encoding="utf-8") as source:
        rows = list(csv.reader(source))
    columns = rows[0] if rows else []
    records = rows[1:]
    with open(output_path, "w", newline="", encoding="utf-8") as target:
        writer = csv.writer(target)
        writer.writerow(columns)
        writer.writerows(records)
    return {
        "output": "normalized.csv",
        "format": "csv",
        "rowCount": len(records),
        "columns": [{"name": column, "type": "string"} for column in columns],
    }
`;

const GENERATED_NODE_NORMALIZER_TRANSFORM = String.raw`
import { readFile } from "node:fs/promises";

export async function transform(context, outputDir) {
  await outputDir.mkdir({ recursive: true });
  const outputPath = outputDir.join("normalized.csv");
  const rows = parseCsv(await readFile(context.sourcePath, "utf8"));
  const columns = dedupe(rows[0] ?? []);
  const records = rows.slice(1);
  await outputPath.writeFile(
    [columns, ...records].map((row) => row.map(escapeCsvCell).join(",")).join("\n") + "\n",
    "utf8"
  );
  return {
    output: outputPath.toString(),
    format: "csv",
    rowCount: records.length,
    columns: columns.map((name) => ({ name, type: "string" })),
    warnings: [],
  };
}

function dedupe(values) {
  const used = new Map();
  return values.map((value, index) => {
    const base = String(value ?? "").trim() || "column_" + (index + 1);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : base + "_" + count;
  });
}

function parseCsv(text) {
  return text.trim().split(/\r?\n/).map((line) => line.split(","));
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? "\"" + text.replace(/"/g, "\"\"") + "\"" : text;
}
`;
