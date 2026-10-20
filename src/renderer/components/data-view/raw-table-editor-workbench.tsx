import { formatDataErrorMessage } from '../../features/data/model/errors';
import { RawTableCloudSourceDialog } from './raw-table-cloud-source-dialog';
import { RawTableAutomations } from './table-automations';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { useCallback, useEffect, useMemo, useRef, useState, Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FileCode2,
  History,
  Info,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { DATA_FIELD_TYPES, type DataFieldType } from '../../../shared/data-field-types';
import { useDataFieldTypeLabel } from '../../hooks/useDataFieldTypeLabel';
import type {
  DataColumnTypeInfo,
  DataRawTable,
  DataRawTableColumnTypeOverride,
  DataRawTableConfig,
  DataRawTableExcelConfig,
  DataRawTableCsvConfig,
  DataRawTableFolderConfig,
  DataRawTableNormalizerArtifactVersion,
  DataRawTableNormalizerDraftProgressEvent,
  DataRawTablePreview,
  DataRawTableProcessingConfig,
  DataRawTableSourceKind,
  DataNormalizerLanguage,
} from '../../types';
import { useAppStore } from '../../store';
import { GlassSelect } from '../GlassSelect';
import { getAgentModelLabel } from '../AgentModelSelector';
import { LlmPromptComposer } from '../LlmPromptComposer';
import { useConfirmDialog } from '../ConfirmDialog';
import type { RawTableDraft } from '../../features/data/model/types';
import { dataClient } from '../../features/data/api/data-client';
import {
  RAW_TABLE_PREVIEW_PAGE_SIZE,
  RawTableCheckbox,
  RawTableSelect,
  RawTableStatusBadge,
  editorHeaderRowClass,
  formatCloudMirrorLocation,
  formatDateTime,
  formatDisplayPath,
  getCloudMirror,
  getRawTableSourceMeta,
  bottomTabBarClass,
  bottomTabListClass,
  bottomTabTriggerClass,
} from './shared';
import { GlassDataGridPreview } from '../GlassDataGridPreview';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { CodePreview, getCodePreviewLanguageLabel } from './raw-table-code-preview';
import { RawTableGenerationConsole } from './raw-table-generation-console';
import { NormalizerProjectTree, RawTableVersionHistoryPanel } from './raw-table-version-history';
import { RawTablePreviewDialog } from './raw-table-preview-dialog';
import {
  applyNormalizerGenerationProgress,
  createNormalizerGenerationLog,
  createNormalizerGenerationProgressId,
  getDefaultExcelRawTableConfig,
  getDefaultFolderRawTableConfig,
  getDefaultRawTableConfig,
  getRawTableDataProcessing,
  getPreferredNormalizerFilePath,
  inferNormalizerLanguageFromRulePrompt,
  isRawTableConfigEqual,
  markNormalizerGenerationError,
  markNormalizerGenerationSuccess,
  withRawTableDataProcessing,
  type NormalizerGenerationLog,
} from './raw-table-normalizer-utils';

export type RawTableEditorProps = {
  draft?: RawTableDraft;
  rawTable?: DataRawTable;
  isBusy: boolean;
  onBack: () => void;
  onRenameDraft?: (id: string, name: string) => void;
  onRenameRawTable?: (rawTable: DataRawTable, name: string) => void | Promise<void>;
  onChooseDraftSource?: (
    draft: RawTableDraft,
    sourceKind: DataRawTableSourceKind,
    config: DataRawTableConfig,
    name?: string
  ) => void | Promise<void | string | null>;
  onChooseRawTableSource?: (
    rawTable: DataRawTable,
    sourceKind: DataRawTableSourceKind,
    config: DataRawTableConfig,
    name?: string
  ) => void | Promise<void | string | null>;
  onUpdateRawTableConfig?: (
    rawTable: DataRawTable,
    config: DataRawTableConfig,
    name?: string
  ) => void | Promise<void>;
  onSyncCloudSource?: (rawTable: DataRawTable) => Promise<DataRawTable | undefined>;
};

export type RawTableCustomizeStep = 'rules' | 'generate' | 'review';

function initialCustomizeStepFor(config: DataRawTableConfig): RawTableCustomizeStep {
  const processing = config.dataProcessing;
  return processing?.strategy === 'customize' &&
    (processing.artifactVersionId || (processing.projectFiles?.length ?? 0) > 0)
    ? 'review'
    : 'rules';
}

export function RawTableEditorWorkbench({
  draft,
  rawTable,
  isBusy,
  onBack,
  onRenameDraft,
  onRenameRawTable,
  onChooseDraftSource,
  onChooseRawTableSource,
  onUpdateRawTableConfig,
  onSyncCloudSource,
}: RawTableEditorProps) {
  const { t } = useTranslation();
  const { confirmDelete } = useConfirmDialog();
  const appConfig = useAppStore((state) => state.appConfig);
  const targetId = draft?.id ?? rawTable?.id ?? '';
  const initialName = draft?.name ?? rawTable?.name ?? '';
  const savedCloudSource = getCloudMirror(rawTable);
  const initialSourceKind = savedCloudSource ? 'cloud' : (rawTable?.sourceKind ?? 'excel');
  const initialConfig = useMemo<DataRawTableConfig>(
    () =>
      savedCloudSource
        ? {
            sourceKind: 'cloud',
            cloudMirror: savedCloudSource,
            dataProcessing: rawTable?.inputConfig.dataProcessing,
          }
        : (rawTable?.inputConfig ?? getDefaultRawTableConfig(initialSourceKind)),
    [rawTable?.inputConfig, savedCloudSource, initialSourceKind]
  );
  // Keyed on serialized content, not object identity: a rawTable refetch after a
  // failed save produces an equal config object, and must not reset in-progress
  // edits (an unpublished customize draft lives in localConfig).
  const initialConfigKey = useMemo(() => JSON.stringify(initialConfig), [initialConfig]);
  const [localName, setLocalName] = useState(initialName);
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [localSourceKind, setLocalSourceKind] = useState<DataRawTableSourceKind>(initialSourceKind);
  const [localConfig, setLocalConfig] = useState<DataRawTableConfig>(initialConfig);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeViewTab, setActiveViewTab] = useState<'config' | 'data' | 'automation'>('config');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Import / source-change failure, shown inline under the source row (B11).
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DataRawTablePreview | null>(null);
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
    DataRawTableNormalizerArtifactVersion[]
  >([]);
  const [normalizerVersionsLoading, setNormalizerVersionsLoading] = useState(false);
  const [customizeGenerationError, setCustomizeGenerationError] = useState<string | null>(null);
  const [customizeStep, setCustomizeStep] = useState<RawTableCustomizeStep>(() =>
    initialCustomizeStepFor(initialConfig)
  );
  const [versionsDialogOpen, setVersionsDialogOpen] = useState(false);
  const [selectedNormalizerFilePath, setSelectedNormalizerFilePath] = useState('');
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  // Last customize config seen while editing — restored when the strategy
  // select toggles back to 自定义, so the generated-draft linkage survives
  // accidental switches and failed saves.
  const customizeDraftBackupRef = useRef<Extract<
    DataRawTableProcessingConfig,
    { strategy: 'customize' }
  > | null>(null);
  const autoPreviewArmed = useRef(false);
  const lastSourcePath = useRef<string | null>(rawTable?.sourcePath ?? null);
  const trimmedName = localName.trim();
  const isConfigured = Boolean(rawTable);
  const cloudMirror =
    localConfig.sourceKind === 'cloud' && localConfig.cloudMirror.tableId
      ? localConfig.cloudMirror
      : undefined;
  const [cloudSourceDialogOpen, setCloudSourceDialogOpen] = useState(false);
  const localFileSource =
    rawTable && !savedCloudSource && localSourceKind === initialSourceKind
      ? rawTable.sourcePath
      : undefined;
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false);
  const sourceMeta = getRawTableSourceMeta(localSourceKind);
  const SourceIcon = sourceMeta.Icon;
  const excelConfig =
    localConfig.sourceKind === 'excel' ? localConfig : getDefaultExcelRawTableConfig();
  const folderConfig =
    localConfig.sourceKind === 'folder' ? localConfig : getDefaultFolderRawTableConfig();
  const dataProcessing = getRawTableDataProcessing(localConfig);
  const normalizerLanguage: DataNormalizerLanguage =
    dataProcessing.strategy === 'customize'
      ? inferNormalizerLanguageFromRulePrompt(dataProcessing.rulePrompt)
      : 'python';
  const hasNameChanges = Boolean(rawTable && trimmedName && trimmedName !== rawTable.name);
  const canSaveConfig =
    Boolean(rawTable) &&
    localSourceKind === initialSourceKind &&
    !isRawTableConfigEqual(localConfig, rawTable?.inputConfig);
  const canSave = Boolean(rawTable && trimmedName && !isBusy && (hasNameChanges || canSaveConfig));
  const canPreview = Boolean(
    rawTable &&
    localSourceKind === initialSourceKind &&
    !isBusy &&
    dataClient.has('previewRawTableSource')
  );
  const canGenerateCustomizeDraft = Boolean(
    rawTable &&
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
    const persistedConfig = JSON.parse(initialConfigKey) as DataRawTableConfig;
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
    setCustomizeStep(initialCustomizeStepFor(persistedConfig));
    setVersionsDialogOpen(false);
    setSelectedNormalizerFilePath('');
    setPreviewData(null);
    setPreviewError(null);
    setPreviewPage(1);
  }, [initialConfigKey, initialName, initialSourceKind, targetId]);

  useEffect(() => {
    setActiveViewTab('config');
  }, [targetId]);

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

  // Reads the real materialized column list from the source file on demand —
  // forced to the auto strategy so names reflect the raw source, not
  // normalizer output. Triggered by the column-type editor's picker button.
  const loadSourceColumns = useCallback(async (): Promise<DataColumnTypeInfo[]> => {
    if (!rawTable || !dataClient.has('previewRawTableSource')) return [];
    const preview = await dataClient.previewRawTableSource({
      filePath: rawTable.sourcePath,
      sourceKind: localSourceKind,
      config: { ...localConfig, dataProcessing: { strategy: 'auto' } } as DataRawTableConfig,
      limit: 1,
      offset: 0,
    });
    if (preview.columnTypes && preview.columnTypes.length > 0) {
      return preview.columnTypes;
    }
    return preview.columns.map((name) => ({ name, type: 'text' as const, storageType: '' }));
  }, [rawTable, localSourceKind, localConfig]);

  const handleNameChange = (value: string) => {
    setLocalName(value);
    if (draft && onRenameDraft) {
      onRenameDraft(draft.id, value);
    }
  };

  const chooseSource = (sourceKind: DataRawTableSourceKind, config = localConfig) => {
    const nextConfig =
      config.sourceKind === sourceKind ? config : getDefaultRawTableConfig(sourceKind);
    autoPreviewArmed.current = true;
    setSourceError(null);
    const pending =
      draft && onChooseDraftSource
        ? onChooseDraftSource(draft, sourceKind, nextConfig, localName)
        : rawTable && onChooseRawTableSource
          ? onChooseRawTableSource(rawTable, sourceKind, nextConfig, localName)
          : undefined;
    void Promise.resolve(pending).then((result) => {
      if (typeof result === 'string' && result) setSourceError(result);
    });
  };

  const handleSourceKindChange = (sourceKind: DataRawTableSourceKind) => {
    const nextConfig =
      sourceKind === initialSourceKind ? initialConfig : getDefaultRawTableConfig(sourceKind);
    setLocalSourceKind(sourceKind);
    setLocalConfig(nextConfig);
  };

  const updateConfig = (config: DataRawTableConfig) => {
    setLocalConfig(config);
  };

  const updateDataProcessing = useCallback(
    (dataProcessing: DataRawTableProcessingConfig) => {
      setLocalConfig(withRawTableDataProcessing(localConfig, dataProcessing));
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
    (patch: Partial<Extract<DataRawTableProcessingConfig, { strategy: 'customize' }>>) => {
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
      const result = await dataClient.listRawTableNormalizerVersions({
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
    if (!rulePrompt || !rawTable) {
      return;
    }
    setCustomizeStep('generate');
    const log = createNormalizerGenerationLog({
      rawTableName: rawTable.name,
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
    const unsubscribeProgress = dataClient.onRawTableNormalizerDraftProgress(
      (event: DataRawTableNormalizerDraftProgressEvent) => {
        if (event.progressId !== progressId) return;
        if (typeof event.text !== 'string' || event.text.length === 0) return;
        applyNormalizerGenerationProgress(log, event);
        scheduleGenerationLogFlush();
      }
    );
    try {
      const result = await dataClient.generateRawTableNormalizerDraft({
        artifactId: dataProcessing.artifactId,
        name: `${rawTable.name} normalizer`,
        sourcePath: rawTable.sourcePath,
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
      setCustomizeStep('review');
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

  const saveRawTable = () => {
    if (!rawTable || !trimmedName) return;
    setCustomizeGenerationError(null);
    if (canSaveConfig && onUpdateRawTableConfig) {
      // A customize config backed by an unpublished draft cannot reimport — the
      // server rejects it. Fail fast with a localized hint and route the user
      // to the versions tab where publishing lives, instead of wiping state.
      if (
        dataProcessing.strategy === 'customize' &&
        dataProcessing.artifactVersionStatus !== 'published'
      ) {
        setCustomizeGenerationError(t('data.rawTables.editor.saveRequiresPublishedVersion'));
        setCustomizeStep('review');
        setVersionsDialogOpen(true);
        return;
      }
      void onUpdateRawTableConfig(rawTable, localConfig, localName);
      return;
    }
    if (hasNameChanges && onRenameRawTable) {
      void onRenameRawTable(rawTable, localName);
    }
  };

  const loadPreviewPage = async (page: number, source = rawTable, config = localConfig) => {
    if (!source || !dataClient.has('previewRawTableSource')) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewPage(page);
    try {
      const nextPreview = await dataClient.previewRawTableSource({
        filePath: source.sourcePath,
        sourceKind: config.sourceKind,
        config,
        limit: RAW_TABLE_PREVIEW_PAGE_SIZE,
        offset: (page - 1) * RAW_TABLE_PREVIEW_PAGE_SIZE,
      });
      setPreviewData(nextPreview);
    } catch (err) {
      setPreviewError(formatDataErrorMessage(err, t));
    } finally {
      setPreviewLoading(false);
    }
  };

  const refreshData = async () => {
    if (!rawTable || !savedCloudSource || !onSyncCloudSource) {
      await loadPreviewPage(previewPage);
      return;
    }
    setCloudSyncBusy(true);
    setPreviewError(null);
    try {
      const refreshed = await onSyncCloudSource(rawTable);
      if (refreshed) {
        await loadPreviewPage(1, refreshed, refreshed.inputConfig);
      }
    } catch (error) {
      setPreviewError(formatDataErrorMessage(error, t));
    } finally {
      setCloudSyncBusy(false);
    }
  };

  // The data tab is the preview surface — open it and load page 1.
  const previewRawTable = async () => {
    setActiveViewTab('data');
    setPreviewData(null);
    await loadPreviewPage(1);
  };

  // Header preview toggle: enter preview (data tab + reload) or exit back to
  // the config tab.
  const handlePreviewToggle = async () => {
    if (activeViewTab === 'data') {
      setActiveViewTab('config');
      return;
    }
    await previewRawTable();
  };

  const previewRawTableRef = useRef(previewRawTable);
  previewRawTableRef.current = previewRawTable;

  // Switching to another draft/rawTable drops a pending auto-preview. A
  // draft→rawTable transition is the import completing — keep it armed so the
  // newly materialized source still previews.
  const prevTargetRef = useRef({ draftId: draft?.id ?? null, rawTableId: rawTable?.id ?? null });
  useEffect(() => {
    const prev = prevTargetRef.current;
    const next = { draftId: draft?.id ?? null, rawTableId: rawTable?.id ?? null };
    prevTargetRef.current = next;
    const draftImported = Boolean(prev.draftId && next.rawTableId && !next.draftId);
    if (!draftImported && (prev.draftId !== next.draftId || prev.rawTableId !== next.rawTableId)) {
      autoPreviewArmed.current = false;
    }
  }, [draft?.id, rawTable?.id]);

  // After the user picks a file/folder, automatically open the sample preview
  // (inferred column types + errors) once the imported/updated rawTable lands.
  useEffect(() => {
    const path = rawTable?.sourcePath ?? null;
    const changed = path !== lastSourcePath.current;
    lastSourcePath.current = path;
    if (autoPreviewArmed.current && path && changed) {
      autoPreviewArmed.current = false;
      void previewRawTableRef.current();
    }
  }, [rawTable?.sourcePath]);

  const previewCustomizeDraft = async () => {
    if (dataProcessing.strategy !== 'customize' || !dataProcessing.artifactVersionId || !rawTable) {
      return;
    }
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewData(null);
    setPreviewPage(1);
    try {
      const result = await dataClient.previewRawTableNormalizerVersion({
        versionId: dataProcessing.artifactVersionId,
        sourcePath: rawTable.sourcePath,
        sourceKind: localSourceKind,
        config: localConfig,
        prepareDependencies: true,
        limit: RAW_TABLE_PREVIEW_PAGE_SIZE,
        offset: 0,
      });
      setPreviewData(result.preview);
    } catch (err) {
      setPreviewError(formatDataErrorMessage(err, t));
    } finally {
      setPreviewLoading(false);
    }
  };

  const publishSpecificNormalizerVersion = async (
    version: DataRawTableNormalizerArtifactVersion
  ) => {
    if (dataProcessing.strategy !== 'customize' || !rawTable) {
      return;
    }
    setCustomizeVersionActionId(version.id);
    setCustomizeGenerationError(null);
    try {
      const result = await dataClient.publishRawTableNormalizerVersion({
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
    version: DataRawTableNormalizerArtifactVersion
  ) => {
    if (dataProcessing.strategy !== 'customize' || !rawTable) {
      return;
    }
    if (version.status === 'published') {
      setCustomizeGenerationError(t('data.rawTables.editor.deletePublishedVersionBlocked'));
      return;
    }
    const confirmed = await confirmDelete({
      message: t('data.rawTables.editor.deleteVersionConfirm', {
        version: version.version,
      }),
    });
    if (!confirmed) return;
    setDeletingNormalizerVersionId(version.id);
    setCustomizeGenerationError(null);
    try {
      await dataClient.deleteRawTableNormalizerVersion({
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

  const customizeStepIndex = (['rules', 'generate', 'review'] as RawTableCustomizeStep[]).indexOf(
    customizeStep
  );
  const customizeSteps: Array<{
    value: RawTableCustomizeStep;
    label: string;
    reachable: boolean;
  }> = [
    {
      value: 'rules',
      label: t('data.rawTables.editor.customizeStepPrompt'),
      reachable: true,
    },
    {
      value: 'generate',
      label: t('data.rawTables.editor.customizeStepGenerate'),
      reachable: customizeGenerating || generationLog !== null,
    },
    {
      value: 'review',
      label: t('data.rawTables.editor.customizeStepReview'),
      reachable: normalizerProjectFiles.length > 0,
    },
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
              {t('data.rawTables.editor.backShort')}
            </button>
            <div className="flex min-w-0 items-center gap-2">
              <RawTableStatusBadge
                label={
                  isConfigured
                    ? t('data.rawTables.status.available')
                    : t('data.rawTables.status.draft')
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
                      if (rawTable) {
                        setLocalName(rawTable.name);
                      }
                      setIsNameEditing(false);
                    }
                  }}
                  disabled={isBusy}
                  maxLength={50}
                  aria-label={t('data.rawTables.editor.name')}
                  className="h-8 min-w-0 max-w-[22rem] truncate border-0 bg-transparent px-0 text-[15px] font-medium text-text-secondary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder={t('data.rawTables.editor.title')}
                />
              ) : (
                <div
                  className="flex h-8 min-w-0 max-w-[22rem] items-center truncate text-[15px] font-medium text-text-secondary"
                  title={localName || t('data.rawTables.editor.title')}
                >
                  {localName || t('data.rawTables.editor.title')}
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
            <button
              type="button"
              onClick={() => void handlePreviewToggle()}
              disabled={!canPreview && activeViewTab !== 'data'}
              aria-pressed={activeViewTab === 'data'}
              className={`inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                activeViewTab === 'data'
                  ? 'border border-accent/40 bg-accent-muted text-accent'
                  : 'border border-border-muted bg-surface text-text-secondary hover:border-accent/30 hover:bg-accent-muted hover:text-accent'
              }`}
            >
              {activeViewTab === 'data' ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {activeViewTab === 'data'
                ? t('data.rawTables.actions.exitPreview')
                : t('data.rawTables.actions.preview')}
            </button>
            <button
              type="button"
              onClick={saveRawTable}
              disabled={!canSave}
              className={`inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                canSave
                  ? 'bg-accent text-accent-foreground hover:bg-accent-hover'
                  : 'border border-border-muted bg-surface text-text-secondary hover:border-accent/30 hover:bg-accent-muted hover:text-accent'
              }`}
            >
              <Save className="h-3.5 w-3.5" />
              {isBusy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>

        <Tabs
          value={activeViewTab}
          onValueChange={(value) => {
            const next = value as 'config' | 'data' | 'automation';
            setActiveViewTab(next);
            // previewData may currently hold a customize-draft preview — always
            // reload the raw source preview when entering the data tab.
            if (next === 'data' && canPreview && !previewLoading) {
              void loadPreviewPage(1);
            }
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsContent
            value="config"
            className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface"
          >
            <div
              className={`flex-shrink-0 bg-background-secondary px-6 ${dataProcessing.strategy === 'customize' ? 'border-b border-border-muted/80 py-4' : 'pb-3 pt-4'}`}
            >
              <div className="grid gap-3">
                <section className="rounded-[10px] border border-border-muted bg-surface px-4 py-3">
                  <div className="mb-1.5 px-1 text-[13px] font-semibold text-text-primary">
                    {t('data.rawTables.editor.sectionSource')}
                  </div>
                  <RawTableConfigRow
                    label={
                      localSourceKind === 'cloud'
                        ? t('data.rawTables.sources.cloud')
                        : localSourceKind === 'folder'
                          ? t('data.rawTables.editor.folderPath')
                          : t('data.rawTables.editor.file')
                    }
                  >
                    <div className="flex min-w-0 items-stretch">
                      <div
                        className={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded-l-lg border bg-surface px-2.5 shadow-soft ${sourceError ? 'border-error ring-2 ring-error/15' : 'border-border-muted'}`}
                      >
                        <span
                          className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md ${sourceMeta.className}`}
                        >
                          <SourceIcon className="h-3.5 w-3.5" />
                        </span>
                        <div
                          className="min-w-0 truncate text-[13px] font-medium text-text-primary"
                          title={
                            cloudMirror ? formatCloudMirrorLocation(cloudMirror) : localFileSource
                          }
                        >
                          {cloudMirror
                            ? formatCloudMirrorLocation(cloudMirror)
                            : localFileSource
                              ? formatDisplayPath(localFileSource)
                              : t('data.rawTables.editor.noSource')}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          localSourceKind === 'cloud'
                            ? setCloudSourceDialogOpen(true)
                            : chooseSource(localSourceKind)
                        }
                        disabled={isBusy || !trimmedName}
                        className="inline-flex h-8 flex-shrink-0 items-center justify-center rounded-r-lg border border-l-0 border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        {localSourceKind === 'cloud'
                          ? t(
                              cloudMirror
                                ? 'data.rawTables.editor.cloudSource.change'
                                : 'data.rawTables.editor.cloudSource.choose'
                            )
                          : localFileSource
                            ? localSourceKind === 'folder'
                              ? t('data.rawTables.editor.changeFolder')
                              : t('data.rawTables.editor.changeFile')
                            : localSourceKind === 'folder'
                              ? t('data.rawTables.editor.chooseFolder')
                              : t('data.rawTables.editor.chooseFile')}
                      </button>
                    </div>
                    {sourceError && (
                      <div
                        role="alert"
                        className="mt-2 flex items-start gap-2 rounded-lg border border-error/25 bg-error/6 px-2.5 py-2 text-[12.5px] leading-[18px] text-text-primary"
                      >
                        <XCircle className="mt-px h-3.5 w-3.5 flex-shrink-0 text-error" />
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold text-error">
                            {t('data.rawTables.editor.importFailedInline')}
                          </span>
                          {sourceError}
                        </div>
                        <button
                          type="button"
                          aria-label={t('common.close')}
                          onClick={() => setSourceError(null)}
                          className="flex-shrink-0 text-text-muted hover:text-text-secondary"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </RawTableConfigRow>

                  <RawTableConfigRow label={t('data.rawTables.editor.sourceType')}>
                    <GlassSelect
                      value={localSourceKind}
                      onValueChange={(value) =>
                        handleSourceKindChange(value as DataRawTableSourceKind)
                      }
                      options={[
                        { value: 'excel', label: t('data.rawTables.editor.excel') },
                        { value: 'csv', label: t('data.rawTables.editor.csv') },
                        { value: 'folder', label: t('data.rawTables.editor.folder') },
                        { value: 'cloud', label: t('data.rawTables.sources.cloud') },
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
                  </RawTableConfigRow>
                </section>
                <div className="grid gap-3">
                  <section className="rounded-[10px] border border-border-muted bg-surface px-4 py-3">
                    <div className="mb-1.5 px-1 text-[13px] font-semibold text-text-primary">
                      {t('data.rawTables.editor.sectionParsing')}
                    </div>
                    <RawTableConfigRow label={t('data.rawTables.editor.processingStrategy')}>
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
                            setCustomizeStep('rules');
                            return;
                          }
                          updateDataProcessing({ strategy: 'auto' });
                        }}
                        options={[
                          { value: 'auto', label: t('data.rawTables.editor.processingAuto') },
                          {
                            value: 'customize',
                            label: t('data.rawTables.editor.processingCustomize'),
                          },
                        ]}
                        disabled={isBusy || !rawTable}
                        triggerClassName="!h-8 w-full justify-between rounded-lg bg-surface px-2.5 text-[13px] font-medium text-text-primary disabled:opacity-60"
                        contentClassName="w-[var(--radix-select-trigger-width)]"
                      />
                    </RawTableConfigRow>
                  </section>
                </div>
              </div>
            </div>

            {dataProcessing.strategy === 'customize' ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex h-10 flex-shrink-0 items-center gap-1 border-b border-border-muted/80 px-4">
                  {customizeSteps.map((step, index) => {
                    const isActive = customizeStep === step.value;
                    const isDone = index < customizeStepIndex;
                    const clickable = step.reachable || isActive;
                    return (
                      <Fragment key={step.value}>
                        {index > 0 ? (
                          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-text-muted/50" />
                        ) : null}
                        <button
                          type="button"
                          disabled={!clickable}
                          onClick={() => setCustomizeStep(step.value)}
                          className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors ${
                            isActive
                              ? 'text-accent'
                              : clickable
                                ? 'text-text-secondary hover:bg-accent-muted hover:text-accent'
                                : 'cursor-not-allowed text-text-muted/60'
                          }`}
                        >
                          <span
                            className={`flex h-4.5 w-4.5 items-center justify-center rounded-full text-[10px] font-semibold ${
                              isActive
                                ? 'bg-accent text-accent-foreground'
                                : isDone
                                  ? 'bg-accent-muted text-accent'
                                  : 'bg-surface-active text-text-muted'
                            }`}
                          >
                            {index + 1}
                          </span>
                          {step.label}
                        </button>
                      </Fragment>
                    );
                  })}
                </div>

                <div className="min-h-0 flex-1 overflow-hidden px-4 py-4">
                  {customizeStep === 'rules' ? (
                    <div className="mx-auto flex h-full min-h-0 max-w-[70rem] flex-col gap-4">
                      <div className="grid flex-shrink-0 gap-2">
                        <span className="inline-flex items-center gap-2 text-[13px] font-medium text-text-secondary">
                          {t('data.rawTables.editor.rulePrompt')}
                          <span className="group relative inline-flex">
                            <button
                              type="button"
                              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent-muted hover:text-accent focus:bg-accent-muted focus:text-accent focus:outline-none"
                              aria-label={t('data.rawTables.editor.rulePromptHint')}
                            >
                              <Info className="h-3.5 w-3.5" />
                            </button>
                            <span className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-72 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-left text-[12px] font-medium leading-5 text-text-secondary shadow-elevated group-hover:block group-focus-within:block">
                              {t('data.rawTables.editor.rulePromptHint')}
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
                          placeholder={t('data.rawTables.editor.rulePromptPlaceholder')}
                          disabled={isBusy || !rawTable}
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
                            {t('data.rawTables.editor.rulePromptExamples')}
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
                            const example = t(`data.rawTables.editor.${key}`);
                            return (
                              <button
                                key={key}
                                type="button"
                                disabled={isBusy || !rawTable || customizeGenerating}
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
                    </div>
                  ) : null}

                  {customizeStep === 'generate' ? (
                    <div className="mx-auto flex h-full min-h-0 max-w-[70rem] flex-col">
                      <RawTableGenerationConsole
                        isStreaming={customizeGenerating}
                        log={generationLog}
                        onViewCode={
                          normalizerProjectFiles.length > 0
                            ? () => setCustomizeStep('review')
                            : undefined
                        }
                        t={t}
                      />
                    </div>
                  ) : null}

                  {customizeStep === 'review' ? (
                    normalizerProjectFiles.length === 0 ? (
                      <div className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-border-muted">
                        <div className="flex flex-col items-center gap-2 px-6 text-center">
                          <FileCode2 className="h-6 w-6 text-text-muted" />
                          <span className="text-[13px] font-medium text-text-secondary">
                            {t('data.rawTables.editor.noProjectFiles')}
                          </span>
                          <span className="text-xs text-text-muted">
                            {t('data.rawTables.editor.selectedFileEmpty')}
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
                                  {t('data.rawTables.editor.codeFileMeta', {
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
                                  ? t('data.rawTables.editor.copiedCode')
                                  : t('data.rawTables.editor.copyCode')
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
                              {t('data.rawTables.editor.projectStructure')}
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
                </div>

                {customizeGenerationError ? (
                  <div className="mx-4 flex-shrink-0 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-[12px] font-medium text-error">
                    {customizeGenerationError}
                  </div>
                ) : null}

                <div className="flex min-h-12 flex-shrink-0 items-center gap-2 border-t border-border-muted/80 px-4 py-2">
                  {customizeStep !== 'rules' && !customizeGenerating ? (
                    <button
                      type="button"
                      onClick={() => setCustomizeStep('rules')}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-text-primary"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      {t('data.rawTables.editor.customizeStepBack')}
                    </button>
                  ) : null}
                  <div className="ml-auto flex items-center gap-2">
                    {customizeStep === 'review' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setVersionsDialogOpen(true)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent"
                        >
                          <History className="h-3.5 w-3.5" />
                          {t('data.rawTables.editor.versionHistory')}
                        </button>
                        <button
                          type="button"
                          disabled={!customizeArtifactVersionId || previewLoading || !rawTable}
                          onClick={() => void previewCustomizeDraft()}
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {previewLoading ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                          {t('data.rawTables.editor.previewNormalizedDraft')}
                        </button>
                        {dataProcessing.artifactVersionStatus === 'published' ? (
                          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 text-xs font-medium text-success">
                            <Check className="h-3.5 w-3.5" />
                            {t('data.rawTables.editor.publishedVersion')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={!currentNormalizerVersion || !!customizeVersionActionId}
                            onClick={() => {
                              if (currentNormalizerVersion) {
                                void publishSpecificNormalizerVersion(currentNormalizerVersion);
                              }
                            }}
                            className="inline-flex h-8 min-w-[7rem] items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-foreground shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-active disabled:text-text-muted disabled:opacity-70"
                          >
                            {customizeVersionActionId ? (
                              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Upload className="h-3.5 w-3.5" />
                            )}
                            {customizeVersionActionId
                              ? t('data.rawTables.editor.publishingNormalizer')
                              : t('data.rawTables.editor.publishNormalizer')}
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={!canGenerateCustomizeDraft}
                        onClick={() => void generateCustomizeDraft()}
                        className="inline-flex h-8 min-w-[8rem] items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-foreground shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-active disabled:text-text-muted disabled:opacity-70"
                        title={t('data.rawTables.editor.generateProjectDisabled')}
                      >
                        {customizeGenerating ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        {customizeGenerating
                          ? t('data.rawTables.editor.generateProjectDrafting')
                          : t('data.rawTables.editor.generateProjectDraft')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto bg-background-secondary px-6 pb-4">
                <div className="grid gap-1 rounded-[10px] border border-border-muted bg-surface px-4 py-3">
                  <div className="mb-0.5 px-1 text-[13px] font-semibold text-text-primary">
                    {t('data.rawTables.editor.sectionParsingDetail')}
                  </div>
                  {localSourceKind === 'excel' ? (
                    <>
                      <RawTableConfigRow label={t('data.rawTables.editor.sheetName')}>
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
                          disabled={isBusy || !rawTable}
                          triggerClassName="!h-8 w-full justify-between rounded-lg bg-surface px-2.5 text-[13px] font-medium text-text-primary disabled:opacity-60"
                          contentClassName="w-[var(--radix-select-trigger-width)]"
                        />
                      </RawTableConfigRow>
                      <RawTableConfigRow
                        label={
                          <span className="inline-flex items-center gap-1.5">
                            {t('data.rawTables.editor.headerRow')}
                            <span className="group relative inline-flex">
                              <button
                                type="button"
                                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent-muted hover:text-accent focus:bg-accent-muted focus:text-accent focus:outline-none"
                                aria-label={t('data.rawTables.editor.headerRowDetectHint')}
                              >
                                <Info className="h-3.5 w-3.5" />
                              </button>
                              <span className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-72 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-left text-[12px] font-medium leading-5 text-text-secondary shadow-elevated group-hover:block group-focus-within:block">
                                {t('data.rawTables.editor.headerRowDetectHint')}
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
                                headerMode: value as DataRawTableExcelConfig['headerMode'],
                              })
                            }
                            options={[
                              { value: 'auto', label: t('data.rawTables.editor.smartDetect') },
                              {
                                value: 'manual',
                                label: t('data.rawTables.editor.manualSpecify'),
                              },
                            ]}
                            disabled={isBusy || !rawTable}
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
                                disabled={isBusy || !rawTable}
                                className="box-border !h-8 w-full rounded-lg border border-border-muted bg-surface pl-2.5 pr-10 text-[13px] font-medium leading-5 text-text-primary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                              />
                              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-text-muted">
                                {t('data.rawTables.editor.rowUnit')}
                              </span>
                            </label>
                          ) : null}
                        </div>
                      </RawTableConfigRow>
                      <RawTableConfigRow label={t('data.rawTables.editor.columnTypes')}>
                        <ColumnTypeOverridesEditor
                          overrides={excelConfig.columnTypeOverrides ?? []}
                          onChange={(columnTypeOverrides) =>
                            updateConfig({ ...excelConfig, columnTypeOverrides })
                          }
                          disabled={isBusy || !rawTable}
                          loadColumns={loadSourceColumns}
                        />
                      </RawTableConfigRow>
                    </>
                  ) : null}

                  {localSourceKind === 'csv' ? (
                    <div className="grid gap-3">
                      {[
                        ['header', 'data.rawTables.editor.csvHeader'],
                        ['dataRegion', 'data.rawTables.editor.csvDataRegion'],
                        ['delimiter', 'data.rawTables.editor.csvDelimiter'],
                      ].map(([key, labelKey]) => (
                        <RawTableConfigRow key={key} label={t(labelKey)}>
                          <div className="text-[13px] font-medium text-text-primary">
                            {t('data.rawTables.editor.autoDetected')}
                          </div>
                        </RawTableConfigRow>
                      ))}
                      <RawTableConfigRow label={t('data.rawTables.editor.csvEncoding')}>
                        <RawTableSelect
                          value={localConfig.sourceKind === 'csv' ? localConfig.encoding : 'auto'}
                          disabled={isBusy || !rawTable}
                          onChange={(value) =>
                            localConfig.sourceKind === 'csv'
                              ? updateConfig({
                                  ...localConfig,
                                  encoding: value as DataRawTableCsvConfig['encoding'],
                                })
                              : undefined
                          }
                          options={[
                            { value: 'auto', label: t('data.rawTables.editor.csvEncodingAuto') },
                            { value: 'utf-8', label: 'UTF-8' },
                            { value: 'gbk', label: t('data.rawTables.editor.csvEncodingGbk') },
                          ]}
                        />
                      </RawTableConfigRow>
                      <RawTableConfigRow label={t('data.rawTables.editor.columnTypes')}>
                        <ColumnTypeOverridesEditor
                          overrides={
                            localConfig.sourceKind === 'csv'
                              ? (localConfig.columnTypeOverrides ?? [])
                              : []
                          }
                          onChange={(columnTypeOverrides) =>
                            localConfig.sourceKind === 'csv'
                              ? updateConfig({ ...localConfig, columnTypeOverrides })
                              : undefined
                          }
                          disabled={isBusy || !rawTable}
                          loadColumns={loadSourceColumns}
                        />
                      </RawTableConfigRow>
                    </div>
                  ) : null}

                  {localSourceKind === 'folder' ? (
                    <div className="grid gap-3">
                      <RawTableConfigRow label={t('data.rawTables.editor.fileSelectionRange')}>
                        <RawTableSelect
                          value={folderConfig.fileRange}
                          disabled={isBusy || !rawTable}
                          onChange={(value) =>
                            updateConfig({
                              ...folderConfig,
                              fileRange: value as DataRawTableFolderConfig['fileRange'],
                            })
                          }
                          options={[
                            {
                              value: 'excel_csv',
                              label: t('data.rawTables.editor.includeExcelCsv'),
                            },
                            { value: 'excel', label: t('data.rawTables.editor.includeExcel') },
                            { value: 'csv', label: t('data.rawTables.editor.includeCsv') },
                          ]}
                        />
                      </RawTableConfigRow>
                      <div className="flex flex-wrap gap-3 px-1">
                        <RawTableCheckbox
                          checked={folderConfig.skipEmptyFiles}
                          disabled={isBusy || !rawTable}
                          label={t('data.rawTables.editor.skipEmptyFiles')}
                          onChange={(checked) =>
                            updateConfig({ ...folderConfig, skipEmptyFiles: checked })
                          }
                        />
                        <RawTableCheckbox
                          checked={folderConfig.keepSourceFileName}
                          disabled={isBusy || !rawTable}
                          label={t('data.rawTables.editor.keepSourceFileName')}
                          onChange={(checked) =>
                            updateConfig({ ...folderConfig, keepSourceFileName: checked })
                          }
                        />
                      </div>
                      <RawTableConfigRow label={t('data.rawTables.editor.columnTypes')}>
                        <ColumnTypeOverridesEditor
                          overrides={folderConfig.columnTypeOverrides ?? []}
                          onChange={(columnTypeOverrides) =>
                            updateConfig({ ...folderConfig, columnTypeOverrides })
                          }
                          disabled={isBusy || !rawTable}
                          loadColumns={loadSourceColumns}
                        />
                      </RawTableConfigRow>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </TabsContent>
          <TabsContent value="data" className="flex min-h-0 flex-1 flex-col">
            <GlassDataGridPreview
              enableFilters
              preview={previewData}
              isLoading={previewLoading}
              error={previewError}
              currentPage={previewPage}
              onPageChange={(page) => void loadPreviewPage(page)}
              onRetry={() => void loadPreviewPage(previewPage)}
              labels={{
                loading: t('data.rawTables.editor.previewLoading'),
                empty: t('data.rawTables.editor.previewEmpty'),
                total: (count) => t('data.rawTables.editor.previewTotal', { count }),
                errorTitle: t('data.preview.loadFailed'),
                retry: t('data.preview.retry'),
                pageSize: (count) => t('data.rawTables.editor.previewPageSize', { count }),
              }}
              edgeToEdge
              rowHeight={32}
              headerHeight={34}
            />
          </TabsContent>
          {rawTable ? (
            <TabsContent
              value="automation"
              className="min-h-0 flex-1 overflow-y-auto bg-background-secondary"
            >
              <div className="px-6 py-4">
                <section className="rounded-[10px] border border-border-muted bg-surface px-4 py-3">
                  <div className="mb-1.5 px-1 text-[13px] font-semibold text-text-primary">
                    {t('data.rawTables.editor.sectionLinkage')}
                  </div>
                  <RawTableAutomations
                    key={rawTable.id}
                    rawTable={rawTable}
                    embedded
                    Row={RawTableConfigRow}
                  />
                </section>
              </div>
            </TabsContent>
          ) : null}
          <div className={`${bottomTabBarClass} justify-between`}>
            <TabsList className={bottomTabListClass}>
              <TabsTrigger value="config" className={bottomTabTriggerClass}>
                {t('data.rawTables.editor.tabs.config')}
              </TabsTrigger>
              <TabsTrigger value="data" className={bottomTabTriggerClass} disabled={!canPreview}>
                {t('data.rawTables.editor.tabs.data')}
              </TabsTrigger>
              {rawTable ? (
                <TabsTrigger value="automation" className={bottomTabTriggerClass}>
                  {t('data.rawTables.editor.tabs.automation')}
                </TabsTrigger>
              ) : null}
            </TabsList>
            <div className="flex items-center gap-2 px-4 text-xs text-text-muted">
              {activeViewTab === 'data' && previewData && rawTable && (
                <span>
                  {t('data.resultTables.editor.dataMeta', {
                    rows: previewData.totalRows,
                    time: formatDateTime(savedCloudSource?.syncedAt ?? rawTable.updatedAt),
                  })}
                </span>
              )}
              {activeViewTab === 'data' && canPreview && (
                <button
                  type="button"
                  onClick={() => void refreshData()}
                  disabled={previewLoading || cloudSyncBusy}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
                  aria-label={t('data.actions.refresh')}
                  title={t('data.actions.refresh')}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${previewLoading || cloudSyncBusy ? 'animate-spin' : ''}`}
                  />
                </button>
              )}
            </div>
          </div>
        </Tabs>
      </section>
      {cloudSourceDialogOpen && (
        <RawTableCloudSourceDialog
          initialSource={cloudMirror}
          onClose={() => setCloudSourceDialogOpen(false)}
          onSelect={(source) =>
            chooseSource('cloud', { sourceKind: 'cloud', cloudMirror: source, dataProcessing })
          }
        />
      )}
      <Dialog
        open={versionsDialogOpen}
        onOpenChange={setVersionsDialogOpen}
        ariaLabel={t('data.rawTables.editor.versionHistory')}
        className="w-full max-w-4xl p-5"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <div className="text-[14px] font-semibold text-text-primary">
              {t('data.rawTables.editor.versionHistory')}
            </div>
            {normalizerVersions.length > 0 ? (
              <span className="text-xs text-text-muted">
                {t('data.rawTables.editor.versionsCount', {
                  count: normalizerVersions.length,
                })}
              </span>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setVersionsDialogOpen(false)}
            className="text-text-muted hover:bg-accent-muted hover:text-accent"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <RawTableVersionHistoryPanel
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
      </Dialog>
      {previewOpen && (
        <RawTablePreviewDialog
          tableKind="raw"
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

export function RawTableConfigRow({
  label,
  children,
  align = 'center',
}: {
  label: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center';
}) {
  return (
    <div className="grid min-h-9 items-center gap-3 px-1 py-0.5 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
      <div
        className={`text-[13px] font-medium text-text-secondary ${align === 'start' ? 'lg:self-start lg:pt-1.5' : ''}`}
      >
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ColumnTypeOverridesEditor({
  overrides,
  onChange,
  disabled,
  loadColumns,
}: {
  overrides: DataRawTableColumnTypeOverride[];
  onChange: (next: DataRawTableColumnTypeOverride[] | undefined) => void;
  disabled?: boolean;
  loadColumns: () => Promise<DataColumnTypeInfo[]>;
}) {
  const { t } = useTranslation();
  const dataTypeLabel = useDataFieldTypeLabel();
  const [fileColumns, setFileColumns] = useState<DataColumnTypeInfo[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const configuredNames = useMemo(
    () => new Set(overrides.map((entry) => entry.name.trim()).filter(Boolean)),
    [overrides]
  );
  const setOverride = (index: number, patch: Partial<DataRawTableColumnTypeOverride>) => {
    onChange(overrides.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  };
  const openPicker = async () => {
    setPicked(new Set());
    setPickerOpen(true);
    setPickerLoading(true);
    try {
      const columns = await loadColumns();
      setFileColumns(columns);
    } finally {
      setPickerLoading(false);
    }
  };
  const selectableColumns = fileColumns.filter((column) => !configuredNames.has(column.name));
  const confirmPicked = () => {
    const additions = fileColumns
      .filter((column) => picked.has(column.name) && !configuredNames.has(column.name))
      .map((column) => ({ name: column.name, type: column.type }));
    if (additions.length > 0) {
      onChange([...overrides, ...additions]);
    }
    setPickerOpen(false);
  };
  return (
    <div className="grid gap-1.5">
      {overrides.map((entry, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_9rem_1.75rem] items-center gap-2">
          <input
            type="text"
            value={entry.name}
            placeholder={t('data.rawTables.editor.columnTypeNamePlaceholder')}
            disabled={disabled}
            onChange={(event) => setOverride(index, { name: event.target.value })}
            className="box-border !h-8 w-full rounded-lg border border-border-muted bg-surface px-2.5 text-[13px] font-medium leading-5 text-text-primary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <GlassSelect
            value={entry.type}
            onValueChange={(value) => setOverride(index, { type: value as DataFieldType })}
            options={DATA_FIELD_TYPES.map((type) => ({
              value: type,
              label: dataTypeLabel(type),
            }))}
            disabled={disabled}
            triggerClassName="!h-8 w-full justify-between rounded-lg bg-surface px-2.5 text-[13px] font-medium text-text-primary disabled:opacity-60"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const next = overrides.filter((_, i) => i !== index);
              onChange(next.length > 0 ? next : undefined);
            }}
            aria-label={t('data.rawTables.editor.removeColumnType')}
            title={t('data.rawTables.editor.removeColumnType')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...overrides, { name: '', type: 'text' }])}
          className="inline-flex h-7 w-fit items-center gap-1 rounded-md px-2 text-[12px] font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('data.rawTables.editor.addColumnType')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void openPicker()}
          className="inline-flex h-7 w-fit items-center gap-1 rounded-md px-2 text-[12px] font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Eye className="h-3.5 w-3.5" />
          {t('data.rawTables.editor.pickColumnsFromFile')}
        </button>
      </div>
      <Dialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        ariaLabel={t('data.rawTables.editor.pickColumnsTitle')}
        className="w-full max-w-md p-5"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[14px] font-semibold text-text-primary">
            {t('data.rawTables.editor.pickColumnsTitle')}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPickerOpen(false)}
            className="text-text-muted hover:bg-accent-muted hover:text-accent"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {pickerLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-text-muted">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              {t('data.rawTables.editor.columnsLoading')}
            </div>
          ) : fileColumns.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-text-muted">
              {t('data.rawTables.editor.columnsEmpty')}
            </div>
          ) : (
            <div className="grid gap-0.5">
              {fileColumns.map((column) => {
                const isConfigured = configuredNames.has(column.name);
                const isPicked = picked.has(column.name);
                return (
                  <label
                    key={column.name}
                    className={`flex h-8 items-center gap-2 rounded-md px-2 text-[13px] ${
                      isConfigured
                        ? 'cursor-not-allowed text-text-muted/60'
                        : 'cursor-pointer text-text-primary hover:bg-surface-hover'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isConfigured || isPicked}
                      disabled={isConfigured}
                      onChange={(event) => {
                        setPicked((current) => {
                          const next = new Set(current);
                          if (event.target.checked) {
                            next.add(column.name);
                          } else {
                            next.delete(column.name);
                          }
                          return next;
                        });
                      }}
                      className="h-4 w-4 rounded border-border-muted text-accent focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{column.name}</span>
                    <span className="flex-shrink-0 text-[11px] text-text-muted">
                      {isConfigured
                        ? t('data.rawTables.editor.columnTypeAdded')
                        : dataTypeLabel(column.type)}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <RawTableCheckbox
            checked={
              selectableColumns.length > 0 && selectableColumns.every((c) => picked.has(c.name))
            }
            disabled={pickerLoading || selectableColumns.length === 0}
            label={t('common.selectAll')}
            onChange={(checked) =>
              setPicked(checked ? new Set(selectableColumns.map((c) => c.name)) : new Set())
            }
          />
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPickerOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={picked.size === 0}
              onClick={confirmPicked}
            >
              {t('data.rawTables.editor.confirmAddColumns', { count: picked.size })}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
