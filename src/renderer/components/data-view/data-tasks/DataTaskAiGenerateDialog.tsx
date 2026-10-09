/** Every entry point starts the same persisted analyze → confirm → generate conversation. */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Sparkles } from 'lucide-react';
import type {
  DataAutomationSourceBinding,
  DataAutomationOutputBinding,
  DataGenerateTaskFromRequirementInput,
  DataGenerateTaskFromRequirementResult,
  DataWorkflowSaveInput,
} from '../../../types';
import type { DataTaskAuthoringRequest } from '../../../../shared/data-task-authoring';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '../../ui/dialog';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { GlassSelect } from '../../GlassSelect';
import { LlmPromptComposer } from '../../LlmPromptComposer';
import { useDataTaskAuthoring } from '../../../features/data/hooks/use-data-task-authoring';
import { useTaskGenerationInputs } from '../../../features/data/hooks/use-task-generation-inputs';

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
  onStarted,
  onOpenChange,
  workingDirectory,
}: {
  open: boolean;
  taskId?: string;
  workingDirectory?: string;
  boundInputTable?: { id: string; name: string } | null;
  initialSource?: DataAutomationSourceBinding | null;
  initialOutput?: DataAutomationOutputBinding;
  initialRequirement?: string;
  anchorNode?: { id: string; label: string; type: string } | null;
  draftWorkflow?: DataWorkflowSaveInput | null;
  hasExistingNodes?: boolean;
  isCanvasDirty?: boolean;
  onApplied?: (
    result: DataGenerateTaskFromRequirementResult,
    input: DataGenerateTaskFromRequirementInput
  ) => void | Promise<void>;
  onStarted?: (sessionId: string, request: DataTaskAuthoringRequest) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { startAuthoring } = useDataTaskAuthoring({ taskId, workingDirectory, onApplied });
  const [requirement, setRequirement] = useState('');
  const [chosenInputId, setChosenInputId] = useState('');
  const [outputName, setOutputName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fixedSource = useMemo(
    () =>
      initialSource?.tableId
        ? initialSource
        : boundInputTable
          ? {
              location: 'local' as const,
              tableId: boundInputTable.id,
              tableName: boundInputTable.name,
            }
          : null,
    [boundInputTable, initialSource]
  );
  const inputs = useTaskGenerationInputs(open && !taskId && !fixedSource);
  const selectedInput = inputs.tables.find((table) => table.id === chosenInputId);
  const source =
    fixedSource ??
    (selectedInput
      ? { location: 'local' as const, tableId: selectedInput.id, tableName: selectedInput.name }
      : null);
  const title = t(taskId ? 'data.workflow.aiGenerate' : 'data.aiTaskGenerate');
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
          reuseTaskId: taskId,
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
            <GlassSelect
              value={chosenInputId}
              disabled={busy || inputs.loading}
              onValueChange={setChosenInputId}
              options={inputs.tables.map((table) => ({ value: table.id, label: table.name }))}
              ariaLabel={t('data.aiTaskInputTable')}
              placeholder={t(inputs.loading ? 'common.loading' : 'data.aiTaskInputTable')}
              searchable
              searchPlaceholder={t('data.aiTaskInputSearch')}
              searchEmptyText={t('common.noResults')}
              triggerClassName="h-9 w-full justify-between"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
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
            onChange={(event) => setOutputName(event.target.value)}
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
