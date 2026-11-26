import { Sparkles, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../ui/button';

interface PipelineStarterOverlayProps {
  isBusy: boolean;
  hasBoundRawTable: boolean;
  onApplyStarterTemplate: () => void;
  onOpenAiDialog: () => void;
}

export function PipelineStarterOverlay({
  isBusy,
  hasBoundRawTable,
  onApplyStarterTemplate,
  onOpenAiDialog,
}: PipelineStarterOverlayProps) {
  const { t } = useTranslation();

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="pointer-events-auto flex w-[26rem] max-w-full flex-col items-center gap-4 rounded-xl border border-border-muted bg-surface px-6 py-5 text-center shadow-card">
        <div className="text-[13px] font-semibold text-text-secondary">
          {t('data.workflow.starterTitle')}
        </div>
        <div className="text-[12px] leading-5 text-text-muted">
          {t('data.workflow.starterHint')}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onApplyStarterTemplate}
            disabled={isBusy}
            className="h-8 px-3 text-xs"
          >
            <Workflow className="h-3.5 w-3.5" />
            {t('data.workflow.starterTemplate')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenAiDialog}
            disabled={isBusy || !hasBoundRawTable}
            className="h-8 px-3 text-xs"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('data.workflow.starterAi')}
          </Button>
        </div>
        {!hasBoundRawTable && (
          <div className="text-[11px] leading-5 text-text-muted">
            {t('data.workflow.aiInputMissing')}
          </div>
        )}
      </div>
    </div>
  );
}
