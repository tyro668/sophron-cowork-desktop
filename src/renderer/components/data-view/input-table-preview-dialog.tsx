import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { DataInputTablePreview } from '../../types';
import { GlassDataGridPreview } from '../GlassDataGridPreview';

export function InputTablePreviewDialog({
  tableKind = 'input',
  title,
  subtitle,
  preview,
  isLoading,
  error,
  currentPage,
  onPageChange,
  onClose,
  footer,
}: {
  tableKind?: 'input' | 'output';
  title?: string;
  subtitle?: string;
  preview: DataInputTablePreview | null;
  isLoading: boolean;
  error: string | null;
  currentPage: number;
  onPageChange: (page: number) => void;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const previewTitle =
    title ??
    (tableKind === 'output'
      ? t('data.outputTables.previewTitle')
      : t('data.inputTables.editor.previewTitle'));
  const previewEmpty =
    tableKind === 'output'
      ? t('data.outputTables.previewEmpty')
      : t('data.inputTables.editor.previewEmpty');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#163526]/16 px-4 py-6 dark:bg-black/50">
      <div className="flex h-[42rem] max-h-[calc(100vh-3rem)] w-[72rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-card">
        <div className="glass-panel-header flex h-12 flex-shrink-0 items-center justify-between px-4">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-text-primary">
              {previewTitle}
            </div>
            {subtitle && <div className="truncate text-[11px] text-text-muted">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent"
            title={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--data-grid-cell-surface)]">
          <GlassDataGridPreview
            preview={preview}
            isLoading={isLoading}
            error={error}
            currentPage={currentPage}
            onPageChange={onPageChange}
            edgeToEdge
            labels={{
              loading: t('data.inputTables.editor.previewLoading'),
              empty: previewEmpty,
              total: (count) => t('data.inputTables.editor.previewTotal', { count }),
              pageSize: (count) => t('data.inputTables.editor.previewPageSize', { count }),
            }}
          />
        </div>
        {footer && (
          <div className="flex h-12 flex-shrink-0 items-center justify-end gap-2 border-t border-border-subtle bg-background px-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
