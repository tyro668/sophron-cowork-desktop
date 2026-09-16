import type {
  DataInputTableConfig,
  DataInputTableExcelConfig,
  DataInputTableFolderConfig,
  DataInputTableNormalizerArtifactVersion,
  DataInputTableProcessingConfig,
  DataInputTableSourceKind,
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

export function buildNormalizerGenerationStartOutput(input: {
  inputTableName: string;
  sourceKind: DataInputTableSourceKind;
  language: DataNormalizerLanguage;
  rulePrompt: string;
  t: TranslateFn;
}): string {
  return [
    `**${input.t('data.inputTables.editor.generationOutputStartTitle')}**`,
    '',
    `- ${input.t('data.inputTables.editor.generationOutputInputTable')}: ${input.inputTableName}`,
    `- ${input.t('data.inputTables.editor.generationOutputSourceKind')}: ${input.sourceKind}`,
    `- ${input.t('data.inputTables.editor.generationOutputLanguage')}: ${input.language === 'node' ? 'Node.js' : 'Python'}`,
    `- ${input.t('data.inputTables.editor.rulePrompt')}: ${truncateGenerationLogText(input.rulePrompt, 220)}`,
    '',
    '```text',
    input.t('data.inputTables.editor.generationOutputPreparing'),
    '```',
  ].join('\n');
}

export function buildNormalizerGenerationSuccessOutput(input: {
  artifactId: string;
  versionNumber: number;
  files: DataNormalizerProjectFile[];
  language: DataNormalizerLanguage;
  t: TranslateFn;
}): string {
  const fileLines = input.files.slice(0, 12).map((file) => `- ${file.path}`);
  const extraCount = Math.max(0, input.files.length - fileLines.length);
  if (extraCount > 0) {
    fileLines.push(`- ... +${extraCount}`);
  }
  return [
    '```text',
    `[4/4] ${input.t('data.inputTables.editor.generatedStatusReady')}`,
    `artifact=${input.artifactId}`,
    `version=v${input.versionNumber}`,
    `language=${input.language}`,
    '```',
    '',
    `**${input.t('data.inputTables.editor.generatedDraftFiles', {
      count: input.files.length,
    })}**`,
    '',
    ...fileLines,
  ].join('\n');
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

export function getNormalizerVersionDiffSummary(
  version: DataInputTableNormalizerArtifactVersion,
  current: DataInputTableNormalizerArtifactVersion | undefined,
  t: TranslateFn
): string {
  if (!current || version.id === current.id) {
    return '';
  }
  const currentFiles = new Map(current.files.map((file) => [file.path, file.content]));
  const versionFiles = new Map(version.files.map((file) => [file.path, file.content]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [path, content] of versionFiles) {
    if (!currentFiles.has(path)) {
      added += 1;
    } else if (currentFiles.get(path) !== content) {
      changed += 1;
    }
  }
  for (const path of currentFiles.keys()) {
    if (!versionFiles.has(path)) {
      removed += 1;
    }
  }
  return t('data.inputTables.editor.versionDiffSummary', {
    changed,
    added,
    removed,
    rule:
      version.rulePrompt === current.rulePrompt
        ? t('data.inputTables.editor.versionRuleSame')
        : t('data.inputTables.editor.versionRuleChanged'),
  });
}

export function inferNormalizerLanguageFromRulePrompt(rulePrompt: string): DataNormalizerLanguage {
  const normalized = rulePrompt.toLowerCase();
  if (/\b(node|node\.js|javascript|typescript|npm|js)\b/.test(normalized)) {
    return 'node';
  }
  return 'python';
}

export function getDefaultInputTableConfig(
  sourceKind: DataInputTableSourceKind
): DataInputTableConfig {
  if (sourceKind === 'excel') {
    return getDefaultExcelInputTableConfig();
  }
  if (sourceKind === 'folder') {
    return getDefaultFolderInputTableConfig();
  }
  return {
    sourceKind: 'csv',
    header: 'auto',
    dataRegion: 'auto',
    encoding: 'auto',
    delimiter: 'auto',
    dataProcessing: getDefaultInputTableDataProcessing(),
  };
}

export function getDefaultExcelInputTableConfig(): DataInputTableExcelConfig {
  return {
    sourceKind: 'excel',
    sheetName: 'Sheet1',
    sheetNames: ['Sheet1'],
    headerMode: 'auto',
    headerRow: 1,
    dataProcessing: getDefaultInputTableDataProcessing(),
  };
}

export function getDefaultFolderInputTableConfig(): DataInputTableFolderConfig {
  return {
    sourceKind: 'folder',
    mergeMode: 'append_same_schema',
    schemaStrategy: 'align_by_name',
    fileRange: 'excel_csv',
    skipEmptyFiles: true,
    keepSourceFileName: true,
    dataProcessing: getDefaultInputTableDataProcessing(),
  };
}

export function getDefaultInputTableDataProcessing(): DataInputTableProcessingConfig {
  return { strategy: 'auto' };
}

export function getInputTableDataProcessing(
  config: DataInputTableConfig
): DataInputTableProcessingConfig {
  if (config.dataProcessing?.strategy === 'customize') {
    return {
      ...config.dataProcessing,
      rulePrompt: config.dataProcessing.rulePrompt ?? '',
    };
  }
  return getDefaultInputTableDataProcessing();
}

export function withInputTableDataProcessing(
  config: DataInputTableConfig,
  dataProcessing: DataInputTableProcessingConfig
): DataInputTableConfig {
  return {
    ...config,
    dataProcessing,
  } as DataInputTableConfig;
}

export function isInputTableConfigEqual(
  left: DataInputTableConfig,
  right: DataInputTableConfig | undefined
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
