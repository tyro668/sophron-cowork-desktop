import { basename } from 'path';
import type { AppConfig } from '../config/config-store';
import { runPiAiOneShot } from '../claude/claude-sdk-one-shot';
import type {
  DataInputTableSourceSummary,
  DataNormalizerLanguage,
  DataNormalizerProjectFile,
} from '../../renderer/types';
import {
  createInputTableNormalizerProjectTemplate,
  type InputTableNormalizerProjectTemplate,
} from '../../shared/input-table-normalizer/templates';

export interface GenerateInputTableNormalizerProjectInput {
  name: string;
  primaryLanguage: DataNormalizerLanguage;
  rulePrompt: string;
  sourceSummary: DataInputTableSourceSummary;
}

export type InputTableNormalizerSourceStructureAnalysis = Record<string, unknown>;

export interface InputTableNormalizerProjectGenerator {
  generate(
    input: GenerateInputTableNormalizerProjectInput
  ): Promise<InputTableNormalizerProjectTemplate>;
}

export function createLlmInputTableNormalizerProjectGenerator(
  getConfig: () => AppConfig
): InputTableNormalizerProjectGenerator {
  return {
    async generate(input) {
      const template = createInputTableNormalizerProjectTemplate(
        input.primaryLanguage,
        input.rulePrompt
      );
      const sourceSummary = compactSourceSummary(input.sourceSummary);
      const analysisResponse = await runPiAiOneShot(
        buildSourceAnalysisUserPrompt(input, sourceSummary),
        buildSourceAnalysisSystemPrompt(),
        getConfig(),
        {
          temperature: 0,
          maxTokens: 8_000,
        }
      );
      const sourceStructureAnalysis = parseSourceStructureAnalysis(analysisResponse.text);
      const response = await runPiAiOneShot(
        buildCodeGenerationUserPrompt(input, template, sourceSummary, sourceStructureAnalysis),
        buildCodeGenerationSystemPrompt(input.primaryLanguage),
        getConfig(),
        {
          temperature: 0.1,
          maxTokens: 16_000,
        }
      );
      const generatedFiles = parseGeneratedProjectFiles(response.text);
      const files = mergeGeneratedProjectFiles(
        template.files,
        generatedFiles,
        input.primaryLanguage
      );
      return {
        ...template,
        files: upsertGeneratedProjectFile(files, {
          path: 'docs/source-structure-analysis.json',
          content: `${JSON.stringify(
            {
              rulePrompt: input.rulePrompt,
              sourceSummaryHash: input.sourceSummary.hash,
              sourceStructureAnalysis,
            },
            null,
            2
          )}\n`,
        }),
      };
    },
  };
}

function buildSourceAnalysisSystemPrompt(): string {
  return [
    'You analyze input table source structure before code generation.',
    'Return only strict JSON. Do not return markdown, explanations, or code fences.',
    'Do not generate code in this step.',
    'Use only the provided source summary. It was produced by built-in Node readers from the real authorized file or folder.',
    'Excel sampleRows contain the first sampled rows after merged cells were expanded by the built-in reader. mergedCells lists original merge ranges and values.',
    'Use 1-based row and column numbers when describing headers, data starts, and merge ranges.',
    'The JSON object must include: sourceKind, sourceShape, sampleFindings, sheetSelection, headerStrategy, mergeStrategy, rowStrategy, columnStrategy, outputColumns, implementationNotes, warnings.',
    'outputColumns should be an array of objects with name, type, source, and nullable when the provided samples make that possible.',
    'If the structure is uncertain, explain the uncertainty in warnings and give a robust fallback strategy in implementationNotes.',
  ].join('\n');
}

function buildCodeGenerationSystemPrompt(language: DataNormalizerLanguage): string {
  const transformPath = language === 'node' ? 'src/transform.js' : 'normalizer/transform.py';
  const exportContract =
    language === 'node'
      ? 'Export async function transform(context, outputDir) from src/transform.js.'
      : 'Define transform(context: dict[str, Any], output_dir: pathlib.Path) in normalizer/transform.py.';
  return [
    'You generate executable input-table normalizer project files.',
    'Return only strict JSON. Do not return markdown, explanations, or code fences.',
    'The JSON schema is {"files":[{"path":"relative/path","content":"complete file content"}]}.',
    `Update ${transformPath}; you may add helper files if useful.`,
    exportContract,
    'Do not use external dependencies. Use only the standard runtime library.',
    language === 'python'
      ? 'Generated Python code must run on Python 3.9 or newer. Do not use Python 3.10+ only syntax or APIs.'
      : 'Generated Node.js code must run without npm dependencies unless the project files also include the required dependency declarations and lockfile updates.',
    language === 'python'
      ? 'For Python max(), never combine multiple positional arguments with default=. Use max([a, b], default=0) for possibly empty values, or max(a, b) when values are always present.'
      : 'Use standard JavaScript syntax compatible with the app runtime.',
    'The app first used built-in Node readers to inspect the real source file/folder and produce sourceStructureAnalysis. Follow that analysis when implementing the final code.',
    'At runtime the app provides context.preparedSources.files: UTF-8 CSV files extracted from the original Excel/CSV/folder input by the same built-in Node reader.',
    'For Excel sources, prepared CSV rows already include values expanded from merged cells, while context.sourceSummary still includes original merged-cell ranges.',
    'Read context.preparedSources files whenever available. Use context.sourcePath only as a direct CSV fallback.',
    'Do not assume that the first non-empty row is always the header. Choose header rows, data start rows, and column names from sourceStructureAnalysis and runtime rows.',
    'The transform must write output/normalized.csv and return a manifest object with output, format="csv", rowCount, columns, warnings.',
    'Manifest columns must be an array of objects: [{"name":"column name","type":"string"}]. Do not return columns as a string array.',
    'If no data rows are found, still return the detected output columns and rowCount=0. Never return an empty columns array for a readable source.',
    'Generate code tailored to the user rule prompt, sourceStructureAnalysis, and source summary. Do not leave TODOs or scaffold placeholders.',
  ].join('\n');
}

function buildSourceAnalysisUserPrompt(
  input: GenerateInputTableNormalizerProjectInput,
  sourceSummary: DataInputTableSourceSummary
): string {
  return JSON.stringify(
    {
      task:
        'Analyze the real input file/folder structure for a custom input table normalizer. This is step 1 of 2. Do not generate code.',
      projectName: input.name,
      languageRequestedForFinalCode: input.primaryLanguage,
      rulePrompt: input.rulePrompt,
      sourceSummary,
      analysisGuidance: [
        'Identify which sampled file(s), sheet(s), and rows contain the actual table.',
        'For Excel, inspect mergedCells and the first sampled rows to decide whether headers are single-row, multi-row, grouped, or irregular.',
        'Describe how duplicate column names should be made unique without losing Chinese column names.',
        'Describe how rows before/after the data region should be skipped.',
        'Describe robust runtime heuristics so the final code can process similar files, not just the exact sample.',
      ],
      outputJsonSchema: {
        sourceKind: 'excel | csv | folder',
        sourceShape: 'short structural summary',
        sampleFindings: ['finding'],
        sheetSelection: {
          mode: 'specific | first | all | pattern',
          sheets: ['Sheet1'],
          reason: 'why these sheets should be used',
        },
        headerStrategy: {
          type: 'single-row | multi-row | inferred',
          headerRows: [1, 2],
          dataStartRow: 3,
          notes: 'how to build final column names',
        },
        mergeStrategy: 'how merged cells should affect headers and row values',
        rowStrategy: 'how to identify real data rows and skip notes/titles/totals',
        columnStrategy: 'how to normalize, combine, and deduplicate column names',
        outputColumns: [{ name: 'column name', type: 'string', source: 'sample/source detail' }],
        implementationNotes: ['note for final code generation'],
        warnings: ['uncertainty or risk'],
      },
    },
    null,
    2
  );
}

function buildCodeGenerationUserPrompt(
  input: GenerateInputTableNormalizerProjectInput,
  template: InputTableNormalizerProjectTemplate,
  sourceSummary: DataInputTableSourceSummary,
  sourceStructureAnalysis: InputTableNormalizerSourceStructureAnalysis
): string {
  return JSON.stringify(
    {
      task:
        'Generate final executable code for an input table normalizer project. This is step 2 of 2 and must follow the prior sourceStructureAnalysis.',
      projectName: input.name,
      language: input.primaryLanguage,
      rulePrompt: input.rulePrompt,
      sourceStructureAnalysis,
      sourceSummary,
      runtimeContextContract: {
        contextKeys: ['sourcePath', 'sourceKind', 'config', 'sourceSummary', 'preparedSources'],
        preparedSources:
          'context.preparedSources.files is an array of CSV sources extracted by the app built-in Node reader. Each item has path, relativePath, originalPath, originalKind, sheetName, headerCandidates, rowCountEstimate, columnCountEstimate.',
      },
      existingProjectFiles: template.files.map((file) => ({
        path: file.path,
        content: file.content,
      })),
      outputJsonSchema: {
        files: [{ path: 'relative path', content: 'complete UTF-8 file content' }],
      },
    },
    null,
    2
  );
}

function compactSourceSummary(summary: DataInputTableSourceSummary): DataInputTableSourceSummary {
  return {
    ...summary,
    sourcePath: basename(summary.sourcePath),
    files: summary.files.slice(0, 8).map((file) => ({
      ...file,
      path: basename(file.path),
      sampleRows: file.sampleRows?.slice(0, 20),
      sheets: file.sheets?.slice(0, 6).map((sheet) => ({
        ...sheet,
        sampleRows: sheet.sampleRows.slice(0, 20),
        mergedCells: sheet.mergedCells?.slice(0, 40),
        headerCandidates: sheet.headerCandidates.slice(0, 5),
      })),
    })),
  };
}

function parseSourceStructureAnalysis(text: string): InputTableNormalizerSourceStructureAnalysis {
  const parsed = JSON.parse(extractJsonObject(text)) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('LLM source analysis response must be a JSON object');
  }
  return parsed;
}

function parseGeneratedProjectFiles(text: string): DataNormalizerProjectFile[] {
  const parsed = JSON.parse(extractJsonObject(text)) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.files)) {
    throw new Error('LLM normalizer response must be a JSON object with files array');
  }
  const files = parsed.files
    .map((file) => {
      if (!isRecord(file) || typeof file.path !== 'string' || typeof file.content !== 'string') {
        return null;
      }
      return {
        path: normalizeGeneratedPath(file.path),
        content: file.content,
      };
    })
    .filter((file): file is DataNormalizerProjectFile => file !== null);
  if (files.length === 0) {
    throw new Error('LLM normalizer response did not include any valid project files');
  }
  return files;
}

function mergeGeneratedProjectFiles(
  baseFiles: DataNormalizerProjectFile[],
  generatedFiles: DataNormalizerProjectFile[],
  language: DataNormalizerLanguage
): DataNormalizerProjectFile[] {
  const fileMap = new Map(baseFiles.map((file) => [file.path, file]));
  for (const file of generatedFiles) {
    fileMap.set(file.path, file);
  }
  const transformPath = language === 'node' ? 'src/transform.js' : 'normalizer/transform.py';
  const transformFile = fileMap.get(transformPath);
  if (!transformFile) {
    throw new Error(`LLM normalizer response must include ${transformPath}`);
  }
  validateGeneratedNormalizerProjectFiles(Array.from(fileMap.values()), language);
  return Array.from(fileMap.values()).sort((left, right) => left.path.localeCompare(right.path));
}

export function validateGeneratedNormalizerProjectFiles(
  files: DataNormalizerProjectFile[],
  language: DataNormalizerLanguage
): void {
  const transformPath = language === 'node' ? 'src/transform.js' : 'normalizer/transform.py';
  const transformFile = files.find((file) => file.path === transformPath);
  if (!transformFile) {
    throw new Error(`LLM normalizer response must include ${transformPath}`);
  }
  validateGeneratedTransform(transformFile, language);
}

function upsertGeneratedProjectFile(
  files: DataNormalizerProjectFile[],
  nextFile: DataNormalizerProjectFile
): DataNormalizerProjectFile[] {
  const fileMap = new Map(files.map((file) => [file.path, file]));
  fileMap.set(nextFile.path, nextFile);
  return Array.from(fileMap.values()).sort((left, right) => left.path.localeCompare(right.path));
}

function validateGeneratedTransform(
  file: DataNormalizerProjectFile,
  language: DataNormalizerLanguage
): void {
  if (file.content.includes('This project is a scaffold') || /TODO|Replace this draft/i.test(file.content)) {
    throw new Error('LLM normalizer transform still contains scaffold placeholder text');
  }
  if (language === 'node' && !/export\s+async\s+function\s+transform/.test(file.content)) {
    throw new Error('Node normalizer transform must export async function transform');
  }
  if (language === 'python' && !/def\s+transform\s*\(/.test(file.content)) {
    throw new Error('Python normalizer transform must define transform(...)');
  }
  if (language === 'python') {
    const unsafeMaxCall = findPythonMaxDefaultWithMultipleArguments(file.content);
    if (unsafeMaxCall) {
      throw new Error(
        `Python normalizer transform uses invalid max(..., default=...) form: ${unsafeMaxCall}`
      );
    }
  }
}

function findPythonMaxDefaultWithMultipleArguments(content: string): string | null {
  const maxCallPattern = /\bmax\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = maxCallPattern.exec(content)) !== null) {
    const callStart = match.index;
    const openParenIndex = content.indexOf('(', callStart);
    const call = readBalancedCall(content, openParenIndex);
    if (!call) continue;
    maxCallPattern.lastIndex = call.endIndex;
    if (!/\bdefault\s*=/.test(call.argumentsText)) continue;
    if (countTopLevelCommas(call.argumentsText) > 1) {
      return content.slice(callStart, call.endIndex).replace(/\s+/g, ' ').trim();
    }
  }
  return null;
}

function readBalancedCall(
  content: string,
  openParenIndex: number
): { argumentsText: string; endIndex: number } | null {
  if (openParenIndex < 0 || content[openParenIndex] !== '(') {
    return null;
  }
  let depth = 1;
  let quote: '"' | "'" | null = null;
  let tripleQuote = false;
  let escaped = false;
  for (let index = openParenIndex + 1; index < content.length; index += 1) {
    const char = content[index];
    const nextThree = content.slice(index, index + 3);
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (tripleQuote && nextThree === quote.repeat(3)) {
        quote = null;
        tripleQuote = false;
        index += 2;
        continue;
      }
      if (!tripleQuote && char === quote) {
        quote = null;
      }
      continue;
    }
    if (nextThree === '"""' || nextThree === "'''") {
      quote = char as '"' | "'";
      tripleQuote = true;
      index += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      tripleQuote = false;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          argumentsText: content.slice(openParenIndex + 1, index),
          endIndex: index + 1,
        };
      }
    }
  }
  return null;
}

function countTopLevelCommas(argumentsText: string): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let tripleQuote = false;
  let escaped = false;
  let count = 0;
  for (let index = 0; index < argumentsText.length; index += 1) {
    const char = argumentsText[index];
    const nextThree = argumentsText.slice(index, index + 3);
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (tripleQuote && nextThree === quote.repeat(3)) {
        quote = null;
        tripleQuote = false;
        index += 2;
        continue;
      }
      if (!tripleQuote && char === quote) {
        quote = null;
      }
      continue;
    }
    if (nextThree === '"""' || nextThree === "'''") {
      quote = char as '"' | "'";
      tripleQuote = true;
      index += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      tripleQuote = false;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === ',' && depth === 0) {
      count += 1;
    }
  }
  return count;
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return trimmed;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim().startsWith('{')) {
    return fenced[1].trim();
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  throw new Error('LLM normalizer response did not contain JSON');
}

function normalizeGeneratedPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized.includes('..') || normalized.startsWith('/')) {
    throw new Error(`Generated normalizer file path is not safe: ${path}`);
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
