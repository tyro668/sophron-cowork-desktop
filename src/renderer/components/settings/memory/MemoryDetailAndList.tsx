import { Check, FileText, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  formatMemoryDate,
  getConfidenceLevel,
  getConfidenceLevelLabel,
  getConfidenceReason,
  isRecordConfirmable,
  type MemoryRecord,
} from './memory-helpers';

export function MemoryStat({
  label,
  value,
  unit,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: 'default' | 'error';
}) {
  return (
    <div className="min-w-0 border-border-subtle px-4 py-3 even:border-l [&:nth-child(n+3)]:border-t xl:[&:nth-child(n+2)]:border-l xl:[&:nth-child(n+3)]:border-t-0">
      <p className="text-[11px] font-medium text-text-muted">{label}</p>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={`truncate text-[17px] font-semibold leading-none ${
            tone === 'error' ? 'text-error' : 'text-text-primary'
          }`}
        >
          {value}
        </span>
        {unit ? <span className="text-[11px] font-medium text-text-muted">{unit}</span> : null}
      </div>
    </div>
  );
}

export function MemoryListItem({
  record,
  selected,
  isBusy,
  onSelect,
  onConfirm,
  onDelete,
}: {
  record: MemoryRecord;
  selected: boolean;
  isBusy: boolean;
  onSelect: () => void;
  onConfirm: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const confidenceLevel = getConfidenceLevel(record.confidence);
  const confidenceDot =
    confidenceLevel === 'high'
      ? 'bg-accent'
      : confidenceLevel === 'medium'
        ? 'bg-warning'
        : 'bg-error';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative border-b border-border-subtle px-3 py-2 text-left transition-colors ${
        selected
          ? 'bg-accent-muted shadow-[inset_3px_0_0_var(--color-accent)]'
          : 'bg-surface hover:bg-surface-hover/50'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-primary">
          {record.title}
        </h4>
        <span className="flex flex-shrink-0 items-center gap-1.5 text-[11px] font-medium text-text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${confidenceDot}`} />
          {getConfidenceLevelLabel(confidenceLevel, t)}
        </span>
      </div>
      <p className="mt-0.5 line-clamp-1 text-[12px] leading-4 text-text-secondary">
        {record.summary}
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <MemoryTags tags={record.tags} />
        <div className="flex flex-shrink-0 items-center gap-0.5">
          {isRecordConfirmable(record) ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onConfirm();
              }}
              disabled={isBusy}
              aria-label={t('memory.confirmAction')}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted opacity-0 transition-opacity hover:bg-accent/10 hover:text-accent focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            disabled={isBusy}
            aria-label={t('memory.deleteEntryConfirm')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted opacity-0 transition-opacity hover:bg-error/10 hover:text-error focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </button>
  );
}

export function MemoryDetailPanel({
  record,
  isBusy,
  onConfirm,
}: {
  record: MemoryRecord | null;
  isBusy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  if (!record) {
    return (
      <aside className="flex h-full min-h-0 items-center justify-center rounded-md border border-border-subtle bg-surface p-3 text-center text-[13px] text-text-muted">
        {t('memory.noSelection')}
      </aside>
    );
  }

  const confidenceLevel = getConfidenceLevel(record.confidence);
  const firstEvidence = record.evidence[0];
  const recentEvidence = record.evidence.slice(0, 3);
  const confidenceReason = getConfidenceReason(record.confidenceSignals, t);

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border-subtle bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex h-6 items-center rounded-lg bg-accent-muted px-2.5 text-xs font-medium text-accent">
          {record.kind === 'core' ? t('memory.coreCapabilityTab') : t('memory.projectContextTab')}
        </span>
      </div>

      <h3 className="mt-3 line-clamp-2 text-[15px] font-semibold text-text-primary">
        {record.title}
      </h3>
      <p className="mt-1.5 line-clamp-3 text-[12px] leading-5 text-text-secondary">
        {record.summary}
      </p>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[12px] font-semibold text-text-primary">
          <span>{t('memory.confidenceLabel')}</span>
          <span className="text-accent">{getConfidenceLevelLabel(confidenceLevel, t)}</span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.round(record.confidence * 100)}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-text-muted">{confidenceReason}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-text-muted">
          {t('memory.confidenceEvidenceMeta', {
            evidence: record.confidenceSignals.evidenceCount,
            corroboration: record.confidenceSignals.corroborationCount,
          })}
        </p>
      </div>

      <div className="mt-4 border-t border-border-subtle pt-3">
        <h4 className="text-[12px] font-semibold text-text-primary">{t('memory.source')}</h4>
        <div className="mt-1.5 flex items-center gap-2 text-[12px] font-medium text-text-secondary">
          <FileText className="h-4 w-4 text-text-muted" />
          <span className="truncate">
            {firstEvidence?.sourceSessionTitle || record.sourceLabel || '-'}
          </span>
        </div>
      </div>

      <div className="mt-4 border-t border-border-subtle pt-3">
        <h4 className="text-[12px] font-semibold text-text-primary">{t('memory.recentUsage')}</h4>
        <div className="mt-2 max-h-24 space-y-1.5 overflow-y-auto pr-1">
          {recentEvidence.length ? (
            recentEvidence.map((evidence, index) => (
              <div
                key={`${evidence.sessionId}:${index}`}
                className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-3 text-[12px]"
              >
                <span className="flex min-w-0 items-center gap-2 text-text-secondary">
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                  <span className="truncate">
                    {evidence.sourceSessionTitle || evidence.excerpt || '-'}
                  </span>
                </span>
                <span className="text-right text-text-muted">
                  {formatMemoryDate(evidence.createdAt)}
                </span>
              </div>
            ))
          ) : (
            <div className="text-[12px] text-text-muted">{t('memory.noEvidence')}</div>
          )}
        </div>
      </div>

      {isRecordConfirmable(record) ? (
        <div className="mt-auto flex justify-end border-t border-border-subtle pt-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-foreground shadow-soft transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Check className="h-3.5 w-3.5" />
            {t('memory.confirmAction')}
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function MemoryTags({ tags }: { tags: string[] }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {tags.slice(0, 3).map((tag) => (
        <span
          key={tag}
          className="inline-flex h-6 max-w-full items-center rounded-md bg-surface-muted px-2 text-[11px] font-medium text-text-secondary"
        >
          <span className="truncate">{tag}</span>
        </span>
      ))}
    </div>
  );
}
