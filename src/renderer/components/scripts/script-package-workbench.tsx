import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  FileCode2,
  Folder,
  FolderOpen,
  History,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import type {
  ScriptPackageSummary,
  ScriptPackageVersion,
  ScriptPackageVersionDetail,
  ScriptRuntime,
  ScriptTestRunResult,
} from '../../../shared/automation/script-package';
import { SCRIPT_SOURCE_KEYS } from './labels';
import { DEFAULT_SCRIPT_TIMEOUT_MS } from '../../../shared/automation/script-package';
import type { Automation, DataRawTablePreview } from '../../types';
import { useAppStore, type ScriptEditorTarget } from '../../store';
import { GlassSelect } from '../GlassSelect';
import { AgentModelSelector, getAgentModelLabel } from '../AgentModelSelector';
import { GlassDataGridPreview } from '../GlassDataGridPreview';
import { Dialog } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { CodePreview, getCodePreviewLanguageLabel } from '../data-view/raw-table-code-preview';
import { RawTableGenerationConsole } from '../data-view/raw-table-generation-console';
import {
  NormalizerProjectTree,
  RawTableVersionHistoryPanel,
  type HistoryVersionDiff,
} from '../data-view/raw-table-version-history';
import { RawTablePreviewDialog } from '../data-view/raw-table-preview-dialog';
import { FixErrorPanel, type AutoFixRounds } from '../data-view/fix-error-panel';
import { CodeDiffView, fileDiffStats } from '../data-view/code-diff-view';
import {
  createFixLog,
  failureHistoryItem,
  historyFromLog,
  runFixFlow,
  type FixFailure,
} from '../data-view/fix-error-flow';
import {
  changedFilePaths,
  describeConfigInput,
  evaluatePass,
  expectedColumnsFromManifest,
  parseErrorReport,
  predictFixDraft,
  type FixErrorReport,
} from '../../../shared/fix-error';
import { RawTableConfigRow } from '../data-view/raw-table-editor-workbench';
import {
  applyNormalizerGenerationProgress,
  createNormalizerGenerationProgressId,
  markNormalizerGenerationError,
  truncateGenerationLogText,
  type NormalizerGenerationLog,
} from '../data-view/raw-table-normalizer-utils';
import {
  bottomTabBarClass,
  bottomTabListClass,
  bottomTabTriggerClass,
  formatDateTime,
  RawTableStatusBadge,
} from '../data-view/shared';

type Step = 'rules' | 'generate' | 'review';
type HistoryVersion = ScriptPackageVersion & { id: string };

const EXAMPLE_KEYS = [
  'examplePaging',
  'exampleApiAuth',
  'exampleDedupe',
  'exampleRetry',
  'exampleIncremental',
] as const;

function shortTime(timestamp: number | undefined): string {
  return timestamp ? formatDateTime(timestamp).replace(/^\d{4}-/, '') : '';
}

function toPreview(result: {
  columns: string[];
  rows: Array<Record<string, string>>;
  total: number;
}): DataRawTablePreview {
  return {
    columns: result.columns,
    columnTypes: [],
    rows: result.rows,
    fileCount: 1,
    limit: Math.max(result.rows.length, 1),
    offset: 0,
    totalRows: result.rows.length,
  };
}

function versionDiff(version: HistoryVersion): HistoryVersionDiff | null {
  if (!version.diff) return null;
  return {
    changed: version.diff.modified.length,
    added: version.diff.added.length,
    removed: version.diff.removed.length,
  };
}

/**
 * Script package editor page: same shell and three steps as the raw-table 自定义
 * strategy (描述规则 → 生成代码 → 预览确认), backed by the package's git history.
 */
export function ScriptPackageWorkbench({
  target,
  onClose,
}: {
  target: ScriptEditorTarget;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const api = window.electronAPI.automation.scripts;
  const appConfig = useAppStore((state) => state.appConfig);
  const [packageId, setPackageId] = useState<string | undefined>(target.packageId);
  const [summary, setSummary] = useState<ScriptPackageSummary | null>(null);
  const [versions, setVersions] = useState<ScriptPackageVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [viewVersion, setViewVersion] = useState<number | null>(target.version ?? null);
  const [detail, setDetail] = useState<ScriptPackageVersionDetail | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [step, setStep] = useState<Step>(target.step ?? (target.packageId ? 'review' : 'rules'));
  const [name, setName] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  const [rulePrompt, setRulePrompt] = useState('');
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [runtime, setRuntime] = useState<ScriptRuntime>('python');
  const [modelConfigSetId, setModelConfigSetId] = useState<string | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationLog, setGenerationLog] = useState<NormalizerGenerationLog | null>(null);
  const logRef = useRef<NormalizerGenerationLog | null>(null);
  const flushTimer = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [trial, setTrial] = useState<ScriptTestRunResult | null>(null);
  const [trialOpen, setTrialOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  const [deletingVersion, setDeletingVersion] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'config' | 'data' | 'automation'>('config');
  const [lastOutput, setLastOutput] = useState<DataRawTablePreview | null>(null);
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  // 报错修复: the version the trial ran, the panel's inputs, and the last fix result.
  const [trialVersion, setTrialVersion] = useState<number | null>(null);
  const [fixNote, setFixNote] = useState('');
  const [autoFixRounds, setAutoFixRounds] = useState<AutoFixRounds>(0);
  const [fixing, setFixing] = useState(false);
  const [trialSuspicious, setTrialSuspicious] = useState<{ reason: string; sample: string } | null>(
    null
  );
  const [fixInfo, setFixInfo] = useState<{
    version: number;
    baseVersion: number;
    rounds: number;
    passed: boolean;
    text: string;
  } | null>(null);
  const [codeView, setCodeView] = useState<'diff' | 'full'>('full');
  const [diffBase, setDiffBase] = useState<ScriptPackageVersionDetail | null>(null);
  const [focusLine, setFocusLine] = useState<{ path: string; line: number } | null>(null);
  const [continueText, setContinueText] = useState('');
  const lastFailureRef = useRef<FixFailure | null>(null);
  // 补充 notes and follow-up requests from earlier fix turns on this draft: each turn resends
  // them (oldest first) so a later request does not undo an earlier fix.
  const fixNotesRef = useRef<string[]>([]);
  const initialised = useRef(false);

  const refresh = useCallback(
    async (id = packageId) => {
      if (!id) return null;
      setVersionsLoading(true);
      try {
        const [nextSummary, nextVersions] = await Promise.all([api.get(id), api.versions(id)]);
        setSummary(nextSummary);
        setVersions(nextVersions);
        return { summary: nextSummary, versions: nextVersions };
      } finally {
        setVersionsLoading(false);
      }
    },
    [api, packageId]
  );

  // First load: pick the version to show and restore the rule draft.
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    if (!target.packageId) {
      setName(t('scripts.editor.newName'));
      setNameEditing(true);
      return;
    }
    void (async () => {
      try {
        const loaded = await refresh(target.packageId);
        const editor = await api.editorState(target.packageId!).catch(() => undefined);
        if (!loaded) return;
        const { summary: loadedSummary, versions: loadedVersions } = loaded;
        setName(loadedSummary.name);
        setRuntime(editor?.runtime ?? loadedSummary.runtime);
        setModelConfigSetId(editor?.modelConfigSetId ?? null);
        const lastRule = loadedVersions.find((version) => version.source === 'rule');
        setRulePrompt(editor?.rulePrompt ?? lastRule?.rulePrompt ?? '');
        // 基于 defaults to the current draft when there is one.
        setBaseVersion(loadedSummary.draft?.version ?? loadedSummary.published?.version ?? null);
        const initial =
          target.version ??
          loadedSummary.draft?.version ??
          loadedSummary.published?.version ??
          loadedVersions[0]?.version ??
          null;
        setViewVersion(initial);
        if (initial == null) setStep('rules');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [api, refresh, t, target.packageId, target.version]);

  useEffect(() => {
    if (!packageId || viewVersion == null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void api
      .versionDetail(packageId, viewVersion)
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
        setSelectedPath((current) =>
          next.files.some((file) => file.path === current)
            ? current
            : (next.files.find((file) => file.path === next.entry)?.path ??
              next.files[0]?.path ??
              '')
        );
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [api, packageId, viewVersion, versions]);

  useEffect(() => {
    if (!packageId) return;
    if (tab === 'data') {
      void api
        .lastOutput(packageId)
        .then((output) => setLastOutput(output ? toPreview(output) : null));
    }
    if (tab === 'automation') {
      void window.electronAPI.automation
        .list({ status: 'all', limit: 500 })
        .then((result) =>
          setAutomations(
            result.automations.filter((automation) =>
              automation.actionGraph.nodes.some(
                (node) => node.type === 'script.run' && node.config?.packageId === packageId
              )
            )
          )
        )
        .catch(() => setAutomations([]));
    }
  }, [api, packageId, tab]);

  const flushLog = () => {
    if (flushTimer.current != null) window.clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const log = logRef.current;
    if (log) setGenerationLog({ ...log, steps: log.steps.map((item) => ({ ...item })) });
  };
  const scheduleFlush = () => {
    if (flushTimer.current == null) flushTimer.current = window.setTimeout(flushLog, 120);
  };

  const published = summary?.published;
  const currentDraft = summary?.draft;
  const baseLabelFor = (version: number | null) =>
    version == null
      ? t('scripts.editor.baseScratch')
      : currentDraft && version === currentDraft.version
        ? t('fixError.baseDraft', { version })
        : t('scripts.editor.basePublished', { version });
  const baseOptions = [
    ...(currentDraft
      ? [
          {
            value: String(currentDraft.version),
            label: t('fixError.baseDraft', { version: currentDraft.version }),
          },
        ]
      : []),
    ...(published
      ? [
          {
            value: String(published.version),
            label: t('scripts.editor.basePublished', { version: published.version }),
          },
        ]
      : []),
    { value: 'scratch', label: t('scripts.editor.baseScratch') },
  ];
  const runtimeLabel = (value: ScriptRuntime) =>
    value === 'node'
      ? 'Node.js'
      : summary?.runtimeVersion?.startsWith('Python')
        ? summary.runtimeVersion
        : 'Python';
  const modelLabel = getAgentModelLabel(
    appConfig,
    t('chat.noModel', { defaultValue: '未配置模型' }),
    modelConfigSetId ?? appConfig?.activeConfigSetId ?? ''
  );

  const generate = async () => {
    const prompt = rulePrompt.trim();
    if (!prompt || generating) return;
    setStep('generate');
    setError(null);
    const log: NormalizerGenerationLog = {
      meta: [
        { label: t('scripts.editor.metaPackage'), value: name || packageId || '' },
        {
          label: t('scripts.editor.metaBase'),
          value: baseLabelFor(packageId ? baseVersion : null),
        },
        {
          label: t('scripts.editor.metaLanguage'),
          value: runtime === 'node' ? 'Node.js' : 'Python',
        },
        { label: t('scripts.editor.ruleLabel'), value: truncateGenerationLogText(prompt, 160) },
      ],
      steps: [],
      startedAt: Date.now(),
    };
    logRef.current = log;
    setGenerationLog({ ...log });
    setGenerating(true);
    fixNotesRef.current = [];
    const progressId = createNormalizerGenerationProgressId();
    const unsubscribe = api.onGenerateProgress((event) => {
      if (event.progressId !== progressId || event.phase === 'complete') return;
      applyNormalizerGenerationProgress(log, event);
      scheduleFlush();
    });
    try {
      const result = await api.generateDraft({
        packageId,
        name: name.trim() || undefined,
        rulePrompt: prompt,
        baseVersion: packageId ? baseVersion : null,
        runtime,
        modelConfigSetId,
        progressId,
      });
      for (const item of log.steps) if (item.status === 'active') item.status = 'done';
      log.finishedAt = Date.now();
      log.outcome = {
        status: 'success',
        title: t('scripts.editor.generated', {
          version: result.version.version,
          count: result.version.files.length,
        }),
        details: [],
        files: result.version.files.map((file) => file.path),
      };
      setPackageId(result.summary.id);
      setNameEditing(false);
      await refresh(result.summary.id);
      setViewVersion(result.version.version);
      setStep('review');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      markNormalizerGenerationError(log, message);
      setError(message);
    } finally {
      unsubscribe();
      setGenerating(false);
      flushLog();
    }
  };

  const runTrial = async (version: number | 'published' | null = viewVersion) => {
    if (!packageId || testing) return;
    setTesting(true);
    setTrial(null);
    setTrialSuspicious(null);
    setTrialOpen(true);
    setTrialVersion(
      version == null || version === 'published' ? (published?.version ?? null) : version
    );
    try {
      const result = await api.testRun(
        packageId,
        DEFAULT_SCRIPT_TIMEOUT_MS,
        version ?? 'published'
      );
      setTrial(result);
      if (result.ok && result.version != null) {
        // 通过但结果异常 counts as a failure too (empty expected column, missing columns).
        const ran = await api.versionDetail(packageId, result.version).catch(() => null);
        const verdict = evaluatePass({
          ok: true,
          columns: result.columns,
          rows: result.previewRows,
          expectedColumns: expectedColumnsFromManifest(
            ran?.files.find((file) => file.path === 'manifest.json')?.content
          ),
        });
        if (!verdict.ok)
          setTrialSuspicious({
            reason: verdict.reason ?? '',
            sample: `输出预览：\n${result.preview ?? ''}`,
          });
      }
      void refresh();
    } catch (err) {
      setTrial({
        ok: false,
        durationMs: 0,
        installedDeps: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  /**
   * 交给 AI 修复 / 继续修改: a follow-up turn in the generation console that edits the current
   * draft, reruns the trial and (自动修复) repeats until it passes or hits the round limit.
   */
  const startFix = async (input: {
    failure: FixFailure;
    report: FixErrorReport;
    note?: string;
    request?: string;
    maxRounds: number;
    baseVersion: number;
  }) => {
    if (!packageId || fixing || generating) return;
    const id = packageId;
    setTrialOpen(false);
    setStep('generate');
    setError(null);
    setFixing(true);
    const baseRecord = versions.find((version) => version.version === input.baseVersion);
    const base = t(
      baseRecord?.status === 'published'
        ? 'fixError.baseLabelPublished'
        : 'fixError.baseLabelDraft',
      { version: input.baseVersion }
    );
    const previous = logRef.current;
    const history = previous
      ? historyFromLog(
          previous,
          t('fixError.historyVersion', {
            version: input.baseVersion,
            source: t(SCRIPT_SOURCE_KEYS[baseRecord?.source ?? 'rule']),
          })
        )
      : [
          {
            title: t('fixError.historyVersion', {
              version: input.baseVersion,
              source: t(SCRIPT_SOURCE_KEYS[baseRecord?.source ?? 'rule']),
            }),
            status: 'success' as const,
          },
        ];
    if (!input.request) {
      history.push(
        failureHistoryItem(
          t('fixError.historyTrialFailed', { version: input.baseVersion }),
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
      verifyKind: 'trial',
      t,
    });
    logRef.current = log;
    setGenerationLog({ ...log });
    const progressId = createNormalizerGenerationProgressId();
    const notes = [...fixNotesRef.current, (input.request ?? input.note ?? '').trim()].filter(
      Boolean
    );
    let forward:
      ((event: { phase: string; kind: 'message' | 'delta'; text: string }) => void) | null = null;
    const unsubscribe = api.onGenerateProgress((event) => {
      if (event.progressId === progressId) forward?.(event);
    });
    let target = input.baseVersion;
    try {
      // Snapshot of the files before this turn: the 差异 view compares against it.
      const baseDetail = await api.versionDetail(id, input.baseVersion);
      const result = await runFixFlow({
        log,
        flush: scheduleFlush,
        maxRounds: input.maxRounds,
        initial: input.failure,
        note: notes.join('\n') || undefined,
        verifyKind: 'trial',
        t,
        fix: async (request, onProgress) => {
          forward = onProgress;
          const fixed = await api.generateDraft({
            packageId: id,
            name: name.trim() || undefined,
            rulePrompt: rulePrompt.trim() || t('fixError.fix'),
            baseVersion: target,
            runtime,
            modelConfigSetId,
            progressId,
            fix: request,
          });
          target = fixed.version.version;
          return {
            versionNumber: fixed.version.version,
            changedFiles: fixed.changedFiles ?? [],
            summary: fixed.fixSummary,
            replaced: fixed.replaced,
          };
        },
        verify: async (fixed) => {
          const run = await api.testRun(id, DEFAULT_SCRIPT_TIMEOUT_MS, fixed.versionNumber);
          const fixedDetail = await api.versionDetail(id, fixed.versionNumber);
          setTrial(run);
          setTrialVersion(fixed.versionNumber);
          setTrialSuspicious(null);
          const verdict = evaluatePass({
            ok: run.ok,
            error: run.error,
            exitCode: run.exitCode,
            columns: run.columns,
            rows: run.previewRows,
            expectedColumns: expectedColumnsFromManifest(
              fixedDetail.files.find((file) => file.path === 'manifest.json')?.content
            ),
          });
          if (verdict.ok) return { passed: true, rows: run.rows, cols: run.columns?.length };
          if (run.ok)
            setTrialSuspicious({
              reason: verdict.reason ?? '',
              sample: `输出预览：\n${run.preview ?? ''}`,
            });
          return {
            passed: false,
            rows: run.rows,
            cols: run.columns?.length,
            failure: run.ok
              ? {
                  message: verdict.reason ?? '',
                  error: `${verdict.reason ?? ''}\n输出预览：\n${run.preview ?? ''}`,
                }
              : {
                  message: verdict.reason ?? run.error ?? '',
                  error: run.error ?? '',
                  log: run.log,
                  exitCode: run.exitCode,
                  durationMs: run.durationMs,
                },
          };
        },
      });
      flushLog();
      await refresh(id);
      if (result.last) {
        fixNotesRef.current = notes;
        const version = result.last.versionNumber;
        setDiffBase(baseDetail);
        setCodeView('diff');
        setFocusLine(null);
        setViewVersion(version);
        if (result.changedFiles[0]) setSelectedPath(result.changedFiles[0]);
        lastFailureRef.current = result.passed ? null : (result.lastVerify?.failure ?? null);
        const verdictText = result.passed
          ? t('fixError.trialPassed', {
              rows: result.lastVerify?.rows ?? 0,
              cols: result.lastVerify?.cols ?? 0,
            })
          : t('fixError.verifyFailed', { reason: result.lastVerify?.failure?.message ?? '' });
        setFixInfo({
          version,
          baseVersion: input.baseVersion,
          rounds: result.rounds,
          passed: result.passed,
          text: t('fixError.reviewFixed', { version, rounds: result.rounds, result: verdictText }),
        });
        if (result.passed) setStep('review');
      }
      if (result.error) setError(result.error);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      markNormalizerGenerationError(log, message);
      setError(message);
    } finally {
      unsubscribe();
      setFixing(false);
      flushLog();
    }
  };

  const publish = async (version: number) => {
    if (!packageId) return;
    setBusyVersion(version);
    setError(null);
    try {
      await api.publish(packageId, version);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyVersion(null);
    }
  };

  const deleteVersion = async (version: number) => {
    if (!packageId) return;
    setDeletingVersion(version);
    try {
      await api.deleteVersion(packageId, version);
      const loaded = await refresh();
      if (viewVersion === version)
        setViewVersion(loaded?.summary.published?.version ?? loaded?.versions[0]?.version ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingVersion(null);
    }
  };

  const save = async () => {
    if (!packageId) return;
    setSaving(true);
    try {
      setSummary(
        await api.setMeta(packageId, {
          displayName: name.trim(),
          editor: { rulePrompt, runtime, modelConfigSetId },
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const files = detail?.files ?? [];
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0];
  const showingFix = Boolean(diffBase && fixInfo && detail && detail.version === fixInfo.version);
  const diffBaseFile = diffBase?.files.find((file) => file.path === selectedFile?.path);
  const markers = useMemo(() => {
    const result: Record<string, string> = {};
    if (showingFix && diffBase && detail) {
      // After an AI 修复 the markers show what this fix changed against the version it edited.
      const before = new Set(diffBase.files.map((file) => file.path));
      for (const path of changedFilePaths(diffBase.files, detail.files))
        result[path] = before.has(path)
          ? t('scripts.editor.markerModified')
          : t('scripts.editor.markerAdded');
      return result;
    }
    if (!detail?.diff) return result;
    for (const file of detail.diff.modified) result[file] = t('scripts.editor.markerModified');
    for (const file of detail.diff.added) result[file] = t('scripts.editor.markerAdded');
    return result;
  }, [detail, diffBase, showingFix, t]);

  const trialVersionNumber = trial?.version ?? trialVersion;
  const trialRecord = versions.find((version) => version.version === trialVersionNumber);
  const trialVersionLabel = trialVersionNumber
    ? `v${trialVersionNumber}${trialRecord ? ` ${t(`scripts.status.${trialRecord.status}`)}` : ''}`
    : '';
  const trialFiles = detail && detail.version === trialVersionNumber ? detail.files : undefined;
  const trialReport = useMemo(
    (): FixErrorReport | null =>
      trial?.ok && trialSuspicious
        ? {
            ...parseErrorReport({ error: trialSuspicious.reason, durationMs: trial.durationMs }),
            message: trialSuspicious.reason,
            traceback: trialSuspicious.sample,
            exitCode: 0,
          }
        : trial && !trial.ok
          ? parseErrorReport(
              {
                error: trial.error ?? '',
                log: trial.log,
                exitCode: trial.exitCode,
                durationMs: trial.durationMs,
              },
              trialFiles?.map((file) => file.path)
            )
          : null,
    [trial, trialFiles, trialSuspicious]
  );
  const trialFailedHere =
    Boolean(trialReport) &&
    !testing &&
    trialVersionNumber != null &&
    trialVersionNumber === viewVersion;
  const fixTarget = predictFixDraft(versions);
  const fixBaseLabel = trialVersionNumber
    ? t(
        trialRecord?.status === 'published'
          ? 'fixError.baseLabelPublished'
          : 'fixError.baseLabelDraft',
        { version: trialVersionNumber }
      )
    : '';
  const startTrialFix = () => {
    if (!trial || !trialReport || trialVersionNumber == null) return;
    void startFix({
      failure: {
        message: trialReport.message,
        error: trial.ok
          ? `${trialReport.message}\n${trialSuspicious?.sample ?? ''}`
          : (trial.error ?? ''),
        log: trial.log,
        exitCode: trial.exitCode,
        durationMs: trial.durationMs,
      },
      report: trialReport,
      note: fixNote,
      maxRounds: Math.max(1, autoFixRounds),
      baseVersion: trialVersionNumber,
    });
  };
  const sendContinue = () => {
    const text = continueText.trim();
    if (!text || !fixInfo) return;
    const failure = lastFailureRef.current ?? {
      message: t('fixError.continueNoError'),
      error: t('fixError.continueNoError'),
    };
    setContinueText('');
    void startFix({
      failure,
      report: parseErrorReport({
        error: failure.error,
        log: failure.log,
        exitCode: failure.exitCode,
      }),
      request: text,
      maxRounds: Math.max(1, autoFixRounds),
      baseVersion: fixInfo.version,
    });
  };

  const statusBadge = published
    ? {
        label: t('scripts.editor.statusPublished', { version: published.version }),
        tone: 'success' as const,
      }
    : {
        label: packageId ? t('scripts.editor.statusDraft') : t('scripts.editor.statusNew'),
        tone: 'warning' as const,
      };

  const steps: Array<{ value: Step; label: string; reachable: boolean }> = [
    { value: 'rules', label: t('data.rawTables.editor.customizeStepPrompt'), reachable: true },
    {
      value: 'generate',
      label: t('data.rawTables.editor.customizeStepGenerate'),
      reachable: generating || fixing || generationLog !== null,
    },
    {
      value: 'review',
      label: t('data.rawTables.editor.customizeStepReview'),
      reachable: viewVersion != null,
    },
  ];
  const stepIndex = steps.findIndex((item) => item.value === step);
  const toolCell =
    'inline-flex items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50';

  const noteCell = (text: ReactNode, first = false) =>
    error ? (
      <div
        role="alert"
        title={error}
        data-testid="script-editor-error"
        className={`flex min-w-0 items-center gap-1.5 px-2.5 text-xs font-medium text-error ${first ? '' : 'border-l border-border-subtle'}`}
      >
        <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="truncate">{error}</span>
      </div>
    ) : (
      <div
        className={`flex min-w-0 items-center px-2.5 text-xs text-text-muted ${first ? '' : 'border-l border-border-subtle'}`}
      >
        <span className="truncate">{text}</span>
      </div>
    );
  const backCell = (
    <button
      type="button"
      disabled={generating || fixing}
      onClick={() => setStep('rules')}
      className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {t('data.rawTables.editor.customizeStepBack')}
    </button>
  );

  let actionCols = '';
  let actionCells: ReactNode = null;
  if (step === 'rules') {
    actionCols = 'minmax(0,1fr) 160px';
    actionCells = (
      <>
        {noteCell(t('scripts.editor.rulesHint'), true)}
        <button
          type="button"
          disabled={!rulePrompt.trim() || generating}
          onClick={() => void generate()}
          data-testid="script-generate"
          className="ui-accent-cell border-l border-border-subtle"
        >
          {generating ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {generating
            ? t('data.rawTables.editor.generateProjectDrafting')
            : t('scripts.editor.generate')}
        </button>
      </>
    );
  } else if (step === 'generate' && fixing) {
    actionCols = '104px minmax(0,1fr) 120px';
    actionCells = (
      <>
        {backCell}
        {noteCell(t('fixError.fixingHintTrial'))}
        <button type="button" disabled className="ui-accent-cell border-l border-border-subtle">
          <FileCode2 className="h-3.5 w-3.5" />
          {t('fixError.viewChanges')}
        </button>
      </>
    );
  } else if (step === 'generate' && fixInfo && !generating && generationLog?.turnTitle) {
    // After a fix turn: keep editing the same draft with a follow-up request.
    actionCols = '104px minmax(0,1fr) 92px 120px';
    actionCells = (
      <>
        {backCell}
        <input
          value={continueText}
          onChange={(event) => setContinueText(event.target.value.slice(0, 2000))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) sendContinue();
          }}
          placeholder={t('fixError.continuePlaceholder')}
          data-testid="fix-continue-input"
          className="min-w-0 border-0 border-l border-border-subtle bg-transparent px-2.5 text-xs text-text-primary outline-none placeholder:text-text-muted"
        />
        <button
          type="button"
          disabled={!continueText.trim()}
          onClick={sendContinue}
          data-testid="fix-continue-send"
          className={toolCell}
        >
          <Send className="h-3.5 w-3.5" />
          {t('fixError.send')}
        </button>
        <button
          type="button"
          onClick={() => setStep('review')}
          data-testid="fix-view-changes"
          className="ui-accent-cell border-l border-border-subtle"
        >
          <FileCode2 className="h-3.5 w-3.5" />
          {t('fixError.viewChanges')}
        </button>
      </>
    );
  } else if (step === 'generate') {
    const failed = !generating && generationLog?.outcome?.status === 'error';
    actionCols = '104px minmax(0,1fr) 120px';
    actionCells = (
      <>
        {backCell}
        {noteCell(
          generating
            ? t('data.rawTables.editor.customizeGeneratingHint')
            : failed
              ? t('data.rawTables.editor.customizeErrorHint')
              : t('data.rawTables.editor.customizeDoneHint')
        )}
        {failed ? (
          <button
            type="button"
            onClick={() => void generate()}
            className="ui-accent-cell border-l border-border-subtle"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('data.rawTables.editor.regenerateProjectDraft')}
          </button>
        ) : (
          <button
            type="button"
            disabled={generating || viewVersion == null}
            onClick={() => setStep('review')}
            className="ui-accent-cell border-l border-border-subtle"
          >
            <FileCode2 className="h-3.5 w-3.5" />
            {t('data.rawTables.editor.generationViewCode')}
          </button>
        )}
      </>
    );
  } else {
    const isPublished = detail?.status === 'published';
    actionCols = '104px minmax(0,1fr) 104px 120px 104px';
    actionCells = (
      <>
        {backCell}
        {trialFailedHere && !error && trialReport ? (
          // Step bar failure note: the reason plus the way back to the 报错 panel.
          <button
            type="button"
            role="alert"
            onClick={() => setTrialOpen(true)}
            title={trialReport.message}
            data-testid="script-trial-failure"
            className="flex min-w-0 items-center gap-1.5 border-l border-border-subtle px-2.5 text-left text-xs font-medium text-error hover:bg-error/5"
          >
            <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">
              {t('fixError.trialFailed', { reason: trialReport.message })}
            </span>
            <span className="ml-auto flex-shrink-0 pl-2 text-accent">{t('fixError.fix')}</span>
          </button>
        ) : (
          noteCell(
            detail ? (
              <span data-testid="script-version-summary">
                {showingFix && fixInfo && detail.status === 'draft'
                  ? fixInfo.text
                  : [
                      t('data.rawTables.editor.versionNumber', { version: detail.version }),
                      t(`scripts.status.${detail.status}`),
                      t(SCRIPT_SOURCE_KEYS[detail.source]),
                      shortTime(detail.updatedAt),
                    ].join(' · ')}
              </span>
            ) : (
              ''
            )
          )
        )}
        <button
          type="button"
          onClick={() => setVersionsOpen(true)}
          data-testid="script-versions"
          className={`${toolCell} ${versionsOpen ? 'bg-accent-muted text-accent' : ''}`}
        >
          <History className="h-3.5 w-3.5" />
          {t('data.rawTables.editor.versionHistory')}
        </button>
        <button
          type="button"
          disabled={!detail || testing}
          onClick={() => void runTrial(detail?.version ?? null)}
          data-testid="script-trial"
          className={toolCell}
        >
          {testing ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {t('scripts.editor.trialPreview')}
        </button>
        {isPublished ? (
          <span className="inline-flex items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-success">
            <Check className="h-3.5 w-3.5" />
            {t('data.rawTables.editor.publishedVersion')}
          </span>
        ) : (
          <button
            type="button"
            disabled={!detail || busyVersion != null}
            onClick={() => detail && void publish(detail.version)}
            data-testid="script-publish"
            className="ui-accent-cell border-l border-border-subtle"
          >
            {busyVersion != null ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {t('scripts.editor.publishVersion', { version: detail?.version ?? '' })}
          </button>
        )}
      </>
    );
  }

  const historyVersions: HistoryVersion[] = versions.map((version) => ({
    ...version,
    id: String(version.version),
  }));
  const currentHistory = historyVersions.find((version) => version.status === 'published');
  const lastRun =
    summary?.lastError && (!summary.lastSuccess || summary.lastError.at > summary.lastSuccess.at)
      ? t('scripts.editor.lastRunFailed', {
          time: shortTime(summary.lastError.at),
          reason: summary.lastError.message,
        })
      : summary?.lastSuccess
        ? t('scripts.editor.lastRunOk', {
            time: shortTime(summary.lastSuccess.at),
            count: summary.lastSuccess.rows,
          })
        : '';

  return (
    <section
      className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface"
      data-testid="script-workbench"
    >
      <div className="flex h-12 flex-shrink-0 items-stretch justify-between border-b border-border-subtle">
        <div className="flex min-w-0 items-stretch">
          <button
            type="button"
            onClick={onClose}
            data-testid="script-editor-back"
            className="inline-flex w-[104px] flex-shrink-0 items-center justify-center gap-1.5 border-r border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('data.rawTables.editor.backShort')}
          </button>
          <div className="flex min-w-0 items-center gap-2 border-r border-border-subtle px-3">
            <RawTableStatusBadge label={statusBadge.label} tone={statusBadge.tone} />
            {nameEditing ? (
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => setNameEditing(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
                maxLength={50}
                aria-label={t('scripts.editor.name')}
                className="h-8 min-w-0 max-w-[22rem] border-0 bg-transparent px-0 text-[14px] font-semibold text-text-primary outline-none"
              />
            ) : (
              <div className="flex h-8 min-w-0 max-w-[22rem] items-center truncate text-[14px] font-semibold text-text-primary">
                {name}
              </div>
            )}
            <button
              type="button"
              onClick={() => setNameEditing(true)}
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent"
              aria-label={t('common.edit')}
            >
              <PencilLine className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex items-stretch">
          <button
            type="button"
            disabled={!packageId || testing}
            onClick={() => void runTrial(step === 'review' ? viewVersion : 'published')}
            data-testid="script-editor-trial"
            className="inline-flex h-full w-[92px] items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {t('schedule.script.testRun')}
          </button>
          <button
            type="button"
            disabled={!packageId || saving}
            onClick={() => void save()}
            data-testid="script-editor-save"
            className="inline-flex h-full w-[92px] items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-accent transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as typeof tab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsContent
          value="config"
          className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface"
        >
          <section className="ui-group ui-form-flush flex-shrink-0 bg-surface">
            <div className="ui-group-title">{t('schedule.script.package')}</div>
            <RawTableConfigRow label={t('scripts.editor.folder')}>
              <div className="flex min-h-[35px] min-w-0 flex-1 items-stretch">
                <div className="flex min-w-0 flex-1 items-center gap-2 px-[10px]">
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-accent-muted text-accent">
                    <Folder className="h-3.5 w-3.5" />
                  </span>
                  <div
                    className="min-w-0 truncate font-mono text-[12px] text-text-primary"
                    title={summary?.dir}
                  >
                    {summary?.dir.replace(
                      /^\/home\/[^/]+|^\/Users\/[^/]+|^[A-Z]:\\Users\\[^\\]+/,
                      '~'
                    ) ?? t('scripts.editor.folderPending')}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!packageId}
                  onClick={() => packageId && void api.open(packageId)}
                  className="ui-accent-cell w-[120px] flex-shrink-0 border-l border-border-subtle"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t('scripts.editor.openFolder')}
                </button>
              </div>
            </RawTableConfigRow>
            <RawTableConfigRow label={t('schedule.script.entry')}>
              <span className="ui-flush-text text-text-muted">
                {summary
                  ? [
                      summary.entry,
                      summary.runtimeVersion ?? runtimeLabel(summary.runtime),
                      summary.depsReady
                        ? t('schedule.script.depsReady')
                        : t('schedule.script.depsOnFirstRun'),
                    ].join(' · ')
                  : '—'}
              </span>
            </RawTableConfigRow>
          </section>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <section className="ui-group ui-form-flush flex-shrink-0 bg-surface">
              <RawTableConfigRow label={t('data.rawTables.editor.customizeFlowLabel')}>
                <div className="flex min-h-[35px] items-center px-2.5" data-testid="script-steps">
                  {steps.map((item, index) => {
                    const active = item.value === step;
                    const done = index < stepIndex;
                    const clickable = item.reachable || active;
                    return (
                      <Fragment key={item.value}>
                        {index > 0 ? (
                          <ChevronRight
                            aria-hidden
                            className="mx-2.5 h-3.5 w-3.5 flex-shrink-0 text-text-muted"
                          />
                        ) : null}
                        <button
                          type="button"
                          disabled={!clickable}
                          aria-current={active ? 'step' : undefined}
                          data-step={item.value}
                          onClick={() => setStep(item.value)}
                          className={`inline-flex h-7 items-center gap-1.5 text-[12.5px] transition-colors ${
                            active
                              ? 'font-semibold text-accent'
                              : clickable
                                ? 'font-normal text-text-primary hover:text-accent'
                                : 'cursor-not-allowed font-normal text-text-muted'
                          }`}
                        >
                          {done ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <span className="font-semibold tabular-nums">{index + 1}</span>
                          )}
                          {item.label}
                        </button>
                      </Fragment>
                    );
                  })}
                </div>
              </RawTableConfigRow>
            </section>

            <section className="ui-group ui-form-flush flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
              {step === 'rules' ? (
                <>
                  <div className="ui-form-row min-h-0 flex-1">
                    <div className="ui-form-label items-start pt-2.5">
                      {t('scripts.editor.ruleLabel')}
                      <span className="ml-0.5 text-error">*</span>
                    </div>
                    <div className="ui-form-value relative min-h-0">
                      <textarea
                        value={rulePrompt}
                        onChange={(event) => setRulePrompt(event.target.value.slice(0, 4000))}
                        placeholder={t('scripts.editor.rulePlaceholder')}
                        disabled={generating}
                        data-testid="script-rule-prompt"
                        className="h-full min-h-[120px] w-full resize-none border-0 bg-transparent px-2.5 py-2 pb-6 text-[13px] leading-6 text-text-primary outline-none placeholder:text-text-muted"
                      />
                      <span className="pointer-events-none absolute bottom-2 right-2.5 text-[11px] tabular-nums text-text-muted">
                        {rulePrompt.length} / 4000
                      </span>
                    </div>
                  </div>
                  <RawTableConfigRow label={t('scripts.editor.base')}>
                    <GlassSelect
                      ariaLabel={t('scripts.editor.base')}
                      value={baseVersion != null && packageId ? String(baseVersion) : 'scratch'}
                      onValueChange={(value) =>
                        setBaseVersion(value === 'scratch' ? null : Number(value))
                      }
                      options={baseOptions}
                      disabled={generating || !packageId}
                      triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
                      contentClassName="w-[var(--radix-select-trigger-width)]"
                    />
                  </RawTableConfigRow>
                  <RawTableConfigRow label={t('scripts.editor.language')}>
                    <GlassSelect
                      ariaLabel={t('scripts.editor.language')}
                      value={runtime}
                      onValueChange={(value) => setRuntime(value as ScriptRuntime)}
                      options={[
                        {
                          value: 'python',
                          label:
                            summary?.runtime === 'python' && summary.runtimeVersion
                              ? summary.runtimeVersion
                              : 'Python 3',
                        },
                        { value: 'node', label: 'Node.js' },
                      ]}
                      disabled={generating}
                      triggerClassName="w-full justify-between text-text-primary disabled:opacity-60"
                      contentClassName="w-[var(--radix-select-trigger-width)]"
                    />
                  </RawTableConfigRow>
                  <RawTableConfigRow label={t('data.rawTables.editor.customizeModelLabel')}>
                    <AgentModelSelector
                      open={modelMenuOpen}
                      onOpenChange={setModelMenuOpen}
                      appConfig={appConfig}
                      selectedConfigSetId={modelConfigSetId ?? appConfig?.activeConfigSetId ?? ''}
                      fallbackLabel={t('chat.noModel', { defaultValue: '未配置模型' })}
                      disabled={generating}
                      align="start"
                      triggerClassName="ui-flush-control flex items-center justify-between gap-2 text-left text-text-primary"
                      onSelect={(configSetId) => setModelConfigSetId(configSetId)}
                    />
                  </RawTableConfigRow>
                  <RawTableConfigRow label={t('data.rawTables.editor.examplesLabel')}>
                    <div className="flex min-h-[35px] flex-wrap items-center gap-1.5 px-2.5 py-1.5">
                      {EXAMPLE_KEYS.map((key) => {
                        const example = t(`scripts.editor.${key}`);
                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={generating}
                            onClick={() =>
                              setRulePrompt((current) =>
                                current.trim()
                                  ? `${current.replace(/\s+$/, '')}\n${example}`
                                  : example
                              )
                            }
                            className="inline-flex h-6 items-center gap-1 rounded border border-accent/25 bg-surface px-2 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Plus className="h-3 w-3" />
                            {t(`scripts.editor.${key}Label`)}
                          </button>
                        );
                      })}
                    </div>
                  </RawTableConfigRow>
                </>
              ) : null}

              {step === 'generate' ? (
                <RawTableGenerationConsole
                  isStreaming={generating || fixing}
                  log={generationLog}
                  modelLabel={modelLabel}
                  stepTitles={{
                    source_summary: t('scripts.editor.stepBase'),
                    code_generation: t('scripts.editor.stepCode'),
                    saving: t('scripts.editor.stepSave'),
                  }}
                  t={t}
                />
              ) : null}

              {step === 'review' ? (
                files.length === 0 ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center bg-surface">
                    <div className="flex flex-col items-center gap-2 px-6 text-center">
                      <FileCode2 className="h-6 w-6 text-text-muted" />
                      <span className="text-[13px] font-medium text-text-secondary">
                        {t('data.rawTables.editor.noProjectFiles')}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`grid min-h-0 flex-1 grid-rows-[36px_minmax(0,1fr)] ${
                      showingFix
                        ? 'grid-cols-[minmax(0,1fr)_150px_92px_200px_40px]'
                        : 'grid-cols-[minmax(0,1fr)_92px_200px_40px]'
                    }`}
                    data-testid="script-review"
                  >
                    <div className="flex min-w-0 items-center gap-2 border-b border-border-subtle px-2.5">
                      <FileCode2 className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
                      <span className="min-w-0 truncate font-mono text-xs font-medium text-text-primary">
                        {selectedFile?.path}
                      </span>
                      {selectedFile ? (
                        <span className="flex-shrink-0 whitespace-nowrap text-[11px] text-text-muted">
                          {showingFix && codeView === 'diff'
                            ? (() => {
                                const stats = fileDiffStats(
                                  diffBaseFile?.content,
                                  selectedFile.content
                                );
                                return `+${stats.added} −${stats.removed} · ${getCodePreviewLanguageLabel(selectedFile.path)}`;
                              })()
                            : t('data.rawTables.editor.codeFileMeta', {
                                lines: selectedFile.content.split('\n').length,
                                language: getCodePreviewLanguageLabel(selectedFile.path),
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
                      disabled={!selectedFile}
                      onClick={() => {
                        if (!selectedFile) return;
                        void navigator.clipboard?.writeText(selectedFile.content);
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1500);
                      }}
                      className={`inline-flex items-center justify-center gap-1.5 border-b border-l border-border-subtle text-xs font-medium transition-colors hover:bg-accent-muted ${
                        copied ? 'text-success' : 'text-text-secondary hover:text-accent'
                      }`}
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copied
                        ? t('data.rawTables.editor.copiedShort')
                        : t('data.rawTables.editor.copyShort')}
                    </button>
                    <div className="flex items-center border-b border-l border-border-subtle px-2.5 text-xs font-semibold text-text-primary">
                      {t('data.rawTables.editor.projectStructure')}
                    </div>
                    <div className="flex items-center justify-center border-b border-border-subtle text-xs tabular-nums text-text-muted">
                      {files.length}
                    </div>
                    <div
                      className={`${showingFix ? 'col-span-3' : 'col-span-2'} flex min-h-0 min-w-0 flex-col overflow-hidden`}
                    >
                      {showingFix && codeView === 'diff' && selectedFile ? (
                        <CodeDiffView
                          before={diffBaseFile?.content}
                          after={selectedFile.content}
                          t={t}
                        />
                      ) : (
                        <CodePreview
                          file={selectedFile}
                          t={t}
                          focusLine={
                            focusLine && focusLine.path === selectedFile?.path
                              ? focusLine.line
                              : undefined
                          }
                        />
                      )}
                    </div>
                    <div className="col-span-2 min-h-0 overflow-auto border-l border-border-subtle">
                      <NormalizerProjectTree
                        files={files}
                        selectedPath={selectedFile?.path ?? ''}
                        onSelect={setSelectedPath}
                        markers={markers}
                        t={t}
                      />
                    </div>
                  </div>
                )
              ) : null}
            </section>

            <div
              className="grid h-9 flex-shrink-0 border-t border-border-subtle bg-surface"
              style={{ gridTemplateColumns: actionCols }}
              data-testid="script-actions"
            >
              {actionCells}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="data" className="flex min-h-0 flex-1 flex-col">
          <GlassDataGridPreview
            preview={lastOutput}
            isLoading={false}
            error={null}
            currentPage={1}
            onPageChange={() => undefined}
            labels={{
              loading: t('data.rawTables.editor.previewLoading'),
              empty: t('scripts.editor.noOutput'),
              total: (count) => t('data.rawTables.editor.previewTotal', { count }),
              pageSize: (count) => t('data.rawTables.editor.previewPageSize', { count }),
            }}
            edgeToEdge
            rowHeight={32}
            headerHeight={34}
          />
        </TabsContent>
        <TabsContent value="automation" className="min-h-0 flex-1 overflow-y-auto bg-surface">
          <div className="ui-group ui-form-flush bg-surface">
            <div className="ui-group-title">{t('scripts.editor.usedBy')}</div>
            {automations && automations.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-text-muted">
                {t('scripts.editor.notUsed')}
              </div>
            ) : (
              (automations ?? []).map((automation) => (
                <RawTableConfigRow
                  key={automation.id}
                  label={
                    automation.enabled ? t('scripts.editor.enabled') : t('scripts.editor.disabled')
                  }
                >
                  <span className="ui-flush-text">
                    {automation.name}
                    {automation.lastRunAt ? ` · ${shortTime(automation.lastRunAt)}` : ''}
                  </span>
                </RawTableConfigRow>
              ))
            )}
          </div>
        </TabsContent>
        <div className={`${bottomTabBarClass} justify-between`}>
          <TabsList className={bottomTabListClass}>
            <TabsTrigger value="config" className={bottomTabTriggerClass}>
              {t('data.rawTables.editor.tabs.config')}
            </TabsTrigger>
            <TabsTrigger value="data" className={bottomTabTriggerClass} disabled={!packageId}>
              {t('data.rawTables.editor.tabs.data')}
            </TabsTrigger>
            <TabsTrigger value="automation" className={bottomTabTriggerClass} disabled={!packageId}>
              {t('data.rawTables.editor.tabs.automation')}
            </TabsTrigger>
          </TabsList>
          <div className="flex min-w-0 items-center gap-2 px-4 text-xs text-text-muted">
            <span className="truncate" data-testid="script-last-run">
              {lastRun}
            </span>
          </div>
        </div>
      </Tabs>

      <Dialog
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        ariaLabel={t('data.rawTables.editor.versionHistory')}
        className="w-full max-w-[820px] overflow-hidden !p-0"
      >
        <div className="grid h-10 grid-cols-[minmax(0,1fr)_92px_40px] border-b border-border-subtle">
          <div className="flex min-w-0 items-baseline gap-2 self-center px-3">
            <span className="text-[14px] font-semibold text-text-primary">
              {t('data.rawTables.editor.versionHistory')}
            </span>
            {versions.length > 0 ? (
              <span className="text-xs text-text-muted">
                {t('data.rawTables.editor.versionsCount', { count: versions.length })}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            disabled={versionsLoading}
            onClick={() => void refresh()}
            className="inline-flex items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${versionsLoading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </button>
          <button
            type="button"
            onClick={() => setVersionsOpen(false)}
            className="inline-flex items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-accent-muted hover:text-accent"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <RawTableVersionHistoryPanel<HistoryVersion>
          currentVersion={currentHistory}
          currentVersionId={viewVersion != null ? String(viewVersion) : undefined}
          deletingVersionId={deletingVersion != null ? String(deletingVersion) : null}
          embedded
          loading={versionsLoading}
          onRefresh={() => void refresh()}
          onDelete={(version) => void deleteVersion(version.version)}
          onPublish={(version) => void publish(version.version)}
          publishingVersionId={busyVersion != null ? String(busyVersion) : null}
          t={t}
          versions={historyVersions}
          sourceOf={(version) => t(SCRIPT_SOURCE_KEYS[version.source])}
          diffOf={(version) => versionDiff(version)}
          onOpen={(version) => {
            setViewVersion(version.version);
            setStep('review');
            setVersionsOpen(false);
          }}
        />
      </Dialog>

      {trialOpen ? (
        <RawTablePreviewDialog
          title={
            trialReport
              ? t('fixError.trialFailedTitle', { version: trialVersionLabel })
              : t('scripts.editor.trialTitle', {
                  version: trialVersionNumber ? `v${trialVersionNumber}` : '',
                  status: trialRecord ? t(`scripts.status.${trialRecord.status}`) : '',
                })
          }
          subtitle={
            trialReport
              ? undefined
              : trial
                ? trial.ok
                  ? t('scripts.editor.trialOk', {
                      count: trial.rows ?? 0,
                      seconds: (trial.durationMs / 1000).toFixed(1),
                    }) + (trial.installedDeps ? ` · ${t('scripts.editor.depsInstalled')}` : '')
                  : undefined
                : t('schedule.script.testing')
          }
          preview={
            trial?.ok && trial.columns && !trialSuspicious
              ? toPreview({
                  columns: trial.columns,
                  rows: trial.previewRows ?? [],
                  total: trial.rows ?? 0,
                })
              : null
          }
          isLoading={testing}
          error={
            trialReport ? trialReport.message : trial && !trial.ok ? (trial.error ?? '') : null
          }
          errorContent={
            trialReport ? (
              <FixErrorPanel
                report={trialReport}
                inputLabel={describeConfigInput(
                  trialFiles?.find((file) => file.path === 'config.json')?.content
                )}
                note={fixNote}
                onNoteChange={setFixNote}
                autoFixRounds={autoFixRounds}
                onAutoFixRoundsChange={setAutoFixRounds}
                onOpenLocation={(location) => {
                  setTrialOpen(false);
                  setStep('review');
                  if (trialVersionNumber != null) setViewVersion(trialVersionNumber);
                  setSelectedPath(location.file);
                  setCodeView('full');
                  setFocusLine({ path: location.file, line: location.line });
                }}
                onFix={startTrialFix}
                busy={fixing}
                disabled={generating || trialVersionNumber == null}
                title={t('fixError.trialFailedTitle', { version: trialVersionLabel })}
                footerNote={
                  fixTarget.overwrite
                    ? t('fixError.footerOverwrite', { base: fixBaseLabel })
                    : t('fixError.footerNew', { base: fixBaseLabel, next: fixTarget.version })
                }
                t={t}
              />
            ) : undefined
          }
          currentPage={1}
          onPageChange={() => undefined}
          onClose={() => setTrialOpen(false)}
        />
      ) : null}
    </section>
  );
}
