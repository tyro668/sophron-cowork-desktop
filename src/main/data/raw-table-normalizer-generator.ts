import { basename } from 'path';
import { parse } from 'acorn';
import { spawnSync } from 'node:child_process';
import type { AppConfig } from '../config/config-store';
import { runPiAiOneShot } from '../agent/pi-ai-one-shot';
import {
  runNormalizerAgent,
  type NormalizerPreviewCheck,
  type NormalizerPreviewFn,
} from './raw-table-normalizer-agent';
import type {
  AgentRuntimeConfig,
  DataRawTableSourceSummary,
  DataNormalizerLanguage,
  DataNormalizerProjectFile,
} from '../../shared/contracts';
import {
  createRawTableNormalizerProjectTemplate,
  type RawTableNormalizerProjectTemplate,
} from '../../shared/raw-table-normalizer/templates';
import { extractJsonObjectText } from '../../shared/structured-text';
import { resolveNormalizerPythonExecutable } from './raw-table-normalizer-runner';
import {
  buildFixPayload,
  changedFilePaths,
  collectSecretValues,
  type FixErrorRequest,
  type FixPayload,
  createFixStreamSplitter,
} from '../../shared/fix-error';

export interface GenerateRawTableNormalizerProjectInput {
  name: string;
  primaryLanguage: DataNormalizerLanguage;
  rulePrompt: string;
  selectedSkillNames?: string[];
  sourceSummary: DataRawTableSourceSummary;
  runtimeConfig?: AgentRuntimeConfig;
  onProgress?: RawTableNormalizerProjectProgressCallback;
}

export type RawTableNormalizerSourceStructureAnalysis = Record<string, unknown>;
export type RawTableNormalizerProjectProgressPhase =
  | 'source_summary'
  | 'source_analysis'
  | 'code_generation'
  | 'verify'
  | 'saving'
  | 'complete'
  | 'error';
export interface RawTableNormalizerProjectProgressEvent {
  phase: RawTableNormalizerProjectProgressPhase;
  kind: 'message' | 'delta';
  text: string;
}
export type RawTableNormalizerProjectProgressCallback = (
  event: RawTableNormalizerProjectProgressEvent
) => void;

export interface FixRawTableNormalizerProjectInput {
  name: string;
  primaryLanguage: DataNormalizerLanguage;
  rulePrompt: string;
  /** Current files of the draft being fixed (the fix edits these, it never regenerates). */
  files: DataNormalizerProjectFile[];
  baseLabel: string;
  request: FixErrorRequest;
  sourceSummary?: DataRawTableSourceSummary;
  runtimeConfig?: AgentRuntimeConfig;
  onProgress?: RawTableNormalizerProjectProgressCallback;
  /** Preview unsaved files on the real source: the fix then runs as a self-testing agent. */
  preview?: NormalizerPreviewFn;
  signal?: AbortSignal;
}

/** 规则生成 follow-up: the first preview of a generated draft failed; iterate until it passes. */
export interface RefineRawTableNormalizerProjectInput {
  name: string;
  primaryLanguage: DataNormalizerLanguage;
  rulePrompt: string;
  files: DataNormalizerProjectFile[];
  failure: string;
  sourceSummary?: DataRawTableSourceSummary;
  runtimeConfig?: AgentRuntimeConfig;
  onProgress?: RawTableNormalizerProjectProgressCallback;
  preview: NormalizerPreviewFn;
  signal?: AbortSignal;
}

export interface RefineRawTableNormalizerProjectResult {
  files: DataNormalizerProjectFile[];
  changedFiles: string[];
  summary: string;
  lastCheck?: NormalizerPreviewCheck;
}

export interface FixRawTableNormalizerProjectResult {
  files: DataNormalizerProjectFile[];
  changedFiles: string[];
  summary: string;
  analysis: string;
  /** Exactly what was sent to the model (redacted), for tests and logs. */
  payload: FixPayload;
}

export interface RawTableNormalizerProjectGenerator {
  generate(
    input: GenerateRawTableNormalizerProjectInput
  ): Promise<RawTableNormalizerProjectTemplate>;
  /** Follow-up turn: fix the current draft's files from a preview failure. */
  fix?(input: FixRawTableNormalizerProjectInput): Promise<FixRawTableNormalizerProjectResult>;
  /** Self-test loop after 规则生成 when the first preview fails. */
  refine?(
    input: RefineRawTableNormalizerProjectInput
  ): Promise<RefineRawTableNormalizerProjectResult>;
}

export function createLlmRawTableNormalizerProjectGenerator(
  getConfig: () => AppConfig | Promise<AppConfig>
): RawTableNormalizerProjectGenerator {
  return {
    async generate(input) {
      const template = createRawTableNormalizerProjectTemplate(
        input.primaryLanguage,
        input.rulePrompt
      );
      const generationInput = {
        ...input,
        rulePrompt: buildSkillAwareRulePrompt(input.rulePrompt, input.selectedSkillNames),
      };
      const runtimeConfig = input.runtimeConfig ?? (await getConfig());
      const sourceSummary = compactSourceSummary(input.sourceSummary);
      const analysisProgress = createJsonProgressWriter(input, 'source_analysis');
      const analysisResponse = await runPiAiOneShot(
        buildSourceAnalysisUserPrompt(generationInput, sourceSummary),
        buildSourceAnalysisSystemPrompt(),
        runtimeConfig,
        {
          temperature: 0,
          maxTokens: 8_000,
          onTextDelta: analysisProgress.append,
        }
      );
      analysisProgress.fallback(analysisResponse.text);
      const sourceStructureAnalysis = parseSourceStructureAnalysis(analysisResponse.text);
      const codeProgress = createJsonProgressWriter(input, 'code_generation');
      const response = await runPiAiOneShot(
        buildCodeGenerationUserPrompt(
          generationInput,
          template,
          sourceSummary,
          sourceStructureAnalysis
        ),
        buildCodeGenerationSystemPrompt(input.primaryLanguage),
        runtimeConfig,
        {
          temperature: 0.1,
          maxTokens: 16_000,
          onTextDelta: codeProgress.append,
        }
      );
      codeProgress.fallback(response.text);
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
              selectedSkillNames: normalizeSelectedSkillNames(input.selectedSkillNames),
              sourceSummaryHash: input.sourceSummary.hash,
              sourceStructureAnalysis,
            },
            null,
            2
          )}\n`,
        }),
      };
    },
    async refine(input) {
      const runtimeConfig = input.runtimeConfig ?? (await getConfig());
      const result = await runNormalizerAgent({
        mode: 'generate',
        name: input.name,
        language: input.primaryLanguage,
        rulePrompt: input.rulePrompt,
        files: input.files,
        failure: input.failure,
        sourceSummary: input.sourceSummary ? compactSourceSummary(input.sourceSummary) : undefined,
        preview: input.preview,
        validate: (files) => validateGeneratedNormalizerProjectFiles(files, input.primaryLanguage),
        systemRules: buildCodeGenerationSystemPrompt(input.primaryLanguage),
        config: runtimeConfig,
        signal: input.signal,
        onProgress: (phase, text) => {
          if (text) input.onProgress?.({ phase, kind: 'message', text });
        },
      });
      return {
        files: result.files,
        changedFiles: result.changedFiles,
        summary: result.summary,
        lastCheck: result.lastCheck,
      };
    },
    async fix(input) {
      const config = await getConfig();
      const runtimeConfig = input.runtimeConfig ?? config;
      const secrets = [
        ...collectSecretValues(process.env),
        ...collectSecretValues(config),
        ...collectSecretValues(input.runtimeConfig),
      ];
      const payload = buildNormalizerFixPayload(input, secrets);
      const emit = (event: RawTableNormalizerProjectProgressEvent) => {
        if (event.text) input.onProgress?.(event);
      };
      if (input.preview) {
        emit({
          phase: 'source_summary',
          kind: 'message',
          text: `读取 ${input.files.length} 个文件（${input.baseLabel}）· 智能体会预览自测`,
        });
        const result = await runNormalizerAgent({
          mode: 'fix',
          name: input.name,
          language: input.primaryLanguage,
          rulePrompt: input.rulePrompt,
          files: input.files,
          failure: payload.error,
          payload,
          sourceSummary: input.sourceSummary
            ? compactSourceSummary(input.sourceSummary)
            : undefined,
          preview: input.preview,
          validate: (files) =>
            validateGeneratedNormalizerProjectFiles(files, input.primaryLanguage),
          systemRules: buildCodeGenerationSystemPrompt(input.primaryLanguage),
          config: runtimeConfig,
          signal: input.signal,
          onProgress: (phase, text) => emit({ phase, kind: 'message', text }),
        });
        if (result.changedFiles.length === 0) throw new Error('AI 修复没有改动任何文件');
        return {
          files: result.files,
          changedFiles: result.changedFiles,
          summary: result.summary,
          analysis: '',
          payload,
        };
      }
      emit({
        phase: 'source_summary',
        kind: 'message',
        text: `调用栈 ${payload.callStack.length} 层${payload.location ? ` · 定位 ${payload.location.file}:${payload.location.line}${payload.location.func ? ` ${payload.location.func}()` : ''}` : ''}`,
      });
      emit({
        phase: 'source_summary',
        kind: 'message',
        text: `读取 ${input.files.length} 个文件（${input.baseLabel}）`,
      });
      // One model call returns {"analysis", "files", "summary"}: stream the analysis part into
      // 分析原因 and everything from "files" on into 修改文件.
      const onDelta = createFixStreamSplitter((event) => emit(event));
      const response = await runPiAiOneShot(
        buildNormalizerFixUserPrompt(input, payload),
        buildNormalizerFixSystemPrompt(input.primaryLanguage),
        runtimeConfig,
        { temperature: 0.1, maxTokens: 16_000, onTextDelta: onDelta }
      );
      if (!response.text.trim()) throw new Error('模型没有返回内容');
      const parsed = JSON.parse(extractJsonObject(response.text)) as unknown;
      if (!isRecord(parsed) || !Array.isArray(parsed.files)) {
        throw new Error('模型返回的不是 {"files": [...]} JSON');
      }
      const generated = parseGeneratedProjectFiles(JSON.stringify({ files: parsed.files }));
      const fileMap = new Map(input.files.map((file) => [file.path, file]));
      for (const file of generated) fileMap.set(file.path, file);
      const files = Array.from(fileMap.values()).sort((left, right) =>
        left.path.localeCompare(right.path)
      );
      validateGeneratedNormalizerProjectFiles(files, input.primaryLanguage);
      const changedFiles = changedFilePaths(input.files, files);
      if (changedFiles.length === 0) throw new Error('AI 修复没有改动任何文件');
      return {
        files,
        changedFiles,
        summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
        analysis: typeof parsed.analysis === 'string' ? parsed.analysis.trim() : '',
        payload,
      };
    },
  };
}

/** Redacted fix context: error, relative stack, stderr tail, failing file + other names, ≤20 rows. */
export function buildNormalizerFixPayload(
  input: Pick<FixRawTableNormalizerProjectInput, 'files' | 'request' | 'sourceSummary'>,
  secrets: string[] = []
): FixPayload {
  const summary = input.sourceSummary;
  const file = summary?.files[0];
  const sheet = file?.sheets?.[0];
  const rows = sheet?.sampleRows ?? file?.sampleRows ?? [];
  return buildFixPayload({
    request: input.request,
    files: input.files.filter((item) => item.path !== 'docs/source-structure-analysis.json'),
    primaryFile: input.files.some((item) => item.path === 'src/transform.js')
      ? 'src/transform.js'
      : 'normalizer/transform.py',
    input: summary
      ? {
          label: [
            basename(file?.path ?? summary.sourcePath),
            summary.sourceKind,
            `${summary.fileCount} 个文件`,
            file ? `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB` : '',
            sheet ? `工作表 ${sheet.name}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          rows,
        }
      : undefined,
    secrets,
  });
}

function buildNormalizerFixSystemPrompt(language: DataNormalizerLanguage): string {
  return [
    buildCodeGenerationSystemPrompt(language),
    '',
    'This is a FIX turn on an existing draft, not a regeneration.',
    'You receive the project files as they are now and the failure of the last preview run (error, call stack with project-relative paths, stderr tail, input sample, optional user note).',
    'Find the root cause and make the smallest change that fixes it while keeping the rest of the code and the output columns as they are.',
    'If the run succeeded but the result is wrong (missing columns, a column that is entirely empty), fix the logic so the expected columns are filled from the source.',
    'Return only strict JSON: {"analysis":"2-4 short Chinese sentences: root cause and what you change","files":[{"path":"relative/path","content":"complete new file content"}],"summary":"one short Chinese sentence describing the change"}.',
    'failure.failingFile (and failure.stackFiles) hold the full current content of the files involved; failure.otherFiles only lists the names of the remaining project files.',
    'failure.round.previousAttempts (auto-fix) lists the original error and what each earlier round changed and why it still failed. The files you get already contain those changes: keep everything they fixed (the original error and earlier failures must stay fixed, values stay parsed/typed as before) and only add what the new failure needs.',
    "failure.userNote holds the user's 补充 notes and follow-up requests for this draft, oldest first. They override the original rule wherever they conflict, and earlier ones stay in force: never undo a fix an earlier note asked for.",
    'Only change files whose full content you were given, and return each changed file with its complete new content. Files you do not return stay unchanged. Do not rename or delete files.',
  ].join('\n');
}

function buildNormalizerFixUserPrompt(
  input: FixRawTableNormalizerProjectInput,
  payload: FixPayload
): string {
  const docs = input.files.find((file) => file.path === 'docs/source-structure-analysis.json');
  return JSON.stringify(
    {
      task: `Fix the current draft (${input.baseLabel}) of the input table normalizer "${input.name}" so the preview runs and the output is correct.`,
      language: input.primaryLanguage,
      rulePrompt: input.rulePrompt,
      failure: payload,
      sourceStructureAnalysis: docs ? safeJson(docs.content) : undefined,
      outputJsonSchema: {
        analysis: 'root cause and fix, Chinese',
        files: [{ path: 'relative path', content: 'complete UTF-8 file content' }],
        summary: 'one sentence, Chinese',
      },
    },
    null,
    2
  );
}

function safeJson(text: string): unknown {
  try {
    return (JSON.parse(text) as { sourceStructureAnalysis?: unknown }).sourceStructureAnalysis;
  } catch {
    return undefined;
  }
}

function normalizeSelectedSkillNames(selectedSkillNames: string[] | undefined): string[] {
  return Array.isArray(selectedSkillNames)
    ? selectedSkillNames
        .map((name) => name.trim())
        .filter((name, index, names) => name.length > 0 && names.indexOf(name) === index)
    : [];
}

function buildSkillAwareRulePrompt(
  rulePrompt: string,
  selectedSkillNames: string[] | undefined
): string {
  const normalizedSkillNames = normalizeSelectedSkillNames(selectedSkillNames);
  if (normalizedSkillNames.length === 0) {
    return rulePrompt;
  }

  return [
    rulePrompt,
    '',
    `Selected skills from the UI: ${normalizedSkillNames.map((name) => `@${name}`).join(', ')}.`,
    'Use these selected skills as user-provided context when interpreting the transformation rule.',
  ].join('\n');
}

function emitProgress(
  input: GenerateRawTableNormalizerProjectInput,
  event: RawTableNormalizerProjectProgressEvent
): void {
  if (typeof event.text !== 'string' || event.text.length === 0) return;
  input.onProgress?.(event);
}

// Raw model text streams through as `delta` events; the renderer owns all
// presentation (step titles, collapsible output) so this writer stays minimal.
function createJsonProgressWriter(
  input: GenerateRawTableNormalizerProjectInput,
  phase: RawTableNormalizerProjectProgressPhase
): {
  append: (delta: string) => void;
  fallback: (finalText: string) => void;
} {
  let streamedText = '';
  const append = (delta: string) => {
    if (typeof delta !== 'string' || delta.length === 0) return;
    streamedText += delta;
    emitProgress(input, {
      phase,
      kind: 'delta',
      text: delta,
    });
  };
  return {
    append,
    fallback(finalText) {
      if (streamedText.trim().length > 0 || !finalText.trim()) return;
      append(finalText);
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
    'You generate executable raw-table normalizer project files.',
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
    'At runtime the app provides context.preparedSources.files: UTF-8 Csv files extracted from the original Excel/Csv/folder input by the same built-in Node reader.',
    'For Excel sources, prepared Csv rows already include values expanded from merged cells, while context.sourceSummary still includes original merged-cell ranges.',
    'Read context.preparedSources files whenever available. Use context.sourcePath only as a direct Csv fallback.',
    'Do not assume that the first non-empty row is always the header. Choose header rows, data start rows, and column names from sourceStructureAnalysis and runtime rows.',
    'The transform must write output/normalized.csv and return a manifest object with output, format="csv", rowCount, columns, warnings.',
    'Manifest columns must be an array of objects: [{"name":"column name","type":"string"}]. Do not return columns as a string array.',
    'If no data rows are found, still return the detected output columns and rowCount=0 (the app treats 0 rows as a failed preview, so make sure real data rows are recognised). Never return an empty columns array for a readable source.',
    'Generate code tailored to the user rule prompt, sourceStructureAnalysis, and source summary. Do not leave TODOs or scaffold placeholders.',
  ].join('\n');
}

function buildSourceAnalysisUserPrompt(
  input: GenerateRawTableNormalizerProjectInput,
  sourceSummary: DataRawTableSourceSummary
): string {
  return JSON.stringify(
    {
      pipeline:
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
        sourceKind: 'excel | csv | folder | cloud (downloaded Csv snapshot)',
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
  input: GenerateRawTableNormalizerProjectInput,
  template: RawTableNormalizerProjectTemplate,
  sourceSummary: DataRawTableSourceSummary,
  sourceStructureAnalysis: RawTableNormalizerSourceStructureAnalysis
): string {
  return JSON.stringify(
    {
      pipeline:
        'Generate final executable code for an input table normalizer project. This is step 2 of 2 and must follow the prior sourceStructureAnalysis.',
      projectName: input.name,
      language: input.primaryLanguage,
      rulePrompt: input.rulePrompt,
      sourceStructureAnalysis,
      sourceSummary,
      runtimeContextContract: {
        contextKeys: ['sourcePath', 'sourceKind', 'config', 'sourceSummary', 'preparedSources'],
        preparedSources:
          'context.preparedSources.files is an array of Csv sources extracted by the app built-in Node reader. Each item has path, relativePath, originalPath, originalKind, sheetName, headerCandidates, rowCountEstimate, columnCountEstimate.',
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

function compactSourceSummary(summary: DataRawTableSourceSummary): DataRawTableSourceSummary {
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

function parseSourceStructureAnalysis(text: string): RawTableNormalizerSourceStructureAnalysis {
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
  if (
    file.content.includes('This project is a scaffold') ||
    /TODO|Replace this draft/i.test(file.content)
  ) {
    throw new Error('LLM normalizer transform still contains scaffold placeholder text');
  }
  if (language === 'node') validateNodeTransform(file.content);
  else validatePythonTransform(file.content);
}

function validateNodeTransform(content: string): void {
  let program: ReturnType<typeof parse>;
  try {
    program = parse(content, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (error) {
    throw new Error(
      `Node normalizer transform contains invalid JavaScript: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const body = program.body as Array<{
    type: string;
    declaration?: {
      type: string;
      async?: boolean;
      id?: { name?: string } | null;
      params?: Array<{ type: string; name?: string }>;
    } | null;
  }>;
  const entry = body.find(
    (node) =>
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'FunctionDeclaration' &&
      node.declaration.id?.name === 'transform'
  )?.declaration;
  if (!entry?.async) {
    throw new Error('Node normalizer transform must export async function transform');
  }
  const parameterNames = (entry.params ?? []).map((parameter) =>
    parameter.type === 'Identifier' ? parameter.name : undefined
  );
  if (parameterNames[0] !== 'context' || parameterNames[1] !== 'outputDir') {
    throw new Error('Node normalizer transform must declare transform(context, outputDir)');
  }
}

interface PythonAstValidationResult {
  ok: boolean;
  error?: string;
  invalidMaxCall?: string;
}

const PYTHON_AST_VALIDATOR = `
import ast
import json
import sys

source = sys.stdin.read()
result = {"ok": False}
try:
    tree = ast.parse(source)
    entries = [
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "transform"
    ]
    if not entries:
        result["error"] = "Python normalizer transform must define top-level transform(context, output_dir)"
    else:
        entry = entries[0]
        names = [argument.arg for argument in entry.args.args]
        if names[:2] != ["context", "output_dir"]:
            result["error"] = "Python normalizer transform must declare transform(context, output_dir)"
        else:
            invalid_call = None
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                if not isinstance(node.func, ast.Name) or node.func.id != "max":
                    continue
                has_default = any(keyword.arg == "default" for keyword in node.keywords)
                if has_default and len(node.args) > 1:
                    invalid_call = ast.get_source_segment(source, node) or "max(...)"
                    break
            if invalid_call:
                result["invalidMaxCall"] = invalid_call
            else:
                result["ok"] = True
except SyntaxError as error:
    result["error"] = "Invalid Python syntax at %s:%s: %s" % (
        error.lineno or 1,
        error.offset or 1,
        error.msg,
    )
print(json.dumps(result))
`;

function validatePythonTransform(content: string): void {
  const validation = spawnSync(resolveNormalizerPythonExecutable(), ['-c', PYTHON_AST_VALIDATOR], {
    input: content,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });
  if (validation.error) {
    throw new Error(`Python AST validation could not start: ${validation.error.message}`);
  }
  if (validation.status !== 0) {
    throw new Error(`Python AST validation failed: ${validation.stderr.trim() || 'unknown error'}`);
  }
  let result: PythonAstValidationResult;
  try {
    result = JSON.parse(validation.stdout) as PythonAstValidationResult;
  } catch {
    throw new Error('Python AST validation returned an invalid response');
  }
  if (result.invalidMaxCall) {
    throw new Error(
      `Python normalizer transform uses invalid max(..., default=...) form: ${result.invalidMaxCall}`
    );
  }
  if (!result.ok) throw new Error(result.error ?? 'Python normalizer transform is invalid');
}

function extractJsonObject(text: string): string {
  return extractJsonObjectText(text);
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
