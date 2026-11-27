import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert, X } from 'lucide-react';
import type { DataRawTablePreview } from '../../types';
import { GlassDataGridPreview } from '../GlassDataGridPreview';
import { Dialog } from '../ui/dialog';

export function RawTablePreviewDialog({
  tableKind = 'raw',
  title,
  subtitle,
  preview,
  isLoading,
  error,
  currentPage,
  onPageChange,
  onClose,
  footer,
  errorContent,
  warnings,
}: {
  tableKind?: 'raw' | 'result';
  title?: string;
  subtitle?: string;
  preview: DataRawTablePreview | null;
  isLoading: boolean;
  error: string | null;
  currentPage: number;
  onPageChange: (page: number) => void;
  onClose: () => void;
  footer?: ReactNode;
  /** Replaces the grid's one-line error state (报错修复 panel). */
  errorContent?: ReactNode;
  /** Passed with warnings (on_empty fallback used, single-value columns): yellow strip. */
  warnings?: string[];
}) {
  const { t } = useTranslation();
  const previewTitle =
    title ??
    (tableKind === 'result'
      ? t('data.resultTables.previewTitle')
      : t('data.rawTables.editor.previewTitle'));
  const previewEmpty =
    tableKind === 'result'
      ? t('data.resultTables.previewEmpty')
      : t('data.rawTables.editor.previewEmpty');

  return (
    <Dialog
      open
      onOpenChange={onClose}
      ariaLabel={previewTitle}
      overlayClassName="bg-black/25 px-4 py-6 dark:bg-black/50"
      className="h-[min(42rem,88vh)] w-[min(72rem,94vw)] max-w-[min(72rem,94vw)] gap-0 overflow-hidden rounded-none border-border-subtle bg-surface p-0 shadow-elevated"
    >
      <div
        className="grid h-10 flex-shrink-0 grid-cols-[minmax(0,1fr)_40px] border-b border-border-subtle bg-surface"
        data-testid="raw-table-preview-header"
      >
        <div className="flex min-w-0 items-center gap-2 px-3">
          <div className="truncate text-[13.5px] font-semibold text-text-primary">
            {previewTitle}
          </div>
          {subtitle && <div className="truncate text-[11px] text-text-muted">{subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-full w-10 items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-accent-muted hover:text-accent"
          title={t('common.close')}
          aria-label={t('common.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {warnings?.length && !error && !isLoading ? (
        <div
          className="flex flex-shrink-0 items-start gap-2 border-b border-border-subtle bg-warning/10 px-3 py-1.5 text-[12px] leading-5 text-warning"
          data-testid="preview-warnings"
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0">{warnings.join('；')}</span>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--data-grid-cell-surface)]">
        {error && errorContent && !isLoading ? (
          errorContent
        ) : (
          <GlassDataGridPreview
            preview={preview}
            isLoading={isLoading}
            error={error}
            currentPage={currentPage}
            onPageChange={onPageChange}
            edgeToEdge
            labels={{
              loading: t('data.rawTables.editor.previewLoading'),
              empty: previewEmpty,
              total: (count) => t('data.rawTables.editor.previewTotal', { count }),
              pageSize: (count) => t('data.rawTables.editor.previewPageSize', { count }),
            }}
          />
        )}
      </div>
      {footer && (
        <div className="flex h-10 flex-shrink-0 items-center justify-end gap-2 border-t border-border-subtle bg-surface px-3">
          {footer}
        </div>
      )}
    </Dialog>
  );
}
