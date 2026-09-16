import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  type StringStream,
} from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  ArrowLeft,
  ArrowUpDown,
  ChevronDown,
  Code2,
  Copy,
  Eye,
  FileText,
  Folder,
  Info,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DataDataset,
  DataInputTableConfig,
  DataInputTableExcelConfig,
  DataInputTableFolderConfig,
  DataInputTableNormalizerArtifactVersion,
  DataInputTableNormalizerDraftProgressEvent,
  DataInputTablePreview,
  DataInputTableProcessingConfig,
  DataInputTableSourceKind,
  DataNormalizerLanguage,
  DataNormalizerProjectFile,
  Message,
} from '../../types';
import { useAppStore } from '../../store';
import { GlassSelect } from '../GlassSelect';
import { GlassDataGridPreview } from '../GlassDataGridPreview';
import { MessageCard } from '../MessageCard';
import { getAgentModelLabel } from '../AgentModelSelector';
import { LlmPromptComposer } from '../LlmPromptComposer';
import { useConfirmDialog } from '../ConfirmDialog';
import type { InputTableDraft, InputTableSourceFilter } from '../../features/data/model/types';
import { dataClient } from '../../features/data/api/data-client';
import {
  DataMoreMenu,
  DataTableSearch,
  DataToolbarButton,
  EmptyState,
  INPUT_TABLE_PREVIEW_PAGE_SIZE,
  InputTableStatusBadge,
  LoadingState,
  PaginationFooter,
  TABLE_PAGE_SIZE,
  TranslateFn,
  formatDateTime,
  formatDisplayPath,
  formatRelatedTaskNames,
  getInputTableSourceMeta,
  getTablePageCount,
  matchesSearchText,
} from './shared';

const INPUT_TABLE_SOURCE_FILTERS: Array<{
  value: InputTableSourceFilter;
  labelKey: string;
}> = [
  { value: 'all', labelKey: 'data.inputTables.sources.all' },
  { value: 'excel', labelKey: 'data.inputTables.sources.excel' },
  { value: 'csv', labelKey: 'data.inputTables.sources.csv' },
  { value: 'folder', labelKey: 'data.inputTables.sources.folder' },
];

type CodePreviewLanguageKind = 'python' | 'javascript' | 'json' | 'toml' | 'markdown' | 'text';

const CODE_PREVIEW_KEYWORDS: Record<Exclude<CodePreviewLanguageKind, 'text'>, Set<string>> = {
  python: new Set([
    'and',
    'as',
    'async',
    'await',
    'break',
    'class',
    'continue',
    'def',
    'elif',
    'else',
    'except',
    'finally',
    'for',
    'from',
    'if',
    'import',
    'in',
    'is',
    'lambda',
    'not',
    'or',
    'pass',
    'raise',
    'return',
    'try',
    'while',
    'with',
    'yield',
  ]),
  javascript: new Set([
    'async',
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'default',
    'else',
    'export',
    'extends',
    'finally',
    'for',
    'from',
    'function',
    'if',
    'import',
    'let',
    'new',
    'return',
    'switch',
    'throw',
    'try',
    'var',
    'while',
  ]),
  json: new Set(['true', 'false', 'null']),
  toml: new Set(['true', 'false']),
  markdown: new Set([]),
};

const codePreviewHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--code-token-keyword)', fontWeight: '500' },
  { tag: tags.string, color: 'var(--code-token-string)' },
  { tag: tags.number, color: 'var(--code-token-number)' },
  { tag: tags.atom, color: 'var(--code-token-atom)' },
  { tag: tags.propertyName, color: 'var(--code-token-property)' },
  { tag: tags.variableName, color: 'var(--code-token-variable)' },
  { tag: tags.typeName, color: 'var(--code-token-property)', fontWeight: '500' },
  { tag: tags.heading, color: 'var(--code-token-keyword)', fontWeight: '600' },
  { tag: tags.strong, color: 'var(--code-token-variable)', fontWeight: '500' },
  { tag: tags.comment, color: 'var(--code-token-comment)', fontStyle: 'italic' },
]);

const codePreviewTheme = EditorView.theme({
  '&': {
    height: '100%',
    minHeight: '100%',
    backgroundColor: 'var(--code-preview-background)',
    color: 'var(--code-preview-text)',
    fontSize: '11px',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: '1.55',
    overflow: 'auto',
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '0.5rem 1rem 0.75rem 0.25rem',
  },
  '.cm-line': {
    padding: '0 0.125rem',
  },
  '.cm-gutters': {
    borderRight: '1px solid var(--code-preview-gutter-border)',
    backgroundColor: 'var(--code-preview-gutter-background)',
    color: 'var(--code-preview-muted)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '2.75rem',
    padding: '0 0.75rem 0 0.5rem',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--code-preview-selection) !important',
  },
  '.cm-scroller::-webkit-scrollbar': {
    width: '8px',
    height: '8px',
  },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    backgroundColor: 'var(--code-preview-muted)',
    borderRadius: '999px',
  },
  '.cm-scroller::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
});

const codePreviewLanguages = {
  python: createCodePreviewStreamLanguage('python'),
  javascript: createCodePreviewStreamLanguage('javascript'),
  json: createCodePreviewStreamLanguage('json'),
  toml: createCodePreviewStreamLanguage('toml'),
  markdown: createCodePreviewStreamLanguage('markdown'),
};

function createCodePreviewStreamLanguage(kind: Exclude<CodePreviewLanguageKind, 'text'>) {
  return StreamLanguage.define({
    name: kind,
    token(stream) {
      return tokenCodePreviewStream(stream, kind);
    },
  });
}

function tokenCodePreviewStream(
  stream: StringStream,
  kind: Exclude<CodePreviewLanguageKind, 'text'>
): string | null {
  if (stream.eatSpace()) return null;
  if (kind === 'markdown' && stream.sol() && stream.match(/#{1,6}\s.*/)) return 'heading';
  if (kind === 'markdown' && stream.match(/\*\*[^*]+\*\*/)) return 'strong';
  if (kind === 'markdown' && stream.match(/`[^`]+`/)) return 'string';
  if ((kind === 'python' || kind === 'toml') && stream.match(/#.*/)) return 'comment';
  if (kind === 'javascript' && stream.match(/\/\/.*/)) return 'comment';
  if (kind === 'javascript' && stream.match(/\/\*.*?\*\//)) return 'comment';
  if (stream.match(/"(?:[^"\\]|\\.)*"/)) return 'string';
  if ((kind === 'python' || kind === 'javascript') && stream.match(/'(?:[^'\\]|\\.)*'/)) {
    return 'string';
  }
  if (kind === 'javascript' && stream.match(/`(?:[^`\\]|\\.)*`/)) return 'string';
  if (stream.match(/-?(?:0x[\da-f]+|\d+(?:\.\d+)?)(?:e[+-]?\d+)?/i)) return 'number';
  if ((kind === 'json' || kind === 'toml') && stream.match(/[A-Za-z0-9_.-]+(?=\s*=)/)) {
    return 'propertyName';
  }
  if (kind === 'json' && stream.match(/"(?:[^"\\]|\\.)*"(?=\s*:)/)) return 'propertyName';
  if (stream.match(/[A-Za-z_$][\w$]*/)) {
    const token = stream.current();
    if (CODE_PREVIEW_KEYWORDS[kind].has(token)) {
      return token === 'true' || token === 'false' || token === 'null' ? 'atom' : 'keyword';
    }
    if (/^[A-Z][A-Za-z0-9_]*$/.test(token)) return 'typeName';
    return 'variableName';
  }
  stream.next();
  return null;
}

function getCodePreviewLanguage(filePath: string) {
  const normalized = filePath.toLowerCase();
  if (/\.(py|pyw)$/.test(normalized)) return codePreviewLanguages.python;
  if (/\.(js|jsx|mjs|cjs|ts|tsx)$/.test(normalized)) {
    return codePreviewLanguages.javascript;
  }
  if (/\.json$/.test(normalized)) return codePreviewLanguages.json;
  if (/\.(toml|lock)$/.test(normalized)) return codePreviewLanguages.toml;
  if (/\.(md|markdown)$/.test(normalized)) return codePreviewLanguages.markdown;
  return [];
}

export function InputTablesPanel({
  datasets,
  drafts,
  totalDatasets,
  currentPage,
  searchQuery,
  isLoading,
  sourceFilter,
  onSearchChange,
  onSourceFilterChange,
  onPageChange,
  onCreate,
  onRefresh,
  onPreviewDataset,
  onDelete,
  onDeleteAll,
  onDeleteDraft,
  onEditDraft,
  onEditDataset,
  isCreateDisabled,
  actionId,
}: {
  datasets: DataDataset[];
  drafts: InputTableDraft[];
  totalDatasets: number;
  currentPage: number;
  searchQuery: string;
  isLoading: boolean;
  sourceFilter: InputTableSourceFilter;
  onSearchChange: (value: string) => void;
  onSourceFilterChange: (source: InputTableSourceFilter) => void;
  onPageChange: (page: number) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onPreviewDataset: (dataset: DataDataset) => void;
  onDelete: (dataset: DataDataset) => void;
  onDeleteAll: () => void;
  onDeleteDraft: (id: string) => void;
  onEditDraft: (id: string) => void;
  onEditDataset: (id: string) => void;
  isCreateDisabled: boolean;
  actionId: string | null;
}) {
  const { t } = useTranslation();
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const filteredDrafts = useMemo(
    () =>
      sourceFilter === 'all'
        ? drafts.filter((draft) => matchesSearchText(draft.name, searchQuery))
        : [],
    [drafts, searchQuery, sourceFilter]
  );
  const draftCount = filteredDrafts.length;
  const totalRows = totalDatasets + draftCount;
  const pageCount = getTablePageCount(totalRows);
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);
  const draftStart = (safeCurrentPage - 1) * TABLE_PAGE_SIZE;
  const pageDrafts = useMemo(
    () =>
      !isLoading && sourceFilter === 'all'
        ? filteredDrafts.slice(draftStart, draftStart + TABLE_PAGE_SIZE)
        : [],
    [draftStart, filteredDrafts, isLoading, sourceFilter]
  );
  const visibleRows = useMemo(
    () =>
      isLoading
        ? []
        : [
            ...pageDrafts.map((draft) => ({ kind: 'draft' as const, id: draft.id, draft })),
            ...datasets.map((dataset) => ({ kind: 'dataset' as const, id: dataset.id, dataset })),
          ],
    [datasets, isLoading, pageDrafts]
  );
  const pageRows = visibleRows;
  const emptyLabel =
    sourceFilter === 'all' ? t('data.inputTables.empty') : t('data.inputTables.emptyFiltered');
  const selectedRow = visibleRows.find((row) => row.id === selectedDatasetId) ?? null;
  const selectedDataset = selectedRow?.kind === 'dataset' ? selectedRow.dataset : null;
  const selectedDraft = selectedRow?.kind === 'draft' ? selectedRow.draft : null;
  const selectedRowBusy = selectedRow ? actionId === selectedRow.id : false;
  const bulkBusy = actionId === 'delete-all-input-tables';

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (selectedDatasetId && !visibleRows.some((row) => row.id === selectedDatasetId)) {
      setSelectedDatasetId(null);
    }
  }, [isLoading, selectedDatasetId, visibleRows]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="mb-3 flex flex-shrink-0 flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button
            onClick={onCreate}
            disabled={isCreateDisabled || bulkBusy}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('data.inputTables.add')}
          </button>
          <DataTableSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={t('data.inputTables.searchPlaceholder')}
          />
          <label className="block w-32">
            <span className="sr-only">{t('data.inputTables.sourceFilter')}</span>
            <GlassSelect
              value={sourceFilter}
              onValueChange={(value) => onSourceFilterChange(value as InputTableSourceFilter)}
              options={INPUT_TABLE_SOURCE_FILTERS.map((option) => ({
                value: option.value,
                label: t(option.labelKey),
              }))}
              disabled={bulkBusy}
              triggerClassName="h-8 w-full justify-between rounded-lg bg-surface pl-3 text-xs font-medium text-text-secondary hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:opacity-45"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <DataToolbarButton
            icon={<Eye className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.preview')}
            disabled={!selectedDataset || bulkBusy}
            onClick={() => {
              if (selectedDataset) {
                onPreviewDataset(selectedDataset);
              }
            }}
          />
          <DataToolbarButton
            icon={<PencilLine className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.edit')}
            disabled={!selectedRow || bulkBusy}
            onClick={() => {
              if (selectedDraft) {
                onEditDraft(selectedDraft.id);
              } else if (selectedDataset) {
                onEditDataset(selectedDataset.id);
              }
            }}
          />
          <DataToolbarButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.delete')}
            disabled={!selectedRow || selectedRowBusy || bulkBusy}
            danger
            onClick={() => {
              if (selectedDraft) {
                onDeleteDraft(selectedDraft.id);
              } else if (selectedDataset) {
                onDelete(selectedDataset);
              }
            }}
          />
          <DataMoreMenu
            items={[
              {
                key: 'refresh',
                label: t('data.actions.refresh'),
                icon: <RefreshCw className="h-3.5 w-3.5" />,
                disabled: bulkBusy,
                onClick: onRefresh,
              },
              {
                key: 'delete-all',
                label: t('data.actions.deleteAll'),
                icon: <Trash2 className="h-3.5 w-3.5" />,
                danger: true,
                disabled: totalRows <= 0 || bulkBusy,
                onClick: onDeleteAll,
              },
            ]}
          />
        </div>
      </div>

      <div className="glass-table flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <LoadingState label={t('data.inputTables.loading')} />
          ) : visibleRows.length === 0 ? (
            <EmptyState label={emptyLabel} />
          ) : (
            <div className="min-w-full overflow-x-auto">
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted backdrop-blur-xl">
                    <th className="w-[4%] px-4">
                      <span className="sr-only">{t('data.inputTables.selection')}</span>
                    </th>
                    <th className="w-[22%] whitespace-nowrap px-2">
                      {t('data.columns.inputTableName')}
                    </th>
                    <th className="w-[9%] whitespace-nowrap px-2">
                      {t('data.columns.sourceType')}
                    </th>
                    <th className="w-[22%] whitespace-nowrap px-2">
                      {t('data.columns.sourceLocation')}
                    </th>
                    <th className="w-[17%] whitespace-nowrap px-2">
                      {t('data.columns.relatedTasks')}
                    </th>
                    <th className="w-[16%] whitespace-nowrap px-2">
                      <span className="inline-flex items-center gap-1">
                        {t('data.columns.updatedAt')}
                        <ArrowUpDown className="h-3 w-3" />
                      </span>
                    </th>
                    <th className="w-[10%] whitespace-nowrap px-2">{t('data.columns.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, index) => {
                    const dataset = row.kind === 'dataset' ? row.dataset : null;
                    const draft = row.kind === 'draft' ? row.draft : null;
                    const sourceKind = dataset ? dataset.sourceKind : 'draft';
                    const sourceMeta = getInputTableSourceMeta(sourceKind);
                    const SourceIcon = sourceMeta.Icon;
                    const selected = row.id === selectedDatasetId;
                    const rowName = dataset?.name ?? draft?.name ?? '';
                    const rowUpdatedAt = dataset?.updatedAt ?? draft?.updatedAt ?? null;
                    return (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedDatasetId(row.id)}
                        onDoubleClick={() => {
                          if (draft) {
                            onEditDraft(draft.id);
                          } else if (dataset) {
                            onEditDataset(dataset.id);
                          }
                        }}
                        className={`h-[3.25rem] cursor-pointer border-b border-dashed border-border-muted/85 last:border-b-0 transition-colors ${
                          selected
                            ? 'bg-accent/10 ring-1 ring-inset ring-accent/20'
                            : index === 1
                              ? 'bg-accent/5'
                              : 'hover:bg-surface-hover/35'
                        }`}
                      >
                        <td className="px-4">
                          <input
                            type="radio"
                            name="input-table-selection"
                            checked={selected}
                            onChange={() => setSelectedDatasetId(row.id)}
                            onClick={(event) => event.stopPropagation()}
                            className="h-3.5 w-3.5 accent-accent"
                            aria-label={rowName}
                          />
                        </td>
                        <td className="px-2">
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${sourceMeta.className}`}
                            >
                              <SourceIcon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 truncate text-[13px] font-medium text-text-secondary">
                              {rowName}
                            </div>
                          </div>
                        </td>
                        <td className="px-2">
                          <span
                            className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-medium ${sourceMeta.badgeClassName}`}
                          >
                            {t(sourceMeta.labelKey)}
                          </span>
                        </td>
                        <td className="px-2">
                          <div
                            className="truncate text-[13px] font-medium text-text-secondary"
                            title={dataset?.sourcePath}
                          >
                            {dataset
                              ? formatDisplayPath(dataset.sourcePath)
                              : t('data.inputTables.notConfigured')}
                          </div>
                        </td>
                        <td className="px-2">
                          <div className="truncate text-[13px] font-medium text-text-secondary">
                            {dataset
                              ? formatRelatedTaskNames(dataset.relatedTaskNames, t)
                              : t('data.inputTables.noRelatedTasks')}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                          {formatDateTime(rowUpdatedAt)}
                        </td>
                        <td className="px-2">
                          <InputTableStatusBadge
                            label={
                              draft
                                ? t('data.inputTables.status.draft')
                                : t('data.inputTables.status.available')
                            }
                            tone={draft ? 'warning' : 'success'}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <PaginationFooter
          count={totalRows}
          currentPage={currentPage}
          onPageChange={onPageChange}
          embedded
        />
      </div>
    </div>
  );
}

type InputTableEditorProps = {
  draft?: InputTableDraft;
  dataset?: DataDataset;
  isBusy: boolean;
  onBack: () => void;
  onRenameDraft?: (id: string, name: string) => void;
  onRenameDataset?: (dataset: DataDataset, name: string) => void | Promise<void>;
  onChooseDraftSource?: (
    draft: InputTableDraft,
    sourceKind: DataInputTableSourceKind,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
  onChooseDatasetSource?: (
    dataset: DataDataset,
    sourceKind: DataInputTableSourceKind,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
  onUpdateDatasetConfig?: (
    dataset: DataDataset,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
};

type InputTableEditorTab = 'rules' | 'code' | 'versions';

function InputTableEditorWorkbench({
  draft,
  dataset,
  isBusy,
  onBack,
  onRenameDraft,
  onRenameDataset,
  onChooseDraftSource,
  onChooseDatasetSource,
  onUpdateDatasetConfig,
}: InputTableEditorProps) {
  const { t } = useTranslation();
  const { confirmDelete } = useConfirmDialog();
  const appConfig = useAppStore((state) => state.appConfig);
  const targetId = draft?.id ?? dataset?.id ?? '';
  const initialName = draft?.name ?? dataset?.name ?? '';
  const initialSourceKind = dataset?.sourceKind ?? 'excel';
  const initialConfig = useMemo(
    () => dataset?.inputConfig ?? getDefaultInputTableConfig(initialSourceKind),
    [dataset?.inputConfig, initialSourceKind]
  );
  const [localName, setLocalName] = useState(initialName);
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [localSourceKind, setLocalSourceKind] =
    useState<DataInputTableSourceKind>(initialSourceKind);
  const [localConfig, setLocalConfig] = useState<DataInputTableConfig>(initialConfig);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DataInputTablePreview | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [customizeGenerating, setCustomizeGenerating] = useState(false);
  const [customizeGenerationOutput, setCustomizeGenerationOutput] = useState('');
  const [customizeVersionActionId, setCustomizeVersionActionId] = useState<string | null>(null);
  const [deletingNormalizerVersionId, setDeletingNormalizerVersionId] = useState<string | null>(
    null
  );
  const [normalizerVersions, setNormalizerVersions] = useState<
    DataInputTableNormalizerArtifactVersion[]
  >([]);
  const [normalizerVersionsLoading, setNormalizerVersionsLoading] = useState(false);
  const [customizeGenerationError, setCustomizeGenerationError] = useState<string | null>(null);
  const [activeEditorTab, setActiveEditorTab] = useState<InputTableEditorTab>('rules');
  const [selectedNormalizerFilePath, setSelectedNormalizerFilePath] = useState('');
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const trimmedName = localName.trim();
  const isConfigured = Boolean(dataset);
  const sourceMeta = getInputTableSourceMeta(localSourceKind);
  const SourceIcon = sourceMeta.Icon;
  const excelConfig =
    localConfig.sourceKind === 'excel' ? localConfig : getDefaultExcelInputTableConfig();
  const folderConfig =
    localConfig.sourceKind === 'folder' ? localConfig : getDefaultFolderInputTableConfig();
  const dataProcessing = getInputTableDataProcessing(localConfig);
  const normalizerLanguage: DataNormalizerLanguage =
    dataProcessing.strategy === 'customize'
      ? inferNormalizerLanguageFromRulePrompt(dataProcessing.rulePrompt)
      : 'python';
  const hasNameChanges = Boolean(dataset && trimmedName && trimmedName !== dataset.name);
  const canSaveConfig =
    Boolean(dataset) &&
    localSourceKind === dataset?.sourceKind &&
    !isInputTableConfigEqual(localConfig, dataset?.inputConfig);
  const canSave = Boolean(dataset && trimmedName && !isBusy && (hasNameChanges || canSaveConfig));
  const canPreview = Boolean(
    dataset &&
    localSourceKind === dataset.sourceKind &&
    !isBusy &&
    dataClient.has('previewInputTable')
  );
  const canGenerateCustomizeDraft = Boolean(
    dataset &&
    dataProcessing.strategy === 'customize' &&
    dataProcessing.rulePrompt.trim() &&
    !customizeGenerating
  );
  const currentNormalizerVersion =
    dataProcessing.strategy === 'customize'
      ? normalizerVersions.find((version) => version.id === dataProcessing.artifactVersionId)
      : undefined;
  const customizeArtifactId =
    dataProcessing.strategy === 'customize' ? dataProcessing.artifactId : undefined;
  const customizeArtifactVersionId =
    dataProcessing.strategy === 'customize' ? dataProcessing.artifactVersionId : undefined;
  const normalizerProjectFiles = useMemo(() => {
    if (dataProcessing.strategy !== 'customize') return [];
    if (dataProcessing.projectFiles && dataProcessing.projectFiles.length > 0) {
      return dataProcessing.projectFiles;
    }
    return currentNormalizerVersion?.files ?? [];
  }, [currentNormalizerVersion, dataProcessing]);
  const normalizerProjectFileSignature = useMemo(
    () => normalizerProjectFiles.map((file) => file.path).join('\n'),
    [normalizerProjectFiles]
  );
  const selectedNormalizerFile = useMemo(() => {
    if (normalizerProjectFiles.length === 0) return undefined;
    return (
      normalizerProjectFiles.find((file) => file.path === selectedNormalizerFilePath) ??
      normalizerProjectFiles.find(
        (file) =>
          file.path === getPreferredNormalizerFilePath(normalizerProjectFiles, normalizerLanguage)
      ) ??
      normalizerProjectFiles[0]
    );
  }, [normalizerLanguage, normalizerProjectFiles, selectedNormalizerFilePath]);

  useEffect(() => {
    setLocalName(initialName);
    setIsNameEditing(false);
    setLocalSourceKind(initialSourceKind);
    setLocalConfig(initialConfig);
    setCustomizeGenerationError(null);
    setCustomizeGenerationOutput('');
    setCustomizeGenerating(false);
    setCustomizeVersionActionId(null);
    setDeletingNormalizerVersionId(null);
    setActiveEditorTab('rules');
    setSelectedNormalizerFilePath('');
  }, [initialConfig, initialName, initialSourceKind, targetId]);

  useEffect(() => {
    if (!isNameEditing) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [isNameEditing]);

  useEffect(() => {
    const preferredPath = getPreferredNormalizerFilePath(
      normalizerProjectFiles,
      normalizerLanguage
    );
    setSelectedNormalizerFilePath((current) => {
      if (current && normalizerProjectFiles.some((file) => file.path === current)) {
        return current;
      }
      return preferredPath;
    });
  }, [normalizerLanguage, normalizerProjectFileSignature, normalizerProjectFiles]);

  const handleNameChange = (value: string) => {
    setLocalName(value);
    if (draft && onRenameDraft) {
      onRenameDraft(draft.id, value);
    }
  };

  const chooseSource = (sourceKind: DataInputTableSourceKind, config = localConfig) => {
    const nextConfig =
      config.sourceKind === sourceKind ? config : getDefaultInputTableConfig(sourceKind);
    if (draft && onChooseDraftSource) {
      void onChooseDraftSource(draft, sourceKind, nextConfig, localName);
    } else if (dataset && onChooseDatasetSource) {
      void onChooseDatasetSource(dataset, sourceKind, nextConfig, localName);
    }
  };

  const handleSourceKindChange = (sourceKind: DataInputTableSourceKind) => {
    const nextConfig = getDefaultInputTableConfig(sourceKind);
    setLocalSourceKind(sourceKind);
    setLocalConfig(nextConfig);
  };

  const updateConfig = (config: DataInputTableConfig) => {
    setLocalConfig(config);
  };

  const updateDataProcessing = useCallback(
    (dataProcessing: DataInputTableProcessingConfig) => {
      setLocalConfig(withInputTableDataProcessing(localConfig, dataProcessing));
    },
    [localConfig]
  );

  const customizeSelectedSkillNames = useMemo(() => {
    if (dataProcessing.strategy !== 'customize') return [];
    return Array.isArray(dataProcessing.selectedSkillNames)
      ? dataProcessing.selectedSkillNames.filter((name): name is string => typeof name === 'string')
      : [];
  }, [dataProcessing]);

  const selectedCustomizeModelConfigSetId =
    dataProcessing.strategy === 'customize' &&
    typeof dataProcessing.modelConfigSetId === 'string' &&
    dataProcessing.modelConfigSetId.trim()
      ? dataProcessing.modelConfigSetId
      : appConfig?.activeConfigSetId;

  const patchCustomizeDataProcessing = useCallback(
    (patch: Partial<Extract<DataInputTableProcessingConfig, { strategy: 'customize' }>>) => {
      if (dataProcessing.strategy !== 'customize') return;
      updateDataProcessing({
        ...dataProcessing,
        ...patch,
      });
    },
    [dataProcessing, updateDataProcessing]
  );

  const appendGenerationOutput = useCallback((line: string) => {
    setCustomizeGenerationOutput((current) => `${current}${current ? '\n' : ''}${line}`);
  }, []);

  const appendGenerationOutputChunk = useCallback((chunk: string) => {
    setCustomizeGenerationOutput((current) => `${current}${chunk}`);
  }, []);

  const refreshNormalizerVersions = useCallback(async (artifactId: string | undefined) => {
    if (!artifactId) {
      setNormalizerVersions([]);
      return;
    }
    setNormalizerVersionsLoading(true);
    try {
      const result = await dataClient.listInputTableNormalizerVersions({
        artifactId,
      });
      setNormalizerVersions(result.versions);
    } catch (err) {
      setCustomizeGenerationError(err instanceof Error ? err.message : String(err));
    } finally {
      setNormalizerVersionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshNormalizerVersions(customizeArtifactId);
  }, [customizeArtifactId, refreshNormalizerVersions]);

  const generateCustomizeDraft = async () => {
    if (dataProcessing.strategy !== 'customize') return;
    const rulePrompt = dataProcessing.rulePrompt.trim();
    if (!rulePrompt || !dataset) {
      return;
    }
    setActiveEditorTab('rules');
    setCustomizeGenerationOutput(
      buildNormalizerGenerationStartOutput({
        inputTableName: dataset.name,
        sourceKind: localSourceKind,
        language: normalizerLanguage,
        rulePrompt,
        t,
      })
    );
    setCustomizeGenerating(true);
    setCustomizeGenerationError(null);
    const progressId = createNormalizerGenerationProgressId();
    const unsubscribeProgress = dataClient.onInputTableNormalizerDraftProgress(
      (event: DataInputTableNormalizerDraftProgressEvent) => {
        if (event.progressId !== progressId) return;
        if (typeof event.text !== 'string' || event.text.length === 0) return;
        if (event.kind === 'delta') {
          appendGenerationOutputChunk(event.text);
        } else {
          appendGenerationOutput(event.text);
        }
      }
    );
    try {
      const result = await dataClient.generateInputTableNormalizerDraft({
        artifactId: dataProcessing.artifactId,
        name: `${dataset.name} normalizer`,
        sourcePath: dataset.sourcePath,
        sourceKind: localSourceKind,
        config: localConfig,
        rulePrompt,
        selectedSkillNames: customizeSelectedSkillNames,
        modelConfigSetId: selectedCustomizeModelConfigSetId,
        model: getAgentModelLabel(appConfig, '', selectedCustomizeModelConfigSetId),
        primaryLanguage: normalizerLanguage,
        progressId,
      });
      updateDataProcessing({
        ...dataProcessing,
        rulePrompt: result.version.rulePrompt,
        artifactId: result.artifact.id,
        artifactVersionId: result.version.id,
        artifactVersionStatus: result.version.status,
        fileTreeHash: result.version.fileTreeHash,
        dependencyLockHash: result.version.dependencyLockHash ?? undefined,
        runtime: result.version.runtime,
        entrypoint: result.version.entrypoint,
        dependencyPrepare: result.version.dependencyPrepare,
        projectFiles: result.version.files,
        sourceSummaryHash: result.version.sourceSummaryHash ?? result.summary.hash,
      });
      setSelectedNormalizerFilePath(
        getPreferredNormalizerFilePath(result.version.files, result.version.runtime.language)
      );
      void refreshNormalizerVersions(result.artifact.id);
      appendGenerationOutput(
        buildNormalizerGenerationSuccessOutput({
          artifactId: result.artifact.id,
          versionNumber: result.version.version,
          files: result.version.files,
          language: result.artifact.primaryLanguage,
          t,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCustomizeGenerationError(message);
      appendGenerationOutput(
        `${t('data.inputTables.editor.generationOutputFailed')}\n\n${message}`
      );
    } finally {
      unsubscribeProgress?.();
      setCustomizeGenerating(false);
    }
  };

  const saveInputTable = () => {
    if (!dataset || !trimmedName) return;
    if (canSaveConfig && onUpdateDatasetConfig) {
      void onUpdateDatasetConfig(dataset, localConfig, localName);
      return;
    }
    if (hasNameChanges && onRenameDataset) {
      void onRenameDataset(dataset, localName);
    }
  };

  const loadPreviewPage = async (page: number) => {
    if (!dataset || !dataClient.has('previewInputTable')) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewPage(page);
    try {
      const nextPreview = await dataClient.previewInputTable({
        filePath: dataset.sourcePath,
        sourceKind: localSourceKind,
        config: localConfig,
        limit: INPUT_TABLE_PREVIEW_PAGE_SIZE,
        offset: (page - 1) * INPUT_TABLE_PREVIEW_PAGE_SIZE,
      });
      setPreviewData(nextPreview);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const previewInputTable = async () => {
    setPreviewData(null);
    await loadPreviewPage(1);
  };

  const previewCustomizeDraft = async () => {
    if (dataProcessing.strategy !== 'customize' || !dataProcessing.artifactVersionId || !dataset) {
      return;
    }
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewData(null);
    setPreviewPage(1);
    try {
      const result = await dataClient.previewInputTableNormalizerVersion({
        versionId: dataProcessing.artifactVersionId,
        sourcePath: dataset.sourcePath,
        sourceKind: localSourceKind,
        config: localConfig,
        prepareDependencies: true,
        limit: INPUT_TABLE_PREVIEW_PAGE_SIZE,
        offset: 0,
      });
      setPreviewData(result.preview);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const publishSpecificNormalizerVersion = async (
    version: DataInputTableNormalizerArtifactVersion
  ) => {
    if (dataProcessing.strategy !== 'customize' || !dataset) {
      return;
    }
    setCustomizeVersionActionId(version.id);
    setCustomizeGenerationError(null);
    try {
      const result = await dataClient.publishInputTableNormalizerVersion({
        versionId: version.id,
      });
      updateDataProcessing({
        ...dataProcessing,
        artifactId: result.artifact.id,
        artifactVersionId: result.version.id,
        artifactVersionStatus: result.version.status,
        fileTreeHash: result.version.fileTreeHash,
        dependencyLockHash: result.version.dependencyLockHash ?? undefined,
        runtime: result.version.runtime,
        entrypoint: result.version.entrypoint,
        dependencyPrepare: result.version.dependencyPrepare,
        projectFiles: result.version.files,
        sourceSummaryHash: result.version.sourceSummaryHash ?? undefined,
      });
      void refreshNormalizerVersions(result.artifact.id);
    } catch (err) {
      setCustomizeGenerationError(err instanceof Error ? err.message : String(err));
    } finally {
      setCustomizeVersionActionId(null);
    }
  };

  const deleteSpecificNormalizerVersion = async (
    version: DataInputTableNormalizerArtifactVersion
  ) => {
    if (dataProcessing.strategy !== 'customize' || !dataset) {
      return;
    }
    if (version.status === 'published') {
      setCustomizeGenerationError(t('data.inputTables.editor.deletePublishedVersionBlocked'));
      return;
    }
    const confirmed = await confirmDelete({
      message: t('data.inputTables.editor.deleteVersionConfirm', {
        version: version.version,
      }),
    });
    if (!confirmed) return;
    setDeletingNormalizerVersionId(version.id);
    setCustomizeGenerationError(null);
    try {
      await dataClient.deleteInputTableNormalizerVersion({
        versionId: version.id,
      });
      if (dataProcessing.artifactVersionId === version.id) {
        updateDataProcessing({
          ...dataProcessing,
          artifactVersionId: undefined,
          artifactVersionStatus: undefined,
          fileTreeHash: undefined,
          dependencyLockHash: undefined,
          runtime: undefined,
          entrypoint: undefined,
          dependencyPrepare: undefined,
          projectFiles: undefined,
          sourceSummaryHash: undefined,
        });
        setSelectedNormalizerFilePath('');
      }
      void refreshNormalizerVersions(dataProcessing.artifactId);
    } catch (err) {
      setCustomizeGenerationError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingNormalizerVersionId(null);
    }
  };

  const editorTabs: Array<{ value: InputTableEditorTab; label: string }> = [
    { value: 'rules', label: t('data.inputTables.editor.ruleDescription') },
    { value: 'code', label: t('data.inputTables.editor.codePreview') },
    { value: 'versions', label: t('data.inputTables.editor.versionHistory') },
  ];

  return (
    <>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mb-3 flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <button
              onClick={onBack}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t('data.inputTables.editor.backShort')}
            </button>
            <div className="flex min-w-0 items-center gap-2">
              <InputTableStatusBadge
                label={
                  isConfigured
                    ? t('data.inputTables.status.available')
                    : t('data.inputTables.status.draft')
                }
                tone={isConfigured ? 'success' : 'warning'}
              />
              {isNameEditing ? (
                <input
                  ref={nameInputRef}
                  value={localName}
                  onChange={(event) => handleNameChange(event.target.value)}
                  onBlur={() => setIsNameEditing(false)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }
                    if (event.key === 'Escape') {
                      if (dataset) {
                        setLocalName(dataset.name);
                      }
                      setIsNameEditing(false);
                    }
                  }}
                  disabled={isBusy}
                  maxLength={50}
                  aria-label={t('data.inputTables.editor.name')}
                  className="h-8 min-w-0 max-w-[22rem] truncate border-0 bg-transparent px-0 text-[15px] font-medium text-text-secondary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder={t('data.inputTables.editor.title')}
                />
              ) : (
                <div
                  className="flex h-8 min-w-0 max-w-[22rem] items-center truncate text-[15px] font-medium text-text-secondary"
                  title={localName || t('data.inputTables.editor.title')}
                >
                  {localName || t('data.inputTables.editor.title')}
                </div>
              )}
              <button
                type="button"
                onClick={() => setIsNameEditing(true)}
                disabled={isBusy || isNameEditing}
                className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
                aria-label={t('common.edit')}
                title={t('common.edit')}
              >
                <PencilLine className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void previewInputTable()}
              disabled={!canPreview || previewLoading}
              className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {previewLoading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {t('data.inputTables.editor.preview')}
            </button>
            <button
              type="button"
              onClick={saveInputTable}
              disabled={!canSave}
              className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {isBusy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-muted bg-[var(--glass-card)] shadow-card backdrop-blur-xl">
          <div className="grid flex-shrink-0 gap-2 border-b border-border-muted/80 px-5 py-4">
            <InputTableConfigRow label={t('data.inputTables.editor.sourceType')}>
              <GlassSelect
                value={localSourceKind}
                onValueChange={(value) => handleSourceKindChange(value as DataInputTableSourceKind)}
                options={[
                  { value: 'excel', label: t('data.inputTables.editor.excel') },
                  { value: 'csv', label: t('data.inputTables.editor.csv') },
                  { value: 'folder', label: t('data.inputTables.editor.folder') },
                ]}
                disabled={isBusy}
                triggerIcon={
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-md ${sourceMeta.className}`}
                  >
                    <SourceIcon className="h-4 w-4" />
                  </span>
                }
                triggerClassName="!h-10 w-full justify-between rounded-lg bg-background/50 px-3 text-[14px] font-medium text-text-primary disabled:opacity-60"
                contentClassName="w-[var(--radix-select-trigger-width)]"
              />
            </InputTableConfigRow>

            <InputTableConfigRow
              label={
                localSourceKind === 'folder'
                  ? t('data.inputTables.editor.folderPath')
                  : t('data.inputTables.editor.file')
              }
            >
              <div className="flex min-w-0 items-stretch">
                <div className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-l-lg border border-border-muted bg-background/50 px-3 shadow-soft">
                  <span
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${sourceMeta.className}`}
                  >
                    <SourceIcon className="h-4 w-4" />
                  </span>
                  <div
                    className="min-w-0 truncate text-[14px] font-medium text-text-primary"
                    title={dataset?.sourcePath}
                  >
                    {dataset
                      ? formatDisplayPath(dataset.sourcePath)
                      : t('data.inputTables.editor.noSource')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => chooseSource(localSourceKind)}
                  disabled={isBusy || !trimmedName}
                  className="inline-flex h-10 flex-shrink-0 items-center justify-center rounded-r-lg border border-l-0 border-border-muted bg-background/62 px-5 text-[13px] font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {localSourceKind === 'folder'
                    ? t('data.inputTables.editor.changeFolder')
                    : t('data.inputTables.editor.changeFile')}
                </button>
              </div>
            </InputTableConfigRow>

            <InputTableConfigRow label={t('data.inputTables.editor.processingStrategy')}>
              <GlassSelect
                value={dataProcessing.strategy}
                onValueChange={(value) => {
                  if (value === 'customize') {
                    updateDataProcessing({
                      ...(dataProcessing.strategy === 'customize' ? dataProcessing : {}),
                      strategy: 'customize',
                      rulePrompt:
                        dataProcessing.strategy === 'customize' ? dataProcessing.rulePrompt : '',
                    });
                    setActiveEditorTab('rules');
                    return;
                  }
                  updateDataProcessing({ strategy: 'auto' });
                }}
                options={[
                  { value: 'auto', label: t('data.inputTables.editor.processingAuto') },
                  { value: 'customize', label: t('data.inputTables.editor.processingCustomize') },
                ]}
                disabled={isBusy || !dataset}
                triggerClassName="!h-10 w-full justify-between rounded-lg bg-background/50 px-3 text-[14px] font-medium text-text-primary disabled:opacity-60"
                contentClassName="w-[var(--radix-select-trigger-width)]"
              />
            </InputTableConfigRow>
          </div>

          {dataProcessing.strategy === 'customize' ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex h-14 flex-shrink-0 items-end border-b border-border-muted/80 px-5">
                {editorTabs.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setActiveEditorTab(tab.value)}
                    className={`relative flex h-12 min-w-[8.5rem] items-center justify-center px-4 text-[13px] font-medium transition-colors ${
                      activeEditorTab === tab.value
                        ? 'text-accent'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {tab.label}
                    {activeEditorTab === tab.value ? (
                      <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-accent" />
                    ) : null}
                  </button>
                ))}
              </div>

              <div
                className={`min-h-0 flex-1 px-7 py-6 ${
                  activeEditorTab === 'versions' ? 'overflow-y-auto' : 'overflow-hidden'
                }`}
              >
                {activeEditorTab === 'rules' ? (
                  <div className="mx-auto flex h-full min-h-0 max-w-[70rem] flex-col gap-4">
                    <div className="grid flex-shrink-0 gap-2">
                      <span className="inline-flex items-center gap-2 text-[13px] font-medium text-text-secondary">
                        {t('data.inputTables.editor.rulePrompt')}
                        <Info className="h-3.5 w-3.5 text-text-muted" />
                      </span>
                      <LlmPromptComposer
                        value={dataProcessing.rulePrompt}
                        onChange={(rulePrompt) => patchCustomizeDataProcessing({ rulePrompt })}
                        selectedSkillNames={customizeSelectedSkillNames}
                        onSelectedSkillNamesChange={(selectedSkillNames) =>
                          patchCustomizeDataProcessing({ selectedSkillNames })
                        }
                        onSkillSelectionCommit={({ value, selectedSkillNames }) =>
                          patchCustomizeDataProcessing({
                            rulePrompt: value,
                            selectedSkillNames,
                          })
                        }
                        appConfig={appConfig}
                        selectedModelConfigSetId={selectedCustomizeModelConfigSetId}
                        modelFallbackLabel={t('chat.noModel', { defaultValue: '未配置模型' })}
                        placeholder={t('data.inputTables.editor.rulePromptPlaceholder')}
                        disabled={isBusy || !dataset}
                        maxLength={4000}
                        className="min-h-[128px]"
                        textareaClassName="min-h-[64px]"
                        skillMenuPlacement="bottom"
                        onModelSelect={({ configSetId, model }) =>
                          patchCustomizeDataProcessing({
                            modelConfigSetId: configSetId,
                            model,
                          })
                        }
                      />
                    </div>
                    <InputTableGenerationOutputPanel
                      isStreaming={customizeGenerating}
                      output={customizeGenerationOutput}
                      t={t}
                    />
                    {customizeGenerationError ? (
                      <div className="flex-shrink-0 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-[12px] font-medium text-danger">
                        {customizeGenerationError}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activeEditorTab === 'code' ? (
                  <div className="grid h-[30rem] max-h-full min-h-0 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_16rem]">
                    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-muted bg-background/50">
                      <div className="flex h-9 flex-shrink-0 items-center justify-between gap-2 border-b border-border-muted px-3">
                        <span className="min-w-0 truncate font-mono text-xs font-medium text-text-primary">
                          {selectedNormalizerFile?.path ??
                            t('data.inputTables.editor.noProjectFiles')}
                        </span>
                        <button
                          type="button"
                          disabled={!selectedNormalizerFile}
                          onClick={() => {
                            if (selectedNormalizerFile) {
                              void navigator.clipboard?.writeText(selectedNormalizerFile.content);
                            }
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-accent/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                          title={t('data.inputTables.editor.copyCode')}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <CodePreview file={selectedNormalizerFile} t={t} />
                    </div>
                    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-muted bg-background/42">
                      <div className="flex h-9 items-center border-b border-border-muted px-3 text-xs font-medium text-text-primary">
                        {t('data.inputTables.editor.projectStructure')}
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto p-2">
                        <NormalizerProjectTree
                          files={normalizerProjectFiles}
                          selectedPath={selectedNormalizerFile?.path ?? selectedNormalizerFilePath}
                          onSelect={setSelectedNormalizerFilePath}
                          t={t}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeEditorTab === 'versions' ? (
                  <InputTableVersionHistoryPanel
                    currentVersion={currentNormalizerVersion}
                    currentVersionId={customizeArtifactVersionId}
                    deletingVersionId={deletingNormalizerVersionId}
                    embedded
                    loading={normalizerVersionsLoading}
                    onRefresh={() => void refreshNormalizerVersions(customizeArtifactId)}
                    onDelete={(version) => void deleteSpecificNormalizerVersion(version)}
                    onPublish={(version) => void publishSpecificNormalizerVersion(version)}
                    publishingVersionId={customizeVersionActionId}
                    t={t}
                    versions={normalizerVersions}
                  />
                ) : null}
              </div>

              <div className="flex min-h-16 flex-shrink-0 items-center justify-end gap-3 border-t border-border-muted/80 px-7 py-4">
                <button
                  type="button"
                  disabled={!canGenerateCustomizeDraft}
                  onClick={() => void generateCustomizeDraft()}
                  className="inline-flex h-10 min-w-[9.5rem] items-center justify-center gap-2 rounded-lg bg-accent px-5 text-[13px] font-medium text-white shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-active disabled:text-text-muted disabled:opacity-70"
                  title={t('data.inputTables.editor.generateProjectDisabled')}
                >
                  {customizeGenerating ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {customizeGenerating
                    ? t('data.inputTables.editor.generateProjectDrafting')
                    : t('data.inputTables.editor.generateProjectDraft')}
                </button>
                <button
                  type="button"
                  disabled={!customizeArtifactVersionId || previewLoading || !dataset}
                  onClick={() => void previewCustomizeDraft()}
                  className="inline-flex h-10 min-w-[11.5rem] items-center justify-center gap-2 rounded-lg border border-border-muted bg-background/62 px-5 text-[13px] font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {previewLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                  {t('data.inputTables.editor.previewNormalizedDraft')}
                </button>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
              <div className="grid gap-4">
                {localSourceKind === 'excel' ? (
                  <>
                    <InputTableConfigRow label={t('data.inputTables.editor.sheetName')}>
                      <GlassSelect
                        value={excelConfig.sheetName ?? ''}
                        onValueChange={(value) =>
                          updateConfig({
                            ...excelConfig,
                            sheetName: value,
                          })
                        }
                        options={(excelConfig.sheetNames.length > 0
                          ? excelConfig.sheetNames
                          : ['Sheet1']
                        ).map((sheetName) => ({ value: sheetName, label: sheetName }))}
                        disabled={isBusy || !dataset}
                        triggerClassName="!h-10 w-full justify-between rounded-lg bg-background/50 px-3 text-[14px] font-medium text-text-primary disabled:opacity-60"
                        contentClassName="w-[var(--radix-select-trigger-width)]"
                      />
                    </InputTableConfigRow>
                    <InputTableConfigRow
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          {t('data.inputTables.editor.headerRow')}
                          <span className="group relative inline-flex">
                            <button
                              type="button"
                              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent/10 hover:text-accent focus:bg-accent/10 focus:text-accent focus:outline-none"
                              aria-label={t('data.inputTables.editor.headerRowDetectHint')}
                            >
                              <Info className="h-3.5 w-3.5" />
                            </button>
                            <span className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-72 rounded-lg border border-border-subtle bg-[var(--glass-card-strong)] px-3 py-2 text-left text-[12px] font-medium leading-5 text-text-secondary shadow-elevated backdrop-blur-xl group-hover:block group-focus-within:block">
                              {t('data.inputTables.editor.headerRowDetectHint')}
                            </span>
                          </span>
                        </span>
                      }
                    >
                      <div
                        className={`grid items-start gap-2 ${
                          excelConfig.headerMode === 'manual'
                            ? 'sm:grid-cols-[minmax(0,1fr)_10rem]'
                            : ''
                        }`}
                      >
                        <GlassSelect
                          value={excelConfig.headerMode}
                          onValueChange={(value) =>
                            updateConfig({
                              ...excelConfig,
                              headerMode: value as DataInputTableExcelConfig['headerMode'],
                            })
                          }
                          options={[
                            { value: 'auto', label: t('data.inputTables.editor.smartDetect') },
                            {
                              value: 'manual',
                              label: t('data.inputTables.editor.manualSpecify'),
                            },
                          ]}
                          disabled={isBusy || !dataset}
                          triggerClassName="!h-10 w-full justify-between rounded-lg bg-background/50 px-3 text-[14px] font-medium text-text-primary disabled:opacity-60"
                          contentClassName="w-[var(--radix-select-trigger-width)]"
                        />
                        {excelConfig.headerMode === 'manual' ? (
                          <label className="relative block !h-10">
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={excelConfig.headerRow}
                              onChange={(event) =>
                                updateConfig({
                                  ...excelConfig,
                                  headerRow: Math.max(
                                    1,
                                    Math.floor(Number(event.target.value) || 1)
                                  ),
                                })
                              }
                              disabled={isBusy || !dataset}
                              className="box-border !h-10 w-full rounded-lg border border-border-muted bg-background/50 pl-3 pr-10 text-[14px] font-medium leading-5 text-text-primary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-text-muted">
                              {t('data.inputTables.editor.rowUnit')}
                            </span>
                          </label>
                        ) : null}
                      </div>
                    </InputTableConfigRow>
                  </>
                ) : null}

                {localSourceKind === 'csv' ? (
                  <div className="grid gap-3">
                    {[
                      ['header', 'data.inputTables.editor.csvHeader'],
                      ['dataRegion', 'data.inputTables.editor.csvDataRegion'],
                      ['encoding', 'data.inputTables.editor.csvEncoding'],
                      ['delimiter', 'data.inputTables.editor.csvDelimiter'],
                    ].map(([key, labelKey]) => (
                      <InputTableConfigRow key={key} label={t(labelKey)}>
                        <div className="text-[14px] font-medium text-text-primary">
                          {t('data.inputTables.editor.autoDetected')}
                        </div>
                      </InputTableConfigRow>
                    ))}
                  </div>
                ) : null}

                {localSourceKind === 'folder' ? (
                  <div className="grid gap-3">
                    <InputTableConfigRow label={t('data.inputTables.editor.fileSelectionRange')}>
                      <InputTableSelect
                        value={folderConfig.fileRange}
                        disabled={isBusy || !dataset}
                        onChange={(value) =>
                          updateConfig({
                            ...folderConfig,
                            fileRange: value as DataInputTableFolderConfig['fileRange'],
                          })
                        }
                        options={[
                          {
                            value: 'excel_csv',
                            label: t('data.inputTables.editor.includeExcelCsv'),
                          },
                          { value: 'excel', label: t('data.inputTables.editor.includeExcel') },
                          { value: 'csv', label: t('data.inputTables.editor.includeCsv') },
                        ]}
                      />
                    </InputTableConfigRow>
                    <div className="flex flex-wrap gap-4 px-1">
                      <InputTableCheckbox
                        checked={folderConfig.skipEmptyFiles}
                        disabled={isBusy || !dataset}
                        label={t('data.inputTables.editor.skipEmptyFiles')}
                        onChange={(checked) =>
                          updateConfig({ ...folderConfig, skipEmptyFiles: checked })
                        }
                      />
                      <InputTableCheckbox
                        checked={folderConfig.keepSourceFileName}
                        disabled={isBusy || !dataset}
                        label={t('data.inputTables.editor.keepSourceFileName')}
                        onChange={(checked) =>
                          updateConfig({ ...folderConfig, keepSourceFileName: checked })
                        }
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </section>
      {previewOpen && (
        <InputTablePreviewDialog
          tableKind="input"
          preview={previewData}
          isLoading={previewLoading}
          error={previewError}
          currentPage={previewPage}
          onPageChange={(page) => void loadPreviewPage(page)}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}

export function InputTableEditor({
  draft,
  dataset,
  isBusy,
  onBack,
  onRenameDraft,
  onRenameDataset,
  onChooseDraftSource,
  onChooseDatasetSource,
  onUpdateDatasetConfig,
}: {
  draft?: InputTableDraft;
  dataset?: DataDataset;
  isBusy: boolean;
  onBack: () => void;
  onRenameDraft?: (id: string, name: string) => void;
  onRenameDataset?: (dataset: DataDataset, name: string) => void | Promise<void>;
  onChooseDraftSource?: (
    draft: InputTableDraft,
    sourceKind: DataInputTableSourceKind,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
  onChooseDatasetSource?: (
    dataset: DataDataset,
    sourceKind: DataInputTableSourceKind,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
  onUpdateDatasetConfig?: (
    dataset: DataDataset,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
}) {
  return (
    <InputTableEditorWorkbench
      draft={draft}
      dataset={dataset}
      isBusy={isBusy}
      onBack={onBack}
      onRenameDraft={onRenameDraft}
      onRenameDataset={onRenameDataset}
      onChooseDraftSource={onChooseDraftSource}
      onChooseDatasetSource={onChooseDatasetSource}
      onUpdateDatasetConfig={onUpdateDatasetConfig}
    />
  );
}

function InputTableConfigRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-12 items-center gap-3 px-1 py-1 lg:grid-cols-[10rem_minmax(0,1fr)]">
      <div className="text-[14px] font-medium text-text-primary">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function InputTableGenerationOutputPanel({
  output,
  isStreaming,
  t,
}: {
  output: string;
  isStreaming: boolean;
  t: TranslateFn;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const message = useMemo<Message>(
    () => ({
      id: 'input-table-normalizer-generation-output',
      sessionId: 'data-input-table-normalizer',
      role: 'assistant',
      content: [{ type: 'text', text: output }],
      timestamp: Date.now(),
    }),
    [output]
  );

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [isStreaming, output]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-muted bg-background/42 shadow-soft">
      <div className="flex h-10 flex-shrink-0 items-center justify-between gap-3 border-b border-border-muted px-3">
        <div className="inline-flex min-w-0 items-center gap-2 text-[13px] font-medium text-text-primary">
          {isStreaming ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" />
          ) : (
            <Code2 className="h-3.5 w-3.5 text-accent" />
          )}
          <span className="truncate">{t('data.inputTables.editor.generationOutputTitle')}</span>
        </div>
        <span className="text-[11px] font-medium text-text-muted">
          {isStreaming
            ? t('data.inputTables.editor.generationOutputStreaming')
            : t('data.inputTables.editor.generationOutputIdle')}
        </span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {output ? (
          <MessageCard message={message} isStreaming={isStreaming} />
        ) : (
          <div className="flex h-full min-h-28 items-center justify-center rounded-lg border border-dashed border-border-muted bg-background/30 px-4 text-center text-[13px] font-medium text-text-muted">
            {t('data.inputTables.editor.generatedStatusEmpty')}
          </div>
        )}
      </div>
    </div>
  );
}

function CodePreview({ file, t }: { file?: DataNormalizerProjectFile; t: TranslateFn }) {
  if (!file) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs font-medium text-text-muted">
        {t('data.inputTables.editor.selectedFileEmpty')}
      </div>
    );
  }
  return <CodeMirrorFilePreview file={file} />;
}

function CodeMirrorFilePreview({ file }: { file: DataNormalizerProjectFile }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const language = useMemo(() => getCodePreviewLanguage(file.path), [file.path]);
  const extensions = useMemo(
    () => [
      lineNumbers(),
      language,
      syntaxHighlighting(codePreviewHighlightStyle),
      codePreviewTheme,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
    ],
    [language]
  );

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: file.content, extensions }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [extensions, file.content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === file.content) return;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: file.content,
      },
    });
  }, [file.content]);

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />;
}

interface NormalizerProjectTreeNode {
  name: string;
  path: string;
  type: 'folder' | 'file';
  children: NormalizerProjectTreeNode[];
}

function NormalizerProjectTree({
  files,
  selectedPath,
  onSelect,
  t,
  spacious = false,
}: {
  files: DataNormalizerProjectFile[];
  selectedPath: string;
  onSelect: (path: string) => void;
  t: TranslateFn;
  spacious?: boolean;
}) {
  const tree = useMemo(() => buildNormalizerProjectTree(files), [files]);
  if (tree.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-muted bg-background/42 px-3 py-4 text-center text-xs font-medium text-text-muted">
        {t('data.inputTables.editor.noProjectFiles')}
      </div>
    );
  }
  return (
    <div className={spacious ? 'space-y-1' : 'space-y-0.5'}>
      {tree.map((node) => (
        <NormalizerProjectTreeNodeView
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
          spacious={spacious}
        />
      ))}
    </div>
  );
}

function NormalizerProjectTreeNodeView({
  node,
  depth,
  selectedPath,
  onSelect,
  spacious,
}: {
  node: NormalizerProjectTreeNode;
  depth: number;
  selectedPath: string;
  onSelect: (path: string) => void;
  spacious: boolean;
}) {
  const isFile = node.type === 'file';
  const isSelected = isFile && node.path === selectedPath;
  const Icon = isFile ? FileText : Folder;
  return (
    <div>
      <button
        type="button"
        disabled={!isFile}
        onClick={() => {
          if (isFile) onSelect(node.path);
        }}
        className={`flex w-full min-w-0 items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs font-medium transition-colors disabled:cursor-default ${
          isSelected
            ? 'bg-accent/10 text-text-primary ring-1 ring-inset ring-accent/20'
            : 'text-text-secondary hover:bg-background/54 hover:text-text-primary'
        } ${spacious ? 'min-h-8' : 'min-h-7'}`}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        {node.type === 'folder' ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
        ) : (
          <span className="h-3.5 w-3.5 flex-shrink-0" />
        )}
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
      {node.children.length > 0 ? (
        <div>
          {node.children.map((child) => (
            <NormalizerProjectTreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              spacious={spacious}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InputTableVersionHistoryPanel({
  currentVersion,
  currentVersionId,
  deletingVersionId,
  embedded = false,
  loading,
  onRefresh,
  onDelete,
  onPublish,
  publishingVersionId,
  t,
  versions,
}: {
  currentVersion?: DataInputTableNormalizerArtifactVersion;
  currentVersionId?: string;
  deletingVersionId: string | null;
  embedded?: boolean;
  loading: boolean;
  onRefresh: () => void;
  onDelete: (version: DataInputTableNormalizerArtifactVersion) => void;
  onPublish: (version: DataInputTableNormalizerArtifactVersion) => void;
  publishingVersionId: string | null;
  t: TranslateFn;
  versions: DataInputTableNormalizerArtifactVersion[];
}) {
  return (
    <section
      className={`overflow-hidden rounded-lg border border-border-muted ${
        embedded ? 'bg-background/42' : 'mt-3 bg-[var(--glass-card)] shadow-soft backdrop-blur-xl'
      }`}
    >
      <div className="flex h-11 items-center justify-between border-b border-border-muted px-3">
        <div className="text-[13px] font-medium text-text-primary">
          {t('data.inputTables.editor.versionHistory')}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-background/62 px-3 text-xs font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </button>
      </div>
      {versions.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-xs">
            <tbody>
              {versions.map((version) => {
                const isCurrent = version.id === currentVersionId;
                const isPublished = version.status === 'published';
                const diffSummary = getNormalizerVersionDiffSummary(version, currentVersion, t);
                return (
                  <tr
                    key={version.id}
                    className="h-11 border-b border-border-muted/80 text-text-secondary last:border-b-0 hover:bg-background/32"
                  >
                    <td className="w-20 px-3 font-mono text-[13px] font-medium text-text-primary">
                      {t('data.inputTables.editor.versionNumber', {
                        version: version.version,
                      })}
                    </td>
                    <td className="w-44 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isCurrent ? (
                          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                            {t('data.inputTables.editor.currentVersion')}
                          </span>
                        ) : null}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            isPublished
                              ? 'bg-success/10 text-success'
                              : 'bg-background/58 text-text-secondary'
                          }`}
                        >
                          {isPublished
                            ? t('data.inputTables.editor.publishedVersion')
                            : version.status}
                        </span>
                      </div>
                    </td>
                    <td className="min-w-[13rem] px-3 text-text-muted">
                      {t('data.inputTables.editor.updatedAt', {
                        time: formatDateTime(version.updatedAt),
                      })}
                    </td>
                    <td className="min-w-[16rem] max-w-[28rem] px-3">
                      <span className="line-clamp-1 font-medium text-text-secondary">
                        {diffSummary || version.rulePrompt || '-'}
                      </span>
                    </td>
                    <td className="w-[13rem] px-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={isPublished || publishingVersionId === version.id}
                          onClick={() => onPublish(version)}
                          className="inline-flex h-7 min-w-[4.25rem] items-center justify-center gap-1 rounded-lg jade-primary-button px-3 text-[11px] font-medium text-white transition-colors disabled:cursor-not-allowed disabled:bg-surface-active disabled:text-text-muted disabled:opacity-70"
                        >
                          {publishingVersionId === version.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : null}
                          {isPublished
                            ? t('data.inputTables.editor.publishedVersion')
                            : t('data.inputTables.editor.publishVersionAction')}
                        </button>
                        <button
                          type="button"
                          disabled={isPublished || deletingVersionId === version.id}
                          onClick={() => onDelete(version)}
                          title={
                            isPublished
                              ? t('data.inputTables.editor.deletePublishedVersionBlocked')
                              : undefined
                          }
                          className="inline-flex h-7 min-w-[4.25rem] items-center justify-center gap-1 rounded-lg border border-danger/20 bg-danger/10 px-3 text-[11px] font-medium text-danger transition-colors hover:border-danger/40 hover:bg-danger/20 disabled:cursor-not-allowed disabled:border-border-muted disabled:bg-surface-active disabled:text-text-muted disabled:opacity-70"
                        >
                          {deletingVersionId === version.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          {deletingVersionId === version.id
                            ? t('data.inputTables.editor.deletingVersionAction')
                            : t('data.inputTables.editor.deleteVersionAction')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-3 py-6 text-center text-xs font-medium text-text-muted">
          {loading
            ? t('data.inputTables.editor.loadingVersions')
            : t('data.inputTables.editor.noVersions')}
        </div>
      )}
    </section>
  );
}

export function InputTablePreviewDialog({
  tableKind = 'input',
  title,
  subtitle,
  preview,
  isLoading,
  error,
  currentPage,
  onPageChange,
  onClose,
  footer,
}: {
  tableKind?: 'input' | 'output';
  title?: string;
  subtitle?: string;
  preview: DataInputTablePreview | null;
  isLoading: boolean;
  error: string | null;
  currentPage: number;
  onPageChange: (page: number) => void;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const previewTitle =
    title ??
    (tableKind === 'output'
      ? t('data.outputTables.previewTitle')
      : t('data.inputTables.editor.previewTitle'));
  const previewEmpty =
    tableKind === 'output'
      ? t('data.outputTables.previewEmpty')
      : t('data.inputTables.editor.previewEmpty');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#163526]/16 px-4 py-6 dark:bg-black/50">
      <div className="flex h-[42rem] max-h-[calc(100vh-3rem)] w-[72rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-subtle bg-[var(--glass-card-strong)] shadow-card backdrop-blur-xl">
        <div className="glass-panel-header flex h-12 flex-shrink-0 items-center justify-between px-4">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-text-primary">
              {previewTitle}
            </div>
            {subtitle && <div className="truncate text-[11px] text-text-muted">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent"
            title={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--data-grid-cell-surface)]">
          <GlassDataGridPreview
            preview={preview}
            isLoading={isLoading}
            error={error}
            currentPage={currentPage}
            onPageChange={onPageChange}
            edgeToEdge
            labels={{
              loading: t('data.inputTables.editor.previewLoading'),
              empty: previewEmpty,
              total: (count) => t('data.inputTables.editor.previewTotal', { count }),
              pageSize: (count) => t('data.inputTables.editor.previewPageSize', { count }),
            }}
          />
        </div>
        {footer && (
          <div className="flex h-12 flex-shrink-0 items-center justify-end gap-2 border-t border-border-subtle bg-background/70 px-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function InputTableSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <GlassSelect
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        options={options}
        triggerClassName="!h-10 w-full justify-between rounded-lg bg-background/50 px-3 text-[13px] font-medium text-text-secondary disabled:opacity-60"
        contentClassName="w-[var(--radix-select-trigger-width)]"
      />
    </label>
  );
}

function InputTableCheckbox({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex w-fit items-center gap-2 text-[13px] font-medium text-text-secondary">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-border-muted accent-accent disabled:cursor-not-allowed disabled:opacity-60"
      />
      {label}
    </label>
  );
}

function getPreferredNormalizerFilePath(
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

function createNormalizerGenerationProgressId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `normalizer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildNormalizerGenerationStartOutput(input: {
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

function buildNormalizerGenerationSuccessOutput(input: {
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

function truncateGenerationLogText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function buildNormalizerProjectTree(
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

function getNormalizerVersionDiffSummary(
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

function inferNormalizerLanguageFromRulePrompt(rulePrompt: string): DataNormalizerLanguage {
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

function getDefaultExcelInputTableConfig(): DataInputTableExcelConfig {
  return {
    sourceKind: 'excel',
    sheetName: 'Sheet1',
    sheetNames: ['Sheet1'],
    headerMode: 'auto',
    headerRow: 1,
    dataProcessing: getDefaultInputTableDataProcessing(),
  };
}

function getDefaultFolderInputTableConfig(): DataInputTableFolderConfig {
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

function getDefaultInputTableDataProcessing(): DataInputTableProcessingConfig {
  return { strategy: 'auto' };
}

function getInputTableDataProcessing(config: DataInputTableConfig): DataInputTableProcessingConfig {
  if (config.dataProcessing?.strategy === 'customize') {
    return {
      ...config.dataProcessing,
      rulePrompt: config.dataProcessing.rulePrompt ?? '',
    };
  }
  return getDefaultInputTableDataProcessing();
}

function withInputTableDataProcessing(
  config: DataInputTableConfig,
  dataProcessing: DataInputTableProcessingConfig
): DataInputTableConfig {
  return {
    ...config,
    dataProcessing,
  } as DataInputTableConfig;
}

function isInputTableConfigEqual(
  left: DataInputTableConfig,
  right: DataInputTableConfig | undefined
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
