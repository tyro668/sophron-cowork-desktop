import { AlertCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DataRawTablePreview } from '../../../../types';
import { Button } from '../../../ui/button';
import { Dialog } from '../../../ui/dialog';
import { WorkflowNodeDataPreview } from './WorkflowUi';

interface PipelineExpectFailureBannerProps {
  visible: boolean;
  summary: string | null;
  failureMessage: string;
  hasSamplePreview: boolean;
  samplePreview: DataRawTablePreview | null;
  sampleOpen: boolean;
  detailsOpen: boolean;
  failedNodeId?: string;
  onOpenSample: () => void;
  onSampleOpenChange: (open: boolean) => void;
  onLocateNode: (nodeId: string) => void;
  onToggleDetails: () => void;
  onDismiss: () => void;
}

export function PipelineExpectFailureBanner({
  visible,
  summary,
  failureMessage,
  hasSamplePreview,
  samplePreview,
  sampleOpen,
  detailsOpen,
  failedNodeId,
  onOpenSample,
  onSampleOpenChange,
  onLocateNode,
  onToggleDetails,
  onDismiss,
}: PipelineExpectFailureBannerProps) {
  const { t } = useTranslation();

  return (
    <>
      {visible && (
        <div className="absolute bottom-4 left-1/2 z-40 flex w-[min(92%,36rem)] -translate-x-1/2 flex-col items-center gap-2">
          <div
            role="alert"
            className="w-full rounded-lg border border-error/30 bg-surface px-3.5 py-3 text-[13px] shadow-card"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-error" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-error">
                  {t('data.workflow.expectFailureTitle')}
                </div>
                <div className="mt-0.5 text-text-secondary">{summary}</div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {hasSamplePreview && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onOpenSample}
                      className="h-7 text-[11px]"
                    >
                      {t('data.workflow.expectViewSample')}
                    </Button>
                  )}
                  {failedNodeId && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onLocateNode(failedNodeId)}
                      className="h-7 text-[11px]"
                    >
                      {t('data.workflow.expectLocateNode')}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onToggleDetails}
                    className="h-7 text-[11px]"
                  >
                    {t('data.workflow.expectTechDetails')}
                  </Button>
                </div>
                {detailsOpen && (
                  <pre className="scrollbar-hover mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border-muted/60 bg-background p-2 font-mono text-[10.5px] leading-4 text-text-muted">
                    {failureMessage}
                  </pre>
                )}
              </div>
              <button
                type="button"
                onClick={onDismiss}
                aria-label={t('common.close')}
                className="flex-shrink-0 rounded-md p-1 text-text-muted transition-colors hover:bg-surface hover:text-text-secondary"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
      {samplePreview && (
        <Dialog
          open={sampleOpen}
          onOpenChange={onSampleOpenChange}
          ariaLabel={t('data.workflow.expectSampleTitle')}
          overlayClassName="operator-ui bg-black/15 px-4 py-6 dark:bg-black/50"
          className="h-[28rem] w-[56rem] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-xl p-0 shadow-card"
        >
          <div className="glass-panel-header flex h-12 flex-shrink-0 items-center justify-between gap-3 px-4">
            <div className="text-[14px] font-semibold text-text-primary">
              {t('data.workflow.expectSampleTitle')}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onSampleOpenChange(false)}
              className="text-[11px]"
            >
              <X className="h-3.5 w-3.5" />
              {t('common.close')}
            </Button>
          </div>
          <div className="min-h-0 flex-1 p-3">
            <WorkflowNodeDataPreview
              preview={samplePreview}
              isLoading={false}
              error={null}
              currentPage={1}
              onPageChange={() => {}}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}
