import { Check, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button } from '../../ui';
import {
  formatMemoryDate,
  getConfidenceLevel,
  getConfidenceLevelLabel,
  isRecordConfirmable,
  type MemoryRecord,
} from './memory-helpers';

export function MemoryListItem({
  record,
  selected,
  onSelect,
}: {
  record: MemoryRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const needsConfirm = isRecordConfirmable(record);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full min-w-0 flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
        selected
          ? 'bg-accent-muted/85 text-text-primary shadow-[inset_2px_0_0_var(--color-accent)]'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
      }`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={`min-w-0 flex-1 truncate text-[12.5px] leading-4 ${
            selected ? 'font-semibold text-text-primary' : 'font-medium text-text-primary'
          }`}
        >
          {record.title}
        </span>
        {needsConfirm && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
      </div>
      <p className="truncate text-[11.5px] leading-4 text-text-muted">{record.summary}</p>
    </button>
  );
}

export function MemoryDetailPanel({
  record,
  isBusy,
  onConfirm,
  onDelete,
}: {
  record: MemoryRecord | null;
  isBusy: boolean;
  onConfirm: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  if (!record) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-[12.5px] text-text-muted">
        {t('memory.noSelection')}
      </div>
    );
  }

  const confidenceLevel = getConfidenceLevel(record.confidence);
  const confidenceTone =
    confidenceLevel === 'high' ? 'success' : confidenceLevel === 'medium' ? 'default' : 'warning';
  const firstEvidence = record.evidence[0];
  const sourceText = firstEvidence?.sourceSessionTitle || record.sourceLabel || '—';
  const updatedText = formatMemoryDate(record.raw.updatedAt || record.raw.createdAt);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone={record.kind === 'core' ? 'accent' : 'default'}>
            {record.kind === 'core' ? t('memory.coreCapabilityTab') : t('memory.projectContextTab')}
          </Badge>
          <h3 className="truncate text-[13px] font-semibold text-text-primary">{record.title}</h3>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isRecordConfirmable(record) && (
            <Button
              variant="primary"
              size="sm"
              onClick={onConfirm}
              disabled={isBusy}
              className="h-7 px-2.5 text-[12px]"
            >
              <Check className="h-3.5 w-3.5" />
              {t('memory.confirmAction')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            disabled={isBusy}
            className="h-7 w-7 text-text-muted hover:bg-error/10 hover:text-error"
            title={t('common.delete')}
            aria-label={t('memory.deleteEntryConfirm')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="scrollbar-hover min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-border-subtle px-4 py-4">
          <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-text-primary">
            {record.summary}
          </p>
        </div>

        <div className="ui-form-flush">
          <div className="ui-form-row">
            <span className="ui-form-label items-center">{t('memory.confidenceLabel')}</span>
            <div className="ui-form-value !flex-row items-center px-[10px]">
              <Badge tone={confidenceTone}>{getConfidenceLevelLabel(confidenceLevel, t)}</Badge>
            </div>
          </div>

          <div className="ui-form-row">
            <span className="ui-form-label items-center">{t('memory.source')}</span>
            <div className="ui-form-value">
              <span className="ui-flush-text truncate text-text-primary" title={sourceText}>
                {sourceText}
              </span>
            </div>
          </div>

          <div className="ui-form-row">
            <span className="ui-form-label items-center">{t('memory.updatedAt')}</span>
            <div className="ui-form-value">
              <span className="ui-flush-text tabular-nums">{updatedText}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
