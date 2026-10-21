import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Layers3, MoreVertical, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import type { ApiConfigSet } from '../types';
import { GlassDropdownMenu, GlassMenuItem } from './GlassDropdownMenu';
import { useConfirmDialog } from './ConfirmDialog';
import { Button } from './ui/button';

type PendingConfigSetAction = { type: 'select' | 'switch'; targetSetId: string };

interface ApiConfigSetManagerProps {
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
  selectedConfigSetId: string;
  currentConfigSet: ApiConfigSet | null;
  pendingConfigSetAction: PendingConfigSetAction | null;
  pendingConfigSet: ApiConfigSet | null;
  hasUnsavedChanges: boolean;
  isMutatingConfigSet: boolean;
  isSaving: boolean;
  onSelectSet: (setId: string) => Promise<void> | void;
  onSwitchSet: (setId: string) => Promise<void> | void;
  onRequestCreateBlankSet: () => Promise<void> | void;
  onRenameSet: (id: string, name: string) => Promise<boolean> | Promise<void> | void;
  onDeleteSet: (id: string) => Promise<boolean> | Promise<void> | void;
  onCancelPendingAction: () => void;
  onSaveAndContinuePendingAction: () => Promise<void> | void;
  onDiscardAndContinuePendingAction: () => Promise<void> | void;
}

export function ApiConfigSetManager({
  configSets,
  activeConfigSetId,
  selectedConfigSetId,
  currentConfigSet,
  pendingConfigSetAction,
  pendingConfigSet,
  hasUnsavedChanges,
  isMutatingConfigSet,
  isSaving,
  onSelectSet,
  onSwitchSet,
  onRequestCreateBlankSet,
  onRenameSet,
  onDeleteSet,
  onCancelPendingAction,
  onSaveAndContinuePendingAction,
  onDiscardAndContinuePendingAction,
}: ApiConfigSetManagerProps) {
  const { t } = useTranslation();
  const { confirmDelete } = useConfirmDialog();
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');

  useEffect(() => {
    setRenameTargetId(null);
    setRenameName(currentConfigSet?.name || '');
  }, [selectedConfigSetId, currentConfigSet?.name]);

  const canDeleteSet = (set: ApiConfigSet): boolean =>
    !set.isSystem && set.id !== activeConfigSetId && configSets.length > 1;
  const modelSummary = (set: ApiConfigSet): string => {
    // A blank set has no provider/model chosen yet — show nothing.
    if (set.provider === '') return '';
    return set.profiles?.[set.activeProfileKey]?.model?.trim() || t('api.noModelsAvailable');
  };

  const requestDeleteSet = async (set: ApiConfigSet) => {
    if (!canDeleteSet(set)) return;
    const confirmed = await confirmDelete({
      message: t('api.configSetDeleteConfirm', { name: set.name }),
      confirmLabel: t('api.deleteSet'),
    });
    if (!confirmed) return;
    await onDeleteSet(set.id);
  };

  const beginRename = (set: ApiConfigSet) => {
    setRenameTargetId(set.id);
    setRenameName(set.name);
  };

  const cancelRename = () => {
    setRenameTargetId(null);
    setRenameName('');
  };

  const commitRename = async () => {
    if (!renameTargetId) return;
    const target = configSets.find((set) => set.id === renameTargetId);
    const nextName = renameName.trim();
    if (!target || !nextName || nextName === target.name) {
      cancelRename();
      return;
    }
    const renamed = await onRenameSet(target.id, nextName);
    if (renamed !== false) cancelRename();
  };

  return (
    <section className="ui-group bg-surface">
      <div className="ui-group-title gap-2">
        <Layers3 className="h-3.5 w-3.5 text-text-muted" />
        <h2>{t('api.configSet')}</h2>
        {hasUnsavedChanges && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
            {t('api.unsavedBadge')}
          </span>
        )}
      </div>

      <div className="ui-form-row">
        <span className="ui-form-label items-start">
          <span className="mt-2.5">{t('api.configSetLabel')}</span>
        </span>
        <div className="flex min-w-0 flex-col">
          {configSets.map((set) => {
            const isSelected = set.id === selectedConfigSetId;
            const isDefault = set.id === activeConfigSetId;
            const isRenaming = renameTargetId === set.id;
            const summary = modelSummary(set);
            return (
              <div
                key={set.id}
                className={`group flex h-9 min-w-0 items-center border-b border-border-subtle transition-colors ${
                  isSelected ? 'bg-accent-muted' : 'hover:bg-surface-hover'
                }`}
              >
                {isRenaming ? (
                  <input
                    value={renameName}
                    onChange={(event) => setRenameName(event.target.value)}
                    onBlur={() => void commitRename()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void commitRename();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                    autoFocus
                    className="mx-1.5 min-w-0 flex-1 rounded-md border border-accent bg-background px-2 py-1.5 text-[13px] text-text-primary outline-none ring-2 ring-accent/15"
                    aria-label={t('api.currentSetName')}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => void onSelectSet(set.id)}
                    disabled={isMutatingConfigSet}
                    aria-pressed={isSelected}
                    className="flex min-w-0 flex-1 items-center gap-2 self-stretch px-3 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <div className="flex min-w-0 shrink-0 items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium text-text-primary">
                          {set.name}
                        </span>
                        {set.isSystem && (
                          <span className="shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                            {t('api.defaultSetTag')}
                          </span>
                        )}
                        {isSelected && !set.isSystem && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                        )}
                      </div>
                      {summary && (
                        <p className="min-w-0 truncate text-[12px] text-text-muted">{summary}</p>
                      )}
                    </div>
                  </button>
                )}

                {!isRenaming && (
                  <GlassDropdownMenu
                    align="end"
                    trigger={
                      <button
                        type="button"
                        onClick={(event) => event.stopPropagation()}
                        disabled={isMutatingConfigSet}
                        className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-active hover:text-text-primary disabled:opacity-50"
                        aria-label={t('api.moreActions')}
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    }
                    contentClassName="w-40"
                  >
                    <GlassMenuItem
                      icon={<Star className="h-4 w-4" />}
                      disabled={isDefault}
                      onSelect={() => void onSwitchSet(set.id)}
                    >
                      {t('api.setAsDefaultSet')}
                    </GlassMenuItem>
                    <GlassMenuItem
                      icon={<Pencil className="h-4 w-4" />}
                      onSelect={() => beginRename(set)}
                    >
                      {t('api.renameSet')}
                    </GlassMenuItem>
                    <GlassMenuItem
                      danger
                      icon={<Trash2 className="h-4 w-4" />}
                      disabled={!canDeleteSet(set)}
                      onSelect={() => void requestDeleteSet(set)}
                    >
                      {t('api.deleteSet')}
                    </GlassMenuItem>
                  </GlassDropdownMenu>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => void onRequestCreateBlankSet()}
            disabled={isMutatingConfigSet || Boolean(renameTargetId)}
            className="flex h-9 items-center gap-1.5 px-3 text-[13px] font-medium text-accent transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('api.newSet')}
          </button>
        </div>
      </div>

      {pendingConfigSetAction && (
        <div className="space-y-2 border-t border-border-subtle bg-warning/10 px-3 py-3">
          <p className="text-xs text-text-primary">
            {t('api.unsavedSwitchPrompt', { name: pendingConfigSet?.name || '-' })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => void onSaveAndContinuePendingAction()}
              disabled={isMutatingConfigSet || isSaving}
              className="shadow-soft"
            >
              {t('api.saveAndContinue')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void onDiscardAndContinuePendingAction()}
              disabled={isMutatingConfigSet || isSaving}
            >
              {t('api.discardAndContinue')}
            </Button>
            <Button
              variant="secondary"
              onClick={onCancelPendingAction}
              disabled={isMutatingConfigSet || isSaving}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
