/** Every entry point starts the same persisted analyze → confirm → generate conversation. */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Sparkles } from 'lucide-react';
import type {
  DataAutomationSourceBinding,
  DataAutomationOutputBinding,
  DataGeneratePipelineFromRequirementInput,
  DataGeneratePipelineFromRequirementResult,
  DataWorkflowSaveInput,
} from '../../../types';
import type { DataPipelineAuthoringRequest } from '../../../../shared/data-pipeline-authoring';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '../../ui/dialog';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { GlassSelect } from '../../GlassSelect';
import { LlmPromptComposer } from '../../LlmPromptComposer';
import { useDataPipelineAuthoring } from '../../../features/data/hooks/use-data-pipeline-authoring';
import { usePipelineGenerationInputs } from '../../../features/data/hooks/use-pipeline-generation-inputs';

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
  boundRawTable?: { id: string; name: string } | null;
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
  const { startAuthoring } = useDataPipelineAuthoring({ pipelineId, workingDirectory, onApplied });
  const [requirement, setRequirement] = useState('');
  const [chosenInputId, setChosenInputId] = useState('');
  const [outputName, setOutputName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fixedSource = useMemo(
    () =>
      initialSource?.tableId
        ? initialSource
        : boundRawTable
          ? {
              location: 'local' as const,
              tableId: boundRawTable.id,
              tableName: boundRawTable.name,
            }
          : null,
    [boundRawTable, initialSource]
  );
  const inputs = usePipelineGenerationInputs(open && !pipelineId && !fixedSource);
  const selectedInput = inputs.tables.find((table) => table.id === chosenInputId);
  const source =
    fixedSource ??
    (selectedInput
      ? { location: 'local' as const, tableId: selectedInput.id, tableName: selectedInput.name }
      : null);
  const title = t(pipelineId ? 'data.workflow.aiGenerate' : 'data.aiPipelineGenerate');
  const canSend = Boolean(source) && requirement.trim().length > 0 && !busy;

  useEffect(() => {
    if (!open) return;
    setRequirement(initialRequirement);
    setChosenInputId('');
    setOutputName(initialOutput?.tableName ?? '');
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
        anchorNode?.label
      );
      if (started) {
        onStarted?.(started.sessionId, started.request);
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

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
      </DialogTitle>
      <DialogBody className="ui-dialog-pad mt-3 flex flex-col gap-2.5">
        <section className="ui-group">
          <div className="ui-form-row">
            <div className="ui-form-label items-center">{t('data.workflow.aiInputLabel')}</div>
            <div className="ui-form-value">
              {fixedSource || pipelineId ? (
                <div className="flex items-center gap-2 text-[12px] text-text-muted">
                  <Database className="h-3.5 w-3.5" />
                  {source
                    ? t('data.workflow.aiInputBound', { name: source.tableName || source.tableId })
                    : t('data.workflow.aiInputMissing')}
                </div>
              ) : (
                <div className="grid gap-2">
                  <GlassSelect
                    value={chosenInputId}
                    disabled={busy || inputs.loading}
                    onValueChange={setChosenInputId}
                    options={inputs.tables.map((table) => ({ value: table.id, label: table.name }))}
                    ariaLabel={t('data.aiPipelineRawTable')}
                    placeholder={t(inputs.loading ? 'common.loading' : 'data.aiPipelineRawTable')}
                    searchable
                    searchPlaceholder={t('data.aiPipelineInputSearch')}
                    searchEmptyText={t('common.noResults')}
                    triggerClassName="h-8 w-full justify-between"
                    contentClassName="w-[var(--radix-select-trigger-width)]"
                  />
                  {inputs.error && (
                    <p role="alert" className="text-xs text-error">
                      {inputs.error}
                    </p>
                  )}
                  {!inputs.loading && !inputs.error && inputs.tables.length === 0 && (
                    <p className="text-xs text-text-muted">{t('data.aiPipelineNoInputs')}</p>
                  )}
                </div>
              )}
            </div>
          </div>
          {!pipelineId && initialOutput?.writeMode !== 'replace' && (
            <div className="ui-form-row">
              <div className="ui-form-label items-center">{t('data.workflow.aiOutputLabel')}</div>
              <div className="ui-form-value">
                <Input
                  aria-label={t('data.aiPipelineOutputName')}
                  placeholder={t('data.aiPipelineOutputName')}
                  value={outputName}
                  disabled={busy}
                  onChange={(event) => setOutputName(event.target.value)}
                />
              </div>
            </div>
          )}
          <div className="ui-form-row">
            <div className="ui-form-label items-center">
              {t('data.workflow.aiRequirementLabel')}
            </div>
            <div className="ui-form-value py-2">
              <LlmPromptComposer
                value={requirement}
                onChange={setRequirement}
                placeholder={t('data.workflow.aiRequirementPlaceholder')}
                disabled={busy || !source}
                maxLength={4000}
                className="min-h-[96px]"
                textareaClassName="min-h-[56px]"
                onSubmit={() => void send()}
                submitDisabled={!canSend}
              />
            </div>
          </div>
        </section>
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
        {error && (
          <p role="alert" className="text-xs text-error">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
