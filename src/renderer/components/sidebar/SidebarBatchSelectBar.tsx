import { Check, Minus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button } from '../ui';

interface SidebarBatchSelectBarProps {
  showDeleteConfirm: boolean;
  selectedCount: number;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
  onCancelDeleteConfirm: () => void;
  onRequestDeleteConfirm: () => void;
  onConfirmBatchDelete: () => void;
  onToggleSelectAll: () => void;
  onExitSelectMode: () => void;
}

export function SidebarBatchSelectBar({
  showDeleteConfirm,
  selectedCount,
  allVisibleSelected,
  someVisibleSelected,
  onCancelDeleteConfirm,
  onRequestDeleteConfirm,
  onConfirmBatchDelete,
  onToggleSelectAll,
  onExitSelectMode,
}: SidebarBatchSelectBarProps) {
  const { t } = useTranslation();

  return (
    <div className="border-t border-border-subtle bg-surface px-3 py-3">
      {showDeleteConfirm ? (
        <div className="rounded-xl border border-error/25 bg-error/10 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <Trash2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-error" />
            <p className="min-w-0 flex-1 text-[12px] leading-4 text-text-primary">
              {t('sidebar.batchDeleteConfirm', { count: selectedCount })}
            </p>
          </div>
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancelDeleteConfirm}>
              {t('sidebar.cancel')}
            </Button>
            <Button variant="danger" size="sm" onClick={onConfirmBatchDelete}>
              {t('sidebar.confirmDelete')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-0.5">
            <button
              onClick={onToggleSelectAll}
              className="group flex items-center gap-2 text-[12px] font-medium text-text-secondary transition-colors hover:text-text-primary"
            >
              <span
                aria-hidden
                className={`flex h-4 w-4 items-center justify-center rounded-md border transition-colors ${
                  allVisibleSelected || someVisibleSelected
                    ? 'border-accent bg-accent text-accent-foreground'
                    : 'border-border-muted bg-surface group-hover:border-accent/50'
                }`}
              >
                {allVisibleSelected ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : someVisibleSelected ? (
                  <Minus className="h-3 w-3" strokeWidth={3} />
                ) : null}
              </span>
              {allVisibleSelected ? t('sidebar.deselectAll') : t('sidebar.selectAll')}
            </button>
            <Badge tone={selectedCount > 0 ? 'accent' : 'default'}>
              {t('sidebar.nSelected', { count: selectedCount })}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              className="flex-1 rounded-xl"
              onClick={onExitSelectMode}
            >
              {t('sidebar.cancel')}
            </Button>
            <Button
              variant="danger"
              size="md"
              className="flex-1 rounded-xl"
              disabled={selectedCount === 0}
              onClick={onRequestDeleteConfirm}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('common.delete')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
