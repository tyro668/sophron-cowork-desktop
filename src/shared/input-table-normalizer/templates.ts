import type {
  DataNormalizerDependencyPrepareConfig,
  DataNormalizerDependencySpec,
  DataNormalizerEntrypoint,
  DataNormalizerLanguage,
  DataNormalizerProjectFile,
  DataNormalizerRuntime,
} from '../../shared/contracts';

export interface InputTableNormalizerProjectTemplate {
  primaryLanguage: DataNormalizerLanguage;
  runtime: DataNormalizerRuntime;
  entrypoint: DataNormalizerEntrypoint;
  dependencyPrepare: DataNormalizerDependencyPrepareConfig;
  dependencies: DataNormalizerDependencySpec[];
  files: DataNormalizerProjectFile[];
}

export function createInputTableNormalizerProjectTemplate(
  language: DataNormalizerLanguage,
  rulePrompt: string
): InputTableNormalizerProjectTemplate {
  return language === 'node'
    ? createNodeNormalizerProjectTemplate(rulePrompt)
    : createPythonNormalizerProjectTemplate(rulePrompt);
}

export function createNormalizerFileTreeHash(files: DataNormalizerProjectFile[]): string {
  return createStableTextHash(files.map((file) => `${file.path}\n${file.content}`).join('\n\n'));
}

export function createNormalizerDependencyLockHash(files: DataNormalizerProjectFile[]): string {
  const lockFiles = files.filter(
    (file) =>
      file.path === 'requirements.lock' ||
      file.path === 'package-lock.json' ||
      file.path.endsWith('/requirements.lock') ||
      file.path.endsWith('/package-lock.json')
  );
  return createStableTextHash(
    lockFiles.map((file) => `${file.path}\n${file.content}`).join('\n\n')
  );
}

export function createStableTextHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createPythonNormalizerProjectTemplate(
  rulePrompt: string
): InputTableNormalizerProjectTemplate {
  return {
    primaryLanguage: 'python',
    runtime: { language: 'python', environment: 'venv', executable: 'python3' },
    dependencyPrepare: {
      steps: [
        { command: ['${runtime}', '-m', 'venv', '${envDir}'] },
        { command: ['${envPython}', '-m', 'pip', 'install', '-r', 'requirements.lock'] },
      ],
      preparedRuntime: '${envPython}',
      lockFiles: ['requirements.lock'],
    },
    entrypoint: {
      cwd: '.',
      command: [
        '${preparedRuntime}',
        '-m',
        'normalizer.cli',
        '--context',
        '${context}',
        '--manifest',
        '${manifest}',
        '--output',
        '${outputDir}',
      ],
    },
    dependencies: [],
    files: createPythonNormalizerProjectFiles(rulePrompt),
  };
}

function createNodeNormalizerProjectTemplate(
  rulePrompt: string
): InputTableNormalizerProjectTemplate {
  return {
    primaryLanguage: 'node',
    runtime: { language: 'node', environment: 'npm', executable: 'node' },
    dependencyPrepare: {
      steps: [{ command: ['npm', 'ci'] }],
      preparedRuntime: 'node',
      lockFiles: ['package-lock.json'],
    },
    entrypoint: {
      cwd: '.',
      command: [
        '${preparedRuntime}',
        'src/cli.js',
        '--context',
        '${context}',
        '--manifest',
        '${manifest}',
        '--output',
        '${outputDir}',
      ],
    },
    dependencies: [],
    files: createNodeNormalizerProjectFiles(rulePrompt),
  };
}

function createPythonNormalizerProjectFiles(rulePrompt: string): DataNormalizerProjectFile[] {
  const encodedRulePrompt = JSON.stringify(rulePrompt);
  return [
    {
      path: 'pyproject.toml',
      content: [
        '[project]',
        'name = "input-table-normalizer"',
        'version = "0.1.0"',
        'requires-python = ">=3.9"',
        'dependencies = []',
        '',
        '[tool.pytest.ini_options]',
        'testpaths = ["tests"]',
        '',
      ].join('\n'),
    },
    {
      path: 'requirements.lock',
      content: '# Add pinned dependencies here, for example: openpyxl==3.1.5\n',
    },
    {
      path: 'normalizer/__init__.py',
      content: '__all__ = ["transform"]\n',
    },
    {
      path: 'normalizer/transform.py',
      content: createPythonNormalizerTransformContent(encodedRulePrompt),
    },
    {
      path: 'normalizer/cli.py',
      content: [
        'from __future__ import annotations',
        '',
        'import argparse',
        'import json',
        'from pathlib import Path',
        '',
        'from normalizer.transform import transform',
        '',
        '',
        'def main() -> None:',
        '    parser = argparse.ArgumentParser(description="Normalize an input table source.")',
        '    parser.add_argument("--context", required=True)',
        '    parser.add_argument("--manifest", required=True)',
        '    parser.add_argument("--output", required=True)',
        '    args = parser.parse_args()',
        '',
        '    context = json.loads(Path(args.context).read_text(encoding="utf-8"))',
        '    manifest = transform(context, Path(args.output))',
        '    manifest_path = Path(args.manifest)',
        '    manifest_path.parent.mkdir(parents=True, exist_ok=True)',
        '    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")',
        '',
        '',
        'if __name__ == "__main__":',
        '    main()',
        '',
      ].join('\n'),
    },
    {
      path: 'tests/fixtures/context.json',
      content: `${JSON.stringify({ sourcePath: './fixtures/source.xlsx', sourceKind: 'excel' }, null, 2)}\n`,
    },
  ];
}

function createNodeNormalizerProjectFiles(rulePrompt: string): DataNormalizerProjectFile[] {
  const encodedRulePrompt = JSON.stringify(rulePrompt);
  return [
    {
      path: 'package.json',
      content: `${JSON.stringify(
        {
          name: 'input-table-normalizer',
          version: '0.1.0',
          private: true,
          type: 'module',
          scripts: {
            start: 'node src/cli.js',
          },
          dependencies: {},
        },
        null,
        2
      )}\n`,
    },
    {
      path: 'package-lock.json',
      content: `${JSON.stringify(
        {
          name: 'input-table-normalizer',
          version: '0.1.0',
          lockfileVersion: 3,
          requires: true,
          packages: {
            '': {
              name: 'input-table-normalizer',
              version: '0.1.0',
              dependencies: {},
            },
          },
        },
        null,
        2
      )}\n`,
    },
    {
      path: 'src/transform.js',
      content: createNodeNormalizerTransformContent(encodedRulePrompt),
    },
    {
      path: 'src/cli.js',
      content: [
        'import { mkdir, readFile, writeFile } from "node:fs/promises";',
        'import { dirname, join } from "node:path";',
        'import { transform } from "./transform.js";',
        '',
        'const args = parseArgs(process.argv.slice(2));',
        'const context = JSON.parse(await readFile(args.context, "utf8"));',
        'const outputDir = createPathHandle(args.output);',
        'const manifest = await transform(context, outputDir);',
        'await mkdir(dirname(args.manifest), { recursive: true });',
        'await writeFile(args.manifest, JSON.stringify(manifest, null, 2), "utf8");',
        '',
        'function parseArgs(values) {',
        '  const result = {};',
        '  for (let index = 0; index < values.length; index += 2) {',
        '    const key = values[index]?.replace(/^--/, "");',
        '    const value = values[index + 1];',
        '    if (key) result[key] = value;',
        '  }',
        '  for (const key of ["context", "manifest", "output"]) {',
        '    if (!result[key]) throw new Error(`Missing --${key}`);',
        '  }',
        '  return result;',
        '}',
        '',
        'function createPathHandle(path) {',
        '  return {',
        '    toString: () => path,',
        '    join: (child) => createPathHandle(join(path, child)),',
        '    mkdir: (options) => mkdir(path, options),',
        '    writeFile: (content, encoding) => writeFile(path, content, encoding),',
        '  };',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'tests/fixtures/context.json',
      content: `${JSON.stringify({ sourcePath: './fixtures/source.xlsx', sourceKind: 'excel' }, null, 2)}\n`,
    },
  ];
}

function createPythonNormalizerTransformContent(encodedRulePrompt: string): string {
  return [
    'from __future__ import annotations',
    '',
    'from pathlib import Path',
    'from typing import Any',
    '',
    `RULE_PROMPT = ${encodedRulePrompt}`,
    '',
    '',
    'def transform(context: dict[str, Any], output_dir: Path) -> dict[str, Any]:',
    '    output_dir.mkdir(parents=True, exist_ok=True)',
    '    raise RuntimeError(',
    '        "This project is a scaffold. Generate a normalizer draft with the configured LLM before previewing."',
    '    )',
    '',
  ].join('\n');
}

function createNodeNormalizerTransformContent(encodedRulePrompt: string): string {
  return [
    `export const rulePrompt = ${encodedRulePrompt};`,
    '',
    'export async function transform(context, outputDir) {',
    '  await outputDir.mkdir({ recursive: true });',
    '  throw new Error("This project is a scaffold. Generate a normalizer draft with the configured LLM before previewing.");',
    '}',
    '',
  ].join('\n');
}
