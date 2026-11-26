import { RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DataRawTableNormalizerArtifactVersion } from '../../../types';
import { Dialog } from '../../ui/dialog';
import { RawTableVersionHistoryPanel } from '../raw-table-version-history';

interface NormalizerVersionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versions: DataRawTableNormalizerArtifactVersion[];
  currentVersion?: DataRawTableNormalizerArtifactVersion;
  currentVersionId?: string;
  loading: boolean;
  deletingVersionId: string | null;
  publishingVersionId: string | null;
  onRefresh: () => void;
  onDelete: (version: DataRawTableNormalizerArtifactVersion) => void;
  onPublish: (version: DataRawTableNormalizerArtifactVersion) => void;
}

export function NormalizerVersionsDialog({
  open,
  onOpenChange,
  versions,
  currentVersion,
  currentVersionId,
  loading,
  deletingVersionId,
  publishingVersionId,
  onRefresh,
  onDelete,
  onPublish,
}: NormalizerVersionsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel={t('data.rawTables.editor.versionHistory')}
      className="w-full max-w-[760px] overflow-hidden !p-0"
    >
      <div
        className="grid h-10 grid-cols-[minmax(0,1fr)_92px_40px] border-b border-border-subtle"
        data-testid="normalizer-versions-header"
      >
        <div className="flex min-w-0 items-baseline gap-2 self-center px-3">
          <span className="text-[14px] font-semibold text-text-primary">
            {t('data.rawTables.editor.versionHistory')}
          </span>
          {versions.length > 0 ? (
            <span className="text-xs text-text-muted">
              {t('data.rawTables.editor.versionsCount', { count: versions.length })}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          className="inline-flex items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </button>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="inline-flex items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-accent-muted hover:text-accent"
          title={t('common.close')}
          aria-label={t('common.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <RawTableVersionHistoryPanel
        currentVersion={currentVersion}
        currentVersionId={currentVersionId}
        deletingVersionId={deletingVersionId}
        embedded
        loading={loading}
        onRefresh={onRefresh}
        onDelete={onDelete}
        onPublish={onPublish}
        publishingVersionId={publishingVersionId}
        sourceOf={(version) =>
          t(
            version.source === 'manual'
              ? 'scripts.source.manual'
              : version.source === 'ai_repair'
                ? 'scripts.source.ai_repair'
                : 'scripts.source.rule'
          )
        }
        t={t}
        versions={versions}
      />
    </Dialog>
  );
}
