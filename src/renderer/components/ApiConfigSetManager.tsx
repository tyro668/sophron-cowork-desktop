import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Layers, Plus, Save, Trash2, Pencil } from 'lucide-react';
import type { ApiConfigSet } from '../types';
import { GlassSelect } from './GlassSelect';

type PendingConfigSetAction = { type: 'switch'; targetSetId: string };

interface ApiConfigSetManagerProps {
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
  currentConfigSet: ApiConfigSet | null;
  pendingConfigSetAction: PendingConfigSetAction | null;
  pendingConfigSet: ApiConfigSet | null;
  hasUnsavedChanges: boolean;
  isMutatingConfigSet: boolean;
  isSaving: boolean;
  onSwitchSet: (setId: string) => Promise<void> | void;
  onRequestCreateBlankSet: () => Promise<void> | void;
  onSaveCurrentSet: () => Promise<boolean> | Promise<void> | void;
  onRenameSet: (id: string, name: string) => Promise<boolean> | Promise<void> | void;
  onDeleteSet: (id: string) => Promise<boolean> | Promise<void> | void;
  onCancelPendingAction: () => void;
  onSaveAndContinuePendingAction: () => Promise<void> | void;
  onDiscardAndContinuePendingAction: () => Promise<void> | void;
}

export function ApiConfigSetManager(props: ApiConfigSetManagerProps) {
  const { t } = useTranslation();
  const {
    configSets,
    activeConfigSetId,
    currentConfigSet,
    pendingConfigSetAction,
    pendingConfigSet,
    hasUnsavedChanges,
    isMutatingConfigSet,
    isSaving,
    onSwitchSet,
    onRequestCreateBlankSet,
    onSaveCurrentSet,
    onRenameSet,
    onDeleteSet,
    onCancelPendingAction,
    onSaveAndContinuePendingAction,
    onDiscardAndContinuePendingAction,
  } = props;

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [isInlineRenaming, setIsInlineRenaming] = useState(false);

  useEffect(() => {
    setDeleteTargetId(null);
    setRenameName(currentConfigSet?.name || '');
    setIsInlineRenaming(false);
  }, [activeConfigSetId, currentConfigSet?.name]);

  const pendingActionMessage = t('api.unsavedSwitchPrompt', {
    name: pendingConfigSet?.name || '-',
  });
  const hasDialogOpen = deleteTargetId !== null;
  const canRenameCurrentConfigSet = Boolean(currentConfigSet);
  const deleteTargetSet = deleteTargetId
    ? configSets.find((set) => set.id === deleteTargetId) || null
    : null;
  const canDeleteSet = (set: ApiConfigSet): boolean =>
    set.id !== activeConfigSetId && configSets.length > 1;

  const cancelInlineRename = () => {
    setRenameName(currentConfigSet?.name || '');
    setIsInlineRenaming(false);
  };

  const configSetModelSummary = (set: ApiConfigSet): string =>
    set.profiles?.[set.activeProfileKey]?.model?.trim() || '';

  const commitInlineRename = async () => {
    if (!currentConfigSet) {
      setIsInlineRenaming(false);
      return;
    }
    const nextName = renameName.trim();
    if (!nextName || nextName === currentConfigSet.name) {
      setRenameName(currentConfigSet.name);
      setIsInlineRenaming(false);
      return;
    }
    const renamed = await onRenameSet(currentConfigSet.id, nextName);
    if (renamed === false) {
      setRenameName(currentConfigSet.name);
      return;
    }
    setIsInlineRenaming(false);
  };

  return (
    <div className="space-y-3 py-5 border-b border-border-muted px-4">
      <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
        <Layers className="w-4 h-4" />
        {t('api.configSet')}
        {hasUnsavedChanges && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning">
            {t('api.unsavedBadge')}
          </span>
        )}
      </label>
      <div className="space-y-2">
        {isInlineRenaming ? (
          <input
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onBlur={() => {
              void commitInlineRename();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commitInlineRename();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelInlineRename();
              }
            }}
            autoFocus
            disabled={isMutatingConfigSet || hasDialogOpen}
            placeholder={t('api.createSetNamePlaceholder')}
            className="w-full px-3 py-2.5 rounded-lg bg-background border border-border-muted text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent disabled:opacity-60"
          />
        ) : (
          <GlassSelect
            value={activeConfigSetId}
            onValueChange={(value) => {
              void onSwitchSet(value);
            }}
            options={configSets.map((set) => ({
              value: set.id,
              label: set.isSystem ? `${set.name} (${t('api.defaultSetTag')})` : set.name,
            }))}
            disabled={isMutatingConfigSet || hasDialogOpen}
            triggerClassName="h-10 w-full justify-between rounded-lg bg-background px-3 text-text-primary disabled:opacity-60"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        )}
        {isInlineRenaming && (
          <p className="text-[11px] text-text-muted">{t('api.renameInlineHint')}</p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void onSaveCurrentSet();
            }}
            disabled={isMutatingConfigSet || hasDialogOpen || isInlineRenaming}
            className="px-3 py-2 rounded-lg border border-border-muted bg-background hover:bg-surface-hover text-text-secondary text-xs hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            <Save className="w-3.5 h-3.5" />
            {t('common.save')}
          </button>
          <button
            type="button"
            onClick={() => {
              void onRequestCreateBlankSet();
            }}
            disabled={isMutatingConfigSet || hasDialogOpen || isInlineRenaming}
            className="px-3 py-2 rounded-lg border border-border-muted bg-background hover:bg-surface-hover text-text-secondary text-xs hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('api.newSet')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!currentConfigSet) {
                return;
              }
              setRenameName(currentConfigSet.name);
              setIsInlineRenaming(true);
            }}
            disabled={
              isMutatingConfigSet || !canRenameCurrentConfigSet || hasDialogOpen || isInlineRenaming
            }
            className="px-3 py-2 rounded-lg border border-border-muted bg-background hover:bg-surface-hover text-text-secondary text-xs hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            <Pencil className="w-3.5 h-3.5" />
            {t('api.renameSet')}
          </button>
        </div>
        <div className="space-y-1.5 pt-1">
          {configSets.map((set) => {
            const isActive = set.id === activeConfigSetId;
            const modelSummary = configSetModelSummary(set);
            return (
              <div
                key={set.id}
                className="flex items-center gap-2 rounded-lg border border-border-muted bg-background/42 px-3 py-2"
              >
                <span className="min-w-0 truncate text-[13px] text-text-primary">{set.name}</span>
                {modelSummary && (
                  <span className="min-w-0 truncate text-xs text-text-muted">{modelSummary}</span>
                )}
                <div className="flex-1" />
                {isActive ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                    <Check className="w-3 h-3" />
                    {t('api.defaultSetTag')}
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void onSwitchSet(set.id);
                      }}
                      disabled={isMutatingConfigSet || hasDialogOpen || isInlineRenaming}
                      className="shrink-0 px-2 py-1 rounded-md border border-border-muted bg-background text-[11px] text-text-secondary hover:text-text-primary hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {t('api.setAsDefaultSet')}
                    </button>
                    {canDeleteSet(set) && (
                      <button
                        type="button"
                        onClick={() => setDeleteTargetId(set.id)}
                        disabled={isMutatingConfigSet || hasDialogOpen || isInlineRenaming}
                        title={t('api.deleteSet')}
                        className="shrink-0 px-1.5 py-1 rounded-md text-text-muted hover:text-error hover:bg-error/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-text-muted">{t('api.currentSetSavingHint')}</p>

      {deleteTargetSet && (
        <div className="space-y-3 rounded-lg border border-error/30 bg-error/10 px-3 py-3">
          <p className="text-xs text-text-primary">
            {t('api.configSetDeleteConfirm', { name: deleteTargetSet.name })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDeleteTargetId(null)}
              disabled={isMutatingConfigSet}
              className="px-2 py-2 rounded-lg border border-border bg-surface text-text-secondary text-xs font-medium hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!deleteTargetSet || !canDeleteSet(deleteTargetSet)) {
                  return;
                }
                const deleted = await onDeleteSet(deleteTargetSet.id);
                if (deleted !== false) {
                  setDeleteTargetId(null);
                }
              }}
              disabled={isMutatingConfigSet}
              className="px-2 py-2 rounded-lg bg-error text-white text-xs font-medium hover:bg-error/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('api.deleteSet')}
            </button>
          </div>
        </div>
      )}

      {pendingConfigSetAction && (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-3">
          <p className="text-xs text-text-primary">{pendingActionMessage}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                void onSaveAndContinuePendingAction();
              }}
              disabled={isMutatingConfigSet || isSaving}
              className="px-2 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('api.saveAndContinue')}
            </button>
            <button
              type="button"
              onClick={() => {
                void onDiscardAndContinuePendingAction();
              }}
              disabled={isMutatingConfigSet || isSaving}
              className="px-2 py-2 rounded-lg bg-surface-hover text-text-secondary text-xs font-medium hover:bg-surface-active disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('api.discardAndContinue')}
            </button>
            <button
              type="button"
              onClick={onCancelPendingAction}
              disabled={isMutatingConfigSet || isSaving}
              className="px-2 py-2 rounded-lg border border-border bg-surface text-text-secondary text-xs font-medium hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {hasUnsavedChanges && !pendingConfigSetAction && (
        <p className="text-xs text-warning">{t('api.unsavedCurrentSetHint')}</p>
      )}
    </div>
  );
}
