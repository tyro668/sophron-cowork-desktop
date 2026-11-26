import { Check, ChevronRight, FileCode2, RotateCcw, Send, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Fragment, type ReactNode } from 'react';

export interface WorkbenchStepItem<TStep extends string> {
  value: TStep;
  label: string;
  reachable: boolean;
}

interface WorkbenchStepBreadcrumbProps<TStep extends string> {
  steps: ReadonlyArray<WorkbenchStepItem<TStep>>;
  activeStep: TStep;
  onSelectStep: (step: TStep) => void;
  testId?: string;
}

/** Shared horizontal step breadcrumb for raw-table & script-package workbenches. */
export function WorkbenchStepBreadcrumb<TStep extends string>({
  steps,
  activeStep,
  onSelectStep,
  testId,
}: WorkbenchStepBreadcrumbProps<TStep>) {
  const activeIndex = steps.findIndex((item) => item.value === activeStep);

  return (
    <div className="flex min-h-[35px] items-center px-2.5" data-testid={testId}>
      {steps.map((step, index) => {
        const isActive = activeStep === step.value;
        const isDone = index < activeIndex;
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
              onClick={() => onSelectStep(step.value)}
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
  );
}

interface FixContinueActionCellsProps {
  backCell: ReactNode;
  continueText: string;
  onContinueTextChange: (value: string) => void;
  onSendContinue: () => void;
  onViewChanges: () => void;
  toolCellClassName: string;
}

/** Shared action bar cells for the AI fix follow-up step in script/raw-table workbenches. */
export function FixContinueActionCells({
  backCell,
  continueText,
  onContinueTextChange,
  onSendContinue,
  onViewChanges,
  toolCellClassName,
}: FixContinueActionCellsProps) {
  const { t } = useTranslation();

  return (
    <>
      {backCell}
      <input
        type="text"
        value={continueText}
        onChange={(event) => onContinueTextChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) onSendContinue();
        }}
        placeholder={t('fixError.continuePlaceholder')}
        data-testid="fix-continue-input"
        className="min-w-0 border-0 border-l border-border-subtle bg-transparent px-2.5 text-xs text-text-primary outline-none placeholder:text-text-muted"
      />
      <button
        type="button"
        disabled={!continueText.trim()}
        onClick={onSendContinue}
        data-testid="fix-continue-send"
        className={toolCellClassName}
      >
        <Send className="h-3.5 w-3.5" />
        {t('fixError.send')}
      </button>
      <button
        type="button"
        onClick={onViewChanges}
        data-testid="fix-view-changes"
        className="ui-accent-cell border-l border-border-subtle"
      >
        <FileCode2 className="h-3.5 w-3.5" />
        {t('fixError.viewChanges')}
      </button>
    </>
  );
}

interface GenerateActionCellsProps {
  backCell: ReactNode;
  note: ReactNode;
  generating: boolean;
  showRegenerate: boolean;
  canRegenerate?: boolean;
  canViewCode: boolean;
  cancelTestId: string;
  regenerateTestId?: string;
  viewCodeTestId?: string;
  onCancel: () => void;
  onRegenerate: () => void;
  onViewCode: () => void;
}

/** Shared action bar cells for the AI generation step in script/raw-table workbenches. */
export function GenerateActionCells({
  backCell,
  note,
  generating,
  showRegenerate,
  canRegenerate = true,
  canViewCode,
  cancelTestId,
  regenerateTestId,
  viewCodeTestId,
  onCancel,
  onRegenerate,
  onViewCode,
}: GenerateActionCellsProps) {
  const { t } = useTranslation();

  return (
    <>
      {backCell}
      {note}
      {generating ? (
        <button
          type="button"
          onClick={onCancel}
          data-testid={cancelTestId}
          className="ui-accent-cell border-l border-border-subtle"
        >
          <XCircle className="h-3.5 w-3.5" />
          {t('scripts.editor.cancelAgent')}
        </button>
      ) : showRegenerate ? (
        <button
          type="button"
          disabled={!canRegenerate}
          onClick={onRegenerate}
          data-testid={regenerateTestId}
          className="ui-accent-cell border-l border-border-subtle"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('data.rawTables.editor.regenerateProjectDraft')}
        </button>
      ) : (
        <button
          type="button"
          disabled={!canViewCode}
          onClick={onViewCode}
          data-testid={viewCodeTestId}
          className="ui-accent-cell border-l border-border-subtle"
        >
          <FileCode2 className="h-3.5 w-3.5" />
          {t('data.rawTables.editor.generationViewCode')}
        </button>
      )}
    </>
  );
}
