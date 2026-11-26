import { AtSign, CheckCircle2, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store';
import type { PluginCatalogItemV2, Skill } from '../../../types';
import { Button } from '../../ui/button';
import {
  formatSkillDate,
  getSkillVisualIcon,
  skillUsageCount,
  type SkillTableItem,
} from './skill-helpers';
import { SkillStatusBadge, SkillTypeBadge } from './SkillTablePrimitives';

interface SkillDetailSidebarProps {
  selectedItem: SkillTableItem;
  selectedSkill: Skill | null;
  selectedPlugin: PluginCatalogItemV2 | null;
  selectedPluginInstalled: boolean;
  usageCounts: Record<string, number>;
  pluginActionKey: string | null;
  isLoading: boolean;
  onToggleEnabled: (skill: Skill) => void;
  onSelectedDeleteOrInstall: () => void;
}

export function SkillDetailSidebar({
  selectedItem,
  selectedSkill,
  selectedPlugin,
  selectedPluginInstalled,
  usageCounts,
  pluginActionKey,
  isLoading,
  onToggleEnabled,
  onSelectedDeleteOrInstall,
}: SkillDetailSidebarProps) {
  const { t } = useTranslation();
  const SelectedIcon = getSkillVisualIcon(selectedItem.name, selectedItem.type);

  return (
    <aside className="hidden min-h-0 min-w-0 flex-col overflow-hidden border-l border-border-subtle xl:flex">
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <section className="ui-group bg-surface">
          <div className="flex min-h-10 items-center gap-2 border-b border-border-subtle px-3 py-1.5">
            <SelectedIcon className="h-4 w-4 flex-shrink-0 text-text-muted" />
            <h3 className="min-w-0 truncate text-[14px] font-semibold text-text-primary">
              {selectedItem.name}
            </h3>
            <SkillTypeBadge item={selectedItem} />
            <SkillStatusBadge item={selectedItem} />
          </div>
          <div className="ui-form-row" style={{ gridTemplateColumns: '112px minmax(0,1fr)' }}>
            <span className="ui-form-label items-start pt-2.5">
              {t('skills.workspace.descriptionLabel')}
            </span>
            <div className="ui-form-value">
              <p className="line-clamp-4 break-words py-1 text-[12.5px] leading-5 text-text-secondary">
                {selectedItem.description || t('skills.installSkillsDesc')}
              </p>
            </div>
          </div>
        </section>

        {selectedItem.tags.length > 0 && (
          <section className="ui-group bg-surface">
            <h4 className="ui-group-title">{t('skills.workspace.supportedCapabilities')}</h4>
            {selectedItem.tags.map((tag) => (
              <div
                key={`${selectedItem.id}:${tag}`}
                className="flex h-9 min-w-0 items-center gap-2 border-b border-border-subtle px-3 text-[12.5px] text-text-secondary last:border-b-0"
              >
                <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate" title={tag}>
                  {tag}
                </span>
              </div>
            ))}
          </section>
        )}

        <section className="ui-group bg-surface">
          <h4 className="ui-group-title">{t('skills.workspace.detailsTitle')}</h4>
          {selectedSkill && (
            <div className="ui-form-row" style={{ gridTemplateColumns: '112px minmax(0,1fr)' }}>
              <span className="ui-form-label items-center">
                {t('skills.workspace.chatDisplay')}
              </span>
              <div className="ui-form-value">
                <span className="inline-flex h-6 items-center gap-1 self-start rounded-md border border-accent/20 bg-accent-muted px-2 text-[12px] text-accent-text">
                  <SelectedIcon className="h-3 w-3" />
                  {t('skills.workspace.usedSkillChip', { name: selectedSkill.name })}
                </span>
              </div>
            </div>
          )}
          <div className="ui-form-row" style={{ gridTemplateColumns: '112px minmax(0,1fr)' }}>
            <span className="ui-form-label items-center">{t('skills.workspace.source')}</span>
            <div className="ui-form-value text-[12.5px] text-text-secondary">
              {selectedItem.kind === 'plugin'
                ? t('skills.skillHubSource')
                : selectedItem.type === 'builtin'
                  ? t('skills.workspace.systemBuiltin')
                  : t('skills.customSkills')}
            </div>
          </div>
          <div className="ui-form-row" style={{ gridTemplateColumns: '112px minmax(0,1fr)' }}>
            <span className="ui-form-label items-center">
              {t('skills.workspace.table.updatedAt')}
            </span>
            <div className="ui-form-value font-mono text-[12px] text-text-secondary">
              {formatSkillDate(selectedItem.updatedAt)}
            </div>
          </div>
          {selectedSkill?.path && (
            <div className="ui-form-row" style={{ gridTemplateColumns: '112px minmax(0,1fr)' }}>
              <span className="ui-form-label items-center">{t('skills.workspace.directory')}</span>
              <div
                className="ui-form-value truncate font-mono text-[11.5px] text-text-secondary"
                title={selectedSkill.path}
              >
                <span className="truncate">{selectedSkill.path}</span>
              </div>
            </div>
          )}
        </section>

        <section className="ui-group bg-surface">
          <h4 className="ui-group-title">{t('skills.workspace.recentCallsTitle')}</h4>
          <div className="ui-form-row">
            <span className="ui-form-label items-center">
              {t('skills.workspace.recentCallsLabel')}
            </span>
            <div className="ui-form-value text-[13px] tabular-nums text-text-primary">
              {selectedSkill
                ? t('skills.workspace.recentCallsCount', {
                    count: skillUsageCount(usageCounts, selectedSkill),
                  })
                : '—'}
            </div>
          </div>
        </section>
      </div>

      {selectedSkill && (
        <div className="grid h-[49px] flex-shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-t border-border-subtle">
          <Button
            variant="primary"
            className="h-full rounded-none"
            disabled={!selectedSkill.enabled}
            onClick={() => {
              const store = useAppStore.getState();
              store.setPendingSkillMention(selectedSkill.name);
              store.setMainView('chat');
              store.setActiveSession(null);
              store.setShowSettings(false);
            }}
          >
            <AtSign className="h-3.5 w-3.5" />
            {t('skills.workspace.useInChat')}
          </Button>
          <Button
            variant="ghost"
            className="h-full rounded-none border-l border-border-subtle"
            disabled={isLoading}
            onClick={() => onToggleEnabled(selectedSkill)}
          >
            {selectedSkill.enabled ? (
              <PowerOff className="h-3.5 w-3.5" />
            ) : (
              <Power className="h-3.5 w-3.5" />
            )}
            {selectedSkill.enabled ? t('skills.pluginDisable') : t('skills.pluginEnable')}
          </Button>
        </div>
      )}

      {(selectedPlugin || (selectedSkill && selectedSkill.type !== 'builtin')) && (
        <div className="border-t border-border-subtle">
          <button
            type="button"
            onClick={onSelectedDeleteOrInstall}
            disabled={
              (!selectedPlugin && (!selectedSkill || selectedSkill.type === 'builtin')) ||
              selectedPluginInstalled ||
              pluginActionKey !== null ||
              isLoading
            }
            className={`inline-flex h-12 w-full items-center justify-center gap-2 px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
              selectedPlugin
                ? 'bg-accent-muted text-accent hover:bg-accent-muted'
                : 'text-error hover:bg-error/10'
            }`}
          >
            {selectedPlugin ? <Plus className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
            {selectedPlugin
              ? selectedPluginInstalled
                ? t('skills.pluginInstalled')
                : t('skills.pluginInstall')
              : t('skills.pluginManageUninstall')}
          </button>
        </div>
      )}
    </aside>
  );
}
