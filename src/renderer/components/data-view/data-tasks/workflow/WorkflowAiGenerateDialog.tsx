/**
 * "Generate/modify this flow with AI" dialog for the task editor. Reuses the
 * requirement pipeline (analyze → confirm → generate) with `reuseTaskId` so
 * the generated graph lands in the currently edited task, then reloads the
 * canvas via `onApplied`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Database, Sparkles } from 'lucide-react';
import type {
  DataAnalyzeTaskRequirementResult,
  DataGenerateTaskFromRequirementInput,
} from '../../../../types';
import { useAppStore } from '../../../../store';
import { dataClient } from '../../../../features/data/api/data-client';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '../../../ui/dialog';
import { Button } from '../../../ui/button';
import { LlmPromptComposer } from '../../../LlmPromptComposer';
import { createLlmUsageTraceId } from '../../../settings/schedule/editor-controls';

const REQUIREMENT_STATUS_ICON = {
  supported: <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-success" />,
  ambiguous: <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-warning" />,
  unsupported: <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-danger" />,
} as const;

const REQUIREMENT_STATUS_LABEL_KEY = {
  supported: 'data.workflow.aiStatusSupported',
  ambiguous: 'data.workflow.aiStatusAmbiguous',
  unsupported: 'data.workflow.aiStatusUnsupported',
} as const;

const REQUIREMENT_STATUS_CLASS = {
  supported: 'text-success',
  ambiguous: 'text-warning',
  unsupported: 'text-danger',
} as const;

export function WorkflowAiGenerateDialog({
  open,
  taskId,
  boundInputTable,
  hasExistingNodes,
  isCanvasDirty,
  onApplied,
  onOpenChange,
}: {
  open: boolean;
  taskId: string;
  /** Input table the generated flow will read — resolved from the canvas/task. */
  boundInputTable: { id: string; name: string } | null;
  /** True when the canvas already holds nodes — generation replaces them. */
  hasExistingNodes: boolean;
  /** True when the canvas has unsaved edits that generation would discard. */
  isCanvasDirty: boolean;
  /** Called after a successful generation so the editor reloads the graph. */
  onApplied: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const appConfig = useAppStore((state) => state.appConfig);
  const [requirement, setRequirement] = useState('');
  const [modelConfigSetId, setModelConfigSetId] = useState('');
  const [model, setModel] = useState('');
  const [analysis, setAnalysis] = useState<DataAnalyzeTaskRequirementResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usageTraceIdRef = useRef(createLlmUsageTraceId());

  const busy = analyzing || generating;
  const canAnalyze = Boolean(boundInputTable) && requirement.trim().length > 0 && !busy;
  const canGenerate =
    Boolean(analysis?.analysisId) &&
    analysis?.items.some((item) => item.status === 'supported') === true &&
    !busy;

  const resetAnalysis = useCallback(() => {
    setAnalysis(null);
    setError(null);
    usageTraceIdRef.current = createLlmUsageTraceId();
  }, []);

  // Each open starts a fresh requirement → analysis → generate chain.
  useEffect(() => {
    if (!open) return;
    setRequirement('');
    setAnalysis(null);
    setError(null);
    usageTraceIdRef.current = createLlmUsageTraceId();
  }, [open]);

  // LlmPromptComposer displays appConfig.activeConfigSetId when nothing is
  // picked, so mirror that fallback — otherwise the backend rejects with
  // "Model configuration is required" on the untouched default.
  const effectiveModelConfigSetId = modelConfigSetId || appConfig?.activeConfigSetId || '';
  const buildInput = useCallback(
    (processRequirement: string): DataGenerateTaskFromRequirementInput => ({
      source: {
        location: 'local',
        tableId: boundInputTable?.id ?? '',
        tableName: boundInputTable?.name,
      },
      processRequirement,
      // writeMode 'create' resolves (or creates) "<input>_processed"; a bound
      // output node keeps its own target inside the generated graph.
      output: { location: 'local', writeMode: 'create' },
      usageTraceId: usageTraceIdRef.current,
      analysisId: analysis?.analysisId,
      modelConfigSetId: effectiveModelConfigSetId || null,
      model: model || null,
      reuseTaskId: taskId,
    }),
    [analysis?.analysisId, boundInputTable, effectiveModelConfigSetId, model, taskId]
  );

  const handleAnalyze = useCallback(async () => {
    if (!canAnalyze || !dataClient.has('analyzeTaskRequirement')) return;
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    try {
      setAnalysis(await dataClient.analyzeTaskRequirement(buildInput(requirement.trim())));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }, [buildInput, canAnalyze, requirement]);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate || !dataClient.has('generateTaskFromRequirement')) return;
    setGenerating(true);
    setError(null);
    try {
      await dataClient.generateTaskFromRequirement(buildInput(requirement.trim()));
      await onApplied();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, [buildInput, canGenerate, onApplied, onOpenChange, requirement]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      ariaLabel={t('data.workflow.aiGenerate')}
      className="w-full max-w-xl p-5"
    >
      <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-text-secondary">
        <Sparkles className="h-4 w-4 text-accent" />
        {t('data.workflow.aiGenerate')}
      </DialogTitle>
      <DialogBody className="mt-3 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[12px] text-text-muted">
          <Database className="h-3.5 w-3.5" />
          {boundInputTable
            ? t('data.workflow.aiInputBound', { name: boundInputTable.name })
            : t('data.workflow.aiInputMissing')}
        </div>
        {(hasExistingNodes || isCanvasDirty) && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            {t('data.workflow.aiReplaceWarning')}
          </div>
        )}
        <LlmPromptComposer
          value={requirement}
          onChange={(value) => {
            setRequirement(value);
            resetAnalysis();
          }}
          appConfig={appConfig}
          selectedModelConfigSetId={modelConfigSetId}
          modelFallbackLabel={t('chat.noModel', { defaultValue: '未配置模型' })}
          placeholder={t('data.workflow.aiRequirementPlaceholder')}
          disabled={busy || !boundInputTable}
          maxLength={4000}
          className="min-h-[96px]"
          textareaClassName="min-h-[56px]"
          onModelSelect={({ configSetId, model: nextModel }) => {
            setModelConfigSetId(configSetId);
            setModel(nextModel);
            resetAnalysis();
          }}
        />
        {analysis && (
          <div className="rounded-lg border border-border-muted bg-surface p-3">
            <div className="mb-2 text-[12px] font-semibold text-text-secondary">
              {t('data.workflow.aiAnalysisResult')}
            </div>
            <div className="flex flex-col gap-2">
              {analysis.items.map((item, index) => (
                <div
                  key={`${item.requirement}-${index}`}
                  className="flex items-start gap-2 rounded-md bg-bg-secondary/50 px-2.5 py-2"
                >
                  {REQUIREMENT_STATUS_ICON[item.status]}
                  <div className="min-w-0 text-[12px] leading-5">
                    <div className="text-text-secondary">{item.requirement}</div>
                    {item.reason && <div className="text-text-muted">{item.reason}</div>}
                  </div>
                  <span
                    className={`ml-auto flex-shrink-0 text-[11px] font-medium ${REQUIREMENT_STATUS_CLASS[item.status]}`}
                  >
                    {t(REQUIREMENT_STATUS_LABEL_KEY[item.status])}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-[12px] font-medium text-danger">
            {error}
          </div>
        )}
      </DialogBody>
      <DialogFooter className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void handleAnalyze()}
          disabled={!canAnalyze}
        >
          {analyzing ? t('data.workflow.aiAnalyzing') : t('data.workflow.aiAnalyze')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={!canGenerate}
        >
          {generating ? t('data.workflow.aiGenerating') : t('data.workflow.aiGenerateSubmit')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
