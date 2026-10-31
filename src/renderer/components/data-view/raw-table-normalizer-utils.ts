import type {
  DataRawTableConfig,
  DataRawTableExcelConfig,
  DataRawTableFolderConfig,
  DataRawTableNormalizerArtifactVersion,
  DataRawTableProcessingConfig,
  DataRawTableSourceKind,
  DataNormalizerLanguage,
  DataNormalizerProjectFile,
} from '../../types';
import type { TranslateFn } from './shared';

export interface NormalizerProjectTreeNode {
  name: string;
  path: string;
  type: 'folder' | 'file';
  children: NormalizerProjectTreeNode[];
}

export function getPreferredNormalizerFilePath(
  files: DataNormalizerProjectFile[],
  language: DataNormalizerLanguage
): string {
  const preferred = language === 'node' ? 'src/transform.js' : 'normalizer/transform.py';
  return (
    files.find((file) => file.path === preferred)?.path ??
    files.find((file) => file.path.endsWith('/transform.py') || file.path.endsWith('/transform.js'))
      ?.path ??
    files[0]?.path ??
    ''
  );
}

export function createNormalizerGenerationProgressId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `normalizer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Structured model behind the Codex-style generation console. Progress events
 * from the main process mutate a draft log held in a ref; the workbench flushes
 * shallow snapshots into React state on a throttle so token-delta floods never
 * re-render the markdown pipeline.
 */
export type NormalizerGenerationStepPhase =
  'source_summary' | 'source_analysis' | 'code_generation' | 'saving' | 'verify';

export type NormalizerGenerationStepStatus = 'active' | 'done' | 'error';

export interface NormalizerGenerationStep {
  phase: NormalizerGenerationStepPhase;
  status: NormalizerGenerationStepStatus;
  notes: string[];
  stream: string;
}

/** An earlier turn of the same generation session, folded into one row. */
export interface GenerationHistoryItem {
  title: string;
  detail?: string;
  status: 'success' | 'error';
  lines?: string[];
}

/** One finished round of an auto-fix loop. */
export interface GenerationRoundItem {
  title: string;
  status: 'success' | 'error';
  lines: string[];
  elapsedMs?: number;
}

export interface NormalizerGenerationLog {
  meta: Array<{ label: string; value: string }>;
  steps: NormalizerGenerationStep[];
  startedAt: number;
  finishedAt?: number;
  /** Multi-turn sessions: earlier turns (rule generation, preview failures, fixes). */
  history?: GenerationHistoryItem[];
  /** Divider above the current turn, e.g. 「修复 · 基于 v1 草稿」. */
  turnTitle?: string;
  /** Status row extra, e.g. 「第 2 / 3 轮」. */
  roundLabel?: string;
  /** Finished rounds of the current auto-fix turn. */
  rounds?: GenerationRoundItem[];
  /** Step titles for this turn (fix turns: 读取报错与当前代码 → 分析原因 → 修改文件 → 重新预览). */
  stepTitles?: Partial<Record<NormalizerGenerationStepPhase, string>>;
  outcome?: {
    /** warning: passed, but e.g. the on_empty fallback was used (yellow). */
    status: 'success' | 'warning' | 'error';
    title: string;
    details: string[];
    files: string[];
  };
}

const NORMALIZER_STEP_PHASE_ORDER: NormalizerGenerationStepPhase[] = [
  'source_summary',
  'source_analysis',
  'code_generation',
  'saving',
  'verify',
];

export function createNormalizerGenerationLog(input: {
  rawTableName: string;
  sourceKind: DataRawTableSourceKind;
  language: DataNormalizerLanguage;
  rulePrompt: string;
  t: TranslateFn;
}): NormalizerGenerationLog {
  return {
    meta: [
      {
        label: input.t('data.rawTables.editor.generationOutputRawTable'),
        value: input.rawTableName,
      },
      {
        label: input.t('data.rawTables.editor.generationOutputSourceKind'),
        value: input.sourceKind,
      },
      {
        label: input.t('data.rawTables.editor.generationOutputLanguage'),
        value: input.language === 'node' ? 'Node.js' : 'Python',
      },
      {
        label: input.t('data.rawTables.editor.rulePrompt'),
        value: truncateGenerationLogText(input.rulePrompt, 160),
      },
    ],
    steps: [],
    startedAt: Date.now(),
  };
}

/** Strips the markdown decorations legacy progress texts still carry. */
export function cleanNormalizerProgressMessage(text: string): string[] {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/```[a-zA-Z]*\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function ensureGenerationStep(
  log: NormalizerGenerationLog,
  phase: NormalizerGenerationStepPhase
): NormalizerGenerationStep {
  let step = log.steps.find((candidate) => candidate.phase === phase);
  if (!step) {
    // A later phase starting implies every earlier active step has finished.
    for (const candidate of log.steps) {
      if (candidate.status === 'active') candidate.status = 'done';
    }
    step = { phase, status: 'active', notes: [], stream: '' };
    log.steps.push(step);
    log.steps.sort(
      (left, right) =>
        NORMALIZER_STEP_PHASE_ORDER.indexOf(left.phase) -
        NORMALIZER_STEP_PHASE_ORDER.indexOf(right.phase)
    );
  } else if (step.status !== 'error') {
    step.status = 'active';
  }
  return step;
}

export function applyNormalizerGenerationProgress(
  log: NormalizerGenerationLog,
  event: { phase: string; kind: 'message' | 'delta'; text: string }
): void {
  if (event.phase === 'error') {
    markNormalizerGenerationError(log, event.text);
    return;
  }
  if (event.phase === 'complete') {
    for (const step of log.steps) {
      if (step.status === 'active') step.status = 'done';
    }
    return;
  }
  const step = ensureGenerationStep(log, event.phase as NormalizerGenerationStepPhase);
  if (event.kind === 'delta') {
    step.stream += event.text;
    return;
  }
  step.notes.push(...cleanNormalizerProgressMessage(event.text));
}

export function markNormalizerGenerationSuccess(
  log: NormalizerGenerationLog,
  input: { versionNumber: number; files: DataNormalizerProjectFile[]; t: TranslateFn }
): void {
  for (const step of log.steps) {
    if (step.status === 'active') step.status = 'done';
  }
  log.finishedAt = Date.now();
  log.outcome = {
    status: 'success',
    title: input.t('data.rawTables.editor.generationResultSaved', {
      version: input.versionNumber,
      count: input.files.length,
    }),
    details: [],
    files: input.files.map((file) => file.path),
  };
}

export function markNormalizerGenerationError(log: NormalizerGenerationLog, message: string): void {
  const activeStep = [...log.steps].reverse().find((step) => step.status === 'active');
  if (activeStep) activeStep.status = 'error';
  log.finishedAt = Date.now();
  const lines = cleanNormalizerProgressMessage(message);
  log.outcome = {
    status: 'error',
    title: lines[0] ?? message,
    details: lines.slice(1),
    files: [],
  };
}

export function formatGenerationElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

export function truncateGenerationLogText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

export function buildNormalizerProjectTree(
  files: DataNormalizerProjectFile[]
): NormalizerProjectTreeNode[] {
  const roots: NormalizerProjectTreeNode[] = [];
  const folderMap = new Map<string, NormalizerProjectTreeNode>();
  const getFolder = (folderPath: string, name: string): NormalizerProjectTreeNode => {
    const existing = folderMap.get(folderPath);
    if (existing) return existing;
    const node: NormalizerProjectTreeNode = {
      name,
      path: folderPath,
      type: 'folder',
      children: [],
    };
    folderMap.set(folderPath, node);
    const parentPath = folderPath.includes('/')
      ? folderPath.slice(0, folderPath.lastIndexOf('/'))
      : '';
    if (parentPath) {
      const parentName = parentPath.split('/').pop() ?? parentPath;
      getFolder(parentPath, parentName).children.push(node);
    } else {
      roots.push(node);
    }
    return node;
  };

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    const fileName = parts[parts.length - 1];
    const folderParts = parts.slice(0, -1);
    const fileNode: NormalizerProjectTreeNode = {
      name: fileName,
      path: file.path,
      type: 'file',
      children: [],
    };
    if (folderParts.length === 0) {
      roots.push(fileNode);
      continue;
    }
    const folderPath = folderParts.join('/');
    const folder = getFolder(folderPath, folderParts[folderParts.length - 1]);
    folder.children.push(fileNode);
  }

  const sortTree = (nodes: NormalizerProjectTreeNode[]) => {
    nodes.sort(
      (left, right) =>
        Number(left.type === 'file') - Number(right.type === 'file') ||
        left.name.localeCompare(right.name)
    );
    nodes.forEach((node) => sortTree(node.children));
  };
  sortTree(roots);
  return roots;
}

export function getNormalizerVersionDiff(
  version: DataRawTableNormalizerArtifactVersion,
  current: DataRawTableNormalizerArtifactVersion | undefined
): { changed: number; added: number; removed: number; ruleSame: boolean } | null {
  if (!current || version.id === current.id) {
    return null;
  }
  // Git blob oids from the normalizer repo (equal oid = equal content).
  const currentFiles = new Map(Object.entries(current.tree ?? {}));
  const versionFiles = new Map(Object.entries(version.tree ?? {}));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [path, oid] of versionFiles) {
    if (!currentFiles.has(path)) {
      added += 1;
    } else if (currentFiles.get(path) !== oid) {
      changed += 1;
    }
  }
  for (const path of currentFiles.keys()) {
    if (!versionFiles.has(path)) {
      removed += 1;
    }
  }
  return {
    changed,
    added,
    removed,
    ruleSame: version.rulePrompt === current.rulePrompt,
  };
}

/** 已改 / 新增 markers for a version's files, compared with the published version in git. */
export function getNormalizerChangeMarkers(
  version: DataRawTableNormalizerArtifactVersion | undefined,
  published: DataRawTableNormalizerArtifactVersion | undefined,
  labels: { modified: string; added: string }
): Record<string, string> {
  if (!version || !published || version.id === published.id) return {};
  const markers: Record<string, string> = {};
  for (const [path, oid] of Object.entries(version.tree ?? {})) {
    const base = published.tree?.[path];
    if (base === undefined) markers[path] = labels.added;
    else if (base !== oid) markers[path] = labels.modified;
  }
  return markers;
}

export function inferNormalizerLanguageFromRulePrompt(rulePrompt: string): DataNormalizerLanguage {
  const normalized = rulePrompt.toLowerCase();
  if (/\b(node|node\.js|javascript|typescript|npm|js)\b/.test(normalized)) {
    return 'node';
  }
  return 'python';
}

export function getDefaultRawTableConfig(sourceKind: DataRawTableSourceKind): DataRawTableConfig {
  if (sourceKind === 'cloud') {
    return {
      sourceKind: 'cloud',
      cloudMirror: { tableId: '', contentHash: '' },
      dataProcessing: getDefaultRawTableDataProcessing(),
    };
  }
  if (sourceKind === 'excel') {
    return getDefaultExcelRawTableConfig();
  }
  if (sourceKind === 'folder') {
    return getDefaultFolderRawTableConfig();
  }
  return {
    sourceKind: 'csv',
    header: 'auto',
    dataRegion: 'auto',
    encoding: 'auto',
    delimiter: 'auto',
    dataProcessing: getDefaultRawTableDataProcessing(),
  };
}

export function getDefaultExcelRawTableConfig(): DataRawTableExcelConfig {
  return {
    sourceKind: 'excel',
    sheetName: 'Sheet1',
    sheetNames: ['Sheet1'],
    headerMode: 'auto',
    headerRow: 1,
    dataProcessing: getDefaultRawTableDataProcessing(),
  };
}

export function getDefaultFolderRawTableConfig(): DataRawTableFolderConfig {
  return {
    sourceKind: 'folder',
    mergeMode: 'append_same_schema',
    schemaStrategy: 'align_by_name',
    fileRange: 'excel_csv',
    skipEmptyFiles: true,
    keepSourceFileName: true,
    dataProcessing: getDefaultRawTableDataProcessing(),
  };
}

export function getDefaultRawTableDataProcessing(): DataRawTableProcessingConfig {
  return { strategy: 'auto' };
}

export function getRawTableDataProcessing(
  config: DataRawTableConfig
): DataRawTableProcessingConfig {
  if (config.dataProcessing?.strategy === 'customize') {
    return {
      ...config.dataProcessing,
      rulePrompt: config.dataProcessing.rulePrompt ?? '',
    };
  }
  return getDefaultRawTableDataProcessing();
}

export function withRawTableDataProcessing(
  config: DataRawTableConfig,
  dataProcessing: DataRawTableProcessingConfig
): DataRawTableConfig {
  return {
    ...config,
    dataProcessing,
  } as DataRawTableConfig;
}

export function isRawTableConfigEqual(
  left: DataRawTableConfig,
  right: DataRawTableConfig | undefined
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
