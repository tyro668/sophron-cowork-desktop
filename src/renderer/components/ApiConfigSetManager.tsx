import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Layers3, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import type { ApiConfigSet, ProviderPresets } from '../types';
import { GlassDropdownMenu, GlassMenuItem } from './GlassDropdownMenu';
import { useConfirmDialog } from './ConfirmDialog';

type PendingConfigSetAction = { type: 'select' | 'switch'; targetSetId: string };

export interface ApiConfigSetManagerProps {
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
  selectedConfigSetId: string;
  currentConfigSet: ApiConfigSet | null;
  pendingConfigSetAction: PendingConfigSetAction | null;
  pendingConfigSet: ApiConfigSet | null;
  hasUnsavedChanges: boolean;
  isMutatingConfigSet: boolean;
  isSaving: boolean;
  presets?: ProviderPresets;
  variant?: 'inline' | 'sidebar';
  showPendingBanner?: boolean;
  onSelectSet: (setId: string) => Promise<void> | void;
  onSwitchSet: (setId: string) => Promise<void> | void;
  onRequestCreateBlankSet: () => Promise<void> | void;
  onRenameSet: (id: string, name: string) => Promise<boolean> | Promise<void> | void;
  onDeleteSet: (id: string) => Promise<boolean> | Promise<void> | void;
  onCancelPendingAction: () => void;
  onSaveAndContinuePendingAction: () => Promise<void> | void;
  onDiscardAndContinuePendingAction: () => Promise<void> | void;
}

export interface ApiConfigSetStateLike {
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
  selectedConfigSetId: string;
  currentConfigSet: ApiConfigSet | null;
  pendingConfigSetAction: PendingConfigSetAction | null;
  pendingConfigSet: ApiConfigSet | null;
  hasUnsavedChanges: boolean;
  isMutatingConfigSet: boolean;
  isSaving: boolean;
  presets?: ProviderPresets;
  requestSelectConfigSet: ApiConfigSetManagerProps['onSelectSet'];
  requestConfigSetSwitch: ApiConfigSetManagerProps['onSwitchSet'];
  requestCreateBlankConfigSet: ApiConfigSetManagerProps['onRequestCreateBlankSet'];
  renameConfigSet: ApiConfigSetManagerProps['onRenameSet'];
  deleteConfigSet: ApiConfigSetManagerProps['onDeleteSet'];
  cancelPendingConfigSetAction: ApiConfigSetManagerProps['onCancelPendingAction'];
  saveAndContinuePendingConfigSetAction: ApiConfigSetManagerProps['onSaveAndContinuePendingAction'];
  discardAndContinuePendingConfigSetAction: ApiConfigSetManagerProps['onDiscardAndContinuePendingAction'];
}

/** Map `useApiConfigState` return fields to `ApiConfigSetManagerProps`. */
export function pickApiConfigSetManagerProps(
  state: ApiConfigSetStateLike
): ApiConfigSetManagerProps {
  return {
    configSets: state.configSets,
    activeConfigSetId: state.activeConfigSetId,
    selectedConfigSetId: state.selectedConfigSetId,
    currentConfigSet: state.currentConfigSet,
    pendingConfigSetAction: state.pendingConfigSetAction,
    pendingConfigSet: state.pendingConfigSet,
    hasUnsavedChanges: state.hasUnsavedChanges,
    isMutatingConfigSet: state.isMutatingConfigSet,
    isSaving: state.isSaving,
    presets: state.presets,
    onSelectSet: state.requestSelectConfigSet,
    onSwitchSet: state.requestConfigSetSwitch,
    onRequestCreateBlankSet: state.requestCreateBlankConfigSet,
    onRenameSet: state.renameConfigSet,
    onDeleteSet: state.deleteConfigSet,
    onCancelPendingAction: state.cancelPendingConfigSetAction,
    onSaveAndContinuePendingAction: state.saveAndContinuePendingConfigSetAction,
    onDiscardAndContinuePendingAction: state.discardAndContinuePendingConfigSetAction,
  };
}

export function PendingConfigSetBanner({
  pendingConfigSet,
  isMutatingConfigSet,
  isSaving,
  onSaveAndContinue,
  onDiscardAndContinue,
  onCancel,
}: {
  pendingConfigSet: ApiConfigSet | null;
  isMutatingConfigSet: boolean;
  isSaving: boolean;
  onSaveAndContinue: () => Promise<void> | void;
  onDiscardAndContinue: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[36px] flex-wrap items-stretch justify-between border-b border-border-subtle bg-warning/10">
      <p className="flex min-w-0 flex-1 items-center px-3 py-1.5 text-[12px] font-medium text-text-primary">
        {t('api.unsavedSwitchPrompt', { name: pendingConfigSet?.name || '-' })}
      </p>
      <div className="flex shrink-0 items-stretch">
        <button
          type="button"
          onClick={() => void onSaveAndContinue()}
          disabled={isMutatingConfigSet || isSaving}
          className="ui-accent-cell border-l border-border-subtle"
        >
          {t('api.saveAndContinue')}
        </button>
        <button
          type="button"
          onClick={() => void onDiscardAndContinue()}
          disabled={isMutatingConfigSet || isSaving}
          className="inline-flex items-center justify-center border-l border-border-subtle px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
        >
          {t('api.discardAndContinue')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isMutatingConfigSet || isSaving}
          className="inline-flex items-center justify-center border-l border-border-subtle px-3 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
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
  presets,
  variant = 'inline',
  showPendingBanner = true,
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

  // Avoid repeating the model ID when the scheme is already named after it.
  const getSetSubtitle = (set: ApiConfigSet): string => {
    if (set.provider === '') return '';
    const providerLabel =
      set.provider === 'custom'
        ? set.customProtocol === 'openai'
          ? t('api.openaiCompatibleLabel')
          : set.customProtocol === 'anthropic'
            ? t('api.anthropicCompatibleLabel')
            : presets?.custom?.name || ''
        : presets?.[set.provider]?.name || '';
    const modelName = set.profiles?.[set.activeProfileKey]?.model?.trim() || '';
    const isSameAsName =
      modelName.length > 0 && modelName.toLowerCase() === set.name.trim().toLowerCase();
    if (isSameAsName) return providerLabel;
    if (providerLabel && modelName) return `${providerLabel} · ${modelName}`;
    return modelName || providerLabel || t('api.noModelsAvailable');
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

  const renderSetActionsMenu = (set: ApiConfigSet, isDefault: boolean, isSelected: boolean) => (
    <GlassDropdownMenu
      align="end"
      trigger={
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          disabled={isMutatingConfigSet}
          className={`flex shrink-0 items-center justify-center text-text-muted transition-colors hover:bg-surface-active hover:text-text-primary disabled:opacity-50 ${
            variant === 'sidebar'
              ? `w-8 self-stretch ${
                  isSelected
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                }`
              : 'h-6 w-6 rounded-md'
          }`}
          aria-label={t('api.moreActions')}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      }
      contentClassName="w-40"
    >
      <GlassMenuItem
        icon={<Star className="h-3.5 w-3.5" />}
        disabled={isDefault}
        onSelect={() => void onSwitchSet(set.id)}
      >
        {t('api.setAsDefaultSet')}
      </GlassMenuItem>
      <GlassMenuItem icon={<Pencil className="h-3.5 w-3.5" />} onSelect={() => beginRename(set)}>
        {t('api.renameSet')}
      </GlassMenuItem>
      <GlassMenuItem
        danger
        icon={<Trash2 className="h-3.5 w-3.5" />}
        disabled={!canDeleteSet(set)}
        onSelect={() => void requestDeleteSet(set)}
      >
        {t('api.deleteSet')}
      </GlassMenuItem>
    </GlassDropdownMenu>
  );

  if (variant === 'sidebar') {
    return (
      <aside className="flex w-full shrink-0 flex-col border-b border-border-subtle bg-background-secondary md:w-[232px] md:border-b-0 md:border-r lg:w-[248px]">
        <div className="flex h-9 shrink-0 items-stretch border-b border-border-subtle bg-surface-muted">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-3">
            <Layers3 className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <h2 className="truncate text-[12px] font-semibold text-text-primary">
              {t('api.configSet')}
            </h2>
            <span className="text-[11px] tabular-nums text-text-muted">{configSets.length}</span>
          </div>
          <button
            type="button"
            onClick={() => void onRequestCreateBlankSet()}
            disabled={isMutatingConfigSet || Boolean(renameTargetId)}
            className="ui-accent-cell shrink-0 border-l border-border-subtle !px-2.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('api.newSet')}
          </button>
        </div>

        <div className="scrollbar-hover max-h-48 flex-1 overflow-y-auto md:max-h-none">
          {configSets.map((set) => {
            const isSelected = set.id === selectedConfigSetId;
            const isDefault = set.id === activeConfigSetId;
            const isRenaming = renameTargetId === set.id;
            const subtitle = getSetSubtitle(set);
            return (
              <div
                key={set.id}
                className={`group flex min-w-0 items-stretch border-b border-border-subtle transition-colors ${
                  isSelected
                    ? 'bg-accent-muted text-text-primary shadow-[inset_3px_0_0_var(--color-accent)]'
                    : 'bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary'
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
                    className="min-h-[40px] min-w-0 flex-1 bg-surface px-3 text-[12.5px] text-text-primary outline-none"
                    aria-label={t('api.currentSetName')}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => void onSelectSet(set.id)}
                    disabled={isMutatingConfigSet}
                    aria-pressed={isSelected}
                    className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={`truncate text-[12.5px] leading-4 ${
                          isSelected ? 'font-semibold text-accent' : 'font-medium text-text-primary'
                        }`}
                      >
                        {set.name}
                      </span>
                      {isDefault && (
                        <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-accent">
                          {t('api.defaultSetTag')}
                        </span>
                      )}
                    </div>
                    {subtitle && (
                      <span className="truncate text-[11px] leading-3.5 text-text-muted">
                        {subtitle}
                      </span>
                    )}
                  </button>
                )}

                {!isRenaming && renderSetActionsMenu(set, isDefault, isSelected)}
              </div>
            );
          })}
        </div>

        {showPendingBanner && pendingConfigSetAction && (
          <div className="border-t border-border-subtle">
            <PendingConfigSetBanner
              pendingConfigSet={pendingConfigSet}
              isMutatingConfigSet={isMutatingConfigSet}
              isSaving={isSaving}
              onSaveAndContinue={onSaveAndContinuePendingAction}
              onDiscardAndContinue={onDiscardAndContinuePendingAction}
              onCancel={onCancelPendingAction}
            />
          </div>
        )}
      </aside>
    );
  }

  return (
    <section className="ui-group bg-surface">
      <div className="ui-group-title justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Layers3 className="h-3.5 w-3.5 text-text-muted" />
          <h2>{t('api.configSet')}</h2>
          {hasUnsavedChanges && (
            <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10.5px] font-medium text-warning">
              {t('api.unsavedBadge')}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void onRequestCreateBlankSet()}
          disabled={isMutatingConfigSet || Boolean(renameTargetId)}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent-muted/75 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('api.newSet')}
        </button>
      </div>

      <div className="divide-y divide-border-subtle">
        {configSets.map((set) => {
          const isSelected = set.id === selectedConfigSetId;
          const isDefault = set.id === activeConfigSetId;
          const isRenaming = renameTargetId === set.id;
          const subtitle = getSetSubtitle(set);
          return (
            <div
              key={set.id}
              className={`group flex h-9 min-w-0 items-center pr-1.5 transition-colors ${
                isSelected ? 'bg-accent-muted/80' : 'hover:bg-surface-hover'
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
                  className="mx-2 min-w-0 flex-1 rounded-md border border-accent bg-surface px-2 py-1 text-[12.5px] text-text-primary outline-none ring-2 ring-accent/15"
                  aria-label={t('api.currentSetName')}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => void onSelectSet(set.id)}
                  disabled={isMutatingConfigSet}
                  aria-pressed={isSelected}
                  className="flex min-w-0 flex-1 items-center gap-2 self-stretch px-3 text-left disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <span className="truncate text-[13px] font-medium text-text-primary">
                    {set.name}
                  </span>
                  {isDefault && (
                    <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-accent">
                      {t('api.defaultSetTag')}
                    </span>
                  )}
                  {isSelected && !isDefault && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                  )}
                  {subtitle && (
                    <span className="min-w-0 truncate text-[12px] text-text-muted">{subtitle}</span>
                  )}
                </button>
              )}

              {!isRenaming && renderSetActionsMenu(set, isDefault, isSelected)}
            </div>
          );
        })}
      </div>

      {showPendingBanner && pendingConfigSetAction && (
        <div className="border-t border-border-subtle">
          <PendingConfigSetBanner
            pendingConfigSet={pendingConfigSet}
            isMutatingConfigSet={isMutatingConfigSet}
            isSaving={isSaving}
            onSaveAndContinue={onSaveAndContinuePendingAction}
            onDiscardAndContinue={onDiscardAndContinuePendingAction}
            onCancel={onCancelPendingAction}
          />
        </div>
      )}
    </section>
  );
}
