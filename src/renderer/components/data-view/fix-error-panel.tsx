import { useState } from 'react';
import { Check, Copy, FileCode2, RefreshCw, Wand2 } from 'lucide-react';
import {
  AUTO_FIX_ROUND_OPTIONS,
  formatErrorReportText,
  formatLocation,
  type FixErrorLocation,
  type FixErrorReport,
} from '../../../shared/fix-error';
import { GlassSelect } from '../GlassSelect';
import type { TranslateFn } from './shared';

export type AutoFixRounds = (typeof AUTO_FIX_ROUND_OPTIONS)[number];

/** Exit code and duration line shown under the traceback. */
export function formatReportFooter(report: FixErrorReport, t: TranslateFn): string {
  return [
    report.exitCode !== undefined ? t('fixError.exitCode', { code: report.exitCode }) : '',
    report.durationMs !== undefined
      ? t('fixError.duration', { seconds: (report.durationMs / 1000).toFixed(1) })
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Structured error state of the 预览 / 试运行 dialog: 错误 / 位置 / 输入 / 日志 rows (traceback
 * keeps its line breaks, paths are relative), then 补充 + 自动修复 and the 复制报错 /
 * 交给 AI 修复 actions. Shared by the raw-table 自定义 workbench and the script editor.
 */
export function FixErrorPanel({
  report,
  inputLabel,
  note,
  onNoteChange,
  autoFixRounds,
  onAutoFixRoundsChange,
  onOpenLocation,
  onFix,
  footerNote,
  title,
  busy = false,
  disabled = false,
  t,
}: {
  report: FixErrorReport;
  inputLabel?: string;
  note: string;
  onNoteChange: (value: string) => void;
  autoFixRounds: AutoFixRounds;
  onAutoFixRoundsChange: (value: AutoFixRounds) => void;
  onOpenLocation?: (location: FixErrorLocation) => void;
  onFix: () => void;
  footerNote?: string;
  /** Prefix line for 复制报错 (e.g. the dialog title). */
  title?: string;
  busy?: boolean;
  disabled?: boolean;
  t: TranslateFn;
}) {
  const [copied, setCopied] = useState(false);
  const footer = formatReportFooter(report, t);
  const rowClass = 'grid grid-cols-[76px_minmax(0,1fr)] border-b border-border-subtle';
  const labelClass =
    'flex border-r border-border-subtle bg-surface-muted px-2.5 text-xs font-medium text-text-secondary';
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface" data-testid="fix-error-panel">
      <div className="mx-3 mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border-subtle">
        <div className={rowClass}>
          <div className={`${labelClass} items-center`}>{t('fixError.error')}</div>
          <div
            className="flex min-h-[34px] min-w-0 items-center px-2.5 font-mono text-[12px] text-text-primary"
            data-testid="fix-error-message"
          >
            <span className="break-all">{report.message}</span>
          </div>
        </div>
        {report.location ? (
          <div className={rowClass}>
            <div className={`${labelClass} items-center`}>{t('fixError.location')}</div>
            <div className="flex min-h-[34px] min-w-0 items-center px-2.5">
              <button
                type="button"
                disabled={!onOpenLocation}
                onClick={() => report.location && onOpenLocation?.(report.location)}
                data-testid="fix-error-location"
                className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-accent hover:underline disabled:cursor-default disabled:no-underline"
              >
                <FileCode2 className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{formatLocation(report.location)}</span>
              </button>
            </div>
          </div>
        ) : null}
        {inputLabel ? (
          <div className={rowClass}>
            <div className={`${labelClass} items-center`}>{t('fixError.input')}</div>
            <div className="flex min-h-[34px] min-w-0 items-center px-2.5 text-[12px] text-text-secondary">
              <span className="truncate">{inputLabel}</span>
            </div>
          </div>
        ) : null}
        <div className={`${rowClass} min-h-0 flex-1`}>
          <div className={`${labelClass} items-start pt-2`}>{t('fixError.log')}</div>
          <pre
            className="min-h-0 overflow-auto whitespace-pre px-2.5 py-2 font-mono text-[11.5px] leading-[1.6] text-text-primary"
            data-testid="fix-error-log"
          >
            {report.traceback}
            {footer ? `\n${footer}` : ''}
          </pre>
        </div>
        <div className={rowClass}>
          <div className={`${labelClass} items-center`}>{t('fixError.note')}</div>
          <input
            value={note}
            onChange={(event) => onNoteChange(event.target.value.slice(0, 2000))}
            placeholder={t('fixError.notePlaceholder')}
            disabled={busy}
            data-testid="fix-error-note"
            className="h-[34px] min-w-0 border-0 bg-transparent px-2.5 text-[12.5px] text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
        <div className="grid grid-cols-[76px_minmax(0,1fr)]">
          <div className={`${labelClass} items-center`}>{t('fixError.autoFix')}</div>
          <div className="ui-form-flush flex min-h-[34px] min-w-0 items-stretch [&>button]:w-full [&>button]:border-0 [&>button]:shadow-none">
            <GlassSelect
              ariaLabel={t('fixError.autoFix')}
              value={String(autoFixRounds)}
              onValueChange={(value) => onAutoFixRoundsChange(Number(value) as AutoFixRounds)}
              disabled={busy}
              options={AUTO_FIX_ROUND_OPTIONS.map((count) => ({
                value: String(count),
                label:
                  count === 0 ? t('fixError.autoFixOff') : t('fixError.autoFixRounds', { count }),
              }))}
              triggerClassName="h-[34px] w-full justify-between rounded-none border-0 bg-transparent px-2.5 text-[12.5px] text-text-primary shadow-none"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </div>
        </div>
      </div>
      <div className="mt-3 grid h-10 flex-shrink-0 grid-cols-[minmax(0,1fr)_104px_128px] border-t border-border-subtle">
        <div className="flex min-w-0 items-center px-3 text-[11.5px] text-text-muted">
          <span className="truncate" data-testid="fix-error-footer-note">
            {footerNote}
          </span>
        </div>
        <button
          type="button"
          data-testid="fix-error-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(
              formatErrorReportText(report, { title, input: inputLabel, note })
            );
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          className={`inline-flex items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium transition-colors hover:bg-accent-muted ${
            copied ? 'text-success' : 'text-text-secondary hover:text-accent'
          }`}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('fixError.copied') : t('fixError.copy')}
        </button>
        <button
          type="button"
          disabled={busy || disabled}
          onClick={onFix}
          data-testid="fix-error-fix"
          className="ui-accent-cell border-l border-border-subtle"
        >
          {busy ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wand2 className="h-3.5 w-3.5" />
          )}
          {busy ? t('fixError.fixing') : t('fixError.fix')}
        </button>
      </div>
    </div>
  );
}
