import { Check, RefreshCw, Wand2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FixErrorReport } from '../../../../shared/fix-error';
import type { DataRawTablePreview } from '../../../types';
import { GlassDataGridPreview } from '../../GlassDataGridPreview';

interface CustomizeReviewResultPaneProps {
  previewLoading: boolean;
  hasPreviewRun: boolean;
  previewFailed: boolean;
  normalizerReport: FixErrorReport | null;
  previewData: DataRawTablePreview | null;
  previewPage: number;
  fixInfoText?: string;
  onOpenFixDialog: () => void;
  onOpenUserFix: () => void;
  onPageChange: (page: number) => void;
}

export function CustomizeReviewResultPane({
  previewLoading,
  hasPreviewRun,
  previewFailed,
  normalizerReport,
  previewData,
  previewPage,
  fixInfoText,
  onOpenFixDialog,
  onOpenUserFix,
  onPageChange,
}: CustomizeReviewResultPaneProps) {
  const { t } = useTranslation();

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="raw-customize-result"
    >
      <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-border-subtle px-2.5 text-[12.5px]">
        {previewLoading || !hasPreviewRun ? (
          <span className="inline-flex items-center gap-1.5 text-text-muted">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            {t('data.rawTables.editor.resultRunning')}
          </span>
        ) : previewFailed && normalizerReport ? (
          <>
            <XCircle className="h-3.5 w-3.5 flex-shrink-0 text-error" />
            <span className="min-w-0 flex-1 truncate text-error" title={normalizerReport.message}>
              {t('fixError.previewFailed', { reason: normalizerReport.message })}
            </span>
            <button
              type="button"
              onClick={onOpenFixDialog}
              data-testid="raw-result-fix"
              className="inline-flex h-7 flex-shrink-0 items-center gap-1 rounded border border-error/30 px-2.5 text-[12px] font-medium text-error hover:bg-error/10"
            >
              <Wand2 className="h-3.5 w-3.5" />
              {t('data.rawTables.editor.abnormalFix')}
            </button>
          </>
        ) : (
          <>
            <Check className="h-3.5 w-3.5 flex-shrink-0 text-success" />
            <span
              className="min-w-0 flex-1 truncate text-text-primary"
              data-testid="raw-result-explain"
            >
              {fixInfoText ??
                t('data.rawTables.editor.resultExplain', {
                  rows: previewData?.totalRows ?? 0,
                  cols: previewData?.columns.length ?? 0,
                })}
            </span>
            <span className="flex-shrink-0 font-medium text-text-secondary">
              {t('data.rawTables.editor.resultLooksRight')}
            </span>
            <button
              type="button"
              onClick={onOpenUserFix}
              data-testid="raw-result-wrong"
              className="inline-flex h-7 flex-shrink-0 items-center gap-1 rounded border border-border-subtle px-2.5 text-[12px] font-medium text-text-secondary hover:bg-accent-muted hover:text-accent"
            >
              <Wand2 className="h-3.5 w-3.5" />
              {t('data.rawTables.editor.resultWrong')}
            </button>
          </>
        )}
      </div>
      <div className="ui-group ui-group-fill flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--data-grid-cell-surface)]">
        <GlassDataGridPreview
          preview={previewFailed ? null : previewData}
          isLoading={previewLoading}
          error={null}
          currentPage={previewPage}
          onPageChange={onPageChange}
          edgeToEdge
          labels={{
            loading: t('data.rawTables.editor.previewLoading'),
            empty: t('data.rawTables.editor.previewEmpty'),
            total: (count) => t('data.rawTables.editor.previewTotal', { count }),
            pageSize: (count) => t('data.rawTables.editor.previewPageSize', { count }),
          }}
        />
      </div>
    </div>
  );
}
