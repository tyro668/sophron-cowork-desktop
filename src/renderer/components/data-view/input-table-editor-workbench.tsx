import { InputTableAutomations } from './table-automations';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Check,
  Cloud,
  Copy,
  Eye,
  FileCode2,
  Info,
  PencilLine,
  RefreshCw,
  Save,
  Sparkles,
  Workflow,
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
} from '../../types';
import { useAppStore } from '../../store';
import { GlassSelect } from '../GlassSelect';
import { getAgentModelLabel } from '../AgentModelSelector';
import { LlmPromptComposer } from '../LlmPromptComposer';
import { useConfirmDialog } from '../ConfirmDialog';
import type { InputTableDraft } from '../../features/data/model/types';
import { dataClient } from '../../features/data/api/data-client';
import {
  INPUT_TABLE_PREVIEW_PAGE_SIZE,
  InputTableCheckbox,
  InputTableSelect,
  InputTableStatusBadge,
  editorHeaderRowClass,
  formatCloudMirrorLocation,
  formatDateTime,
  formatDisplayPath,
  getCloudMirror,
  getCloudMirrorSourceMeta,
  getInputTableSourceMeta,
  underlineTabListClass,
  underlineTabTriggerClass,
  type CloudMirrorInfo,
} from './shared';
import { GlassDataGridPreview } from '../GlassDataGridPreview';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { CodePreview, getCodePreviewLanguageLabel } from './input-table-code-preview';
import { InputTableGenerationConsole } from './input-table-generation-console';
import {
  NormalizerProjectTree,
  InputTableVersionHistoryPanel,
} from './input-table-version-history';
import { InputTablePreviewDialog } from './input-table-preview-dialog';
import {
  applyNormalizerGenerationProgress,
  createNormalizerGenerationLog,
  createNormalizerGenerationProgressId,
  getDefaultExcelInputTableConfig,
  getDefaultFolderInputTableConfig,
  getDefaultInputTableConfig,
  getInputTableDataProcessing,
  getPreferredNormalizerFilePath,
  inferNormalizerLanguageFromRulePrompt,
  isInputTableConfigEqual,
  markNormalizerGenerationError,
  markNormalizerGenerationSuccess,
  withInputTableDataProcessing,
  type NormalizerGenerationLog,
} from './input-table-normalizer-utils';

export type InputTableEditorProps = {
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
  onCreateTask?: (dataset: DataDataset) => void;
  onAiGenerateTask?: (dataset: DataDataset) => void;
  onSyncCloudSource?: (dataset: DataDataset) => void | Promise<void>;
  onOpenCloudSource?: (mirror: CloudMirrorInfo) => void;
};

export type InputTableEditorTab = 'rules' | 'code' | 'versions';

export function InputTableEditorWorkbench({
  draft,
  dataset,
  isBusy,
  onBack,
  onRenameDraft,
  onRenameDataset,
  onChooseDraftSource,
  onChooseDatasetSource,
  onUpdateDatasetConfig,
  onCreateTask,
  onAiGenerateTask,
  onSyncCloudSource,
  onOpenCloudSource,
}: InputTableEditorProps) {
  const { t } = useTranslation();
  const { confirmDelete } = useConfirmDialog();
  const appConfig = useAppStore((state) => state.appConfig);
  const targetId = draft?.id ?? dataset?.id ?? '';
  const initialName = draft?.name ?? dataset?.name ?? '';
  const initialSourceKind = dataset?.sourceKind ?? 'excel';
  const initialConfig = dataset?.inputConfig ?? getDefaultInputTableConfig(initialSourceKind);
  // Keyed on serialized content, not object identity: a dataset refetch after a
  // failed save produces an equal config object, and must not reset in-progress
  // edits (an unpublished customize draft lives in localConfig).
  const initialConfigKey = useMemo(() => JSON.stringify(initialConfig), [initialConfig]);
  const [localName, setLocalName] = useState(initialName);
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [localSourceKind, setLocalSourceKind] =
    useState<DataInputTableSourceKind>(initialSourceKind);
  const [localConfig, setLocalConfig] = useState<DataInputTableConfig>(initialConfig);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeViewTab, setActiveViewTab] = useState<'config' | 'data'>('config');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DataInputTablePreview | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [customizeGenerating, setCustomizeGenerating] = useState(false);
  const [generationLog, setGenerationLog] = useState<NormalizerGenerationLog | null>(null);
  const generationLogRef = useRef<NormalizerGenerationLog | null>(null);
  const generationFlushTimerRef = useRef<number | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
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
  // Last customize config seen while editing — restored when the strategy
  // select toggles back to 自定义, so the generated-draft linkage survives
  // accidental switches and failed saves.
  const customizeDraftBackupRef = useRef<Extract<
    DataInputTableProcessingConfig,
    { strategy: 'customize' }
  > | null>(null);
  const autoPreviewArmed = useRef(false);
  const lastSourcePath = useRef<string | null>(dataset?.sourcePath ?? null);
  const trimmedName = localName.trim();
  const isConfigured = Boolean(dataset);
  const cloudMirror = getCloudMirror(dataset);
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false);
  const sourceMeta = cloudMirror
    ? getCloudMirrorSourceMeta()
    : getInputTableSourceMeta(localSourceKind);
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
    const persistedConfig = JSON.parse(initialConfigKey) as DataInputTableConfig;
    setLocalName(initialName);
    setIsNameEditing(false);
    setLocalSourceKind(initialSourceKind);
    setLocalConfig(persistedConfig);
    customizeDraftBackupRef.current =
      persistedConfig.dataProcessing?.strategy === 'customize'
        ? persistedConfig.dataProcessing
        : null;
    setCustomizeGenerationError(null);
    generationLogRef.current = null;
    setGenerationLog(null);
    setCustomizeGenerating(false);
    setCodeCopied(false);
    setCustomizeVersionActionId(null);
    setDeletingNormalizerVersionId(null);
    setActiveEditorTab('rules');
    setSelectedNormalizerFilePath('');
    setActiveViewTab('config');
    setPreviewData(null);
    setPreviewError(null);
    setPreviewPage(1);
  }, [initialConfigKey, initialName, initialSourceKind, targetId]);

  useEffect(() => {
    if (!isNameEditing) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [isNameEditing]);

  useEffect(() => {
    if (dataProcessing.strategy === 'customize') {
      customizeDraftBackupRef.current = dataProcessing;
    }
  }, [dataProcessing]);

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
    autoPreviewArmed.current = true;
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

  // Progress deltas arrive per token — buffer them in the mutable log ref and
  // flush snapshots at ~20fps so the console repaints smoothly instead of
  // re-rendering once per IPC event.
  const flushGenerationLog = useCallback(() => {
    const current = generationLogRef.current;
    if (!current) return;
    setGenerationLog({ ...current, steps: [...current.steps] });
  }, []);

  const scheduleGenerationLogFlush = useCallback(() => {
    if (generationFlushTimerRef.current !== null) return;
    generationFlushTimerRef.current = window.setTimeout(() => {
      generationFlushTimerRef.current = null;
      flushGenerationLog();
    }, 50);
  }, [flushGenerationLog]);

  useEffect(
    () => () => {
      if (generationFlushTimerRef.current !== null) {
        window.clearTimeout(generationFlushTimerRef.current);
      }
    },
    []
  );

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
    const log = createNormalizerGenerationLog({
      inputTableName: dataset.name,
      sourceKind: localSourceKind,
      language: normalizerLanguage,
      rulePrompt,
      t,
    });
    generationLogRef.current = log;
    setGenerationLog({ ...log, steps: [...log.steps] });
    setCustomizeGenerating(true);
    setCustomizeGenerationError(null);
    const progressId = createNormalizerGenerationProgressId();
    const unsubscribeProgress = dataClient.onInputTableNormalizerDraftProgress(
      (event: DataInputTableNormalizerDraftProgressEvent) => {
        if (event.progressId !== progressId) return;
        if (typeof event.text !== 'string' || event.text.length === 0) return;
        applyNormalizerGenerationProgress(log, event);
        scheduleGenerationLogFlush();
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
      markNormalizerGenerationSuccess(log, {
        versionNumber: result.version.version,
        files: result.version.files,
        t,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCustomizeGenerationError(message);
      markNormalizerGenerationError(log, message);
    } finally {
      unsubscribeProgress?.();
      setCustomizeGenerating(false);
      flushGenerationLog();
    }
  };

  const saveInputTable = () => {
    if (!dataset || !trimmedName) return;
    setCustomizeGenerationError(null);
    if (canSaveConfig && onUpdateDatasetConfig) {
      // A customize config backed by an unpublished draft cannot reimport — the
      // server rejects it. Fail fast with a localized hint and route the user
      // to the versions tab where publishing lives, instead of wiping state.
      if (
        dataProcessing.strategy === 'customize' &&
        dataProcessing.artifactVersionStatus !== 'published'
      ) {
        setCustomizeGenerationError(t('data.inputTables.editor.saveRequiresPublishedVersion'));
        setActiveEditorTab('versions');
        return;
      }
      void onUpdateDatasetConfig(dataset, localConfig, localName);
      return;
    }
    if (hasNameChanges && onRenameDataset) {
      void onRenameDataset(dataset, localName);
    }
  };

  const loadPreviewPage = async (page: number) => {
    if (!dataset || !dataClient.has('previewInputTable')) return;
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

  // The data tab is the preview surface — open it and load page 1.
  const previewInputTable = async () => {
    setActiveViewTab('data');
    setPreviewData(null);
    await loadPreviewPage(1);
  };

  const previewInputTableRef = useRef(previewInputTable);
  previewInputTableRef.current = previewInputTable;

  // Switching to another draft/dataset drops a pending auto-preview. A
  // draft→dataset transition is the import completing — keep it armed so the
  // newly materialized source still previews.
  const prevTargetRef = useRef({ draftId: draft?.id ?? null, datasetId: dataset?.id ?? null });
  useEffect(() => {
    const prev = prevTargetRef.current;
    const next = { draftId: draft?.id ?? null, datasetId: dataset?.id ?? null };
    prevTargetRef.current = next;
    const draftImported = Boolean(prev.draftId && next.datasetId && !next.draftId);
    if (!draftImported && (prev.draftId !== next.draftId || prev.datasetId !== next.datasetId)) {
      autoPreviewArmed.current = false;
    }
  }, [draft?.id, dataset?.id]);

  // After the user picks a file/folder, automatically open the sample preview
  // (inferred column types + errors) once the imported/updated dataset lands.
  useEffect(() => {
    const path = dataset?.sourcePath ?? null;
    const changed = path !== lastSourcePath.current;
    lastSourcePath.current = path;
    if (autoPreviewArmed.current && path && changed) {
      autoPreviewArmed.current = false;
      void previewInputTableRef.current();
    }
  }, [dataset?.sourcePath]);

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
        <div className={`${editorHeaderRowClass} justify-between`}>
          <div className="flex min-w-0 items-center gap-4">
            <button
              onClick={onBack}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent"
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
                className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
                aria-label={t('common.edit')}
                title={t('common.edit')}
              >
                <PencilLine className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {dataset && onAiGenerateTask && (
              <Button
                variant="secondary"
                size="sm"
                disabled={isBusy}
                onClick={() => onAiGenerateTask(dataset)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t('data.aiTaskGenerate')}
              </Button>
            )}
            {dataset && onCreateTask && (
              <button
                type="button"
                onClick={() => onCreateTask(dataset)}
                disabled={isBusy}
                className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Workflow className="h-3.5 w-3.5" />
                {t('data.inputTables.actions.createTask')}
              </button>
            )}
            {dataset && (
              <>
                <Button size="sm" onClick={() => setAutomationsOpen(true)}>
                  {t('data.outputTables.automation.title')}
                </Button>
                <Dialog
                  open={automationsOpen}
                  onOpenChange={setAutomationsOpen}
                  ariaLabel={t('data.outputTables.automation.title')}
                  className="w-full max-w-2xl p-5"
                >
                  <InputTableAutomations inputTable={dataset} />
                  <div className="mt-4 flex justify-end">
                    <Button size="sm" onClick={() => setAutomationsOpen(false)}>
                      {t('common.close')}
                    </Button>
                  </div>
                </Dialog>
              </>
            )}

            <button
              type="button"
              onClick={saveInputTable}
              disabled={!canSave}
              className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {isBusy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>

        <Tabs
          value={activeViewTab}
          onValueChange={(value) => {
            const next = value as 'config' | 'data';
            setActiveViewTab(next);
            // previewData may currently hold a customize-draft preview — always
            // reload the raw source preview when entering the data tab.
            if (next === 'data' && canPreview && !previewLoading) {
              void loadPreviewPage(1);
            }
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-border-muted px-4">
            <TabsList className={underlineTabListClass}>
              <TabsTrigger value="config" className={underlineTabTriggerClass}>
                {t('data.inputTables.editor.tabs.config')}
              </TabsTrigger>
              <TabsTrigger value="data" className={underlineTabTriggerClass} disabled={!canPreview}>
                {t('data.inputTables.editor.tabs.data')}
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              {activeViewTab === 'data' && previewData && dataset && (
                <span>
                  {t('data.outputTables.editor.dataMeta', {
                    rows: previewData.totalRows,
                    time: formatDateTime(dataset.updatedAt),
                  })}
                </span>
              )}
              {activeViewTab === 'data' && canPreview && (
                <button
                  type="button"
                  onClick={() => void loadPreviewPage(previewPage)}
                  disabled={previewLoading}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
                  aria-label={t('data.actions.refresh')}
                  title={t('data.actions.refresh')}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${previewLoading ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>
          </div>

          <TabsContent
            value="config"
            className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface"
          >
            <div className="grid flex-shrink-0 gap-1 border-b border-border-muted/80 px-4 py-3">
              <InputTableConfigRow label={t('data.inputTables.editor.sourceType')}>
                <GlassSelect
                  value={localSourceKind}
                  onValueChange={(value) =>
                    handleSourceKindChange(value as DataInputTableSourceKind)
                  }
                  options={[
                    { value: 'excel', label: t('data.inputTables.editor.excel') },
                    { value: 'csv', label: t('data.inputTables.editor.csv') },
                    { value: 'folder', label: t('data.inputTables.editor.folder') },
                  ]}
                  disabled={isBusy}
                  triggerIcon={
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-md ${sourceMeta.className}`}
                    >
                      <SourceIcon className="h-3.5 w-3.5" />
                    </span>
                  }
                  triggerClassName="!h-8 w-full justify-between rounded-lg bg-surface px-2.5 text-[13px] font-medium text-text-primary disabled:opacity-60"
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
                  <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-l-lg border border-border-muted bg-surface px-2.5 shadow-soft">
                    <span
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md ${sourceMeta.className}`}
                    >
                      <SourceIcon className="h-3.5 w-3.5" />
                    </span>
                    <div
                      className="min-w-0 truncate text-[13px] font-medium text-text-primary"
                      title={dataset?.sourcePath ?? undefined}
                    >
                      {cloudMirror
                        ? formatCloudMirrorLocation(cloudMirror)
                        : dataset
                          ? formatDisplayPath(dataset.sourcePath)
                          : t('data.inputTables.editor.noSource')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => chooseSource(localSourceKind)}
                    disabled={isBusy || !trimmedName}
                    className="inline-flex h-8 flex-shrink-0 items-center justify-center rounded-r-lg border border-l-0 border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {dataset?.sourcePath
                      ? localSourceKind === 'folder'
                        ? t('data.inputTables.editor.changeFolder')
                        : t('data.inputTables.editor.changeFile')
                      : localSourceKind === 'folder'
                        ? t('data.inputTables.editor.chooseFolder')
                        : t('data.inputTables.editor.chooseFile')}
                  </button>
                </div>
              </InputTableConfigRow>

              {dataset && cloudMirror && (
                <InputTableConfigRow label={t('data.inputTables.editor.cloudSource.title')}>
                  <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border-muted bg-surface px-3 py-2.5 shadow-soft">
                    <div className="flex min-w-0 items-center gap-2 text-[13px] text-text-secondary">
                      <span className="flex-shrink-0 text-text-muted">
                        {t('data.inputTables.editor.cloudSource.location')}
                      </span>
                      <span
                        className="min-w-0 truncate font-medium text-text-primary"
                        title={formatCloudMirrorLocation(cloudMirror)}
                      >
                        {formatCloudMirrorLocation(cloudMirror)}
                      </span>
                      {cloudMirror.tableKind && (
                        <span className="inline-flex h-5 flex-shrink-0 items-center rounded bg-surface-active px-1.5 text-[11px] font-medium text-text-secondary">
                          {cloudMirror.tableKind === 'base'
                            ? t('cloudData.kindBase')
                            : t('cloudData.kindAnalysis')}
                        </span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
                      <span>
                        {t('data.inputTables.editor.cloudSource.localSnapshot', {
                          rows: dataset.rowCount.toLocaleString(),
                        })}
                      </span>
                      <span>
                        {t('data.inputTables.editor.cloudSource.lastSync', {
                          time: cloudMirror.syncedAt
                            ? formatDateTime(cloudMirror.syncedAt)
                            : formatDateTime(dataset.updatedAt),
                        })}
                      </span>
                      <span className="min-w-0 truncate" title={cloudMirror.sourceVersion}>
                        {t('data.inputTables.editor.cloudSource.sourceUpdated', {
                          time:
                            cloudMirror.sourceVersion ||
                            t('data.inputTables.editor.cloudSource.unknownTime'),
                        })}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {onSyncCloudSource && (
                        <button
                          type="button"
                          onClick={() => {
                            setCloudSyncBusy(true);
                            void Promise.resolve(onSyncCloudSource(dataset)).finally(() =>
                              setCloudSyncBusy(false)
                            );
                          }}
                          disabled={
                            isBusy ||
                            cloudSyncBusy ||
                            !cloudMirror.spaceId ||
                            !cloudMirror.projectId
                          }
                          className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-border-muted bg-surface px-2.5 text-xs font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
                          title={
                            !cloudMirror.spaceId || !cloudMirror.projectId
                              ? t('data.inputTables.editor.cloudSource.syncUnavailable')
                              : undefined
                          }
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${cloudSyncBusy ? 'animate-spin' : ''}`}
                          />
                          {cloudSyncBusy
                            ? t('data.inputTables.editor.cloudSource.syncing')
                            : t('data.inputTables.editor.cloudSource.sync')}
                        </button>
                      )}
                      {onOpenCloudSource && (
                        <button
                          type="button"
                          onClick={() => onOpenCloudSource(cloudMirror)}
                          disabled={!cloudMirror.spaceId || !cloudMirror.projectId}
                          className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-border-muted bg-surface px-2.5 text-xs font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
                        >
                          <Cloud className="h-3.5 w-3.5" />
                          {t('data.inputTables.editor.cloudSource.openInCloud')}
                        </button>
                      )}
                    </div>
                  </div>
                </InputTableConfigRow>
              )}

              <InputTableConfigRow label={t('data.inputTables.editor.processingStrategy')}>
                <GlassSelect
                  value={dataProcessing.strategy}
                  onValueChange={(value) => {
                    if (value === 'customize') {
                      updateDataProcessing(
                        customizeDraftBackupRef.current ?? {
                          strategy: 'customize',
                          rulePrompt: '',
                        }
                      );
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
                  triggerClassName="!h-8 w-full justify-between rounded-lg bg-surface px-2.5 text-[13px] font-medium text-text-primary disabled:opacity-60"
                  contentClassName="w-[var(--radix-select-trigger-width)]"
                />
              </InputTableConfigRow>
            </div>

            {dataProcessing.strategy === 'customize' ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex h-10 flex-shrink-0 items-end border-b border-border-muted/80 px-4">
                  {editorTabs.map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setActiveEditorTab(tab.value)}
                      className={`relative flex h-10 min-w-[7rem] items-center justify-center px-3 text-[13px] font-medium transition-colors ${
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
                  className={`min-h-0 flex-1 px-4 py-4 ${
                    activeEditorTab === 'versions' ? 'overflow-y-auto' : 'overflow-hidden'
                  }`}
                >
                  {activeEditorTab === 'rules' ? (
                    <div className="mx-auto flex h-full min-h-0 max-w-[70rem] flex-col gap-4">
                      <div className="grid flex-shrink-0 gap-2">
                        <span className="inline-flex items-center gap-2 text-[13px] font-medium text-text-secondary">
                          {t('data.inputTables.editor.rulePrompt')}
                          <span className="group relative inline-flex">
                            <button
                              type="button"
                              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent-muted hover:text-accent focus:bg-accent-muted focus:text-accent focus:outline-none"
                              aria-label={t('data.inputTables.editor.rulePromptHint')}
                            >
                              <Info className="h-3.5 w-3.5" />
                            </button>
                            <span className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-72 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-left text-[12px] font-medium leading-5 text-text-secondary shadow-elevated group-hover:block group-focus-within:block">
                              {t('data.inputTables.editor.rulePromptHint')}
                            </span>
                          </span>
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
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[12px] font-medium text-text-muted">
                            {t('data.inputTables.editor.rulePromptExamples')}
                          </span>
                          {(
                            [
                              'exampleMergeHeaders',
                              'exampleSplitMultiHeaders',
                              'exampleDeduplicateColumns',
                              'exampleExpandMergedCells',
                              'exampleDateNormalize',
                            ] as const
                          ).map((key) => {
                            const example = t(`data.inputTables.editor.${key}`);
                            return (
                              <button
                                key={key}
                                type="button"
                                disabled={isBusy || !dataset || customizeGenerating}
                                onClick={() =>
                                  patchCustomizeDataProcessing({
                                    rulePrompt: dataProcessing.rulePrompt.trim()
                                      ? `${dataProcessing.rulePrompt.replace(/\s+$/, '')}\n${example}`
                                      : example,
                                  })
                                }
                                className="inline-flex h-6 items-center rounded-full border border-border-muted bg-surface px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {example}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <InputTableGenerationConsole
                        isStreaming={customizeGenerating}
                        log={generationLog}
                        onViewCode={
                          normalizerProjectFiles.length > 0
                            ? () => setActiveEditorTab('code')
                            : undefined
                        }
                        t={t}
                      />
                    </div>
                  ) : null}

                  {activeEditorTab === 'code' ? (
                    normalizerProjectFiles.length === 0 ? (
                      <div className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-border-muted">
                        <div className="flex flex-col items-center gap-2 px-6 text-center">
                          <FileCode2 className="h-6 w-6 text-text-muted" />
                          <span className="text-[13px] font-medium text-text-secondary">
                            {t('data.inputTables.editor.noProjectFiles')}
                          </span>
                          <span className="text-xs text-text-muted">
                            {t('data.inputTables.editor.selectedFileEmpty')}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="grid h-full min-h-0 gap-3 overflow-hidden grid-rows-[minmax(0,1fr)_minmax(0,14rem)] lg:grid-cols-[minmax(0,1fr)_15rem] lg:grid-rows-1">
                        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-muted bg-surface">
                          <div className="flex h-10 flex-shrink-0 items-center justify-between gap-3 border-b border-border-muted px-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <FileCode2 className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
                              <span
                                className="min-w-0 truncate font-mono text-xs font-medium text-text-primary"
                                title={selectedNormalizerFile?.path}
                              >
                                {selectedNormalizerFile?.path}
                              </span>
                              {selectedNormalizerFile ? (
                                <span className="flex-shrink-0 whitespace-nowrap text-[11px] font-medium text-text-muted">
                                  {t('data.inputTables.editor.codeFileMeta', {
                                    lines: selectedNormalizerFile.content.split('\n').length,
                                    language: getCodePreviewLanguageLabel(
                                      selectedNormalizerFile.path
                                    ),
                                  })}
                                </span>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              disabled={!selectedNormalizerFile}
                              onClick={() => {
                                if (selectedNormalizerFile) {
                                  void navigator.clipboard?.writeText(
                                    selectedNormalizerFile.content
                                  );
                                  setCodeCopied(true);
                                  window.setTimeout(() => setCodeCopied(false), 1500);
                                }
                              }}
                              className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                codeCopied
                                  ? 'text-success'
                                  : 'text-text-muted hover:bg-accent-muted hover:text-text-primary'
                              }`}
                              title={
                                codeCopied
                                  ? t('data.inputTables.editor.copiedCode')
                                  : t('data.inputTables.editor.copyCode')
                              }
                            >
                              {codeCopied ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                          <CodePreview file={selectedNormalizerFile} t={t} />
                        </div>
                        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-muted bg-surface">
                          <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-border-muted px-3">
                            <span className="text-xs font-medium text-text-primary">
                              {t('data.inputTables.editor.projectStructure')}
                            </span>
                            <span className="rounded-full bg-surface-active px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
                              {normalizerProjectFiles.length}
                            </span>
                          </div>
                          <div className="min-h-0 flex-1 overflow-auto p-2">
                            <NormalizerProjectTree
                              files={normalizerProjectFiles}
                              selectedPath={
                                selectedNormalizerFile?.path ?? selectedNormalizerFilePath
                              }
                              onSelect={setSelectedNormalizerFilePath}
                              t={t}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  ) : null}

                  {activeEditorTab === 'versions' ? (
                    <div className="mx-auto w-full max-w-[72rem]">
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
                    </div>
                  ) : null}
                </div>

                {customizeGenerationError ? (
                  <div className="mx-4 flex-shrink-0 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-[12px] font-medium text-error">
                    {customizeGenerationError}
                  </div>
                ) : null}

                <div className="flex min-h-12 flex-shrink-0 items-center justify-end gap-2 border-t border-border-muted/80 px-4 py-2">
                  <button
                    type="button"
                    disabled={!canGenerateCustomizeDraft}
                    onClick={() => void generateCustomizeDraft()}
                    className="inline-flex h-8 min-w-[8rem] items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-foreground shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-active disabled:text-text-muted disabled:opacity-70"
                    title={t('data.inputTables.editor.generateProjectDisabled')}
                  >
                    {customizeGenerating ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {customizeGenerating
                      ? t('data.inputTables.editor.generateProjectDrafting')
                      : t('data.inputTables.editor.generateProjectDraft')}
                  </button>
                  <button
                    type="button"
                    disabled={!customizeArtifactVersionId || previewLoading || !dataset}
                    onClick={() => void previewCustomizeDraft()}
                    className="inline-flex h-8 min-w-[10rem] items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {previewLoading ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                    {t('data.inputTables.editor.previewNormalizedDraft')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="grid gap-3">
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
                          triggerClassName="!h-8 w-full justify-between rounded-lg bg-surface px-2.5 text-[13px] font-medium text-text-primary disabled:opacity-60"
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
                                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent-muted hover:text-accent focus:bg-accent-muted focus:text-accent focus:outline-none"
                                aria-label={t('data.inputTables.editor.headerRowDetectHint')}
                              >
                                <Info className="h-3.5 w-3.5" />
                              </button>
                              <span className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-72 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-left text-[12px] font-medium leading-5 text-text-secondary shadow-elevated group-hover:block group-focus-within:block">
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
                            triggerClassName="!h-8 w-full justify-between rounded-lg bg-surface px-2.5 text-[13px] font-medium text-text-primary disabled:opacity-60"
                            contentClassName="w-[var(--radix-select-trigger-width)]"
                          />
                          {excelConfig.headerMode === 'manual' ? (
                            <label className="relative block !h-8">
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
                                className="box-border !h-8 w-full rounded-lg border border-border-muted bg-surface pl-2.5 pr-10 text-[13px] font-medium leading-5 text-text-primary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
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
                          <div className="text-[13px] font-medium text-text-primary">
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
                      <div className="flex flex-wrap gap-3 px-1">
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
          </TabsContent>
          <TabsContent value="data" className="flex min-h-0 flex-1 flex-col">
            <GlassDataGridPreview
              preview={previewData}
              isLoading={previewLoading}
              error={previewError}
              currentPage={previewPage}
              onPageChange={(page) => void loadPreviewPage(page)}
              labels={{
                loading: t('data.inputTables.editor.previewLoading'),
                empty: t('data.inputTables.editor.previewEmpty'),
                total: (count) => t('data.inputTables.editor.previewTotal', { count }),
                pageSize: (count) => t('data.inputTables.editor.previewPageSize', { count }),
              }}
              edgeToEdge
              rowHeight={32}
              headerHeight={34}
            />
          </TabsContent>
        </Tabs>
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

export function InputTableConfigRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-9 items-center gap-3 px-1 py-0.5 lg:grid-cols-[10rem_minmax(0,1fr)]">
      <div className="text-[13px] font-medium text-text-secondary">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
