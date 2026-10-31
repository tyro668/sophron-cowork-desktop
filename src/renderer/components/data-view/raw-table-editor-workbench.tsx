import { modesForSource } from './raw-source-detail';
import { useInlineModeChange } from './raw-source-mode-change';
import { formatDataErrorMessage } from '../../features/data/model/errors';
import { RawTableCloudSourceDialog } from './raw-table-cloud-source-dialog';
import { RawTableAutomations } from './table-automations';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { SecretsEditor, useSecretReview } from '../secrets/secrets-ui';
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
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';
import { DATA_FIELD_TYPES, type DataFieldType } from '../../../shared/data-field-types';
import { useDataFieldTypeLabel } from '../../hooks/useDataFieldTypeLabel';
import type {
  DataColumnTypeInfo,
  DataRawTable,
  DataRawSource,
  DataRawSourceBuildMode,
  DataRawSourceCreateResult,
  DataRawTableColumnTypeOverride,
  DataRawTableConfig,
  DataRawTableExcelConfig,
  DataRawTableCsvConfig,
  DataRawTableFolderConfig,
  DataNormalizerProjectFile,
  DataRawTableNormalizerArtifactVersion,
  DataRawTableNormalizerDraftProgressEvent,
  DataRawTablePreview,
  DataRawTableProcessingConfig,
  DataRawTableSourceKind,
  DataNormalizerLanguage,
} from '../../types';
import { useAppStore } from '../../store';
import { GlassSelect } from '../GlassSelect';
import { AgentModelSelector, getAgentModelLabel } from '../AgentModelSelector';
import { LlmPromptComposer } from '../LlmPromptComposer';
import { useConfirmDialog } from '../ConfirmDialog';
import type { RawTableDraft } from '../../features/data/model/types';
import { dataClient } from '../../features/data/api/data-client';
import {
  RAW_TABLE_PREVIEW_PAGE_SIZE,
  RawTableCheckbox,
  RawTableSelect,
  RawTableStatusBadge,
  formatCloudMirrorLocation,
  formatDateTime,
  DataMoreMenu,
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
import { FixErrorPanel, type AutoFixRounds } from './fix-error-panel';
import { CodeDiffView, fileDiffStats } from './code-diff-view';
import {
  createFixLog,
  failureHistoryItem,
  historyFromLog,
  runFixFlow,
  type FixFailure,
} from './fix-error-flow';
import {
  changedFilePaths,
  evaluatePass,
  expectedColumnsFromAnalysis,
  parseErrorReport,
  predictFixDraft,
  summarizeError,
  type FixErrorReport,
} from '../../../shared/fix-error';
import {
  applyNormalizerGenerationProgress,
  createNormalizerGenerationLog,
  createNormalizerGenerationProgressId,
  getDefaultExcelRawTableConfig,
  getDefaultFolderRawTableConfig,
  getDefaultRawTableConfig,
  getRawTableDataProcessing,
  getNormalizerChangeMarkers,
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
  /** Opens the delete confirmation (never deletes without the dialog). */
  onDelete?: (rawTable: DataRawTable) => void | Promise<void>;
  /** Tab to show first (the source wizard opens a new table on its Data tab). */
  initialViewTab?: 'config' | 'data' | 'automation';
  /** The table's source; Excel / folder sources can switch build mode (rebuild wizard). */
  rawSource?: DataRawSource | null;
  /** Enables the inline 组织方式 change; called after it was saved (tables rebuilt). */
  onBuildModeRebuilt?: (result: DataRawSourceCreateResult) => void;
};

export type RawTableCustomizeStep = 'rules' | 'generate' | 'review';

function initialCustomizeStepFor(config: DataRawTableConfig): RawTableCustomizeStep {
  const processing = config.dataProcessing;
  return processing?.strategy === 'customize' && processing.artifactVersionId ? 'review' : 'rules';
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
  onDelete,
  initialViewTab,
  rawSource,
  onBuildModeRebuilt,
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
  const modeChange = useInlineModeChange(rawSource, (result) => onBuildModeRebuilt?.(result));
  const changingMode = modeChange.pending !== null;
  const [activeViewTab, setActiveViewTab] = useState<'config' | 'data' | 'automation'>(
    initialViewTab ?? 'config'
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Import / source-change failure, shown inline under the source row (B11).
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DataRawTablePreview | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [customizeGenerating, setCustomizeGenerating] = useState(false);
  const secretReview = useSecretReview();
  const [secretsKey, setSecretsKey] = useState(0);
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
  const [customizeModelMenuOpen, setCustomizeModelMenuOpen] = useState(false);
  const [customizeStep, setCustomizeStep] = useState<RawTableCustomizeStep>(() =>
    initialCustomizeStepFor(initialConfig)
  );
  const [versionsDialogOpen, setVersionsDialogOpen] = useState(false);
  const [selectedNormalizerFilePath, setSelectedNormalizerFilePath] = useState('');
  // 报错修复: which version the last preview ran, how long it took, a 通过但结果异常 verdict,
  // the panel inputs, and the result of the last fix turn (for the 差异 view and step bar).
  const [previewRun, setPreviewRun] = useState<{
    versionId: string;
    durationMs: number;
    suspicious?: { reason: string; sample: string };
  } | null>(null);
  const [fixNote, setFixNote] = useState('');
  const [autoFixRounds, setAutoFixRounds] = useState<AutoFixRounds>(0);
  const [fixing, setFixing] = useState(false);
  const [fixInfo, setFixInfo] = useState<{
    versionId: string;
    version: number;
    rounds: number;
    passed: boolean;
    text: string;
    baseFiles: DataNormalizerProjectFile[];
  } | null>(null);
  const [codeView, setCodeView] = useState<'diff' | 'full'>('full');
  const [focusLine, setFocusLine] = useState<{ path: string; line: number } | null>(null);
  const [continueText, setContinueText] = useState('');
  const lastFixFailureRef = useRef<FixFailure | null>(null);
  // 补充 notes and follow-up requests from earlier fix turns on this draft: each turn resends
  // them (oldest first) so a later request does not undo an earlier fix.
  const fixNotesRef = useRef<string[]>([]);
  /** progressId of the running generation / fix agent, for 取消. */
  const activeAgentProgressRef = useRef<string | null>(null);
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
    // Code is read from the normalizer's git repo (via the version list), never from config.
    return currentNormalizerVersion?.files ?? [];
  }, [currentNormalizerVersion, dataProcessing]);
  const showingFix = Boolean(
    fixInfo && currentNormalizerVersion && currentNormalizerVersion.id === fixInfo.versionId
  );
  const normalizerChangeMarkers = useMemo(
    () =>
      showingFix && fixInfo && currentNormalizerVersion
        ? // After an AI 修复 the markers show what this fix changed against the version it edited.
          Object.fromEntries(
            changedFilePaths(fixInfo.baseFiles, currentNormalizerVersion.files).map((path) => [
              path,
              fixInfo.baseFiles.some((file) => file.path === path)
                ? t('scripts.editor.markerModified')
                : t('scripts.editor.markerAdded'),
            ])
          )
        : getNormalizerChangeMarkers(
            currentNormalizerVersion,
            normalizerVersions.find((version) => version.status === 'published'),
            {
              modified: t('scripts.editor.markerModified'),
              added: t('scripts.editor.markerAdded'),
            }
          ),
    [currentNormalizerVersion, fixInfo, normalizerVersions, showingFix, t]
  );
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

  const initialViewTabRef = useRef(initialViewTab);
  useEffect(() => {
    if (initialViewTabRef.current === 'data' && rawTable) {
      // Opened from the source wizard's "打开数据页": show the data tab with page 1 loaded.
      void previewRawTableRef.current();
    } else {
      setActiveViewTab('config');
    }
    initialViewTabRef.current = undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const rawRulePrompt = dataProcessing.rulePrompt.trim();
    if (!rawRulePrompt || !rawTable) {
      return;
    }
    // Key-like strings are confirmed as secrets first; the model only sees ${SECRET:NAME}.
    const reviewed = await secretReview.review(rawRulePrompt);
    if (!reviewed) return;
    const rulePrompt = reviewed.text;
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
    fixNotesRef.current = [];
    setCustomizeGenerationError(null);
    const progressId = createNormalizerGenerationProgressId();
    activeAgentProgressRef.current = progressId;
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
        secrets: reviewed.secrets,
        secretsReviewed: reviewed.secretsReviewed,
      });
      setSecretsKey((key) => key + 1);
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
      if (activeAgentProgressRef.current === progressId) activeAgentProgressRef.current = null;
      setCustomizeGenerating(false);
      flushGenerationLog();
    }
  };

  const cancelNormalizerAgent = () => {
    const progressId = activeAgentProgressRef.current;
    if (progressId)
      void dataClient.cancelRawTableNormalizerDraft(progressId).catch(() => undefined);
  };

  const previewVersion = previewRun
    ? normalizerVersions.find((version) => version.id === previewRun.versionId)
    : undefined;
  const previewVersionLabel = previewVersion
    ? t(
        previewVersion.status === 'published'
          ? 'fixError.baseLabelPublished'
          : 'fixError.baseLabelDraft',
        { version: previewVersion.version }
      )
    : '';
  const normalizerReport = useMemo((): FixErrorReport | null => {
    if (!previewRun || previewLoading) return null;
    if (previewRun.suspicious)
      return {
        ...parseErrorReport({
          error: previewRun.suspicious.reason,
          durationMs: previewRun.durationMs,
        }),
        message: previewRun.suspicious.reason,
        traceback: previewRun.suspicious.sample,
        exitCode: 0,
      };
    if (!previewError) return null;
    return parseErrorReport(
      { error: previewError, durationMs: previewRun.durationMs },
      previewVersion?.files.map((file) => file.path)
    );
  }, [previewError, previewLoading, previewRun, previewVersion]);
  const previewFailedHere = Boolean(
    normalizerReport && previewRun && previewRun.versionId === customizeArtifactVersionId
  );
  const normalizerFixTarget = predictFixDraft(normalizerVersions);
  const sourceInputLabel = rawTable
    ? [
        rawTable.sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? rawTable.sourcePath,
        localSourceKind === 'excel'
          ? 'Excel'
          : localSourceKind === 'folder'
            ? t('data.rawTables.editor.sourceKindFolder', { defaultValue: 'Folder' })
            : localSourceKind.toUpperCase(),
      ].join(' · ')
    : '';
  /** 数据异常 → 交给 AI 修复: open the fix panel on the published version with the refresh reason. */
  const openHealthFix = (reason: string) => {
    if (dataProcessing.strategy !== 'customize' || !dataProcessing.artifactVersionId) return;
    setPreviewData(null);
    setPreviewError(null);
    setPreviewRun({
      versionId: dataProcessing.artifactVersionId,
      durationMs: 0,
      suspicious: { reason: `通过但结果异常：刷新检查未通过：${reason}`, sample: '' },
    });
    setPreviewOpen(true);
  };
  const scriptPackageOfTable = rawTable
    ? (/[\\/]scripts[\\/]([^\\/]+)[\\/]\.sophron[\\/]output\.csv$/.exec(rawTable.sourcePath)?.[1] ??
      null)
    : null;
  const startPreviewFix = () => {
    if (!normalizerReport || !previewRun) return;
    void startNormalizerFix({
      failure: {
        message: normalizerReport.message,
        error: previewRun.suspicious
          ? `${previewRun.suspicious.reason}\n${previewRun.suspicious.sample}`
          : (previewError ?? ''),
        durationMs: previewRun.durationMs,
      },
      report: normalizerReport,
      note: fixNote,
      maxRounds: Math.max(1, autoFixRounds),
      baseVersionId: previewRun.versionId,
    });
  };
  const sendNormalizerContinue = () => {
    const text = continueText.trim();
    if (!text || !fixInfo) return;
    const failure = lastFixFailureRef.current ?? {
      message: t('fixError.continueNoError'),
      error: t('fixError.continueNoError'),
    };
    setContinueText('');
    void startNormalizerFix({
      failure,
      report: parseErrorReport({ error: failure.error, log: failure.log }),
      request: text,
      maxRounds: Math.max(1, autoFixRounds),
      baseVersionId: fixInfo.versionId,
    });
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

  /** Pass check on a normalizer preview: 通过但结果异常 (missing / all-empty columns, 0 行) fails. */
  const judgeNormalizerPreview = (
    preview: DataRawTablePreview,
    files: DataNormalizerProjectFile[] | undefined
  ) => {
    const verdict =
      preview.totalRows === 0 && preview.columns.length > 0
        ? { ok: false, reason: t('fixError.emptyOutput') }
        : evaluatePass({
            ok: true,
            columns: preview.columns,
            rows: preview.rows,
            totalRows: preview.totalRows,
            expectedColumns: expectedColumnsFromAnalysis(
              files?.find((file) => file.path === 'docs/source-structure-analysis.json')?.content
            ),
          });
    if (verdict.ok) return null;
    const head = preview.columns.join(',');
    const lines = preview.rows
      .slice(0, 5)
      .map((row) => preview.columns.map((column) => String(row[column] ?? '')).join(','));
    return {
      reason: verdict.reason ?? '',
      sample: `输出预览（共 ${preview.totalRows} 行）：\n${[head, ...lines].join('\n')}`,
    };
  };

  const previewCustomizeDraft = async (page = 1) => {
    if (dataProcessing.strategy !== 'customize' || !dataProcessing.artifactVersionId || !rawTable) {
      return;
    }
    const versionId = dataProcessing.artifactVersionId;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewData(null);
    setPreviewPage(page);
    if (page === 1) setPreviewRun(null);
    const startedAt = Date.now();
    try {
      const result = await dataClient.previewRawTableNormalizerVersion({
        versionId,
        sourcePath: rawTable.sourcePath,
        sourceKind: localSourceKind,
        config: localConfig,
        prepareDependencies: true,
        limit: RAW_TABLE_PREVIEW_PAGE_SIZE,
        offset: (page - 1) * RAW_TABLE_PREVIEW_PAGE_SIZE,
      });
      setPreviewData(result.preview);
      if (page === 1) {
        const suspicious = judgeNormalizerPreview(
          result.preview,
          normalizerVersions.find((version) => version.id === versionId)?.files
        );
        setPreviewRun({
          versionId,
          durationMs: Date.now() - startedAt,
          suspicious: suspicious ?? undefined,
        });
      }
    } catch (err) {
      // Keep the raw message: the 报错 panel strips the IPC prefix and absolute paths itself.
      setPreviewError(err instanceof Error ? err.message : formatDataErrorMessage(err, t));
      setPreviewRun({ versionId, durationMs: Date.now() - startedAt });
    } finally {
      setPreviewLoading(false);
    }
  };

  /**
   * 交给 AI 修复 / 继续修改: a follow-up turn on the current draft — fix → rerun the preview →
   * pass check, repeated up to the 自动修复 limit. Fixes overwrite the same AI 修复 draft and the
   * result stays a draft until 发布.
   */
  const startNormalizerFix = async (input: {
    failure: FixFailure;
    report: FixErrorReport;
    note?: string;
    request?: string;
    maxRounds: number;
    baseVersionId: string;
  }) => {
    if (dataProcessing.strategy !== 'customize' || !rawTable || fixing || customizeGenerating)
      return;
    const processing = dataProcessing;
    const table = rawTable;
    const config = localConfig;
    const baseRecord = normalizerVersions.find((version) => version.id === input.baseVersionId);
    if (!baseRecord) return;
    setPreviewOpen(false);
    setCustomizeStep('generate');
    setCustomizeGenerationError(null);
    setFixing(true);
    const base = t(
      baseRecord.status === 'published' ? 'fixError.baseLabelPublished' : 'fixError.baseLabelDraft',
      { version: baseRecord.version }
    );
    const versionTitle = t('fixError.historyVersion', {
      version: baseRecord.version,
      source: t(
        baseRecord.source === 'manual'
          ? 'scripts.source.manual'
          : baseRecord.source === 'ai_repair'
            ? 'scripts.source.ai_repair'
            : 'scripts.source.rule'
      ),
    });
    const previous = generationLogRef.current;
    const history = previous
      ? historyFromLog(
          previous,
          previous.turnTitle
            ? versionTitle
            : t('fixError.historyRule', { version: baseRecord.version })
        )
      : [{ title: versionTitle, status: 'success' as const }];
    if (!input.request) {
      history.push(
        failureHistoryItem(
          t('fixError.historyPreviewFailed', { version: baseRecord.version }),
          input.report
        )
      );
    }
    const log = createFixLog({
      history,
      turnTitle: input.request
        ? t('fixError.turnContinue', { base })
        : input.maxRounds > 1
          ? t('fixError.turnAutoFix', { count: input.maxRounds, base })
          : t('fixError.turnFix', { base }),
      report: input.report,
      note: input.note,
      request: input.request,
      verifyKind: 'preview',
      t,
    });
    generationLogRef.current = log;
    setGenerationLog({ ...log, steps: [...log.steps] });
    const progressId = createNormalizerGenerationProgressId();
    activeAgentProgressRef.current = progressId;
    const notes = [...fixNotesRef.current, (input.request ?? input.note ?? '').trim()].filter(
      Boolean
    );
    let forward:
      ((event: { phase: string; kind: 'message' | 'delta'; text: string }) => void) | null = null;
    const unsubscribe = dataClient.onRawTableNormalizerDraftProgress(
      (event: DataRawTableNormalizerDraftProgressEvent) => {
        if (event.progressId !== progressId) return;
        if (typeof event.text !== 'string' || event.text.length === 0) return;
        forward?.(event);
      }
    );
    let targetId = input.baseVersionId;
    let saved: Awaited<ReturnType<typeof dataClient.generateRawTableNormalizerDraft>> | null = null;
    try {
      const result = await runFixFlow({
        log,
        flush: scheduleGenerationLogFlush,
        maxRounds: input.maxRounds,
        initial: input.failure,
        note: notes.join('\n') || undefined,
        verifyKind: 'preview',
        t,
        fix: async (request, onProgress) => {
          forward = onProgress;
          const fixed = await dataClient.generateRawTableNormalizerDraft({
            artifactId: processing.artifactId,
            name: `${table.name} normalizer`,
            sourcePath: table.sourcePath,
            sourceKind: localSourceKind,
            config,
            rulePrompt: processing.rulePrompt.trim() || baseRecord.rulePrompt,
            selectedSkillNames: customizeSelectedSkillNames,
            modelConfigSetId: selectedCustomizeModelConfigSetId,
            model: getAgentModelLabel(appConfig, '', selectedCustomizeModelConfigSetId),
            primaryLanguage: normalizerLanguage,
            progressId,
            fix: {
              baseVersionId: targetId,
              error: [request.error, request.log].filter(Boolean).join('\n'),
              note: request.note,
              durationMs: request.durationMs,
              round: request.round,
              maxRounds: request.maxRounds,
              previousAttempts: request.previousAttempts,
            },
          });
          saved = fixed;
          targetId = fixed.version.id;
          return {
            versionNumber: fixed.version.version,
            changedFiles: fixed.changedFiles ?? [],
            summary: fixed.fixSummary,
            replaced: fixed.replaced,
          };
        },
        verify: async () => {
          const version = saved!.version;
          const startedAt = Date.now();
          try {
            const run = await dataClient.previewRawTableNormalizerVersion({
              versionId: version.id,
              sourcePath: table.sourcePath,
              sourceKind: localSourceKind,
              config,
              prepareDependencies: true,
              limit: RAW_TABLE_PREVIEW_PAGE_SIZE,
              offset: 0,
            });
            setPreviewData(run.preview);
            setPreviewError(null);
            setPreviewPage(1);
            const suspicious = judgeNormalizerPreview(run.preview, version.files);
            setPreviewRun({
              versionId: version.id,
              durationMs: Date.now() - startedAt,
              suspicious: suspicious ?? undefined,
            });
            return suspicious
              ? {
                  passed: false,
                  rows: run.preview.totalRows,
                  cols: run.preview.columns.length,
                  failure: {
                    message: suspicious.reason,
                    error: `${suspicious.reason}\n${suspicious.sample}`,
                  },
                }
              : { passed: true, rows: run.preview.totalRows, cols: run.preview.columns.length };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setPreviewData(null);
            setPreviewError(message);
            setPreviewRun({ versionId: version.id, durationMs: Date.now() - startedAt });
            return {
              passed: false,
              failure: {
                message: summarizeError(message),
                error: message,
                durationMs: Date.now() - startedAt,
              },
            };
          }
        },
      });
      const last = saved as Awaited<
        ReturnType<typeof dataClient.generateRawTableNormalizerDraft>
      > | null;
      if (last) {
        fixNotesRef.current = notes;
        const version = last.version;
        updateDataProcessing({
          ...processing,
          artifactId: last.artifact.id,
          artifactVersionId: version.id,
          artifactVersionStatus: version.status,
          fileTreeHash: version.fileTreeHash,
          dependencyLockHash: version.dependencyLockHash ?? undefined,
          runtime: version.runtime,
          entrypoint: version.entrypoint,
          dependencyPrepare: version.dependencyPrepare,
          sourceSummaryHash: version.sourceSummaryHash ?? last.summary.hash,
        });
        await refreshNormalizerVersions(last.artifact.id);
        lastFixFailureRef.current = result.passed ? null : (result.lastVerify?.failure ?? null);
        const verdictText = result.passed
          ? t('fixError.verifyPassed', {
              rows: result.lastVerify?.rows ?? 0,
              cols: result.lastVerify?.cols ?? 0,
            })
          : t('fixError.verifyFailed', { reason: result.lastVerify?.failure?.message ?? '' });
        setFixInfo({
          versionId: version.id,
          version: version.version,
          rounds: result.rounds,
          passed: result.passed,
          text: t('fixError.reviewFixed', {
            version: version.version,
            rounds: result.rounds,
            result: verdictText,
          }),
          baseFiles: baseRecord.files,
        });
        setCodeView('diff');
        setFocusLine(null);
        if (result.changedFiles[0]) setSelectedNormalizerFilePath(result.changedFiles[0]);
        if (result.passed) setCustomizeStep('review');
      }
      if (result.error) setCustomizeGenerationError(result.error);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      markNormalizerGenerationError(log, message);
      setCustomizeGenerationError(message);
    } finally {
      unsubscribe?.();
      if (activeAgentProgressRef.current === progressId) activeAgentProgressRef.current = null;
      setFixing(false);
      flushGenerationLog();
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
        // A rollback also brings back that version's rule.
        rulePrompt: result.version.rulePrompt,
        artifactVersionStatus: result.version.status,
        fileTreeHash: result.version.fileTreeHash,
        dependencyLockHash: result.version.dependencyLockHash ?? undefined,
        runtime: result.version.runtime,
        entrypoint: result.version.entrypoint,
        dependencyPrepare: result.version.dependencyPrepare,
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
        <div
          className={`flex h-12 flex-shrink-0 items-stretch justify-between border-b border-border-subtle`}
        >
          <div className="flex min-w-0 items-stretch">
            <button
              onClick={onBack}
              className="inline-flex w-[104px] flex-shrink-0 items-center justify-center gap-1.5 border-r border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t('data.rawTables.editor.backShort')}
            </button>
            <div className="flex min-w-0 items-center gap-2 border-r border-border-subtle px-3">
              <RawTableStatusBadge
                label={
                  rawTable?.health
                    ? t('data.rawTables.status.abnormal')
                    : isConfigured
                      ? t('data.rawTables.status.available')
                      : t('data.rawTables.status.draft')
                }
                title={rawTable?.health?.reason}
                tone={rawTable?.health ? 'error' : isConfigured ? 'success' : 'warning'}
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
                  className="h-8 min-w-0 max-w-[22rem] truncate border-0 bg-transparent px-0 text-[14px] font-semibold text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder={t('data.rawTables.editor.title')}
                />
              ) : (
                <div
                  className="flex h-8 min-w-0 max-w-[22rem] items-center truncate text-[14px] font-semibold text-text-primary"
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
          <div className="flex items-stretch">
            {modeChange.actions}
            {changingMode ? null : activeViewTab === 'data' ? (
              <button
                type="button"
                onClick={() => void refreshData()}
                disabled={!canPreview || previewLoading || cloudSyncBusy}
                data-testid="raw-editor-refresh"
                className="inline-flex h-full w-[92px] items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${previewLoading || cloudSyncBusy ? 'animate-spin' : ''}`}
                />
                {t('data.actions.refresh')}
              </button>
            ) : null}
            <button
              type="button"
              hidden={activeViewTab === 'data' || changingMode}
              onClick={() => void handlePreviewToggle()}
              disabled={!canPreview && activeViewTab !== 'data'}
              aria-pressed={activeViewTab === 'data'}
              className={`inline-flex h-full w-[92px] items-center justify-center gap-1.5 whitespace-nowrap border-l border-border-subtle text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                activeViewTab === 'data'
                  ? 'bg-accent-muted text-accent'
                  : 'text-text-secondary hover:bg-accent-muted hover:text-accent'
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
              hidden={activeViewTab === 'data' || changingMode}
              disabled={!canSave}
              data-testid="raw-editor-save"
              className={`inline-flex h-full w-[92px] items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                canSave
                  ? 'text-accent hover:bg-accent-muted'
                  : 'text-text-secondary hover:bg-accent-muted hover:text-accent'
              }`}
            >
              <Check className="h-3.5 w-3.5" />
              {isBusy ? t('common.saving') : t('common.save')}
            </button>
            {rawTable && onDelete ? (
              <DataMoreMenu
                items={[
                  {
                    key: 'delete',
                    label: t('data.rawTables.actions.deleteEllipsis'),
                    icon: <Trash2 className="h-3.5 w-3.5" />,
                    danger: true,
                    onClick: () => void onDelete(rawTable),
                  },
                ]}
              />
            ) : null}
          </div>
        </div>
        {rawTable?.health ? (
          <div
            className="flex flex-shrink-0 items-center gap-2 border-b border-border-subtle bg-error/10 px-3 py-1.5 text-[12.5px] text-error"
            data-testid="raw-table-abnormal"
          >
            <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={rawTable.health.reason}>
              {t('data.rawTables.editor.abnormalBanner', { reason: rawTable.health.reason })}
            </span>
            {dataProcessing.strategy === 'customize' && dataProcessing.artifactVersionId ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => openHealthFix(rawTable.health?.reason ?? '')}
                className="inline-flex h-7 flex-shrink-0 items-center gap-1 rounded border border-error/30 bg-surface px-2.5 text-[12px] font-medium text-error hover:bg-error/10 disabled:opacity-50"
              >
                <Wand2 className="h-3.5 w-3.5" />
                {t('data.rawTables.editor.abnormalFix')}
              </button>
            ) : scriptPackageOfTable ? (
              <button
                type="button"
                onClick={() =>
                  useAppStore.getState().openScriptEditor({ packageId: scriptPackageOfTable })
                }
                className="inline-flex h-7 flex-shrink-0 items-center gap-1 rounded border border-error/30 bg-surface px-2.5 text-[12px] font-medium text-error hover:bg-error/10"
              >
                <FileCode2 className="h-3.5 w-3.5" />
                {t('data.rawTables.editor.abnormalOpenScript')}
              </button>
            ) : null}
          </div>
        ) : null}

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
            <div className="flex-shrink-0 bg-surface">
              <div className="grid">
                <section className="ui-group ui-form-flush bg-surface">
                  <div className="ui-group-title">{t('data.rawTables.editor.sectionSource')}</div>
                  <RawTableConfigRow
                    label={
                      localSourceKind === 'cloud'
                        ? t('data.rawTables.sources.cloud')
                        : localSourceKind === 'folder'
                          ? t('data.rawTables.editor.folderPath')
                          : t('data.rawTables.editor.file')
                    }
                  >
                    <div className="flex min-h-[35px] min-w-0 flex-1 items-stretch">
                      <div
                        className={`flex min-w-0 flex-1 items-center gap-2 px-[10px] ${sourceError ? 'bg-error/6 ring-1 ring-inset ring-error/40' : ''}`}
                      >
                        <span
                          className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md ${sourceMeta.className}`}
                        >
                          <SourceIcon className="h-3.5 w-3.5" />
                        </span>
                        <div
                          className="min-w-0 truncate font-mono text-[12px] text-text-primary"
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
                        data-testid="raw-source-change"
                        className="ui-accent-cell w-[120px] flex-shrink-0 border-l border-border-subtle"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
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

                  {rawSource && onBuildModeRebuilt && modesForSource(rawSource).length > 1 && (
                    <RawTableConfigRow label={t('data.rawSources.detail.buildMode')}>
                      <GlassSelect
                        ariaLabel={t('data.rawSources.detail.buildMode')}
                        value={modeChange.value ?? rawSource.buildMode}
                        onValueChange={(value) =>
                          modeChange.choose(value as DataRawSourceBuildMode)
                        }
                        options={modesForSource(rawSource).map((mode) => ({
                          value: mode,
                          label: t(`data.rawSources.modes.${mode}`),
                        }))}
                        disabled={isBusy}
                      />
                    </RawTableConfigRow>
                  )}
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
                      triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
                      contentClassName="w-[var(--radix-select-trigger-width)]"
                    />
                  </RawTableConfigRow>
                </section>
                <div className="grid" hidden={changingMode}>
                  <section className="ui-group ui-form-flush bg-surface">
                    <div className="ui-group-title">
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
                        triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
                        contentClassName="w-[var(--radix-select-trigger-width)]"
                      />
                    </RawTableConfigRow>
                  </section>
                </div>
              </div>
            </div>

            {changingMode ? (
              <div className="min-h-0 flex-1 overflow-auto bg-surface p-2">{modeChange.editor}</div>
            ) : dataProcessing.strategy === 'customize' ? (
              <div
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
                data-testid="raw-customize-flow"
              >
                <section
                  className="ui-group ui-form-flush flex-shrink-0 bg-surface"
                  data-testid="raw-customize-steps"
                >
                  <RawTableConfigRow label={t('data.rawTables.editor.customizeFlowLabel')}>
                    <div className="flex min-h-[35px] items-center px-2.5">
                      {customizeSteps.map((step, index) => {
                        const isActive = customizeStep === step.value;
                        const isDone = index < customizeStepIndex;
                        const clickable = step.reachable || isActive;
                        return (
                          <Fragment key={step.value}>
                            {index > 0 ? (
                              <ChevronRight
                                aria-hidden
                                className="mx-2.5 h-3.5 w-3.5 flex-shrink-0 text-text-muted"
                              />
                            ) : null}
                            <button
                              type="button"
                              disabled={!clickable}
                              aria-current={isActive ? 'step' : undefined}
                              data-step={step.value}
                              onClick={() => setCustomizeStep(step.value)}
                              className={`inline-flex h-7 items-center gap-1.5 text-[12.5px] transition-colors ${
                                isActive
                                  ? 'font-semibold text-accent'
                                  : clickable
                                    ? 'font-normal text-text-primary hover:text-accent'
                                    : 'cursor-not-allowed font-normal text-text-muted'
                              }`}
                            >
                              {isDone ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <span className="font-semibold tabular-nums">{index + 1}</span>
                              )}
                              {step.label}
                            </button>
                          </Fragment>
                        );
                      })}
                    </div>
                  </RawTableConfigRow>
                </section>

                <section
                  className="ui-group ui-form-flush flex min-h-0 flex-1 flex-col overflow-hidden bg-surface"
                  data-testid="raw-customize-pane"
                >
                  {customizeStep === 'rules' ? (
                    <>
                      <div className="ui-form-row min-h-0 flex-1">
                        <div
                          className="ui-form-label items-start pt-2.5"
                          title={t('data.rawTables.editor.rulePromptHint')}
                        >
                          {t('data.rawTables.editor.ruleLabel')}
                          <span className="ml-0.5 text-error">*</span>
                        </div>
                        <div className="ui-form-value relative min-h-0">
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
                            placeholder={t('data.rawTables.editor.rulePromptPlaceholder')}
                            disabled={isBusy || !rawTable}
                            maxLength={4000}
                            className="ui-composer-flush min-h-0 flex-1 pb-6"
                            textareaClassName="h-full"
                            skillMenuPlacement="bottom"
                          />
                          <span
                            className="pointer-events-none absolute bottom-2 right-2.5 text-[11px] tabular-nums text-text-muted"
                            data-testid="raw-customize-prompt-count"
                          >
                            {dataProcessing.rulePrompt.length} / 4000
                          </span>
                        </div>
                      </div>
                      <RawTableConfigRow label={t('data.rawTables.editor.customizeModelLabel')}>
                        <AgentModelSelector
                          open={customizeModelMenuOpen}
                          onOpenChange={setCustomizeModelMenuOpen}
                          appConfig={appConfig}
                          selectedConfigSetId={
                            selectedCustomizeModelConfigSetId ?? appConfig?.activeConfigSetId ?? ''
                          }
                          fallbackLabel={t('chat.noModel', { defaultValue: '未配置模型' })}
                          disabled={isBusy || !rawTable}
                          align="start"
                          triggerClassName="ui-flush-control flex items-center justify-between gap-2 text-left text-text-primary"
                          onSelect={(configSetId) =>
                            patchCustomizeDataProcessing({
                              modelConfigSetId: configSetId,
                              model: getAgentModelLabel(appConfig, '', configSetId),
                            })
                          }
                        />
                      </RawTableConfigRow>
                      <RawTableConfigRow label={t('secrets.label')}>
                        <SecretsEditor
                          kind="normalizer"
                          ownerId={dataProcessing.artifactId}
                          refreshKey={secretsKey}
                          disabled={isBusy}
                        />
                      </RawTableConfigRow>
                      <RawTableConfigRow label={t('data.rawTables.editor.examplesLabel')}>
                        <div className="flex min-h-[35px] flex-wrap items-center gap-1.5 px-2.5 py-1.5">
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
                                className="inline-flex h-6 items-center gap-1 rounded border border-accent/25 bg-surface px-2 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Plus className="h-3 w-3" />
                                {example}
                              </button>
                            );
                          })}
                        </div>
                      </RawTableConfigRow>
                    </>
                  ) : null}

                  {customizeStep === 'generate' ? (
                    <RawTableGenerationConsole
                      isStreaming={customizeGenerating || fixing}
                      log={generationLog}
                      modelLabel={getAgentModelLabel(
                        appConfig,
                        t('chat.noModel', { defaultValue: '未配置模型' }),
                        selectedCustomizeModelConfigSetId ?? appConfig?.activeConfigSetId ?? ''
                      )}
                      t={t}
                    />
                  ) : null}

                  {customizeStep === 'review' ? (
                    normalizerProjectFiles.length === 0 ? (
                      <div className="flex min-h-0 flex-1 items-center justify-center bg-surface">
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
                      <div
                        className={`grid min-h-0 flex-1 grid-rows-[36px_minmax(0,1fr)] ${
                          showingFix
                            ? 'grid-cols-[minmax(0,1fr)_150px_92px_240px_40px]'
                            : 'grid-cols-[minmax(0,1fr)_92px_240px_40px]'
                        }`}
                        data-testid="raw-customize-review"
                      >
                        <div className="flex min-w-0 items-center gap-2 border-b border-border-subtle px-2.5">
                          <FileCode2 className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
                          <span
                            className="min-w-0 truncate font-mono text-xs font-medium text-text-primary"
                            title={selectedNormalizerFile?.path}
                          >
                            {selectedNormalizerFile?.path ??
                              t('data.rawTables.editor.noProjectFiles')}
                          </span>
                          {selectedNormalizerFile ? (
                            <span className="flex-shrink-0 whitespace-nowrap text-[11px] text-text-muted">
                              {showingFix && codeView === 'diff'
                                ? (() => {
                                    const stats = fileDiffStats(
                                      fixInfo?.baseFiles.find(
                                        (file) => file.path === selectedNormalizerFile.path
                                      )?.content,
                                      selectedNormalizerFile.content
                                    );
                                    return `+${stats.added} −${stats.removed} · ${getCodePreviewLanguageLabel(selectedNormalizerFile.path)}`;
                                  })()
                                : t('data.rawTables.editor.codeFileMeta', {
                                    lines: selectedNormalizerFile.content.split('\n').length,
                                    language: getCodePreviewLanguageLabel(
                                      selectedNormalizerFile.path
                                    ),
                                  })}
                            </span>
                          ) : null}
                        </div>
                        {showingFix ? (
                          <div className="flex border-b border-l border-border-subtle">
                            <GlassSelect
                              ariaLabel={t('fixError.viewDiff')}
                              value={codeView}
                              onValueChange={(value) => setCodeView(value as 'diff' | 'full')}
                              options={[
                                { value: 'diff', label: t('fixError.viewDiff') },
                                { value: 'full', label: t('fixError.viewFull') },
                              ]}
                              triggerClassName="h-full w-full justify-between rounded-none border-0 bg-transparent px-2.5 text-xs text-text-primary shadow-none"
                              contentClassName="w-[var(--radix-select-trigger-width)]"
                            />
                          </div>
                        ) : null}
                        <button
                          type="button"
                          disabled={!selectedNormalizerFile}
                          data-testid="raw-customize-copy-code"
                          onClick={() => {
                            if (selectedNormalizerFile) {
                              void navigator.clipboard?.writeText(selectedNormalizerFile.content);
                              setCodeCopied(true);
                              window.setTimeout(() => setCodeCopied(false), 1500);
                            }
                          }}
                          className={`inline-flex items-center justify-center gap-1.5 border-b border-l border-border-subtle text-xs font-medium transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-40 ${
                            codeCopied ? 'text-success' : 'text-text-secondary hover:text-accent'
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
                          {codeCopied
                            ? t('data.rawTables.editor.copiedShort')
                            : t('data.rawTables.editor.copyShort')}
                        </button>
                        <div className="flex items-center border-b border-l border-border-subtle px-2.5 text-xs font-semibold text-text-primary">
                          {t('data.rawTables.editor.projectStructure')}
                        </div>
                        <div className="flex items-center justify-center border-b border-border-subtle text-xs tabular-nums text-text-muted">
                          {normalizerProjectFiles.length}
                        </div>
                        <div
                          className={`${showingFix ? 'col-span-3' : 'col-span-2'} flex min-h-0 min-w-0 flex-col overflow-hidden`}
                        >
                          {showingFix && codeView === 'diff' && selectedNormalizerFile ? (
                            <CodeDiffView
                              before={
                                fixInfo?.baseFiles.find(
                                  (file) => file.path === selectedNormalizerFile.path
                                )?.content
                              }
                              after={selectedNormalizerFile.content}
                              t={t}
                            />
                          ) : (
                            <CodePreview
                              file={selectedNormalizerFile}
                              t={t}
                              focusLine={
                                focusLine && focusLine.path === selectedNormalizerFile?.path
                                  ? focusLine.line
                                  : undefined
                              }
                            />
                          )}
                        </div>
                        <div className="col-span-2 min-h-0 overflow-auto border-l border-border-subtle">
                          <NormalizerProjectTree
                            files={normalizerProjectFiles}
                            markers={normalizerChangeMarkers}
                            selectedPath={
                              selectedNormalizerFile?.path ?? selectedNormalizerFilePath
                            }
                            onSelect={setSelectedNormalizerFilePath}
                            t={t}
                          />
                        </div>
                      </div>
                    )
                  ) : null}
                </section>

                {(() => {
                  const backCell = (
                    <button
                      type="button"
                      disabled={customizeGenerating || fixing}
                      onClick={() => setCustomizeStep('rules')}
                      data-testid="raw-customize-back"
                      className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      {t('data.rawTables.editor.customizeStepBack')}
                    </button>
                  );
                  // Non-generation errors (save / publish / delete / version list) show in the
                  // action row's note cell; generation errors live in the log only.
                  const noticeError =
                    customizeGenerationError &&
                    !(
                      generationLog?.outcome?.status === 'error' &&
                      customizeGenerationError.includes(generationLog.outcome.title)
                    )
                      ? customizeGenerationError
                      : null;
                  const noteCell = (text: ReactNode, first = false) =>
                    noticeError ? (
                      <div
                        role="alert"
                        data-testid="raw-customize-notice"
                        title={noticeError}
                        className={`flex min-w-0 items-center gap-1.5 px-2.5 text-xs font-medium text-error ${first ? '' : 'border-l border-border-subtle'}`}
                      >
                        <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="truncate">{noticeError}</span>
                      </div>
                    ) : (
                      <div
                        className={`flex min-w-0 items-center px-2.5 text-xs text-text-muted ${first ? '' : 'border-l border-border-subtle'}`}
                      >
                        <span className="truncate">{text}</span>
                      </div>
                    );
                  const toolCell =
                    'inline-flex items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50';
                  const generateFailed =
                    !customizeGenerating && generationLog?.outcome?.status === 'error';
                  let cols = '';
                  let cells: ReactNode = null;
                  if (customizeStep === 'rules') {
                    cols = 'minmax(0,1fr) 160px';
                    cells = (
                      <>
                        {noteCell(t('data.rawTables.editor.customizeRulesHint'), true)}
                        <button
                          type="button"
                          disabled={!canGenerateCustomizeDraft}
                          onClick={() => void generateCustomizeDraft()}
                          data-testid="raw-customize-generate"
                          className="ui-accent-cell border-l border-border-subtle"
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
                      </>
                    );
                  } else if (customizeStep === 'generate' && fixing) {
                    cols = '104px minmax(0,1fr) 120px';
                    cells = (
                      <>
                        {backCell}
                        {noteCell(t('fixError.fixingHint'))}
                        <button
                          type="button"
                          onClick={cancelNormalizerAgent}
                          data-testid="raw-agent-cancel"
                          className="ui-accent-cell border-l border-border-subtle"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          {t('scripts.editor.cancelAgent')}
                        </button>
                      </>
                    );
                  } else if (
                    customizeStep === 'generate' &&
                    fixInfo &&
                    !customizeGenerating &&
                    generationLog?.turnTitle
                  ) {
                    // After a fix turn: keep editing the same draft with a follow-up request.
                    cols = '104px minmax(0,1fr) 92px 120px';
                    cells = (
                      <>
                        {backCell}
                        <input
                          value={continueText}
                          onChange={(event) => setContinueText(event.target.value.slice(0, 2000))}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing)
                              sendNormalizerContinue();
                          }}
                          placeholder={t('fixError.continuePlaceholder')}
                          data-testid="fix-continue-input"
                          className="min-w-0 border-0 border-l border-border-subtle bg-transparent px-2.5 text-xs text-text-primary outline-none placeholder:text-text-muted"
                        />
                        <button
                          type="button"
                          disabled={!continueText.trim()}
                          onClick={sendNormalizerContinue}
                          data-testid="fix-continue-send"
                          className={toolCell}
                        >
                          <Send className="h-3.5 w-3.5" />
                          {t('fixError.send')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCustomizeStep('review')}
                          data-testid="fix-view-changes"
                          className="ui-accent-cell border-l border-border-subtle"
                        >
                          <FileCode2 className="h-3.5 w-3.5" />
                          {t('fixError.viewChanges')}
                        </button>
                      </>
                    );
                  } else if (customizeStep === 'generate') {
                    cols = '104px minmax(0,1fr) 120px';
                    cells = (
                      <>
                        {backCell}
                        {noteCell(
                          customizeGenerating
                            ? t('data.rawTables.editor.customizeGeneratingHint')
                            : generateFailed
                              ? t('data.rawTables.editor.customizeErrorHint')
                              : generationLog?.outcome
                                ? t('data.rawTables.editor.customizeDoneHint')
                                : t('data.rawTables.editor.generatedStatusEmpty')
                        )}
                        {customizeGenerating ? (
                          <button
                            type="button"
                            onClick={cancelNormalizerAgent}
                            data-testid="raw-agent-cancel"
                            className="ui-accent-cell border-l border-border-subtle"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            {t('scripts.editor.cancelAgent')}
                          </button>
                        ) : generateFailed ? (
                          <button
                            type="button"
                            disabled={!canGenerateCustomizeDraft}
                            onClick={() => void generateCustomizeDraft()}
                            data-testid="raw-customize-regenerate"
                            className="ui-accent-cell border-l border-border-subtle"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t('data.rawTables.editor.regenerateProjectDraft')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={customizeGenerating || normalizerProjectFiles.length === 0}
                            onClick={() => setCustomizeStep('review')}
                            data-testid="raw-customize-view-code"
                            className="ui-accent-cell border-l border-border-subtle"
                          >
                            <FileCode2 className="h-3.5 w-3.5" />
                            {t('data.rawTables.editor.generationViewCode')}
                          </button>
                        )}
                      </>
                    );
                  } else {
                    const isPublished = dataProcessing.artifactVersionStatus === 'published';
                    const summaryStatus = currentNormalizerVersion
                      ? currentNormalizerVersion.status === 'published'
                        ? t('data.rawTables.editor.publishedVersion')
                        : currentNormalizerVersion.status === 'archived'
                          ? t('data.rawTables.editor.versionStatusArchived')
                          : t('data.rawTables.editor.versionStatusDraft')
                      : '';
                    cols = '104px minmax(0,1fr) 104px 140px 104px';
                    cells = (
                      <>
                        {backCell}
                        {previewFailedHere && normalizerReport && !previewOpen ? (
                          // Step bar failure note: the reason plus the way back to the 报错 panel.
                          <button
                            type="button"
                            role="alert"
                            onClick={() => setPreviewOpen(true)}
                            title={normalizerReport.message}
                            data-testid="raw-customize-preview-failure"
                            className="flex min-w-0 items-center gap-1.5 border-l border-border-subtle px-2.5 text-left text-xs font-medium text-error hover:bg-error/5"
                          >
                            <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
                            <span className="truncate">
                              {t('fixError.previewFailed', { reason: normalizerReport.message })}
                            </span>
                            <span className="ml-auto flex-shrink-0 pl-2 text-accent">
                              {t('fixError.fix')}
                            </span>
                          </button>
                        ) : (
                          noteCell(
                            currentNormalizerVersion ? (
                              <span data-testid="raw-customize-version-summary">
                                {showingFix &&
                                fixInfo &&
                                currentNormalizerVersion.status === 'draft'
                                  ? fixInfo.text
                                  : [
                                      t('data.rawTables.editor.versionNumber', {
                                        version: currentNormalizerVersion.version,
                                      }),
                                      summaryStatus,
                                      formatDateTime(currentNormalizerVersion.updatedAt).replace(
                                        /^\d{4}-/,
                                        ''
                                      ),
                                    ].join(' · ')}
                              </span>
                            ) : (
                              ''
                            )
                          )
                        )}
                        <button
                          type="button"
                          onClick={() => setVersionsDialogOpen(true)}
                          data-testid="raw-customize-versions"
                          className={`${toolCell} ${versionsDialogOpen ? 'bg-accent-muted text-accent' : ''}`}
                        >
                          <History className="h-3.5 w-3.5" />
                          {t('data.rawTables.editor.versionHistory')}
                        </button>
                        <button
                          type="button"
                          disabled={
                            !customizeArtifactVersionId || previewLoading || !rawTable || fixing
                          }
                          onClick={() => void previewCustomizeDraft()}
                          data-testid="raw-customize-preview"
                          className={toolCell}
                        >
                          {previewLoading ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                          {t('data.rawTables.editor.previewNormalizedDraft')}
                        </button>
                        {isPublished ? (
                          <span
                            data-testid="raw-customize-published"
                            className="inline-flex items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-success"
                          >
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
                            data-testid="raw-customize-publish"
                            className="ui-accent-cell border-l border-border-subtle"
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
                    );
                  }
                  return (
                    <div
                      className="grid h-9 flex-shrink-0 border-t border-border-subtle bg-surface"
                      style={{ gridTemplateColumns: cols }}
                      data-testid="raw-customize-actions"
                    >
                      {cells}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
                <div className="ui-group ui-form-flush bg-surface">
                  <div className="ui-group-title">
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
                          triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
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
                          className={`ui-flush-split grid flex-1 ${
                            excelConfig.headerMode === 'manual'
                              ? 'grid-cols-[minmax(0,1fr)_10rem]'
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
                            triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
                            contentClassName="w-[var(--radix-select-trigger-width)]"
                          />
                          {excelConfig.headerMode === 'manual' ? (
                            <label className="relative block border-l border-border-subtle">
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
                                className="box-border h-full min-h-[35px] w-full border-0 bg-transparent pl-[10px] pr-10 text-[12.5px] text-text-primary outline-none placeholder:text-text-muted hover:bg-surface-hover focus:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
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
                    <div>
                      {[
                        ['header', 'data.rawTables.editor.csvHeader'],
                        ['dataRegion', 'data.rawTables.editor.csvDataRegion'],
                        ['delimiter', 'data.rawTables.editor.csvDelimiter'],
                      ].map(([key, labelKey]) => (
                        <RawTableConfigRow key={key} label={t(labelKey)}>
                          <span className="ui-flush-text">
                            {t('data.rawTables.editor.autoDetected')}
                          </span>
                        </RawTableConfigRow>
                      ))}
                      <RawTableConfigRow label={t('data.rawTables.editor.csvEncoding')}>
                        <RawTableSelect
                          flush
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
                    <div>
                      <RawTableConfigRow label={t('data.rawTables.editor.fileSelectionRange')}>
                        <RawTableSelect
                          flush
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
                      <div className="flex flex-wrap gap-3 border-b border-border-subtle px-3 py-2.5">
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
            <TabsContent value="automation" className="min-h-0 flex-1 overflow-y-auto bg-surface">
              <RawTableAutomations key={rawTable.id} rawTable={rawTable} embedded grid />
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
              {activeViewTab === 'config' && rawTable && (
                <span data-testid="raw-editor-updated-meta">
                  {t('data.rawTables.editor.updatedAtMeta', {
                    time: formatDateTime(savedCloudSource?.syncedAt ?? rawTable.updatedAt),
                  })}
                </span>
              )}
              {activeViewTab === 'data' && previewData && rawTable && (
                <span>
                  {t('data.resultTables.editor.dataMeta', {
                    rows: previewData.totalRows,
                    time: formatDateTime(savedCloudSource?.syncedAt ?? rawTable.updatedAt),
                  })}
                </span>
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
        className="w-full max-w-[760px] overflow-hidden !p-0"
      >
        <div
          className="grid h-10 grid-cols-[minmax(0,1fr)_92px_40px] border-b border-border-subtle"
          data-testid="normalizer-versions-header"
        >
          <div className="flex min-w-0 items-baseline gap-2 self-center px-3">
            <span className="text-[14px] font-semibold text-text-primary">
              {t('data.rawTables.editor.versionHistory')}
            </span>
            {normalizerVersions.length > 0 ? (
              <span className="text-xs text-text-muted">
                {t('data.rawTables.editor.versionsCount', { count: normalizerVersions.length })}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            disabled={normalizerVersionsLoading}
            onClick={() => void refreshNormalizerVersions(customizeArtifactId)}
            className="inline-flex items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${normalizerVersionsLoading ? 'animate-spin' : ''}`}
            />
            {t('common.refresh')}
          </button>
          <button
            type="button"
            onClick={() => setVersionsDialogOpen(false)}
            className="inline-flex items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-accent-muted hover:text-accent"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
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
          sourceOf={(version) =>
            t(
              version.source === 'manual'
                ? 'scripts.source.manual'
                : version.source === 'ai_repair'
                  ? 'scripts.source.ai_repair'
                  : 'scripts.source.rule'
            )
          }
          t={t}
          versions={normalizerVersions}
        />
      </Dialog>
      {secretReview.dialog}
      {previewOpen && (
        <RawTablePreviewDialog
          tableKind="raw"
          title={
            normalizerReport
              ? t('fixError.previewFailedTitle', { version: previewVersionLabel })
              : undefined
          }
          preview={normalizerReport ? null : previewData}
          isLoading={previewLoading}
          error={normalizerReport ? normalizerReport.message : previewError}
          errorContent={
            normalizerReport && previewRun ? (
              <FixErrorPanel
                report={normalizerReport}
                inputLabel={sourceInputLabel}
                note={fixNote}
                onNoteChange={setFixNote}
                autoFixRounds={autoFixRounds}
                onAutoFixRoundsChange={setAutoFixRounds}
                onOpenLocation={(location) => {
                  setPreviewOpen(false);
                  setCustomizeStep('review');
                  setSelectedNormalizerFilePath(location.file);
                  setCodeView('full');
                  setFocusLine({ path: location.file, line: location.line });
                }}
                onFix={startPreviewFix}
                busy={fixing}
                disabled={customizeGenerating || !previewVersion}
                title={t('fixError.previewFailedTitle', { version: previewVersionLabel })}
                footerNote={
                  normalizerFixTarget.overwrite
                    ? t('fixError.footerOverwrite', { base: previewVersionLabel })
                    : t('fixError.footerNew', {
                        base: previewVersionLabel,
                        next: normalizerFixTarget.version,
                      })
                }
                t={t}
              />
            ) : undefined
          }
          currentPage={previewPage}
          onPageChange={(page) => void previewCustomizeDraft(page)}
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
    <div className="ui-form-row">
      <div className={`ui-form-label ${align === 'start' ? 'items-start pt-2.5' : 'items-center'}`}>
        {label}
      </div>
      <div className="ui-form-value">{children}</div>
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
    <div className="flex flex-1 flex-col" data-testid="column-type-overrides">
      {overrides.map((entry, index) => (
        <div
          key={index}
          className="grid min-h-[35px] grid-cols-[minmax(0,1fr)_9rem_40px] border-b border-border-subtle"
        >
          <input
            type="text"
            value={entry.name}
            placeholder={t('data.rawTables.editor.columnTypeNamePlaceholder')}
            disabled={disabled}
            onChange={(event) => setOverride(index, { name: event.target.value })}
            className="h-full w-full border-0 bg-transparent px-[10px] text-[12.5px] text-text-primary outline-none placeholder:text-text-muted hover:bg-surface-hover focus:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex border-l border-border-subtle">
            <GlassSelect
              value={entry.type}
              onValueChange={(value) => setOverride(index, { type: value as DataFieldType })}
              options={DATA_FIELD_TYPES.map((type) => ({
                value: type,
                label: dataTypeLabel(type),
              }))}
              disabled={disabled}
              triggerClassName="!h-full !min-h-[35px] w-full justify-between !rounded-none !border-0 !bg-transparent !shadow-none !px-[10px] text-text-primary hover:!bg-surface-hover disabled:opacity-60"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const next = overrides.filter((_, i) => i !== index);
              onChange(next.length > 0 ? next : undefined);
            }}
            aria-label={t('data.rawTables.editor.removeColumnType')}
            title={t('data.rawTables.editor.removeColumnType')}
            className="flex items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex min-h-[35px] items-stretch">
        <span className="ui-flush-text">
          {overrides.length > 0
            ? t('data.rawTables.editor.columnTypesCount', { count: overrides.length })
            : t('data.rawTables.editor.columnTypesAuto')}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void openPicker()}
          className="ui-accent-cell w-[120px] flex-shrink-0 border-l border-border-subtle"
        >
          <Eye className="h-3.5 w-3.5" />
          {t('data.rawTables.editor.pickColumnsFromFile')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...overrides, { name: '', type: 'text' }])}
          className="ui-accent-cell w-[120px] flex-shrink-0 border-l border-border-subtle"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('data.rawTables.editor.addColumnType')}
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
