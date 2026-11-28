import { formatIpcError } from '../../../utils/ipc-error';
/** Every entry point starts the same persisted analyze → confirm → generate conversation. */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  AlertTriangle,
  Database,
  GitBranch,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  DataAutomationSourceBinding,
  DataAutomationOutputBinding,
  DataGeneratePipelineFromRequirementInput,
  DataGeneratePipelineFromRequirementResult,
  DataRawTable,
  DataWorkflowSaveInput,
} from '../../../types';
import { isRawTableUnavailable } from '../../../../shared/contracts';
import type { DataPipelineAuthoringRequest } from '../../../../shared/data-pipeline-authoring';
import { useAppStore } from '../../../store';
import { AgentModelSelector } from '../../AgentModelSelector';
import { Dialog, DialogBody, DialogTitle } from '../../ui/dialog';
import { GlassSelect } from '../../GlassSelect';
import { LlmPromptComposer } from '../../LlmPromptComposer';
import { useDataPipelineAuthoring } from '../../../features/data/hooks/use-data-pipeline-authoring';
import { usePipelineGenerationInputs } from '../../../features/data/hooks/use-pipeline-generation-inputs';

const MAX_REQUIREMENT_LENGTH = 4000;

export function DataPipelineAiGenerateDialog({
  open,
  pipelineId,
  boundRawTable,
  initialSource,
  initialOutput,
  initialRequirement = '',
  anchorNode = null,
  draftWorkflow = null,
  hasExistingNodes = false,
  isCanvasDirty = false,
  onApplied,
  onStarted,
  onOpenChange,
  workingDirectory,
}: {
  open: boolean;
  pipelineId?: string;
  workingDirectory?: string;
  boundRawTable?: {
    id: string;
    name: string;
    memberStatus?: DataRawTable['memberStatus'];
  } | null;
  initialSource?: DataAutomationSourceBinding | null;
  initialOutput?: DataAutomationOutputBinding;
  initialRequirement?: string;
  anchorNode?: { id: string; label: string; type: string } | null;
  draftWorkflow?: DataWorkflowSaveInput | null;
  hasExistingNodes?: boolean;
  isCanvasDirty?: boolean;
  onApplied?: (
    result: DataGeneratePipelineFromRequirementResult,
    input: DataGeneratePipelineFromRequirementInput
  ) => void | Promise<void>;
  onStarted?: (sessionId: string, request: DataPipelineAuthoringRequest) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const appConfig = useAppStore((state) => state.appConfig);
  const { startAuthoring } = useDataPipelineAuthoring({ pipelineId, workingDirectory, onApplied });
  const [requirement, setRequirement] = useState('');
  const [chosenInputId, setChosenInputId] = useState('');
  const [outputName, setOutputName] = useState('');
  const [selectedModelConfigSetId, setSelectedModelConfigSetId] = useState('');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boundUnavailable = !initialSource?.tableId && isRawTableUnavailable(boundRawTable);
  const fixedSource = useMemo(
    () =>
      initialSource?.tableId
        ? initialSource
        : boundRawTable && !boundUnavailable
          ? {
              location: 'local' as const,
              tableId: boundRawTable.id,
              tableName: boundRawTable.name,
            }
          : null,
    [boundRawTable, boundUnavailable, initialSource]
  );
  const inputs = usePipelineGenerationInputs(
    open && !pipelineId && !fixedSource && !boundUnavailable
  );
  const selectedInput = inputs.tables.find(
    (table) => table.id === chosenInputId && !isRawTableUnavailable(table)
  );
  const hasAvailableInputs = inputs.tables.some((table) => !isRawTableUnavailable(table));
  const source =
    fixedSource ??
    (selectedInput
      ? { location: 'local' as const, tableId: selectedInput.id, tableName: selectedInput.name }
      : null);
  const title = t(pipelineId ? 'data.workflow.aiGenerate' : 'data.aiPipelineGenerate');
  const submitLabel = t(
    pipelineId ? 'data.workflow.aiGenerateSubmit' : 'data.aiPipelineGenerateSubmit'
  );
  const canSend = Boolean(source) && !boundUnavailable && requirement.trim().length > 0 && !busy;
  const requirementLength = requirement.length;
  const showOutputRow = !pipelineId && initialOutput?.writeMode !== 'replace';
  const showInputNotice =
    !(fixedSource || pipelineId || boundUnavailable) &&
    (Boolean(inputs.error) || (!inputs.loading && !hasAvailableInputs));

  useEffect(() => {
    if (!open) return;
    setRequirement(initialRequirement);
    setChosenInputId('');
    setOutputName(initialOutput?.tableName ?? '');
    setSelectedModelConfigSetId('');
    setModelMenuOpen(false);
    setError(null);
  }, [open, initialRequirement, initialOutput?.tableName]);

  const send = async () => {
    if (!canSend || !source) return;
    setBusy(true);
    setError(null);
    const output = initialOutput
      ? { ...initialOutput, tableName: outputName.trim() || initialOutput.tableName }
      : {
          location: 'local' as const,
          writeMode: 'create' as const,
          tableName: outputName.trim() || undefined,
        };
    const effectiveModelConfigSetId =
      selectedModelConfigSetId || appConfig?.activeConfigSetId || undefined;
    try {
      const started = await startAuthoring(
        {
          source,
          output,
          processRequirement: requirement.trim(),
          reusePipelineId: pipelineId,
          startFromNodeId: anchorNode?.id,
          workflow: anchorNode ? draftWorkflow : undefined,
        },
        anchorNode?.label,
        effectiveModelConfigSetId
      );
      if (started) {
        onStarted?.(started.sessionId, started.request);
        onOpenChange(false);
      }
    } catch (err) {
      setError(formatIpcError(err, String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      closeOnEscape={!modelMenuOpen}
      ariaLabel={title}
      overlayClassName="bg-black/25 px-4 py-6 dark:bg-black/50"
      className="flex w-full max-w-[540px] flex-col gap-0 overflow-hidden rounded-none border-border bg-surface p-0 shadow-elevated"
    >
      <div
        className="grid h-11 flex-shrink-0 grid-cols-[minmax(0,1fr)_44px] border-b border-border-subtle bg-surface"
        data-testid="data-pipeline-ai-header"
      >
        <div className="flex min-w-0 items-center gap-2 px-4">
          <Sparkles className="h-4 w-4 flex-shrink-0 text-accent" />
          <DialogTitle className="min-w-0 truncate text-[14px] font-semibold text-text-primary">
            {title}
          </DialogTitle>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onOpenChange(false)}
          className="inline-flex h-full w-11 items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          title={t('common.close')}
          aria-label={t('common.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <DialogBody className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface p-0">
        <div className="ui-form-flush bg-surface">
          <div className="ui-form-row h-[42px] !min-h-[42px] !grid-cols-[104px_minmax(0,1fr)]">
            <span className="ui-form-label items-center !px-3.5 text-[12.5px]">
              {t('data.workflow.aiInputLabel')}
            </span>
            <div className="ui-form-value">
              {fixedSource || pipelineId || boundUnavailable ? (
                <div className="flex h-full min-h-[41px] min-w-0 items-center gap-2 px-3.5 text-[13px]">
                  <Database
                    className={`h-3.5 w-3.5 shrink-0 ${
                      boundUnavailable ? 'text-error' : 'text-text-muted'
                    }`}
                  />
                  {boundUnavailable && boundRawTable ? (
                    <span className="truncate text-error">
                      {boundRawTable.name} · {t('data.rawTables.status.unavailable')}
                    </span>
                  ) : source ? (
                    <span
                      className="truncate text-text-primary"
                      title={source.tableName || source.tableId}
                    >
                      {source.tableName || source.tableId}
                    </span>
                  ) : (
                    <span className="truncate text-[12.5px] text-text-muted">
                      {t('data.workflow.aiInputMissing')}
                    </span>
                  )}
                </div>
              ) : (
                <GlassSelect
                  value={chosenInputId}
                  disabled={busy || inputs.loading || !hasAvailableInputs}
                  onValueChange={(nextId) => {
                    const picked = inputs.tables.find((table) => table.id === nextId);
                    if (picked && isRawTableUnavailable(picked)) return;
                    setChosenInputId(nextId);
                  }}
                  options={inputs.tables.map((table) => {
                    const unavailable = isRawTableUnavailable(table);
                    return {
                      value: table.id,
                      label: table.name,
                      disabled: unavailable,
                      muted: unavailable,
                      hint: unavailable ? t('data.rawTables.status.unavailable') : undefined,
                    };
                  })}
                  ariaLabel={t('data.aiPipelineRawTable')}
                  placeholder={t(inputs.loading ? 'common.loading' : 'data.aiPipelineRawTable')}
                  searchable
                  searchPlaceholder={t('data.aiPipelineInputSearch')}
                  searchEmptyText={t('common.noResults')}
                  triggerClassName="!min-h-[41px] w-full justify-between !px-3.5 !text-[13px] text-text-primary disabled:opacity-60"
                  contentClassName="w-[var(--radix-select-trigger-width)] rounded-none border-border"
                />
              )}
            </div>
          </div>

          {showOutputRow && (
            <div className="ui-form-row h-[42px] !min-h-[42px] !grid-cols-[104px_minmax(0,1fr)]">
              <span className="ui-form-label items-center !px-3.5 text-[12.5px]">
                {t('data.workflow.aiOutputLabel')}
              </span>
              <div className="ui-form-value">
                <input
                  aria-label={t('data.aiPipelineOutputName')}
                  placeholder={t('data.aiPipelineOutputName')}
                  value={outputName}
                  disabled={busy}
                  onChange={(event) => setOutputName(event.target.value)}
                  className="h-full !min-h-[41px] w-full border-0 bg-transparent !px-3.5 !text-[13px] text-text-primary outline-none placeholder:text-text-muted hover:bg-surface-hover/60 focus:bg-surface-hover/60 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>
          )}

          <div className="ui-form-row h-[42px] !min-h-[42px] !grid-cols-[104px_minmax(0,1fr)]">
            <span className="ui-form-label items-center !px-3.5 text-[12.5px]">
              {t('data.workflow.aiModelLabel')}
            </span>
            <div className="ui-form-value">
              <AgentModelSelector
                open={modelMenuOpen}
                onOpenChange={setModelMenuOpen}
                appConfig={appConfig}
                selectedConfigSetId={selectedModelConfigSetId || undefined}
                fallbackLabel={t('chat.noModel')}
                disabled={busy}
                side="bottom"
                align="start"
                triggerClassName="ui-flush-control flex !min-h-[41px] items-center justify-between gap-2 !px-3.5 text-left !text-[13px] text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                onSelect={setSelectedModelConfigSetId}
              />
            </div>
          </div>

          <div className="ui-form-row !grid-cols-[104px_minmax(0,1fr)]">
            <span className="ui-form-label items-start !px-3.5 pt-3 text-[12.5px]">
              {t('data.workflow.aiRequirementLabel')}
              <span className="ml-0.5 text-error">*</span>
            </span>
            <div className="ui-form-value relative bg-surface transition-colors focus-within:bg-surface-hover/20">
              <LlmPromptComposer
                value={requirement}
                onChange={setRequirement}
                appConfig={appConfig}
                placeholder={t('data.workflow.aiRequirementPlaceholder')}
                disabled={busy || !source}
                maxLength={MAX_REQUIREMENT_LENGTH}
                className="ui-composer-flush min-h-[144px] flex-1 !bg-transparent !px-3.5 !py-2.5 !pb-7"
                textareaClassName="min-h-[104px] !text-[13px] leading-[1.65]"
                skillMenuPlacement="bottom"
                onSubmit={() => void send()}
                submitDisabled={!canSend}
                hideSubmitButton
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-2.5 px-3.5 py-1.5">
                {requirementLength > 0 && !busy && Boolean(source) && (
                  <button
                    type="button"
                    onClick={() => setRequirement('')}
                    className="pointer-events-auto text-[11px] font-medium text-text-muted transition-colors hover:text-text-primary"
                  >
                    {t('common.clear')}
                  </button>
                )}
                <span
                  className={`text-[11px] tabular-nums ${
                    requirementLength >= 3600 ? 'text-warning' : 'text-text-muted'
                  }`}
                  data-testid="data-pipeline-ai-prompt-count"
                >
                  {requirementLength} / {MAX_REQUIREMENT_LENGTH}
                </span>
              </div>
            </div>
          </div>
        </div>

        {showInputNotice && (
          <div
            role={inputs.error ? 'alert' : undefined}
            className={`flex items-start gap-2 border-t border-border-subtle px-4 py-2 text-[12px] leading-5 ${
              inputs.error ? 'bg-error/10 text-error' : 'bg-surface-muted/60 text-text-muted'
            }`}
          >
            {inputs.error && <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span>{inputs.error || t('data.aiPipelineNoInputs')}</span>
          </div>
        )}

        {anchorNode ? (
          <div className="flex items-start gap-2 border-t border-border-subtle bg-accent-muted/45 px-4 py-2 text-[12px] leading-5 text-text-secondary">
            <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
            <span>{t('data.workflow.aiAnchorHint', { name: anchorNode.label })}</span>
          </div>
        ) : (
          (hasExistingNodes || isCanvasDirty) && (
            <div className="flex items-start gap-2 border-t border-border-subtle bg-warning/10 px-4 py-2 text-[12px] leading-5 text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t('data.workflow.aiReplaceWarning')}</span>
            </div>
          )
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 border-t border-border-subtle bg-error/10 px-4 py-2 text-[12px] leading-5 text-error"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </DialogBody>

      <div className="grid h-11 flex-shrink-0 grid-cols-2 border-t border-border-subtle bg-surface">
        <button
          type="button"
          disabled={busy}
          onClick={() => onOpenChange(false)}
          className="inline-flex h-full items-center justify-center border-r border-border-subtle text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          disabled={!canSend}
          onClick={() => void send()}
          data-testid="data-pipeline-ai-submit"
          className="ui-accent-cell h-full gap-1.5 !text-[13px]"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          <span>{submitLabel}</span>
        </button>
      </div>
    </Dialog>
  );
}
