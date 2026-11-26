import { Check, RefreshCw, Wand2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ScriptTestRunResult } from '../../../shared/automation/script-package';
import type { FixErrorReport } from '../../../shared/fix-error';
import type { DataRawTablePreview } from '../../types';
import { GlassDataGridPreview } from '../GlassDataGridPreview';

interface ScriptResultPaneProps {
  testing: boolean;
  trial: ScriptTestRunResult | null;
  trialFailedHere: boolean;
  trialReport: FixErrorReport | null;
  trialPreview: DataRawTablePreview | null;
  fixInfoText?: string;
  onOpenTrialFixDialog: () => void;
  onOpenUserFix: () => void;
}

export function ScriptResultPane({
  testing,
  trial,
  trialFailedHere,
  trialReport,
  trialPreview,
  fixInfoText,
  onOpenTrialFixDialog,
  onOpenUserFix,
}: ScriptResultPaneProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="script-result">
      <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-border-subtle px-2.5 text-[12.5px]">
        {testing || !trial ? (
          <span className="inline-flex items-center gap-1.5 text-text-muted">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            {t('data.rawTables.editor.resultRunning')}
          </span>
        ) : trialFailedHere && trialReport ? (
          <>
            <XCircle className="h-3.5 w-3.5 flex-shrink-0 text-error" />
            <span className="min-w-0 flex-1 truncate text-error" title={trialReport.message}>
              {t('fixError.trialFailed', { reason: trialReport.message })}
            </span>
            <button
              type="button"
              onClick={onOpenTrialFixDialog}
              data-testid="script-result-fix"
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
              data-testid="script-result-explain"
              title={trial.warnings?.join('；')}
            >
              {fixInfoText ??
                t('scripts.editor.resultExplain', {
                  rows: trial.rows ?? 0,
                  cols: trial.columns?.length ?? 0,
                  seconds: (trial.durationMs / 1000).toFixed(1),
                })}
              {trial.warnings?.length ? (
                <span className="ml-2 text-warning">⚠ {trial.warnings.join('；')}</span>
              ) : null}
            </span>
            <span className="flex-shrink-0 font-medium text-text-secondary">
              {t('data.rawTables.editor.resultLooksRight')}
            </span>
            <button
              type="button"
              onClick={onOpenUserFix}
              data-testid="script-result-wrong"
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
          preview={trialFailedHere ? null : trialPreview}
          isLoading={testing}
          error={null}
          currentPage={1}
          onPageChange={() => undefined}
          edgeToEdge
          labels={{
            loading: t('data.rawTables.editor.previewLoading'),
            empty: t('scripts.editor.noOutput'),
            total: (count) => t('data.rawTables.editor.previewTotal', { count }),
            pageSize: (count) => t('data.rawTables.editor.previewPageSize', { count }),
          }}
        />
      </div>
    </div>
  );
}
