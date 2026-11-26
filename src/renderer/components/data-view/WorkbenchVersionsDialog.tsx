import { RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../ui/dialog';
import {
  RawTableVersionHistoryPanel,
  type HistoryVersionDiff,
  type HistoryVersionLike,
} from './raw-table-version-history';

interface WorkbenchVersionsDialogProps<V extends HistoryVersionLike> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versions: V[];
  currentVersion?: V;
  currentVersionId?: string;
  loading: boolean;
  deletingVersionId: string | null;
  publishingVersionId: string | null;
  maxWidthClassName?: string;
  headerTestId?: string;
  onRefresh: () => void;
  onDelete: (version: V) => void;
  onPublish: (version: V) => void;
  sourceOf?: (version: V) => string;
  diffOf?: (version: V, current: V | undefined) => HistoryVersionDiff | null;
  onOpen?: (version: V) => void;
}

export function WorkbenchVersionsDialog<V extends HistoryVersionLike>({
  open,
  onOpenChange,
  versions,
  currentVersion,
  currentVersionId,
  loading,
  deletingVersionId,
  publishingVersionId,
  maxWidthClassName = 'max-w-[760px]',
  headerTestId,
  onRefresh,
  onDelete,
  onPublish,
  sourceOf,
  diffOf,
  onOpen,
}: WorkbenchVersionsDialogProps<V>) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel={t('data.rawTables.editor.versionHistory')}
      className={`w-full ${maxWidthClassName} overflow-hidden !p-0`}
    >
      <div
        className="grid h-10 grid-cols-[minmax(0,1fr)_92px_40px] border-b border-border-subtle"
        data-testid={headerTestId}
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
      <RawTableVersionHistoryPanel<V>
        currentVersion={currentVersion}
        currentVersionId={currentVersionId}
        deletingVersionId={deletingVersionId}
        embedded
        loading={loading}
        onRefresh={onRefresh}
        onDelete={onDelete}
        onPublish={onPublish}
        publishingVersionId={publishingVersionId}
        sourceOf={sourceOf}
        diffOf={diffOf}
        onOpen={onOpen}
        t={t}
        versions={versions}
      />
    </Dialog>
  );
}
