/** Shared data-task authoring: analyze, clarify, then persist a reusable task. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Database, RotateCcw, Sparkles } from 'lucide-react';
import type {
  DataAnalyzeTaskRequirementResult,
  DataAutomationSourceBinding,
  DataAutomationOutputBinding,
  DataGenerateTaskFromRequirementResult,
  DataGenerateTaskFromRequirementInput,
  DataWorkflowSaveInput,
  Message,
} from '../../../types';
import { useAppStore } from '../../../store';
import { dataClient } from '../../../features/data/api/data-client';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '../../ui/dialog';
import { Button } from '../../ui/button';
import { LlmPromptComposer } from '../../LlmPromptComposer';
import { MessageCard } from '../../MessageCard';
import { createLlmUsageTraceId } from '../../../utils/llm-usage';
import { Input } from '../../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { useTaskGenerationInputs } from '../../../features/data/hooks/use-task-generation-inputs';

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

interface AnalysisRound {
  /** The user text submitted in this turn (displayed as a chat bubble). */
  user: string;
  timestamp: number;
  analysis: DataAnalyzeTaskRequirementResult;
}

function AnalysisItems({
  result,
  faded,
}: {
  result: DataAnalyzeTaskRequirementResult;
  faded?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`rounded-lg border border-border-muted bg-surface p-3 ${faded ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-col gap-2">
        {result.items.map((item, index) => (
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
  );
}

export function DataTaskAiGenerateDialog({
  open,
  taskId,
  boundInputTable,
  initialSource,
  initialOutput,
  initialRequirement = '',
  anchorNode = null,
  draftWorkflow = null,
  hasExistingNodes = false,
  isCanvasDirty = false,
  onApplied,
  onOpenChange,
}: {
  open: boolean;
  taskId?: string;
  /** Input table the generated flow will read — resolved from the canvas/task. */
  boundInputTable?: { id: string; name: string } | null;
  initialSource?: DataAutomationSourceBinding | null;
  initialOutput?: DataAutomationOutputBinding;
  initialRequirement?: string;
  /** Selected canvas node the generated steps continue from (merge, not replace). */
  anchorNode?: { id: string; label: string; type: string } | null;
  /** Live canvas graph sent with anchored generation so schema/merge see unsaved edits. */
  draftWorkflow?: DataWorkflowSaveInput | null;
  /** True when the canvas already holds nodes — generation replaces them. */
  hasExistingNodes?: boolean;
  /** True when the canvas has unsaved edits that generation would discard. */
  isCanvasDirty?: boolean;
  /** Called after a successful generation so the editor reloads the graph. */
  onApplied: (
    result: DataGenerateTaskFromRequirementResult,
    input: DataGenerateTaskFromRequirementInput
  ) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const appConfig = useAppStore((state) => state.appConfig);
  const [requirement, setRequirement] = useState('');
  const [chosenInputId, setChosenInputId] = useState('');
  const [inputSearch, setInputSearch] = useState('');
  const [outputName, setOutputName] = useState('');
  const fixedSource = useMemo(
    () =>
      boundInputTable
        ? {
            location: 'local' as const,
            tableId: boundInputTable.id,
            tableName: boundInputTable.name,
          }
        : initialSource?.tableId
          ? initialSource
          : null,
    [boundInputTable, initialSource]
  );
  const inputs = useTaskGenerationInputs(open && !taskId && !fixedSource);
  const selectedInput = inputs.tables.find((table) => table.id === chosenInputId);
  const source = useMemo<DataAutomationSourceBinding | null>(
    () =>
      fixedSource ??
      (selectedInput
        ? { location: 'local', tableId: selectedInput.id, tableName: selectedInput.name }
        : null),
    [fixedSource, selectedInput]
  );
  const title = t(taskId ? 'data.workflow.aiGenerate' : 'data.aiTaskGenerate');
  const [followUp, setFollowUp] = useState('');
  const [rounds, setRounds] = useState<AnalysisRound[]>([]);
  const [modelConfigSetId, setModelConfigSetId] = useState('');
  const [model, setModel] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usageTraceIdRef = useRef(createLlmUsageTraceId());

  const busy = analyzing || generating;
  const analysis = rounds.length > 0 ? rounds[rounds.length - 1].analysis : null;
  const canAnalyze =
    Boolean(source) && requirement.trim().length > 0 && !busy && rounds.length === 0;
  const canFollowUp = Boolean(source) && followUp.trim().length > 0 && !busy && rounds.length > 0;
  const canGenerate =
    Boolean(analysis?.analysisId) &&
    analysis?.items.some((item) => item.status === 'supported') === true &&
    !busy;

  /** Full accumulated conversation text the analyzer sees for the next turn. */
  const mergedRequirement = useCallback(
    (nextUserText: string) => [...rounds.map((round) => round.user), nextUserText].join('\n\n'),
    [rounds]
  );

  /** Requirement text the receipt contract expects at generate time. */
  const generationRequirement = useCallback((): string => {
    if (!analysis) return '';
    if (analysis.status === 'supported') return rounds.map((round) => round.user).join('\n\n');
    return analysis.items
      .filter((item) => item.status === 'supported')
      .map((item) => item.suggestedRequirement || item.requirement)
      .join('\n')
      .trim();
  }, [analysis, rounds]);

  const resetConversation = useCallback(() => {
    setRounds([]);
    setFollowUp('');
    setError(null);
    usageTraceIdRef.current = createLlmUsageTraceId();
  }, []);

  // Each open starts a fresh requirement → analysis → generate chain.
  useEffect(() => {
    if (!open) return;
    setRequirement(initialRequirement);
    setChosenInputId('');
    setInputSearch('');
    setOutputName(initialOutput?.tableName ?? '');
    setFollowUp('');
    setRounds([]);
    setError(null);
    usageTraceIdRef.current = createLlmUsageTraceId();
  }, [open, initialRequirement, initialOutput?.tableName]);

  // LlmPromptComposer displays appConfig.activeConfigSetId when nothing is
  // picked, so mirror that fallback — otherwise the backend rejects with
  // "Model configuration is required" on the untouched default.
  const effectiveModelConfigSetId = modelConfigSetId || appConfig?.activeConfigSetId || '';
  const buildInput = useCallback(
    (processRequirement: string): DataGenerateTaskFromRequirementInput => ({
      source: source ?? { location: 'local', tableId: '' },
      processRequirement,
      // writeMode 'create' resolves (or creates) "<input>_processed"; a bound
      // output node keeps its own target inside the generated graph.
      output: initialOutput
        ? { ...initialOutput, tableName: outputName.trim() || initialOutput.tableName }
        : { location: 'local', writeMode: 'create', tableName: outputName.trim() || undefined },
      usageTraceId: usageTraceIdRef.current,
      analysisId: analysis?.analysisId,
      modelConfigSetId: effectiveModelConfigSetId || null,
      model: model || null,
      reuseTaskId: taskId,
      startFromNodeId: anchorNode?.id ?? null,
      workflow: anchorNode ? draftWorkflow : null,
    }),
    [
      analysis?.analysisId,
      anchorNode,
      source,
      initialOutput,
      outputName,
      draftWorkflow,
      effectiveModelConfigSetId,
      model,
      taskId,
    ]
  );

  const runAnalysis = useCallback(
    async (userText: string) => {
      if (!dataClient.has('analyzeTaskRequirement')) return;
      setAnalyzing(true);
      setError(null);
      try {
        const result = await dataClient.analyzeTaskRequirement(
          buildInput(mergedRequirement(userText))
        );
        setRounds((current) => [
          ...current,
          { user: userText, timestamp: Date.now(), analysis: result },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setAnalyzing(false);
      }
    },
    [buildInput, mergedRequirement]
  );

  const handleAnalyze = useCallback(() => {
    if (!canAnalyze) return;
    void runAnalysis(requirement.trim());
  }, [canAnalyze, requirement, runAnalysis]);

  const handleFollowUp = useCallback(() => {
    if (!canFollowUp) return;
    const text = followUp.trim();
    setFollowUp('');
    void runAnalysis(text);
  }, [canFollowUp, followUp, runAnalysis]);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate || !dataClient.has('generateTaskFromRequirement')) return;
    setGenerating(true);
    setError(null);
    try {
      const input = buildInput(generationRequirement());
      const result = await dataClient.generateTaskFromRequirement(input);
      await onApplied(result, input);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, [buildInput, canGenerate, generationRequirement, onApplied, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      ariaLabel={title}
      className="w-full max-w-xl p-5"
    >
      <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-text-secondary">
        <Sparkles className="h-4 w-4 text-accent" />
        {title}
        {rounds.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-1.5 text-[11px] font-normal text-text-muted"
            onClick={resetConversation}
            disabled={busy}
          >
            <RotateCcw className="h-3 w-3" />
            {t('data.workflow.aiStartOver')}
          </Button>
        )}
      </DialogTitle>
      <DialogBody className="mt-3 flex flex-col gap-3">
        {fixedSource || taskId ? (
          <div className="flex items-center gap-2 text-[12px] text-text-muted">
            <Database className="h-3.5 w-3.5" />
            {source
              ? t('data.workflow.aiInputBound', { name: source.tableName || source.tableId })
              : t('data.workflow.aiInputMissing')}
          </div>
        ) : (
          <div className="grid gap-2">
            <Input
              aria-label={t('data.aiTaskInputSearch')}
              placeholder={t('data.aiTaskInputSearch')}
              value={inputSearch}
              onChange={(event) => setInputSearch(event.target.value)}
              disabled={busy}
            />
            <Select
              value={chosenInputId}
              disabled={busy || inputs.loading}
              onValueChange={(id) => {
                setChosenInputId(id);
                resetConversation();
              }}
            >
              <SelectTrigger aria-label={t('data.aiTaskInputTable')}>
                <SelectValue
                  placeholder={t(inputs.loading ? 'common.loading' : 'data.aiTaskInputTable')}
                />
              </SelectTrigger>
              <SelectContent>
                {inputs.tables
                  .filter(
                    (table) =>
                      table.id === chosenInputId ||
                      table.name.toLowerCase().includes(inputSearch.trim().toLowerCase())
                  )
                  .map((table) => (
                    <SelectItem key={table.id} value={table.id}>
                      {table.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {inputs.error && (
              <p role="alert" className="text-xs text-error">
                {inputs.error}
              </p>
            )}
            {!inputs.loading && !inputs.error && inputs.tables.length === 0 && (
              <p className="text-xs text-text-muted">{t('data.aiTaskNoInputs')}</p>
            )}
          </div>
        )}
        {!taskId && initialOutput?.writeMode !== 'replace' && (
          <Input
            aria-label={t('data.aiTaskOutputName')}
            placeholder={t('data.aiTaskOutputName')}
            value={outputName}
            disabled={busy}
            onChange={(event) => {
              setOutputName(event.target.value);
              resetConversation();
            }}
          />
        )}
        {anchorNode ? (
          <div className="rounded-lg border border-accent/30 bg-accent-muted px-3 py-2 text-[12px] text-text-secondary">
            {t('data.workflow.aiAnchorHint', { name: anchorNode.label })}
          </div>
        ) : (
          (hasExistingNodes || isCanvasDirty) && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
              {t('data.workflow.aiReplaceWarning')}
            </div>
          )
        )}
        {rounds.length === 0 ? (
          <LlmPromptComposer
            value={requirement}
            onChange={(value) => {
              setRequirement(value);
              resetConversation();
            }}
            appConfig={appConfig}
            selectedModelConfigSetId={modelConfigSetId}
            modelFallbackLabel={t('chat.noModel', { defaultValue: '未配置模型' })}
            placeholder={t('data.workflow.aiRequirementPlaceholder')}
            disabled={busy || !source}
            maxLength={4000}
            className="min-h-[96px]"
            textareaClassName="min-h-[56px]"
            onModelSelect={({ configSetId, model: nextModel }) => {
              setModelConfigSetId(configSetId);
              setModel(nextModel);
              resetConversation();
            }}
          />
        ) : (
          <div className="flex max-h-[340px] flex-col gap-3 overflow-y-auto pr-0.5">
            {rounds.map((round, index) => (
              <div key={index} className="flex flex-col gap-3">
                <MessageCard
                  message={
                    {
                      id: `ai-task-round-${index}`,
                      sessionId: 'ai-task-generate',
                      role: 'user',
                      content: [{ type: 'text', text: round.user }],
                      timestamp: round.timestamp,
                    } satisfies Message
                  }
                />
                <AnalysisItems result={round.analysis} faded={index < rounds.length - 1} />
              </div>
            ))}
            {analyzing && (
              <div className="text-[12px] text-text-muted">{t('data.workflow.aiAnalyzing')}</div>
            )}
          </div>
        )}
        {analysis && analysis.status !== 'supported' && (
          <LlmPromptComposer
            value={followUp}
            onChange={setFollowUp}
            appConfig={appConfig}
            selectedModelConfigSetId={modelConfigSetId}
            modelFallbackLabel={t('chat.noModel', { defaultValue: '未配置模型' })}
            placeholder={t('data.workflow.aiFollowUpPlaceholder')}
            disabled={busy || !source}
            maxLength={4000}
            className="min-h-[80px]"
            textareaClassName="min-h-[32px]"
            modelMenuSide="top"
            onModelSelect={({ configSetId, model: nextModel }) => {
              setModelConfigSetId(configSetId);
              setModel(nextModel);
            }}
            onSubmit={handleFollowUp}
            submitDisabled={!canFollowUp}
            submitTitle={t('data.workflow.aiReanalyze')}
          />
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
        {rounds.length === 0 && (
          <Button variant="secondary" size="sm" onClick={handleAnalyze} disabled={!canAnalyze}>
            {analyzing ? t('data.workflow.aiAnalyzing') : t('data.workflow.aiAnalyze')}
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={!canGenerate}
        >
          {generating
            ? t('data.workflow.aiGenerating')
            : t(taskId ? 'data.workflow.aiGenerateSubmit' : 'data.aiTaskGenerateSubmit')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
